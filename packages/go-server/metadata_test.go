package savvagentflags

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func metadataServer(body string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
}

func TestEvaluateReportsVersionAndScope(t *testing.T) {
	srv := metadataServer(`{"key":"checkout","enabled":true,"scope":"application","variation":null,` +
		`"configuration":null,"timestamp":1700000000,"version":3,"context":{"environment":"production"}}`)
	defer srv.Close()

	var onErrorCalls int32
	client := newFlagKeyTestClient(t, srv.URL, map[string]bool{"checkout": false}, func(error) {
		atomic.AddInt32(&onErrorCalls, 1)
	})

	for i, wantReason := range []string{"evaluated", "cached"} {
		result, err := client.Evaluate("checkout", nil)
		if err != nil {
			t.Fatalf("call %d: err = %v, want nil", i+1, err)
		}
		if result.Reason != wantReason {
			t.Errorf("call %d: Reason = %q, want %q", i+1, result.Reason, wantReason)
		}
		if result.Metadata == nil {
			t.Fatalf("call %d: Metadata is nil", i+1)
		}
		if result.Metadata.Version != 3 {
			t.Errorf("call %d: Version = %d, want 3", i+1, result.Metadata.Version)
		}
		if result.Metadata.Scope != "application" {
			t.Errorf("call %d: Scope = %q, want \"application\"", i+1, result.Metadata.Scope)
		}
		if result.Metadata.FlagID != "" || result.Metadata.Description != "" || result.Metadata.Variant != "" {
			t.Errorf("call %d: FlagID, Description and Variant must be empty, got %+v", i+1, result.Metadata)
		}
	}
	if n := atomic.LoadInt32(&onErrorCalls); n != 0 {
		t.Errorf("OnError calls = %d, want 0", n)
	}
}

func TestEvaluateDropsMalformedMetadata(t *testing.T) {
	bodies := map[string]string{
		"version string": `{"enabled":true,"version":"3","scope":"application"}`,
		"version float":  `{"enabled":true,"version":1.5,"scope":"application"}`,
		"version bool":   `{"enabled":true,"version":true,"scope":"application"}`,
		"scope number":   `{"enabled":true,"version":3,"scope":7}`,
		"both malformed": `{"enabled":true,"version":"3","scope":7}`,
	}
	for name, body := range bodies {
		body := body
		t.Run(name, func(t *testing.T) {
			srv := metadataServer(body)
			defer srv.Close()

			var onErrorCalls int32
			client := newFlagKeyTestClient(t, srv.URL, map[string]bool{"checkout": false}, func(error) {
				atomic.AddInt32(&onErrorCalls, 1)
			})

			result, err := client.Evaluate("checkout", nil)
			if err != nil {
				t.Fatalf("err = %v, want nil", err)
			}
			if !result.Value {
				t.Errorf("Value = false, want true")
			}
			if result.Reason != "evaluated" {
				t.Errorf("Reason = %q, want \"evaluated\"", result.Reason)
			}
			if result.Metadata == nil {
				t.Fatal("Metadata is nil")
			}
			if name != "scope number" && result.Metadata.Version != 0 {
				t.Errorf("Version = %d, want 0", result.Metadata.Version)
			}
			if name != "version string" && name != "version float" && name != "version bool" &&
				result.Metadata.Scope != "" {
				t.Errorf("Scope = %q, want empty", result.Metadata.Scope)
			}
			if n := atomic.LoadInt32(&onErrorCalls); n != 0 {
				t.Errorf("OnError calls = %d, want 0", n)
			}
		})
	}
}
