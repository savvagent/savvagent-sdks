package savvagentflags

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// FlagClient is the main client for evaluating feature flags
type FlagClient struct {
	config             Config
	httpClient         *http.Client
	cache              *cache
	configOverrides    map[string]configOverrideEntry
	variationOverrides map[string]variationOverrideEntry
	overrideMutex      sync.RWMutex

	// static holds the fixed values of a client from NewStaticClient, which never makes a
	// request; nil for every other client.
	static map[string]bool

	// realtime is the flag-change stream, nil when EnableRealtime is false.
	realtime  *realtimeStream
	closeOnce sync.Once
}

// NewClient creates a new FlagClient with the given configuration. When
// config.EnableRealtime is true it also opens the flag-change stream in a background
// goroutine; call Close to stop it.
func NewClient(config Config) (*FlagClient, error) {
	return newClient(config, defaultRealtimeOptions())
}

// newClient is NewClient with the stream's timings given, so tests can make them small.
func newClient(config Config, streamOpts realtimeOptions) (*FlagClient, error) {
	// Validate API key: the public client key or the secret server key, which the SDK guide
	// recommends for server apps (and whose telemetry drives auto-rollback).
	if !strings.HasPrefix(config.APIKey, "sdk_") && !strings.HasPrefix(config.APIKey, "srv_") {
		return nil, fmt.Errorf("invalid API key: must start with 'sdk_' or 'srv_'")
	}

	// Apply defaults
	if config.BaseURL == "" {
		config.BaseURL = "https://api.savvagent.com/flags"
	}
	config.BaseURL = strings.TrimRight(config.BaseURL, "/")
	warnIfServerKeyInClear(config.APIKey, config.BaseURL)
	if config.CacheTTL == 0 {
		config.CacheTTL = 60 * time.Second
	}
	if config.Timeout == 0 {
		config.Timeout = 5 * time.Second
	}
	if config.Defaults == nil {
		config.Defaults = make(map[string]bool)
	}
	if config.OnError == nil {
		config.OnError = func(err error) {
			fmt.Printf("[Savvagent Flags] Error: %v\n", err)
		}
	}

	client := &FlagClient{
		config: config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
			// Never follow redirects: a same-domain redirect, even to http, would still carry Authorization.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		cache:              newCache(config.CacheTTL),
		configOverrides:    make(map[string]configOverrideEntry),
		variationOverrides: make(map[string]variationOverrideEntry),
	}
	if config.EnableRealtime {
		client.realtime = startRealtime(config, client.cache, streamOpts)
	}

	return client, nil
}

// warnIfServerKeyInClear logs one slog warning when a server key would cross the network in
// clear text: the base URL is not https and its host is not loopback. A client key is public, so
// it gets no warning; a base URL that is not an absolute URL gets none either, as in Rust, since
// no request can be sent to it.
func warnIfServerKeyInClear(apiKey, baseURL string) {
	if !strings.HasPrefix(apiKey, "srv_") {
		return
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme == "" || u.Scheme == "https" {
		return
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return
	}
	slog.Warn(fmt.Sprintf("Savvagent Flags: the server key will be sent over %s; use an https base_url", u.Scheme))
}

// NewStaticClient returns a client that serves fixed flag values and never touches the network,
// for tests. Each flag in flags evaluates to its value, any other flag to false; Evaluate reports
// Reason "static". The map is copied. No request is made and no stream is opened. Config and
// variation overrides still apply, which lets a test exercise code that reads them. It is not
// for production use: it ignores the server entirely.
//
//	client := savvagentflags.NewStaticClient(map[string]bool{"new-checkout": true})
//	client.IsEnabled("new-checkout", nil)   // true
//	client.IsEnabled("anything-else", nil)  // false
func NewStaticClient(flags map[string]bool) *FlagClient {
	client, err := newClient(Config{APIKey: "sdk_static"}, defaultRealtimeOptions())
	if err != nil {
		panic("savvagentflags: building a static client failed: " + err.Error())
	}
	client.static = make(map[string]bool, len(flags))
	for key, value := range flags {
		client.static[key] = value
	}
	return client
}

// IsEnabledCached reads a flag without doing any I/O, for code that must not block on a
// request. It returns the unexpired cached value for this flag and context (the same context
// passed to an earlier Evaluate or IsEnabled, since the cache is per context, with
// ApplicationID filled in from the Config as Evaluate does), and otherwise the flag's default
// from Config.Defaults, else false. A flag that has never been looked up, one whose entry has
// outlived CacheTTL and one invalidated by the stream are all misses, so something must keep
// the cache warm: call Evaluate or IsEnabled on the same context at least once per CacheTTL.
// On a client from NewStaticClient it returns the fixed value. Overrides never change the
// answer (they do not change a flag's value in Evaluate either), and OnError is never called.
func (c *FlagClient) IsEnabledCached(flagKey string, ctx *Context) bool {
	// As Evaluate does, a key no flag can have gets its default.
	if !isValidFlagKey(flagKey) {
		return c.config.Defaults[flagKey]
	}
	if c.static != nil {
		return c.static[flagKey]
	}
	_, ctxKey, err := c.contextKey(ctx)
	if err != nil {
		return c.config.Defaults[flagKey]
	}
	if entry, found := c.cache.GetEntry(flagKey, ctxKey); found {
		return entry.Value
	}
	return c.config.Defaults[flagKey]
}

// prepareContext copies ctx (never modifying the caller's value) and fills in the configured
// ApplicationID when the context has none.
func (c *FlagClient) prepareContext(ctx *Context) Context {
	prepared := Context{}
	if ctx != nil {
		prepared = *ctx
	}
	if prepared.ApplicationID == "" && c.config.ApplicationID != "" {
		prepared.ApplicationID = c.config.ApplicationID
	}
	return prepared
}

// contextKey prepares ctx and returns it with its cache key: the JSON of the prepared context
// (map keys sorted by encoding/json), which is also the request body's context. Evaluate (which
// stores entries) and IsEnabledCached (which reads them) both use it, so the two keys cannot
// drift apart.
func (c *FlagClient) contextKey(ctx *Context) (Context, string, error) {
	prepared := c.prepareContext(ctx)
	ctxJSON, err := json.Marshal(prepared)
	return prepared, string(ctxJSON), err
}

// applyOverrides returns configuration and variation with the flag's overrides applied.
func (c *FlagClient) applyOverrides(flagKey string, configuration map[string]interface{}, variation string) (map[string]interface{}, string) {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()
	if configOverride, ok := c.configOverrides[flagKey]; ok {
		if configOverride.Merge && configuration != nil {
			configuration = c.mergeConfigurations(configuration, configOverride.Config)
		} else {
			configuration = configOverride.Config
		}
	}
	if variationOverride, ok := c.variationOverrides[flagKey]; ok {
		variation = variationOverride.Variation
	}
	return configuration, variation
}

// maxResponseBytes bounds an evaluate response body.
const maxResponseBytes = 1 << 20

// Evaluate evaluates a feature flag and returns the result
func (c *FlagClient) Evaluate(flagKey string, ctx *Context) (*EvaluationResult, error) {
	// Reject malformed keys before anything else: no request, no cache lookup.
	if !isValidFlagKey(flagKey) {
		prefix := flagKey
		if len(prefix) > 64 {
			prefix = prefix[:64]
		}
		err := fmt.Errorf("%w: %q (%d bytes)", ErrInvalidFlagKey, prefix, len(flagKey))
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}

	// A static client (NewStaticClient) answers from its fixed values, without a request.
	if c.static != nil {
		configuration, variation := c.applyOverrides(flagKey, nil, "")
		return &EvaluationResult{
			Key:           flagKey,
			Value:         c.static[flagKey],
			Configuration: configuration,
			Variation:     variation,
			Reason:        "static",
		}, nil
	}

	// Prepare the context on a copy, so the caller's value is never modified. Its JSON (map
	// keys sorted by encoding/json) is the cache key and the request body.
	prepared, ctxKey, err := c.contextKey(ctx)
	if err != nil {
		return c.getDefaultResult(flagKey, err), err
	}

	// Check cache first
	if cachedEntry, found := c.cache.GetEntry(flagKey, ctxKey); found {
		configuration, variation := c.applyOverrides(flagKey, cachedEntry.Configuration, cachedEntry.Variation)

		return &EvaluationResult{
			Key:           flagKey,
			Value:         cachedEntry.Value,
			Configuration: configuration,
			Variation:     variation,
			Reason:        "cached",
			Metadata:      &Metadata{Version: cachedEntry.Version, Scope: cachedEntry.Scope},
		}, nil
	}

	// Prepare request
	requestBody := map[string]interface{}{
		"context": prepared,
	}
	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return c.getDefaultResult(flagKey, err), err
	}

	// Read before the request: an invalidation while it is in flight drops this result.
	generation := c.cache.Generation(flagKey)

	endpoint := fmt.Sprintf("%s/api/flags/%s/evaluate", c.config.BaseURL, url.PathEscape(flagKey))
	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		return c.getDefaultResult(flagKey, err), err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)

	// Make request. A static client (NewStaticClient) never gets here: Evaluate returns early
	// for it above, so it never touches the network.
	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("API error: %d %s", resp.StatusCode, resp.Status)
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}

	// Parse response
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}
	if len(body) > maxResponseBytes {
		err := fmt.Errorf("evaluate response for %q exceeds %d bytes", flagKey, maxResponseBytes)
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}

	// The result is "enabled" (docs/SDK-DEVELOPER-GUIDE.md). A pointer tells a missing or
	// null field from false: a body without a boolean "enabled" is a failed lookup, not a
	// false to cache for the TTL (#112). A non-boolean value fails Unmarshal.
	var response struct {
		Enabled       *bool                  `json:"enabled"`
		Configuration map[string]interface{} `json:"configuration"`
		Variation     string                 `json:"variation"`
		Version       json.RawMessage        `json:"version"`
		Scope         json.RawMessage        `json:"scope"`

		// Never sent by the savvagent-flags server; still read for compatibility.
		FlagID      json.RawMessage `json:"flag_id"`
		Description json.RawMessage `json:"description"`
		Variant     json.RawMessage `json:"variant"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}
	if response.Enabled == nil {
		err := fmt.Errorf("evaluate response for %q has no boolean \"enabled\"", flagKey)
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}
	enabled := *response.Enabled

	// Version and scope are metadata only: a value of the wrong type is dropped, never a
	// failed lookup.
	var version int64
	if len(response.Version) > 0 {
		if json.Unmarshal(response.Version, &version) != nil {
			version = 0
		}
	}
	scope := metadataString(response.Scope)

	// Cache the result (including configuration, variation, version and scope)
	c.cache.SetAt(generation, flagKey, ctxKey, enabled, response.Configuration, response.Variation, version, scope)

	// Apply overrides to evaluated result
	finalConfiguration, finalVariation := c.applyOverrides(flagKey, response.Configuration, response.Variation)

	return &EvaluationResult{
		Key:           flagKey,
		Value:         enabled,
		Configuration: finalConfiguration,
		Variation:     finalVariation,
		Reason:        "evaluated",
		Metadata: &Metadata{
			FlagID:      metadataString(response.FlagID),
			Description: metadataString(response.Description),
			Variant:     metadataString(response.Variant),
			Version:     version,
			Scope:       scope,
		},
	}, nil
}

// metadataString decodes a metadata field that should be a JSON string. Anything else (absent,
// null, another type) is "": metadata is informational and never fails a lookup.
func metadataString(raw json.RawMessage) string {
	var s string
	if len(raw) == 0 || json.Unmarshal(raw, &s) != nil {
		return ""
	}
	return s
}

// IsEnabled checks if a flag is enabled (convenience method)
func (c *FlagClient) IsEnabled(flagKey string, ctx *Context) bool {
	result, _ := c.Evaluate(flagKey, ctx)
	return result.Value
}

// GetConfig retrieves dynamic configuration for a flag (Phase 1)
// Returns configuration if flag is enabled, otherwise returns nil
func (c *FlagClient) GetConfig(flagKey string, ctx *Context) (map[string]interface{}, error) {
	result, err := c.Evaluate(flagKey, ctx)
	if err != nil {
		return nil, err
	}

	if !result.Value {
		return nil, nil
	}

	return result.Configuration, nil
}

// GetVariation retrieves variation details for multi-variant flags (Phase 2)
// Returns variation name, enabled status, and configuration
func (c *FlagClient) GetVariation(flagKey string, ctx *Context) (*VariationResult, error) {
	result, err := c.Evaluate(flagKey, ctx)
	if err != nil {
		return nil, err
	}

	variation := result.Variation
	if variation == "" {
		variation = "control"
	}

	return &VariationResult{
		Variation:     variation,
		Enabled:       result.Value,
		Configuration: result.Configuration,
	}, nil
}

// InvalidateCache invalidates the cache for a specific flag
// If flagKey is empty, it clears the entire cache
func (c *FlagClient) InvalidateCache(flagKey string) {
	c.cache.Invalidate(flagKey)
}

// Close stops the flag-change stream, if one is open, and clears the cache. It returns once
// the stream's goroutine has ended, and is safe to call more than once. Do not call it from
// OnError: the stream's goroutine calls OnError, and Close waits for that goroutine.
func (c *FlagClient) Close() error {
	c.closeOnce.Do(func() {
		if c.realtime != nil {
			c.realtime.stop()
		}
	})
	c.cache.Clear()
	return nil
}

// getDefaultResult returns a default result for error cases
func (c *FlagClient) getDefaultResult(flagKey string, err error) *EvaluationResult {
	defaultValue := c.config.Defaults[flagKey]
	return &EvaluationResult{
		Key:    flagKey,
		Value:  defaultValue,
		Reason: "error",
	}
}

// SetConfigOverride sets a configuration override for a flag
// Useful for testing different configuration values without server changes
func (c *FlagClient) SetConfigOverride(flagKey string, config map[string]interface{}, options *ConfigOverrideOptions) error {
	if options == nil {
		options = &ConfigOverrideOptions{
			Merge:    false,
			Validate: true,
		}
	}

	// Validate JSON structure
	if options.Validate {
		if _, err := json.Marshal(config); err != nil {
			return fmt.Errorf("invalid configuration for flag '%s': %w", flagKey, err)
		}
	}

	c.overrideMutex.Lock()
	c.configOverrides[flagKey] = configOverrideEntry{
		Config:    config,
		Merge:     options.Merge,
		Timestamp: time.Now(),
	}
	c.overrideMutex.Unlock()

	// Invalidate cache to force re-evaluation with override
	c.cache.Invalidate(flagKey)

	return nil
}

// ClearConfigOverride clears the configuration override for a flag
func (c *FlagClient) ClearConfigOverride(flagKey string) {
	c.overrideMutex.Lock()
	delete(c.configOverrides, flagKey)
	c.overrideMutex.Unlock()

	// Invalidate cache to get fresh API values
	c.cache.Invalidate(flagKey)
}

// SetVariationOverride sets a variation override for a multi-variant flag
// Forces the flag to return a specific variation
func (c *FlagClient) SetVariationOverride(flagKey string, variation string) {
	c.overrideMutex.Lock()
	c.variationOverrides[flagKey] = variationOverrideEntry{
		Variation: variation,
		Timestamp: time.Now(),
	}
	c.overrideMutex.Unlock()

	// Invalidate cache to force re-evaluation with override
	c.cache.Invalidate(flagKey)
}

// ClearVariationOverride clears the variation override for a flag
func (c *FlagClient) ClearVariationOverride(flagKey string) {
	c.overrideMutex.Lock()
	delete(c.variationOverrides, flagKey)
	c.overrideMutex.Unlock()

	// Invalidate cache to get fresh API values
	c.cache.Invalidate(flagKey)
}

// HasConfigOverride checks if a flag has a configuration override
func (c *FlagClient) HasConfigOverride(flagKey string) bool {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()
	_, ok := c.configOverrides[flagKey]
	return ok
}

// HasVariationOverride checks if a flag has a variation override
func (c *FlagClient) HasVariationOverride(flagKey string) bool {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()
	_, ok := c.variationOverrides[flagKey]
	return ok
}

// GetConfigOverrides returns all configuration overrides (for debugging/inspection)
func (c *FlagClient) GetConfigOverrides() map[string]map[string]interface{} {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()

	overrides := make(map[string]map[string]interface{})
	for key, entry := range c.configOverrides {
		overrides[key] = map[string]interface{}{
			"config":    entry.Config,
			"merge":     entry.Merge,
			"timestamp": entry.Timestamp,
		}
	}
	return overrides
}

// GetVariationOverrides returns all variation overrides (for debugging/inspection)
func (c *FlagClient) GetVariationOverrides() map[string]map[string]interface{} {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()

	overrides := make(map[string]map[string]interface{})
	for key, entry := range c.variationOverrides {
		overrides[key] = map[string]interface{}{
			"variation": entry.Variation,
			"timestamp": entry.Timestamp,
		}
	}
	return overrides
}

// ClearAllOverrides clears all configuration and variation overrides
func (c *FlagClient) ClearAllOverrides() {
	c.overrideMutex.Lock()
	c.configOverrides = make(map[string]configOverrideEntry)
	c.variationOverrides = make(map[string]variationOverrideEntry)
	c.overrideMutex.Unlock()

	c.cache.Clear()
}

// mergeConfigurations merges two configuration maps (for partial overrides)
// Deep merge where override values take precedence
func (c *FlagClient) mergeConfigurations(base, override map[string]interface{}) map[string]interface{} {
	if base == nil {
		return override
	}
	if override == nil {
		return base
	}

	result := make(map[string]interface{})
	for k, v := range base {
		result[k] = v
	}

	for k, v := range override {
		if baseVal, ok := result[k]; ok {
			// If both are maps, merge recursively
			if baseMap, baseIsMap := baseVal.(map[string]interface{}); baseIsMap {
				if overrideMap, overrideIsMap := v.(map[string]interface{}); overrideIsMap {
					result[k] = c.mergeConfigurations(baseMap, overrideMap)
					continue
				}
			}
		}
		// Otherwise, override the value
		result[k] = v
	}

	return result
}
