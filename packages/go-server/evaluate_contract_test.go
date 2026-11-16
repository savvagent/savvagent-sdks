package savvagentflags

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// The evaluate call follows docs/SDK-DEVELOPER-GUIDE.md (#112): POST
// /api/flags/{key}/evaluate, with the result in "enabled".

// serverBody is the evaluate response exactly as the server sends it.
const serverBody = `{"key":"checkout","enabled":%s,"scope":"application","variation":null,` +
	`"configuration":null,"timestamp":1700000000,"version":3,"context":{"environment":"production"}}`

func TestEvaluateReadsEnabledFromTheDocumentedPath(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		enabled := enabled
		name := "false"
		if enabled {
			name = "true"
		}
		t.Run(name, func(t *testing.T) {
			var method, path atomic.Value
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				method.Store(r.Method)
				path.Store(r.URL.EscapedPath())
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, serverBody, name)
			}))
			defer srv.Close()

			var onErrorCalls int32
			client := newFlagKeyTestClient(t, srv.URL, map[string]bool{"checkout": !enabled}, func(error) {
				atomic.AddInt32(&onErrorCalls, 1)
			})

			result, err := client.Evaluate("checkout", nil)
			if err != nil {
				t.Fatalf("err = %v, want nil", err)
			}
			if got, _ := method.Load().(string); got != http.MethodPost {
				t.Errorf("method = %q, want POST", got)
			}
			if got, _ := path.Load().(string); got != "/api/flags/checkout/evaluate" {
				t.Errorf("path = %q, want /api/flags/checkout/evaluate", got)
			}
			if result.Value != enabled {
				t.Errorf("Value = %v, want %v", result.Value, enabled)
			}
			if result.Reason != "evaluated" {
				t.Errorf("Reason = %q, want \"evaluated\"", result.Reason)
			}
			if result.Variation != "" || result.Configuration != nil {
				t.Errorf("Variation = %q, Configuration = %v, want both empty", result.Variation, result.Configuration)
			}
			if n := atomic.LoadInt32(&onErrorCalls); n != 0 {
				t.Errorf("OnError calls = %d, want 0", n)
			}
		})
	}
}

func TestEvaluateWithoutBooleanEnabledIsAFailedLookup(t *testing.T) {
	bodies := map[string]string{
		"value only":     `{"value":true}`,
		"enabled null":   `{"enabled":null}`,
		"enabled string": `{"enabled":"true"}`,
		"enabled number": `{"enabled":1}`,
	}
	for name, body := range bodies {
		body := body
		t.Run(name, func(t *testing.T) {
			var requests int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&requests, 1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(body))
			}))
			defer srv.Close()

			var onErrorCalls int32
			client := newFlagKeyTestClient(t, srv.URL, map[string]bool{"checkout": false}, func(error) {
				atomic.AddInt32(&onErrorCalls, 1)
			})

			for i := 0; i < 2; i++ {
				result, err := client.Evaluate("checkout", nil)
				if err == nil {
					t.Fatalf("call %d: err = nil, want an error", i+1)
				}
				if result.Value {
					t.Errorf("call %d: Value = true, want the default false", i+1)
				}
				if result.Reason != "error" {
					t.Errorf("call %d: Reason = %q, want \"error\"", i+1, result.Reason)
				}
			}
			// Not cached: the second lookup asks the server again.
			if n := atomic.LoadInt32(&requests); n != 2 {
				t.Errorf("requests = %d, want 2", n)
			}
			if n := atomic.LoadInt32(&onErrorCalls); n != 2 {
				t.Errorf("OnError calls = %d, want 2", n)
			}
		})
	}
}
