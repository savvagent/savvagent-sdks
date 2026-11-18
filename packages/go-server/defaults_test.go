package savvagentflags

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSetDefaultFromEnvParsesBooleans(t *testing.T) {
	cases := map[string]bool{
		"1": true, "true": true, "TRUE": true, " yes ": true, "On": true,
		"0": false, "false": false, "No": false, "\toff\n": false,
	}
	for raw, want := range cases {
		t.Setenv("SAVVAGENT_TEST_FLAG", raw)
		var config Config
		config.SetDefaultFromEnv("new-checkout", "SAVVAGENT_TEST_FLAG")
		got, ok := config.Defaults["new-checkout"]
		if !ok || got != want {
			t.Errorf("%q: Defaults[new-checkout] = %v, %v; want %v, true", raw, got, ok, want)
		}
	}
}

func TestSetDefaultFromEnvUnsetKeepsEarlierDefaultSilently(t *testing.T) {
	logs := captureSlog(t)
	config := Config{Defaults: map[string]bool{"new-checkout": true}}
	config.SetDefaultFromEnv("new-checkout", "SAVVAGENT_TEST_FLAG_SURELY_UNSET")
	if !config.Defaults["new-checkout"] {
		t.Error("an unset variable replaced the earlier default")
	}
	if logs.String() != "" {
		t.Errorf("unset variable logged: %s", logs.String())
	}

	var empty Config
	empty.SetDefaultFromEnv("new-checkout", "SAVVAGENT_TEST_FLAG_SURELY_UNSET")
	if _, ok := empty.Defaults["new-checkout"]; ok {
		t.Error("an unset variable set a default")
	}
}

func TestSetDefaultFromEnvInvalidWarnsWithoutTheValue(t *testing.T) {
	for _, raw := range []string{"", "maybe", "secret-ish-value"} {
		logs := captureSlog(t)
		t.Setenv("SAVVAGENT_TEST_FLAG", raw)
		config := Config{Defaults: map[string]bool{"new-checkout": true}}
		config.SetDefaultFromEnv("new-checkout", "SAVVAGENT_TEST_FLAG")
		if !config.Defaults["new-checkout"] {
			t.Errorf("%q replaced the earlier default", raw)
		}
		out := logs.String()
		if !strings.Contains(out, `environment variable \"SAVVAGENT_TEST_FLAG\" is not a boolean; ignoring it`) {
			t.Errorf("%q: missing warning naming the variable; logs: %s", raw, out)
		}
		if raw != "" && strings.Contains(out, raw) {
			t.Errorf("%q: warning leaks the value: %s", raw, out)
		}
	}
}

func TestSetDefaultFuncCalledOnce(t *testing.T) {
	calls := 0
	var config Config
	config.SetDefaultFunc("a", func() (bool, bool) { calls++; return true, true })
	config.SetDefaultFunc("b", func() (bool, bool) { calls++; return true, false })
	if calls != 2 {
		t.Errorf("calls = %d, want 2", calls)
	}
	if !config.Defaults["a"] {
		t.Error("Defaults[a] not set to true")
	}
	if _, ok := config.Defaults["b"]; ok {
		t.Error("ok=false still set a default")
	}
}

func TestEnvDefaultIsUsedWhenALookupFails(t *testing.T) {
	// Defaults set through the helpers are what the client falls back to.
	t.Setenv("SAVVAGENT_TEST_FLAG", "true")
	var config Config
	config.APIKey = "sdk_test_key"
	config.BaseURL = "http://127.0.0.1:1" // nothing listens: every lookup fails
	config.Timeout = 200 * time.Millisecond
	config.OnError = func(error) {}
	config.SetDefaultFromEnv("new-checkout", "SAVVAGENT_TEST_FLAG")
	client, err := NewClient(config)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if !client.IsEnabled("new-checkout", nil) {
		t.Error("failed lookup did not fall back to the env-derived default")
	}
}

func TestIsEnabledCachedNeverRequests(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Write([]byte(`{"enabled": true}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:   "sdk_test_key",
		BaseURL:  server.URL,
		Defaults: map[string]bool{"banner": false, "other": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	alice := &Context{UserID: "alice"}
	if client.IsEnabledCached("banner", alice) {
		t.Error("miss: got true, want the default false")
	}
	if !client.IsEnabledCached("other", alice) {
		t.Error("miss: got false, want the default true")
	}
	if client.IsEnabledCached("never-configured", alice) {
		t.Error("miss without a default: want false")
	}
	if n := requests.Load(); n != 0 {
		t.Fatalf("IsEnabledCached made %d requests", n)
	}

	// Warm the cache for alice; the cached read now sees the server's value.
	if !client.IsEnabled("banner", alice) {
		t.Fatal("IsEnabled = false, want true")
	}
	if !client.IsEnabledCached("banner", alice) {
		t.Error("hit: got false, want the cached true")
	}
	// The cache is per context: bob has no entry, so bob gets the default.
	if client.IsEnabledCached("banner", &Context{UserID: "bob"}) {
		t.Error("another context: got true, want the default false")
	}
	if n := requests.Load(); n != 1 {
		t.Errorf("requests = %d, want 1 (only the IsEnabled call)", n)
	}
}

func TestIsEnabledCachedFillsApplicationIDLikeEvaluate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"enabled": true}`))
	}))
	defer server.Close()
	client, err := NewClient(Config{APIKey: "sdk_test_key", BaseURL: server.URL, ApplicationID: "app-1"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.IsEnabled("banner", nil)
	if !client.IsEnabledCached("banner", nil) {
		t.Error("nil context: want the entry cached under the configured application ID")
	}
	if !client.IsEnabledCached("banner", &Context{ApplicationID: "app-1"}) {
		t.Error("explicit application ID equal to the configured one: want a hit")
	}
}

func TestIsEnabledCachedExpiredIsAMiss(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"enabled": true}`))
	}))
	defer server.Close()
	client, err := NewClient(Config{APIKey: "sdk_test_key", BaseURL: server.URL, CacheTTL: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.IsEnabled("banner", nil)
	time.Sleep(40 * time.Millisecond)
	if client.IsEnabledCached("banner", nil) {
		t.Error("expired entry: got true, want the default false")
	}
}

func TestIsEnabledCachedInvalidKeyGetsDefault(t *testing.T) {
	client, err := NewClient(Config{APIKey: "sdk_test_key", Defaults: map[string]bool{"..": true}})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if !client.IsEnabledCached("..", nil) {
		t.Error("invalid key: want its configured default")
	}
}

func TestNewStaticClient(t *testing.T) {
	client := NewStaticClient(map[string]bool{"new-checkout": true, "old-banner": false})
	defer client.Close()

	if !client.IsEnabled("new-checkout", nil) || !client.IsEnabledCached("new-checkout", nil) {
		t.Error("new-checkout: want true")
	}
	if client.IsEnabled("old-banner", nil) || client.IsEnabledCached("old-banner", nil) {
		t.Error("old-banner: want false")
	}
	if client.IsEnabled("anything-else", &Context{UserID: "u"}) {
		t.Error("unlisted flag: want false")
	}

	result, err := client.Evaluate("new-checkout", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Reason != "static" || !result.Value || result.Key != "new-checkout" {
		t.Errorf("result = %+v", result)
	}
}

func TestNewStaticClientCopiesTheMap(t *testing.T) {
	flags := map[string]bool{"f": true}
	client := NewStaticClient(flags)
	defer client.Close()
	flags["f"] = false
	if !client.IsEnabled("f", nil) {
		t.Error("changing the caller's map changed the static client")
	}
}

func TestNewStaticClientAppliesOverrides(t *testing.T) {
	client := NewStaticClient(map[string]bool{"checkout": true})
	defer client.Close()
	if err := client.SetConfigOverride("checkout", map[string]interface{}{"limit": 3}, nil); err != nil {
		t.Fatal(err)
	}
	client.SetVariationOverride("checkout", "variant_a")

	result, err := client.Evaluate("checkout", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Configuration["limit"] != 3 || result.Variation != "variant_a" {
		t.Errorf("overrides not applied: %+v", result)
	}
	cfg, err := client.GetConfig("checkout", nil)
	if err != nil || cfg["limit"] != 3 {
		t.Errorf("GetConfig = %v, %v", cfg, err)
	}
}

func TestNewStaticClientRejectsInvalidKeysLikeEvaluate(t *testing.T) {
	var gotErr error
	client := NewStaticClient(map[string]bool{"..": true})
	client.config.OnError = func(err error) { gotErr = err }
	defer client.Close()
	if client.IsEnabled("..", nil) {
		t.Error("invalid key: want false")
	}
	if gotErr == nil {
		t.Error("invalid key: want OnError called")
	}
}

func TestIsEnabledCachedReadsTheKeyEvaluateStores(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"enabled": true}`))
	}))
	defer server.Close()
	client, err := NewClient(Config{APIKey: "sdk_test_key", BaseURL: server.URL, ApplicationID: "app-1"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	ctx := &Context{
		UserID:      "alice",
		Environment: "production",
		Attributes:  map[string]interface{}{"plan": "pro", "a": 1},
	}
	if _, err := client.Evaluate("banner", ctx); err != nil {
		t.Fatal(err)
	}

	// The key Evaluate stored, pinned to today's bytes: the SHA-256 hex of the prepared
	// context's JSON, with the configured ApplicationID filled in and map keys sorted (#30).
	const canonical = `{"user_id":"alice","application_id":"app-1","attributes":{"a":1,"plan":"pro"},"environment":"production"}`
	want := sha256Hex(canonical)
	client.cache.mu.Lock()
	stored := make([]string, 0, len(client.cache.byFlag["banner"]))
	for k := range client.cache.byFlag["banner"] {
		stored = append(stored, k)
	}
	client.cache.mu.Unlock()
	if len(stored) != 1 || stored[0] != want {
		t.Fatalf("Evaluate stored keys %q, want [%q]", stored, want)
	}

	// The key IsEnabledCached reads is the same one.
	if _, got, err := client.contextKey(ctx); err != nil || got != want {
		t.Errorf("contextKey = %q, %v; want %q", got, err, want)
	}
	if _, got, err := client.canonicalContext(ctx); err != nil || got != canonical {
		t.Errorf("canonicalContext = %q, %v; want %q", got, err, canonical)
	}
	// An equal context built separately (other map, other insertion order) hits it.
	equal := &Context{
		UserID:      "alice",
		Environment: "production",
		Attributes:  map[string]interface{}{"a": 1, "plan": "pro"},
	}
	if !client.IsEnabledCached("banner", equal) {
		t.Error("IsEnabledCached missed the entry Evaluate stored")
	}
	if ctx.ApplicationID != "" {
		t.Error("the caller's context was modified")
	}
}

// failingTransport fails the test on any request.
type failingTransport struct{ t *testing.T }

func (f failingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	f.t.Fatalf("static client made a request: %s %s", r.Method, r.URL)
	return nil, nil
}

func TestNewStaticClientNeverTouchesTheNetwork(t *testing.T) {
	client := NewStaticClient(map[string]bool{"checkout": true})
	defer client.Close()
	client.httpClient.Transport = failingTransport{t}
	if err := client.SetConfigOverride("checkout", map[string]interface{}{"limit": 3}, nil); err != nil {
		t.Fatal(err)
	}

	if !client.IsEnabled("checkout", &Context{UserID: "u"}) {
		t.Error("IsEnabled = false, want true")
	}
	if result, err := client.Evaluate("unlisted", nil); err != nil || result.Value || result.Reason != "static" {
		t.Errorf("Evaluate = %+v, %v", result, err)
	}
	if cfg, err := client.GetConfig("checkout", nil); err != nil || cfg["limit"] != 3 {
		t.Errorf("GetConfig = %v, %v", cfg, err)
	}
	if v, err := client.GetVariation("checkout", nil); err != nil || !v.Enabled {
		t.Errorf("GetVariation = %+v, %v", v, err)
	}
	if !client.IsEnabledCached("checkout", nil) {
		t.Error("IsEnabledCached = false, want true")
	}
}
