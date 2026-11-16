package savvagentflags

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// An evaluate in flight when its flag is invalidated must not cache its stale result (#137).
func TestInvalidationDuringRequestDropsTheCacheWrite(t *testing.T) {
	var requests int32
	var client *FlagClient
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&requests, 1)
		if n == 1 {
			// The kill switch flips while this (stale) request is in flight.
			client.InvalidateCache("checkout")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, serverBody, fmt.Sprintf("%t", n == 1))
	}))
	defer srv.Close()
	client = newFlagKeyTestClient(t, srv.URL, nil, nil)

	first, err := client.Evaluate("checkout", &Context{UserID: "a"})
	if err != nil || !first.Value {
		t.Fatalf("first = %+v, err = %v; want true", first, err)
	}
	second, err := client.Evaluate("checkout", &Context{UserID: "a"})
	if err != nil {
		t.Fatalf("second err = %v", err)
	}
	if second.Reason != "evaluated" || second.Value {
		t.Errorf("second = value %v reason %q; want a fresh false", second.Value, second.Reason)
	}
	if n := atomic.LoadInt32(&requests); n != 2 {
		t.Errorf("requests = %d, want 2", n)
	}
}

func TestCacheGenerationRules(t *testing.T) {
	c := newCache(60e9)
	gen := c.Generation("a")
	c.Invalidate("b") // another flag does not matter
	c.SetAt(gen, "a", "ctx", true, nil, "", 0, "")
	if _, ok := c.Get("a", "ctx"); !ok {
		t.Error("write dropped after an unrelated invalidation")
	}

	gen = c.Generation("a")
	c.Invalidate("a")
	c.SetAt(gen, "a", "ctx", true, nil, "", 0, "")
	if _, ok := c.Get("a", "ctx"); ok {
		t.Error("write kept after the flag was invalidated")
	}

	gen = c.Generation("a")
	c.Clear()
	c.SetAt(gen, "a", "ctx", true, nil, "", 0, "")
	if _, ok := c.Get("a", "ctx"); ok {
		t.Error("write kept after Clear")
	}
}
