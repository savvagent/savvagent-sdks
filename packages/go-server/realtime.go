package savvagentflags

// The flag-change stream, GET /api/flags/stream (docs/SDK-DEVELOPER-GUIDE.md, Real-time
// Updates), which invalidates cached evaluations so a flag change, a kill switch above all,
// reaches the client in about a round trip instead of after the cache TTL (#167).
//
// One goroutine per client holds one long-lived connection and ends when Close is called. A
// flag.created, flag.updated or flag.deleted event invalidates that flag through the cache's
// generation counters, so an evaluation in flight when it arrived is not cached either (#137).
// Each connected event (the server sends one on every connect) invalidates the whole cache:
// events may have been missed while the stream was down, and CacheTTL bounds staleness in the
// meantime. Lookups never wait on the stream: the goroutine only writes to the cache.
//
// A dropped or refused stream is retried with exponential backoff and jitter; the attempt count
// resets only after a connection stayed up for stableAfter, so a server that accepts and drops at
// once is not retried at the base delay forever. A failed connect attempt calls OnError once;
// nothing else reaches the host. The key is sent only in the Authorization header and is never
// put in an error.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// maxEventBytes bounds one event (the pending line, name and data). One event carries
// one flag with its variations and their configurations: generous, but finite, so a broken or
// hostile peer cannot grow the buffer without bound.
const maxEventBytes = 4 * 1024 * 1024

// maxAttempt bounds the attempt counter; the delay reaches its cap long before.
const maxAttempt = 64

// errEventTooLarge reports a pending event over maxEventBytes; the connection is dropped.
var errEventTooLarge = errors.New("savvagent flags stream: event too large")

// realtimeOptions holds the stream's timings. NewClient uses defaultRealtimeOptions; tests pass
// small ones so nothing waits for seconds.
type realtimeOptions struct {
	// baseDelay is the first retry's full delay; the wait is half of it to all of it.
	baseDelay time.Duration
	// maxDelay caps the delay after a dropped stream or a transport error.
	maxDelay time.Duration
	// rejectedMaxDelay caps the delay after a 401, 403 or 404: the key is refused or the
	// endpoint absent, and retrying fast changes nothing.
	rejectedMaxDelay time.Duration
	// maxRetryAfter caps how far a Retry-After can stretch one wait, so a proxy cannot hold
	// the stream off for hours.
	maxRetryAfter time.Duration
	// stableAfter is how long a connection must stay up to reset the backoff.
	stableAfter time.Duration
	// spread is the longest extra wait before the first retry of a stream that was up, so
	// clients whose streams one deploy dropped do not reconnect together.
	spread time.Duration
	// idleTimeout drops a connection that received nothing for this long. The server sends a
	// heartbeat every 30 s; three missed ones mean the connection is dead even if the socket
	// has not noticed.
	idleTimeout time.Duration
	// headerTimeout bounds the wait for the response headers.
	headerTimeout time.Duration
	// random returns a value in [0, 1) for jitter. It must be safe for concurrent use.
	random func() float64
}

func defaultRealtimeOptions() realtimeOptions {
	return realtimeOptions{
		baseDelay:        time.Second,
		maxDelay:         30 * time.Second,
		rejectedMaxDelay: 5 * time.Minute,
		maxRetryAfter:    60 * time.Second,
		stableAfter:      30 * time.Second,
		spread:           5 * time.Second,
		idleTimeout:      90 * time.Second,
		headerTimeout:    90 * time.Second,
		random:           rand.Float64,
	}
}

// sseEvent is one dispatched server-sent event.
type sseEvent struct {
	// event is the event field, "message" when the event had none.
	event string
	// data is the data lines, joined with "\n".
	data string
}

// sseParser is incremental text/event-stream framing. A chunk may end anywhere, even inside a
// UTF-8 character, so bytes are buffered and a line is processed only once its "\n" arrived.
type sseParser struct {
	// line holds the bytes of the line not yet terminated.
	line []byte
	// event is the pending event's name; hasEvent says whether it had an event field.
	event    string
	hasEvent bool
	// data holds the pending event's data lines, joined with "\n" as they arrive, so its
	// length is exactly what the cap counts (a flood of empty data lines still costs a byte
	// each). hasData says whether there was a data line at all (it may have been empty).
	data    []byte
	hasData bool
}

// feed takes the next chunk of the body and returns the events it completed. After
// errEventTooLarge the parser must not be used again.
func (p *sseParser) feed(chunk []byte) ([]sseEvent, error) {
	var events []sseEvent
	for {
		i := bytes.IndexByte(chunk, '\n')
		if i < 0 {
			break
		}
		p.line = append(p.line, chunk[:i]...)
		if p.tooLarge() {
			return events, errEventTooLarge
		}
		chunk = chunk[i+1:]
		line := p.line
		if n := len(line); n > 0 && line[n-1] == '\r' {
			line = line[:n-1]
		}
		if ev, ok := p.process(line); ok {
			events = append(events, ev)
		}
		// Keep the allocation for the next line; process copied what it kept.
		p.line = p.line[:0]
	}
	p.line = append(p.line, chunk...)
	if p.tooLarge() {
		return events, errEventTooLarge
	}
	return events, nil
}

func (p *sseParser) tooLarge() bool {
	return len(p.line)+len(p.data)+len(p.event) > maxEventBytes
}

// process applies one complete line; an empty line dispatches the pending event. It copies
// whatever it keeps from line, which the caller reuses.
func (p *sseParser) process(line []byte) (sseEvent, bool) {
	if len(line) == 0 {
		if !p.hasEvent && !p.hasData {
			return sseEvent{}, false
		}
		ev := sseEvent{event: p.event, data: string(p.data)}
		if !p.hasEvent {
			ev.event = "message"
		}
		p.event, p.hasEvent = "", false
		p.data, p.hasData = p.data[:0], false
		return ev, true
	}
	if line[0] == ':' {
		return sseEvent{}, false
	}
	field, value := line, []byte(nil)
	if i := bytes.IndexByte(line, ':'); i >= 0 {
		field, value = line[:i], line[i+1:]
		if len(value) > 0 && value[0] == ' ' {
			value = value[1:]
		}
	}
	switch string(field) {
	case "event":
		p.event, p.hasEvent = string(value), true
	case "data":
		if p.hasData {
			p.data = append(p.data, '\n')
		}
		p.data = append(p.data, value...)
		p.hasData = true
	}
	// id and retry are not used: a reconnect clears the cache rather than resuming, and the
	// delay is the client's own.
	return sseEvent{}, false
}

// clampUnit maps unit into [0, 1]; NaN is 0.
func clampUnit(unit float64) float64 {
	switch {
	case math.IsNaN(unit) || unit < 0:
		return 0
	case unit > 1:
		return 1
	}
	return unit
}

// reconnectDelay is the wait before reconnect attempt attempt (from 0):
// min(base * 2^attempt, ceiling), scaled into [50%, 100%] by unit in [0, 1), so clients dropped
// together do not reconnect together. A unit out of range is clamped.
func reconnectDelay(base time.Duration, attempt int, ceiling time.Duration, unit float64) time.Duration {
	if base <= 0 || ceiling <= 0 {
		return 0
	}
	d := base
	for i := 0; i < attempt && d < ceiling; i++ {
		d *= 2
	}
	if d > ceiling {
		d = ceiling
	}
	return time.Duration(float64(d) * (0.5 + clampUnit(unit)/2))
}

// reconnectSpread is the extra wait on top of reconnectDelay for the first retry after an
// established stream ended, uniform in [0, spread) by unit; zero otherwise. The base delay is
// about a second, far too narrow to spread every client of an app whose streams a deploy
// dropped at the same instant.
func reconnectSpread(spread time.Duration, attempt int, wasUp bool, unit float64) time.Duration {
	if attempt != 0 || !wasUp || math.IsNaN(unit) {
		return 0
	}
	return time.Duration(float64(spread) * clampUnit(unit))
}

// parseRetryAfter reads a Retry-After header given in seconds. An HTTP date, a negative or
// fractional value, or a number too large for a uint64 is ignored.
func parseRetryAfter(value string) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	for i := 0; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, false
	}
	const maxSeconds = uint64(math.MaxInt64 / int64(time.Second))
	if n > maxSeconds {
		n = maxSeconds
	}
	return time.Duration(n) * time.Second, true
}

// streamURL is <baseURL>/api/flags/stream, keeping any path prefix in baseURL (one trailing
// slash is dropped) and dropping any query or fragment. The error
// does not echo baseURL.
func streamURL(baseURL string) (string, error) {
	u, err := url.Parse(baseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("savvagent flags stream: BaseURL is not an http(s) URL; real-time updates are off")
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/flags/stream"
	u.RawPath = ""
	u.RawQuery = ""
	u.ForceQuery = false
	u.Fragment = ""
	u.RawFragment = ""
	return u.String(), nil
}

// changedFlagKey returns the key of a flag event, if its data is a JSON object with a string
// "key" that a flag can have. Event text is untrusted: it is only ever used as a cache key, and
// only after this check.
func changedFlagKey(data string) (string, bool) {
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(data), &fields) != nil {
		return "", false
	}
	raw, ok := fields["key"]
	if !ok {
		return "", false
	}
	var key string
	if json.Unmarshal(raw, &key) != nil || !isValidFlagKey(key) {
		return "", false
	}
	return key, true
}

// applyEvent applies one event to the cache. heartbeat and events this SDK does not know are
// ignored. A flag event can never clear the whole cache: "" is not a valid flag key.
func applyEvent(c *cache, ev sseEvent) {
	switch ev.event {
	case "connected":
		c.Invalidate("")
	case "flag.created", "flag.updated", "flag.deleted":
		if key, ok := changedFlagKey(ev.data); ok {
			c.Invalidate(key)
		}
	}
}

// endKind says how one connection attempt ended.
type endKind int

const (
	// endUnreachable: the request failed before a response (refused, unreachable, timeout).
	endUnreachable endKind = iota
	// endRefused: the server answered with a non-2xx status, or a 2xx that is not an event
	// stream.
	endRefused
	// endDropped: the stream was open from since until it ended (closed, broke, went idle, or
	// sent an event over the cap).
	endDropped
)

type connEnd struct {
	kind          endKind
	status        int
	retryAfter    time.Duration
	hasRetryAfter bool
	since         time.Time
}

// nextDelay is the wait after end before attempt attempt.
func (o realtimeOptions) nextDelay(end connEnd, attempt int) time.Duration {
	ceiling := o.maxDelay
	if end.kind == endRefused {
		switch end.status {
		case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
			ceiling = o.rejectedMaxDelay
		}
	}
	delay := reconnectDelay(o.baseDelay, attempt, ceiling, o.random()) +
		reconnectSpread(o.spread, attempt, end.kind == endDropped, o.random())
	if end.kind == endRefused && end.hasRetryAfter &&
		(end.status == http.StatusTooManyRequests || end.status == http.StatusServiceUnavailable) {
		retryAfter := end.retryAfter
		if retryAfter > o.maxRetryAfter {
			retryAfter = o.maxRetryAfter
		}
		if retryAfter > delay {
			delay = retryAfter
		}
	}
	return delay
}

// streamer is the state of one client's stream goroutine.
type streamer struct {
	cache   *cache
	client  *http.Client
	url     string
	apiKey  string
	onError func(error)
	opts    realtimeOptions
}

// realtimeStream is a running stream goroutine.
type realtimeStream struct {
	cancel context.CancelFunc
	// done is closed when the goroutine has returned.
	done chan struct{}
}

// stop ends the goroutine and waits for it. Every wait in it is raced against the context,
// so this returns promptly. It must not be called from the goroutine itself (from OnError).
func (r *realtimeStream) stop() {
	r.cancel()
	<-r.done
}

// startRealtime starts the stream goroutine for config, which has its defaults applied. It
// returns nil, after one OnError call, when BaseURL cannot carry the stream path.
func startRealtime(config Config, c *cache, opts realtimeOptions) *realtimeStream {
	streamAt, err := streamURL(config.BaseURL)
	if err != nil {
		config.OnError(err)
		return nil
	}
	var transport *http.Transport
	if t, ok := http.DefaultTransport.(*http.Transport); ok {
		transport = t.Clone()
	} else {
		transport = &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			TLSHandshakeTimeout: 10 * time.Second,
			ForceAttemptHTTP2:   true,
		}
	}
	// Automatic gzip could hold events back if a proxy compresses without flushing each one.
	transport.DisableCompression = true
	transport.DialContext = (&net.Dialer{Timeout: config.Timeout, KeepAlive: 30 * time.Second}).DialContext
	transport.ResponseHeaderTimeout = opts.headerTimeout
	// No total timeout, which would cut the stream off; the transport bounds the dial and the
	// headers, and the idle watchdog the body.
	client := &http.Client{Transport: transport}
	// A redirect could carry the key elsewhere; a 3xx is a refused attempt.
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	s := &streamer{
		cache:   c,
		client:  client,
		url:     streamAt,
		apiKey:  config.APIKey,
		onError: config.OnError,
		opts:    opts,
	}
	ctx, cancel := context.WithCancel(context.Background())
	rs := &realtimeStream{cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(rs.done)
		defer transport.CloseIdleConnections()
		s.run(ctx)
	}()
	return rs
}

// run connects, reads, and reconnects until ctx is cancelled.
func (s *streamer) run(ctx context.Context) {
	attempt := 0
	for {
		end := s.connect(ctx)
		if ctx.Err() != nil {
			return
		}
		if end.kind == endDropped && time.Since(end.since) >= s.opts.stableAfter {
			attempt = 0
		}
		delay := s.opts.nextDelay(end, attempt)
		if attempt < maxAttempt {
			attempt++
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// report passes a failed connect attempt to OnError, unless the client is closing.
func (s *streamer) report(ctx context.Context, err error) {
	if ctx.Err() != nil {
		return
	}
	s.onError(err)
}

// connect opens the stream and applies its events until it ends.
func (s *streamer) connect(ctx context.Context) connEnd {
	reqCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, s.url, nil)
	if err != nil {
		s.report(ctx, fmt.Errorf("savvagent flags stream: %w", err))
		return connEnd{kind: endUnreachable}
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := s.client.Do(req)
	if err != nil {
		s.report(ctx, fmt.Errorf("savvagent flags stream: connect failed: %w", err))
		return connEnd{kind: endUnreachable}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		end := connEnd{kind: endRefused, status: resp.StatusCode}
		end.retryAfter, end.hasRetryAfter = parseRetryAfter(resp.Header.Get("Retry-After"))
		s.report(ctx, fmt.Errorf("savvagent flags stream: connect refused (status %d)", resp.StatusCode))
		return end
	}
	if !strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		// A captive portal or a proxy's error page: reading it as events would idle until the
		// timeout and look like a working stream.
		s.report(ctx, fmt.Errorf("savvagent flags stream: the response is not text/event-stream (status %d)", resp.StatusCode))
		return connEnd{kind: endRefused, status: resp.StatusCode}
	}

	since := time.Now()
	// The watchdog cancels the request, which ends a blocked Read.
	idle := time.AfterFunc(s.opts.idleTimeout, cancel)
	defer idle.Stop()
	var parser sseParser
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			idle.Reset(s.opts.idleTimeout)
			events, perr := parser.feed(buf[:n])
			for _, ev := range events {
				applyEvent(s.cache, ev)
			}
			if perr != nil {
				break
			}
		}
		if err != nil {
			break
		}
	}
	return connEnd{kind: endDropped, since: since}
}
