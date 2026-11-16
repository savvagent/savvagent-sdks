package savvagentflags

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// newContextServer answers the evaluate call by the request body's user_id, or by
// attributes.plan when there is no user_id: "a" and "pro" are true, everything else false.
func newContextServer(t *testing.T, requests *int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(requests, 1)
		var body struct {
			Context struct {
				UserID     string                 `json:"user_id"`
				Attributes map[string]interface{} `json:"attributes"`
			} `json:"context"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		enabled := body.Context.UserID == "a"
		if plan, ok := body.Context.Attributes["plan"].(string); ok {
			enabled = plan == "pro"
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, serverBody, fmt.Sprintf("%t", enabled))
	}))
}

func TestCacheIsPerContext(t *testing.T) {
	var requests int32
	srv := newContextServer(t, &requests)
	defer srv.Close()
	client := newFlagKeyTestClient(t, srv.URL, nil, nil)

	steps := []struct {
		user   string
		value  bool
		reason string
	}{
		{"a", true, "evaluated"},
		{"b", false, "evaluated"},
		{"a", true, "cached"},
		{"b", false, "cached"},
	}
	for i, s := range steps {
		result, err := client.Evaluate("checkout", &Context{UserID: s.user})
		if err != nil {
			t.Fatalf("step %d: err = %v", i, err)
		}
		if result.Value != s.value || result.Reason != s.reason {
			t.Errorf("step %d (user %s): value=%v reason=%q, want value=%v reason=%q",
				i, s.user, result.Value, result.Reason, s.value, s.reason)
		}
	}
	if n := atomic.LoadInt32(&requests); n != 2 {
		t.Errorf("requests = %d, want 2", n)
	}
}

func TestCacheDistinguishesAttributes(t *testing.T) {
	var requests int32
	srv := newContextServer(t, &requests)
	defer srv.Close()
	client := newFlagKeyTestClient(t, srv.URL, nil, nil)

	for plan, want := range map[string]bool{"pro": true, "free": false} {
		result, err := client.Evaluate("checkout", &Context{Attributes: map[string]interface{}{"plan": plan}})
		if err != nil {
			t.Fatalf("plan %s: err = %v", plan, err)
		}
		if result.Value != want || result.Reason != "evaluated" {
			t.Errorf("plan %s: value=%v reason=%q, want value=%v reason=evaluated",
				plan, result.Value, result.Reason, want)
		}
	}
	if n := atomic.LoadInt32(&requests); n != 2 {
		t.Errorf("requests = %d, want 2", n)
	}
}

func TestInvalidateDropsEveryContext(t *testing.T) {
	var requests int32
	srv := newContextServer(t, &requests)
	defer srv.Close()
	client := newFlagKeyTestClient(t, srv.URL, nil, nil)

	for _, user := range []string{"a", "b", "a", "b"} {
		if _, err := client.Evaluate("checkout", &Context{UserID: user}); err != nil {
			t.Fatalf("err = %v", err)
		}
	}
	client.InvalidateCache("checkout")
	for _, user := range []string{"a", "b"} {
		result, err := client.Evaluate("checkout", &Context{UserID: user})
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if result.Reason != "evaluated" {
			t.Errorf("user %s: reason = %q, want \"evaluated\"", user, result.Reason)
		}
	}
	if n := atomic.LoadInt32(&requests); n != 4 {
		t.Errorf("requests = %d, want 4", n)
	}
}

func TestEvaluateDoesNotModifyCallerContext(t *testing.T) {
	var requests int32
	srv := newContextServer(t, &requests)
	defer srv.Close()
	client, err := NewClient(Config{
		APIKey:        "sdk_test",
		BaseURL:       srv.URL,
		ApplicationID: "app-1",
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	ctx := &Context{UserID: "a"}
	if _, err := client.Evaluate("checkout", ctx); err != nil {
		t.Fatalf("err = %v", err)
	}
	if ctx.ApplicationID != "" {
		t.Errorf("caller context ApplicationID = %q, want it left empty", ctx.ApplicationID)
	}
}

func TestCacheMissForOtherContext(t *testing.T) {
	c := newCache(time.Minute)
	c.Set("f", `{"user_id":"a"}`, true, nil, "", 0, "")
	if _, found := c.Get("f", `{"user_id":"a"}`); !found {
		t.Error("same context: want a hit")
	}
	if _, found := c.Get("f", `{"user_id":"b"}`); found {
		t.Error("other context: want a miss")
	}
	if _, found := c.GetEntry("g", `{"user_id":"a"}`); found {
		t.Error("other flag: want a miss")
	}
}

func TestCacheInvalidateDropsAllContexts(t *testing.T) {
	c := newCache(time.Minute)
	c.Set("f", "a", true, nil, "", 0, "")
	c.Set("f", "b", false, nil, "", 0, "")
	c.Set("g", "a", true, nil, "", 0, "")
	c.Invalidate("f")
	if _, found := c.Get("f", "a"); found {
		t.Error("f/a survived Invalidate(f)")
	}
	if _, found := c.Get("f", "b"); found {
		t.Error("f/b survived Invalidate(f)")
	}
	if _, found := c.Get("g", "a"); !found {
		t.Error("g/a was dropped by Invalidate(f)")
	}
}

func TestCacheBoundsContextsPerFlag(t *testing.T) {
	c := newCache(time.Minute)
	c.maxContextsPerFlag = 4
	for i := 0; i < 10; i++ {
		c.Set("f", fmt.Sprintf("ctx-%d", i), true, nil, "", 0, "")
		if n := len(c.entries["f"]); n > 4 {
			t.Fatalf("after %d inserts, %d contexts held, want at most 4", i+1, n)
		}
	}
	if _, found := c.Get("f", "ctx-9"); !found {
		t.Error("the newest context is not cached")
	}
}
