package savvagentflags

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestClient_Evaluate_DoesNotFollowRedirects(t *testing.T) {
	var targetHits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/target" {
			atomic.AddInt32(&targetHits, 1)
			fmt.Fprint(w, `{"enabled":true}`)
			return
		}
		http.Redirect(w, r, "/target", http.StatusFound)
	}))
	defer srv.Close()

	client, err := NewClient(Config{APIKey: "sdk_test_key", BaseURL: srv.URL, OnError: func(error) {}})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	res, err := client.Evaluate("redirected", nil)
	if err == nil {
		t.Error("expected an error for a redirect response")
	}
	if res == nil || res.Value {
		t.Errorf("expected the default (false) result, got %+v", res)
	}
	if n := atomic.LoadInt32(&targetHits); n != 0 {
		t.Errorf("redirect target received %d requests, want 0", n)
	}
}

func TestClient_Evaluate_OversizedResponseNotCached(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		pad := strings.Repeat("a", maxResponseBytes)
		fmt.Fprintf(w, `{"enabled":true,"variation":"%s"}`, pad)
	}))
	defer srv.Close()

	client, err := NewClient(Config{APIKey: "sdk_test_key", BaseURL: srv.URL, OnError: func(error) {}})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	for i := 1; i <= 2; i++ {
		res, err := client.Evaluate("big", nil)
		if err == nil {
			t.Fatalf("call %d: expected an error for an oversized body", i)
		}
		if res == nil || res.Value {
			t.Fatalf("call %d: expected the default (false) result, got %+v", i, res)
		}
	}
	if n := atomic.LoadInt32(&hits); n != 2 {
		t.Errorf("server hit %d times, want 2 (failed lookup must not be cached)", n)
	}
}
