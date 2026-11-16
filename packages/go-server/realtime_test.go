package savvagentflags

// The flag-change stream against a test server speaking the documented contract
// (docs/SDK-DEVELOPER-GUIDE.md, Real-time Updates): GET /api/flags/stream with the client's key,
// connected on every connect, flag.* events naming the changed flag (#167).

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	streamTestKey = "sdk_test_key"
	longTTL       = 10 * time.Minute
)

// testRealtimeOptions are timings small enough that no test waits for seconds.
func testRealtimeOptions() realtimeOptions {
	return realtimeOptions{
		baseDelay:        5 * time.Millisecond,
		maxDelay:         20 * time.Millisecond,
		rejectedMaxDelay: 20 * time.Millisecond,
		maxRetryAfter:    20 * time.Millisecond,
		stableAfter:      30 * time.Second,
		spread:           5 * time.Millisecond,
		idleTimeout:      2 * time.Second,
		headerTimeout:    2 * time.Second,
		random:           func() float64 { return 0.5 },
	}
}

// streamRequest is what the test server saw of one stream request.
type streamRequest struct {
	path, rawQuery, authorization, accept string
}

// streamTestServer answers GET <prefix>/api/flags/stream with its stream handler (n counts the
// stream requests from 1) and every other request as the evaluate endpoint, with "enabled"
// taken from enabled.
type streamTestServer struct {
	*httptest.Server
	enabled atomic.Bool
	streams atomic.Int32

	mu   sync.Mutex
	seen []streamRequest
}

func newStreamTestServer(t *testing.T, prefix string, stream func(n int32, w http.ResponseWriter, r *http.Request)) *streamTestServer {
	t.Helper()
	s := &streamTestServer{}
	s.enabled.Store(true)
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == prefix+"/api/flags/stream" {
			s.mu.Lock()
			s.seen = append(s.seen, streamRequest{
				path:          r.URL.Path,
				rawQuery:      r.URL.RawQuery,
				authorization: r.Header.Get("Authorization"),
				accept:        r.Header.Get("Accept"),
			})
			s.mu.Unlock()
			stream(s.streams.Add(1), w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, serverBody, strconv.FormatBool(s.enabled.Load()))
	}))
	// Registered before any client's Close, so it runs after it: a held stream ends when its
	// client goes away, and Close on the server waits for every handler.
	t.Cleanup(s.Close)
	return s
}

func (s *streamTestServer) requests() []streamRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]streamRequest(nil), s.seen...)
}

// openStream sends the headers of an event stream.
func openStream(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	w.(http.Flusher).Flush()
}

// send writes text to an open stream at once.
func send(w http.ResponseWriter, text string) {
	_, _ = io.WriteString(w, text)
	w.(http.Flusher).Flush()
}

// hold keeps the request open until the client goes away (bounded, so a bug fails the test
// instead of hanging it).
func hold(r *http.Request) {
	select {
	case <-r.Context().Done():
	case <-time.After(10 * time.Second):
	}
}

// await waits for ch to be closed, or for the client to go away; it reports which.
func await(ch <-chan struct{}, r *http.Request) bool {
	select {
	case <-ch:
		return true
	case <-r.Context().Done():
		return false
	case <-time.After(10 * time.Second):
		return false
	}
}

// errorLog collects OnError calls, which come from the stream goroutine.
type errorLog struct {
	mu   sync.Mutex
	errs []error
}

func (l *errorLog) record(err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.errs = append(l.errs, err)
}

func (l *errorLog) all() []error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]error(nil), l.errs...)
}

func newRealtimeTestClient(t *testing.T, baseURL string, ttl time.Duration, realtime bool, opts realtimeOptions, onError func(error)) *FlagClient {
	t.Helper()
	if onError == nil {
		onError = func(error) {}
	}
	client, err := newClient(Config{
		APIKey:         streamTestKey,
		BaseURL:        baseURL,
		EnableRealtime: realtime,
		CacheTTL:       ttl,
		OnError:        onError,
	}, opts)
	if err != nil {
		t.Fatalf("newClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

// waitFor polls cond every 5 ms and fails the test if it is not true within 3 s.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func evaluate(t *testing.T, client *FlagClient, flag string) *EvaluationResult {
	t.Helper()
	result, err := client.Evaluate(flag, nil)
	if err != nil {
		t.Fatalf("Evaluate(%q): %v", flag, err)
	}
	return result
}

func reason(t *testing.T, client *FlagClient, flag string) string {
	t.Helper()
	return evaluate(t, client, flag).Reason
}

func TestRealtimeUpdateEventDropsTheCachedEvaluation(t *testing.T) {
	release := make(chan struct{})
	srv := newStreamTestServer(t, "", func(_ int32, w http.ResponseWriter, r *http.Request) {
		openStream(w)
		if !await(release, r) {
			return
		}
		// No connected event: it would clear the cache by itself and prove nothing.
		send(w, "event: flag.updated\ndata: {\"key\":\"f\",\"version\":4}\n\n")
		hold(r)
	})
	client := newRealtimeTestClient(t, srv.URL, longTTL, true, testRealtimeOptions(), nil)

	if got := reason(t, client, "f"); got != "evaluated" {
		t.Fatalf("first lookup reason = %q, want evaluated", got)
	}
	if got := reason(t, client, "f"); got != "cached" {
		t.Fatalf("second lookup reason = %q, want cached", got)
	}
	srv.enabled.Store(false)
	close(release)

	// The event, not the TTL, ended the cache entry.
	waitFor(t, "a fresh false after the event", func() bool {
		r := evaluate(t, client, "f")
		return !r.Value && r.Reason == "evaluated"
	})
}

func TestRealtimeDroppedStreamReconnectsAndConnectedClearsTheCache(t *testing.T) {
	release1 := make(chan struct{})
	release2 := make(chan struct{})
	srv := newStreamTestServer(t, "", func(n int32, w http.ResponseWriter, r *http.Request) {
		openStream(w)
		if n == 1 {
			// Ends after the event, so the client must reconnect.
			if await(release1, r) {
				send(w, "event: connected\ndata: {}\n\n")
			}
			return
		}
		if !await(release2, r) {
			return
		}
		send(w, "event: connected\ndata: {}\n\n")
		hold(r)
	})
	client := newRealtimeTestClient(t, srv.URL, longTTL, true, testRealtimeOptions(), nil)

	if got := reason(t, client, "g"); got != "evaluated" {
		t.Fatalf("first lookup reason = %q, want evaluated", got)
	}
	if got := reason(t, client, "g"); got != "cached" {
		t.Fatalf("second lookup reason = %q, want cached", got)
	}
	close(release1)
	waitFor(t, "a second stream request", func() bool { return srv.streams.Load() >= 2 })

	// The first stream was read to its end before the client reconnected, so its connected
	// event has cleared the cache.
	if got := reason(t, client, "g"); got != "evaluated" {
		t.Fatalf("lookup after the first connected: reason = %q, want evaluated", got)
	}
	if got := reason(t, client, "g"); got != "cached" {
		t.Fatalf("lookup after re-caching: reason = %q, want cached", got)
	}

	// The reconnected stream's connected event clears it again.
	close(release2)
	waitFor(t, "the reconnected stream to clear the cache", func() bool {
		return reason(t, client, "g") == "evaluated"
	})
}

func TestRealtimeLookupsAreServedAndExpireByTTLWhileTheStreamIsDown(t *testing.T) {
	srv := newStreamTestServer(t, "", func(_ int32, w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	errs := &errorLog{}
	client := newRealtimeTestClient(t, srv.URL, 250*time.Millisecond, true, testRealtimeOptions(), errs.record)

	if got := reason(t, client, "f"); got != "evaluated" {
		t.Fatalf("first lookup reason = %q, want evaluated", got)
	}
	if got := reason(t, client, "f"); got != "cached" {
		t.Fatalf("second lookup reason = %q, want cached", got)
	}
	time.Sleep(300 * time.Millisecond)
	if got := reason(t, client, "f"); got != "evaluated" {
		t.Fatalf("lookup after the TTL: reason = %q, want evaluated", got)
	}
	if !client.IsEnabled("f", nil) {
		t.Error("IsEnabled = false, want true")
	}

	// The refused stream is retried, and each refusal is reported without the key.
	waitFor(t, "the refused stream to be retried", func() bool { return srv.streams.Load() >= 2 })
	reported := errs.all()
	if len(reported) == 0 {
		t.Fatal("a refused stream was not reported to OnError")
	}
	for _, err := range reported {
		if !strings.Contains(err.Error(), "503") {
			t.Errorf("OnError(%v), want the status", err)
		}
		if strings.Contains(err.Error(), streamTestKey) {
			t.Errorf("OnError(%v) carries the key", err)
		}
	}
}

func TestRealtimeNoStreamWhenRealtimeIsOff(t *testing.T) {
	srv := newStreamTestServer(t, "", func(_ int32, w http.ResponseWriter, _ *http.Request) {
		openStream(w)
		send(w, "event: connected\ndata: {}\n\n")
	})
	client := newRealtimeTestClient(t, srv.URL, longTTL, false, testRealtimeOptions(), nil)

	if client.realtime != nil {
		t.Fatal("a stream was started with EnableRealtime false")
	}
	if got := reason(t, client, "f"); got != "evaluated" {
		t.Fatalf("lookup reason = %q, want evaluated", got)
	}
	time.Sleep(50 * time.Millisecond)
	if n := srv.streams.Load(); n != 0 {
		t.Errorf("stream requests = %d, want 0", n)
	}
}

func TestNewClientLeavesRealtimeOffByDefault(t *testing.T) {
	client, err := NewClient(Config{APIKey: streamTestKey, BaseURL: "http://127.0.0.1:9"})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer client.Close()
	if client.realtime != nil {
		t.Error("the zero Config opened a stream")
	}
}

func TestRealtimeLookupDoesNotWaitForTheStream(t *testing.T) {
	srv := newStreamTestServer(t, "", func(_ int32, _ http.ResponseWriter, r *http.Request) {
		// Never answers: the client is still waiting for the headers.
		hold(r)
	})
	client := newRealtimeTestClient(t, srv.URL, longTTL, true, testRealtimeOptions(), nil)
	waitFor(t, "the stream request", func() bool { return srv.streams.Load() >= 1 })

	answered := make(chan *EvaluationResult, 1)
	go func() {
		result, _ := client.Evaluate("f", nil)
		answered <- result
	}()
	select {
	case result := <-answered:
		if result == nil || result.Reason != "evaluated" || !result.Value {
			t.Errorf("lookup = %+v, want an evaluated true", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the lookup waited on the stream")
	}
}

func TestRealtimeRequestCarriesTheKeyInTheHeaderOnly(t *testing.T) {
	srv := newStreamTestServer(t, "/prefix", func(_ int32, w http.ResponseWriter, r *http.Request) {
		openStream(w)
		hold(r)
	})
	// The base URL's path prefix is kept, and one trailing slash dropped.
	newRealtimeTestClient(t, srv.URL+"/prefix/", longTTL, true, testRealtimeOptions(), nil)
	waitFor(t, "the stream request", func() bool { return srv.streams.Load() >= 1 })

	for _, r := range srv.requests() {
		if r.path != "/prefix/api/flags/stream" {
			t.Errorf("path = %q, want /prefix/api/flags/stream", r.path)
		}
		if r.authorization != "Bearer "+streamTestKey {
			t.Errorf("Authorization = %q, want the bearer key", r.authorization)
		}
		if !strings.Contains(r.accept, "text/event-stream") {
			t.Errorf("Accept = %q, want text/event-stream", r.accept)
		}
		if r.rawQuery != "" {
			t.Errorf("query = %q, want none", r.rawQuery)
		}
	}
}

func TestRealtimeEventsForOtherFlagsOrWithInvalidKeysLeaveThisOneCached(t *testing.T) {
	release := make(chan struct{})
	srv := newStreamTestServer(t, "", func(_ int32, w http.ResponseWriter, r *http.Request) {
		openStream(w)
		if !await(release, r) {
			return
		}
		// Events are applied in order, so once the last one (sentinel) has been, so have the
		// others.
		send(w, "event: flag.deleted\ndata: {\"key\":\"other\"}\n\n"+
			"event: flag.updated\ndata: {\"key\":\"a/b\"}\n\n"+
			"event: flag.updated\ndata: {\"key\":\"\"}\n\n"+
			"event: flag.updated\ndata: not json\n\n"+
			"event: heartbeat\ndata: {}\n\n"+
			"data: {\"key\":\"f\"}\n\n"+
			"event: flag.updated\ndata: {\"key\":\"sentinel\"}\n\n")
		hold(r)
	})
	client := newRealtimeTestClient(t, srv.URL, longTTL, true, testRealtimeOptions(), nil)

	for _, flag := range []string{"f", "sentinel"} {
		if got := reason(t, client, flag); got != "evaluated" {
			t.Fatalf("first lookup of %q: reason = %q, want evaluated", flag, got)
		}
	}
	close(release)
	waitFor(t, "the sentinel event", func() bool { return reason(t, client, "sentinel") == "evaluated" })
	if got := reason(t, client, "f"); got != "cached" {
		t.Errorf("lookup of f: reason = %q, want cached", got)
	}
}

func TestRealtimeA200ThatIsNotAnEventStreamIsNotReadAsEvents(t *testing.T) {
	srv := newStreamTestServer(t, "", func(_ int32, w http.ResponseWriter, _ *http.Request) {
		// A proxy's page that happens to look like an event.
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "event: connected\ndata: {}\n\n")
	})
	errs := &errorLog{}
	client := newRealtimeTestClient(t, srv.URL, longTTL, true, testRealtimeOptions(), errs.record)

	if got := reason(t, client, "h"); got != "evaluated" {
		t.Fatalf("first lookup reason = %q, want evaluated", got)
	}
	// Request n0+1 began after the lookup and ended before request n0+2 began.
	n0 := srv.streams.Load()
	waitFor(t, "two more stream requests", func() bool { return srv.streams.Load() >= n0+2 })
	// The connected event would have cleared the cache.
	if got := reason(t, client, "h"); got != "cached" {
		t.Errorf("lookup reason = %q, want cached", got)
	}
	if len(errs.all()) == 0 {
		t.Error("a non-event-stream response was not reported to OnError")
	}
}

func TestRealtimeAStalledConnectIsAbandonedAndRetried(t *testing.T) {
	srv := newStreamTestServer(t, "", func(_ int32, _ http.ResponseWriter, r *http.Request) {
		hold(r)
	})
	opts := testRealtimeOptions()
	opts.headerTimeout = 50 * time.Millisecond
	newRealtimeTestClient(t, srv.URL, longTTL, true, opts, nil)
	waitFor(t, "a retry after the header timeout", func() bool { return srv.streams.Load() >= 2 })
}

func TestRealtimeAnIdleStreamIsDroppedAndReopened(t *testing.T) {
	srv := newStreamTestServer(t, "", func(_ int32, w http.ResponseWriter, r *http.Request) {
		openStream(w)
		hold(r)
	})
	opts := testRealtimeOptions()
	opts.idleTimeout = 50 * time.Millisecond
	newRealtimeTestClient(t, srv.URL, longTTL, true, opts, nil)
	waitFor(t, "a reconnect after the idle timeout", func() bool { return srv.streams.Load() >= 2 })
}

// closeWithin calls Close in a goroutine and fails the test if it does not return within 2 s.
func closeWithin(t *testing.T, client *FlagClient) {
	t.Helper()
	closed := make(chan struct{})
	go func() {
		_ = client.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not return")
	}
}

func TestRealtimeCloseStopsTheStreamAndIsIdempotent(t *testing.T) {
	ended := make(chan struct{})
	var endOnce sync.Once
	srv := newStreamTestServer(t, "", func(_ int32, w http.ResponseWriter, r *http.Request) {
		openStream(w)
		hold(r)
		endOnce.Do(func() { close(ended) })
	})
	client := newRealtimeTestClient(t, srv.URL, longTTL, true, testRealtimeOptions(), nil)
	waitFor(t, "the stream request", func() bool { return srv.streams.Load() >= 1 })

	closeWithin(t, client)
	select {
	case <-client.realtime.done:
	default:
		t.Fatal("the stream goroutine is still running after Close")
	}
	select {
	case <-ended:
	case <-time.After(2 * time.Second):
		t.Fatal("the server never saw the stream close")
	}
	closeWithin(t, client)
	if n := srv.streams.Load(); n != 1 {
		t.Errorf("stream requests = %d, want 1", n)
	}
}

func TestRealtimeCloseInterruptsALongRetryWait(t *testing.T) {
	srv := newStreamTestServer(t, "", func(_ int32, w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	errs := &errorLog{}
	opts := testRealtimeOptions()
	opts.maxRetryAfter = time.Minute
	client := newRealtimeTestClient(t, srv.URL, longTTL, true, opts, errs.record)
	waitFor(t, "the refusal to be reported", func() bool { return len(errs.all()) >= 1 })

	closeWithin(t, client)
	if n := srv.streams.Load(); n != 1 {
		t.Errorf("stream requests = %d, want 1 (Retry-After was not honored)", n)
	}
}

func TestRealtimeABadBaseURLReportsAndStartsNothing(t *testing.T) {
	errs := &errorLog{}
	client := newRealtimeTestClient(t, "not a url", longTTL, true, testRealtimeOptions(), errs.record)
	if client.realtime != nil {
		t.Error("a stream was started for a base URL that cannot carry its path")
	}
	if len(errs.all()) != 1 {
		t.Errorf("OnError calls = %d, want 1", len(errs.all()))
	}
	closeWithin(t, client)
}

func TestSSEParserSplitsEventsAcrossArbitraryChunkBoundaries(t *testing.T) {
	wire := []byte("event: connected\ndata: {\"a\":1}\n\n: comment\nevent: flag.updated\r\ndata: {\"key\":\"f\"}\r\n\r\n")
	want := []sseEvent{
		{event: "connected", data: `{"a":1}`},
		{event: "flag.updated", data: `{"key":"f"}`},
	}
	for split := 0; split <= len(wire); split++ {
		var p sseParser
		first, err := p.feed(wire[:split])
		if err != nil {
			t.Fatalf("split %d: %v", split, err)
		}
		second, err := p.feed(wire[split:])
		if err != nil {
			t.Fatalf("split %d: %v", split, err)
		}
		got := append(first, second...)
		if !equalEvents(got, want) {
			t.Errorf("split %d: got %+v, want %+v", split, got, want)
		}
	}
}

func equalEvents(a, b []sseEvent) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestSSEParserFraming(t *testing.T) {
	tests := []struct {
		name string
		wire string
		want []sseEvent
	}{
		{
			name: "data lines are joined and the event name defaults to message",
			wire: "data: a\ndata:b\n\n",
			want: []sseEvent{{event: "message", data: "a\nb"}},
		},
		{
			name: "empty events and other fields make nothing; only one leading space is stripped",
			wire: "\n\nid: 7\nretry: 10\n\nevent: heartbeat\nid: 8\ndata:  x\n\n",
			want: []sseEvent{{event: "heartbeat", data: " x"}},
		},
		{
			name: "an event of one empty data line is kept",
			wire: "data:\n\ndata:\ndata:\n\n",
			want: []sseEvent{{event: "message", data: ""}, {event: "message", data: "\n"}},
		},
		{
			name: "a field without a colon has an empty value",
			wire: "event\ndata\n\n",
			want: []sseEvent{{event: "", data: ""}},
		},
		{
			name: "an unterminated event is not dispatched",
			wire: "event: connected\ndata: {}\n",
			want: nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var p sseParser
			got, err := p.feed([]byte(tt.wire))
			if err != nil {
				t.Fatalf("feed: %v", err)
			}
			if !equalEvents(got, tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestSSEParserKeepsASplitMultibyteCharacterIntact(t *testing.T) {
	wire := []byte("data: é\n\n")
	var p sseParser
	first, err := p.feed(wire[:7]) // inside the two bytes of the character
	if err != nil {
		t.Fatal(err)
	}
	second, err := p.feed(wire[7:])
	if err != nil {
		t.Fatal(err)
	}
	got := append(first, second...)
	if len(got) != 1 || got[0].data != "é" {
		t.Errorf("got %+v, want one event with data é", got)
	}
}

func TestSSEParserRefusesAnEventOverTheCap(t *testing.T) {
	var p sseParser
	if _, err := p.feed(bytes.Repeat([]byte("x"), maxEventBytes+1)); err != errEventTooLarge {
		t.Errorf("err = %v, want errEventTooLarge", err)
	}
}

func TestSSEParserCountsEmptyDataLinesAgainstTheCap(t *testing.T) {
	var p sseParser
	chunk := bytes.Repeat([]byte("data:\n"), 64*1024)
	fed := 0
	for {
		if _, err := p.feed(chunk); err != nil {
			break
		}
		fed += len(chunk)
		if fed > 8*maxEventBytes {
			t.Fatalf("%d bytes of empty data lines were accepted", fed)
		}
	}
	if len(p.data) > maxEventBytes+len(chunk) {
		t.Errorf("pending data grew to %d bytes", len(p.data))
	}
}

func TestSSEParserCountsAccumulatedDataLinesAgainstTheCap(t *testing.T) {
	var p sseParser
	line := []byte("data: " + strings.Repeat("x", 1024*1024) + "\n")
	for i := 0; i < 5; i++ {
		if _, err := p.feed(line); err != nil {
			return
		}
	}
	t.Error("five 1 MiB data lines with no dispatch were accepted")
}

func TestReconnectDelay(t *testing.T) {
	d := defaultRealtimeOptions()
	tests := []struct {
		name    string
		attempt int
		ceiling time.Duration
		unit    float64
		want    time.Duration
	}{
		{"first retry, low jitter", 0, d.maxDelay, 0, 500 * time.Millisecond},
		{"doubles", 3, d.maxDelay, 0, 4 * time.Second},
		{"capped", 30, d.maxDelay, 0, 15 * time.Second},
		{"capped at the full delay", 30, d.maxDelay, 1, 30 * time.Second},
		{"rejected cap", 30, d.rejectedMaxDelay, 0, 150 * time.Second},
		{"huge attempt", math.MaxInt32, d.maxDelay, 1, 30 * time.Second},
		{"NaN is clamped", 2, d.maxDelay, math.NaN(), 2 * time.Second},
		{"+Inf is clamped", 2, d.maxDelay, math.Inf(1), 4 * time.Second},
		{"negative is clamped", 2, d.maxDelay, -1, 2 * time.Second},
		{"above one is clamped", 2, d.maxDelay, 2, 4 * time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := reconnectDelay(d.baseDelay, tt.attempt, tt.ceiling, tt.unit); got != tt.want {
				t.Errorf("reconnectDelay = %v, want %v", got, tt.want)
			}
		})
	}
	if got := reconnectDelay(d.baseDelay, 0, d.maxDelay, 0.999999); got >= time.Second {
		t.Errorf("first retry with high jitter = %v, want under 1s", got)
	}
}

func TestReconnectSpreadAppliesOnlyToTheFirstRetryOfAnEstablishedStream(t *testing.T) {
	spread := 5 * time.Second
	tests := []struct {
		name    string
		attempt int
		wasUp   bool
		unit    float64
		want    time.Duration
	}{
		{"zero unit", 0, true, 0, 0},
		{"half", 0, true, 0.5, 2500 * time.Millisecond},
		{"later attempt", 1, true, 0.5, 0},
		{"never up", 0, false, 0.5, 0},
		{"NaN", 0, true, math.NaN(), 0},
		{"+Inf is clamped", 0, true, math.Inf(1), spread},
		{"negative is clamped", 0, true, -1, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := reconnectSpread(spread, tt.attempt, tt.wasUp, tt.unit); got != tt.want {
				t.Errorf("reconnectSpread = %v, want %v", got, tt.want)
			}
		})
	}
	if got := reconnectSpread(spread, 0, true, 0.999999); got >= spread {
		t.Errorf("spread with high jitter = %v, want under %v", got, spread)
	}
}

func TestNextDelay(t *testing.T) {
	opts := defaultRealtimeOptions()
	opts.random = func() float64 { return 0 }
	refused := func(status int, retryAfter time.Duration) connEnd {
		return connEnd{kind: endRefused, status: status, retryAfter: retryAfter, hasRetryAfter: retryAfter > 0}
	}
	tests := []struct {
		name    string
		end     connEnd
		attempt int
		want    time.Duration
	}{
		{"unreachable", connEnd{kind: endUnreachable}, 0, 500 * time.Millisecond},
		{"500 at the cap", refused(500, 0), 30, 15 * time.Second},
		{"401 uses the rejected cap", refused(401, 0), 30, 150 * time.Second},
		{"403 uses the rejected cap", refused(403, 0), 30, 150 * time.Second},
		{"404 uses the rejected cap", refused(404, 0), 30, 150 * time.Second},
		{"503 Retry-After lengthens the wait", refused(503, 40*time.Second), 0, 40 * time.Second},
		{"429 Retry-After is capped", refused(429, 10*time.Minute), 0, time.Minute},
		{"Retry-After never shortens the wait", refused(429, time.Second), 10, 15 * time.Second},
		{"Retry-After on a 500 is ignored", refused(500, 40*time.Second), 0, 500 * time.Millisecond},
		{"a drop adds no spread at zero jitter", connEnd{kind: endDropped}, 0, 500 * time.Millisecond},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := opts.nextDelay(tt.end, tt.attempt); got != tt.want {
				t.Errorf("nextDelay = %v, want %v", got, tt.want)
			}
		})
	}

	opts.random = func() float64 { return 0.5 }
	if got, want := opts.nextDelay(connEnd{kind: endDropped}, 0), 750*time.Millisecond+2500*time.Millisecond; got != want {
		t.Errorf("first retry after a drop = %v, want %v (delay plus spread)", got, want)
	}
	if got, want := opts.nextDelay(connEnd{kind: endUnreachable}, 0), 750*time.Millisecond; got != want {
		t.Errorf("first retry after a failed connect = %v, want %v (no spread)", got, want)
	}
}

func TestParseRetryAfter(t *testing.T) {
	maxDuration := time.Duration(math.MaxInt64/int64(time.Second)) * time.Second
	tests := []struct {
		value  string
		want   time.Duration
		wantOK bool
	}{
		{"5", 5 * time.Second, true},
		{" 7 ", 7 * time.Second, true},
		{"0", 0, true},
		{"", 0, false},
		{"-1", 0, false},
		{"1.5", 0, false},
		{"+3", 0, false},
		{"Wed, 21 Oct 2015 07:28:00 GMT", 0, false},
		{"99999999999999999999999", 0, false},
		{"18446744073709551615", maxDuration, true},
	}
	for _, tt := range tests {
		got, ok := parseRetryAfter(tt.value)
		if got != tt.want || ok != tt.wantOK {
			t.Errorf("parseRetryAfter(%q) = %v, %v; want %v, %v", tt.value, got, ok, tt.want, tt.wantOK)
		}
	}
}

func TestStreamURL(t *testing.T) {
	tests := []struct {
		base    string
		want    string
		wantErr bool
	}{
		{"https://h.example", "https://h.example/api/flags/stream", false},
		{"https://h.example/", "https://h.example/api/flags/stream", false},
		{"https://h.example/p/", "https://h.example/p/api/flags/stream", false},
		{"http://127.0.0.1:8080/p", "http://127.0.0.1:8080/p/api/flags/stream", false},
		{"https://h.example/p?x=1#y", "https://h.example/p/api/flags/stream", false},
		{"not a url", "", true},
		{"ftp://h.example", "", true},
		{"https://", "", true},
	}
	for _, tt := range tests {
		got, err := streamURL(tt.base)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("streamURL(%q) = %q, %v; want %q, error %v", tt.base, got, err, tt.want, tt.wantErr)
		}
	}
}

// cacheWith holds one entry under context "ctx" for each flag.
func cacheWith(flags ...string) *cache {
	c := newCache(time.Minute)
	for _, flag := range flags {
		c.Set(flag, "ctx", true, nil, "", 0, "")
	}
	return c
}

func isCached(c *cache, flag string) bool {
	_, ok := c.Get(flag, "ctx")
	return ok
}

func TestApplyEventInvalidatesOnlyTheNamedFlag(t *testing.T) {
	for _, name := range []string{"flag.created", "flag.updated", "flag.deleted"} {
		c := cacheWith("a", "b")
		applyEvent(c, sseEvent{event: name, data: `{"key":"a","version":3}`})
		if isCached(c, "a") {
			t.Errorf("%s: a is still cached", name)
		}
		if !isCached(c, "b") {
			t.Errorf("%s: b was dropped", name)
		}
	}
}

func TestApplyEventConnectedInvalidatesEveryFlag(t *testing.T) {
	c := cacheWith("a", "b")
	applyEvent(c, sseEvent{event: "connected", data: "{}"})
	if isCached(c, "a") || isCached(c, "b") {
		t.Error("connected left an entry cached")
	}
}

func TestApplyEventIgnoresHeartbeatsUnknownEventsAndBadKeys(t *testing.T) {
	c := cacheWith("a")
	before := c.Generation("a")
	for _, ev := range []sseEvent{
		{event: "heartbeat", data: "{}"},
		{event: "message", data: `{"key":"a"}`},
		{event: "flag.updated", data: "not json"},
		{event: "flag.updated", data: `{"key":7}`},
		{event: "flag.updated", data: `{"key":null}`},
		{event: "flag.updated", data: `{"flag":"a"}`},
		{event: "flag.updated", data: `{"KEY":"a"}`},
		{event: "flag.updated", data: `{"key":"../a"}`},
		{event: "flag.updated", data: `{"key":".."}`},
		{event: "flag.updated", data: `{"key":""}`},
		{event: "flag.updated", data: `["a"]`},
	} {
		applyEvent(c, ev)
	}
	if !isCached(c, "a") {
		t.Error("a was dropped")
	}
	if c.Generation("a") != before {
		t.Error("a's generation changed")
	}
}
