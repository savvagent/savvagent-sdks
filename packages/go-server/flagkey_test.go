package savvagentflags

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func newFlagKeyTestClient(t *testing.T, baseURL string, defaults map[string]bool, onError func(error)) *FlagClient {
	t.Helper()
	client, err := NewClient(Config{
		APIKey:          "sdk_test",
		BaseURL:         baseURL,
		EnableRealtime:  false,
		EnableTelemetry: false,
		Defaults:        defaults,
		OnError:         onError,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return client
}

func TestEvaluateRejectsInvalidFlagKey(t *testing.T) {
	var requests int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	keys := map[string]string{
		"slash":    "a/b",
		"query":    "a?b",
		"fragment": "a#b",
		"dot":      ".",
		"dotdot":   "..",
		"empty":    "",
		"space":    "bad key",
		"too long": strings.Repeat("a", 129),
	}
	for name, key := range keys {
		t.Run(name, func(t *testing.T) {
			atomic.StoreInt32(&requests, 0)
			var onErrorCalls int32
			client := newFlagKeyTestClient(t, srv.URL, map[string]bool{key: true}, func(error) {
				atomic.AddInt32(&onErrorCalls, 1)
			})

			result, err := client.Evaluate(key, nil)
			if !errors.Is(err, ErrInvalidFlagKey) {
				t.Fatalf("err = %v, want ErrInvalidFlagKey", err)
			}
			if result == nil {
				t.Fatal("result is nil")
			}
			if !result.Value {
				t.Errorf("Value = false, want the configured default true")
			}
			if result.Reason != "error" {
				t.Errorf("Reason = %q, want \"error\"", result.Reason)
			}
			if n := atomic.LoadInt32(&requests); n != 0 {
				t.Errorf("requests = %d, want 0", n)
			}
			if n := atomic.LoadInt32(&onErrorCalls); n != 1 {
				t.Errorf("OnError calls = %d, want 1", n)
			}
		})
	}
}

func TestEvaluateSendsValidFlagKeys(t *testing.T) {
	for _, key := range []string{"new-checkout.v2_b", "...", strings.Repeat("a", 128)} {
		t.Run(key, func(t *testing.T) {
			var requests int32
			var path atomic.Value
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&requests, 1)
				path.Store(r.URL.EscapedPath())
				w.WriteHeader(http.StatusInternalServerError)
			}))
			defer srv.Close()

			client := newFlagKeyTestClient(t, srv.URL, nil, func(error) {})
			// The server answers 500; only the request path matters here.
			_, _ = client.Evaluate(key, nil)

			if n := atomic.LoadInt32(&requests); n != 1 {
				t.Fatalf("requests = %d, want 1", n)
			}
			if got, want := path.Load().(string), "/api/flags/"+key+"/evaluate"; got != want {
				t.Errorf("path = %q, want %q", got, want)
			}
		})
	}
}
