package savvagentflags

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// sha256Hex is the cache key the SDK must store for a context's canonical JSON (#30).
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// cachedKeys lists every (flag, context key) pair the cache holds.
func cachedKeys(c *cache) []cacheKey {
	c.mu.Lock()
	defer c.mu.Unlock()
	keys := make([]cacheKey, 0, len(c.items))
	for k := range c.items {
		keys = append(keys, k)
	}
	return keys
}

// cachedCount is the number of entries the cache holds across every flag.
func cachedCount(c *cache) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

// TestCacheKeyIsContextSHA256Digest pins the digest key: the stored context key is the SHA-256
// hex of the canonical context JSON, equal contexts share an entry, different contexts do not,
// and the raw context (here the user id) appears in no cache key.
func TestCacheKeyIsContextSHA256Digest(t *testing.T) {
	var requests int32
	srv := newContextServer(t, &requests)
	defer srv.Close()
	client := newFlagKeyTestClient(t, srv.URL, nil, nil)

	const userID = "alice-raw-user-id"
	first := &Context{UserID: userID, Attributes: map[string]interface{}{"plan": "pro", "region": "eu"}}
	if _, err := client.Evaluate("checkout", first); err != nil {
		t.Fatalf("err = %v", err)
	}
	_, canonical, err := client.canonicalContext(first)
	if err != nil {
		t.Fatalf("canonicalContext: %v", err)
	}
	if !strings.Contains(canonical, userID) {
		t.Fatalf("canonical JSON %q does not carry the user id; the test is not checking anything", canonical)
	}
	want := sha256Hex(canonical)
	keys := cachedKeys(client.cache)
	if len(keys) != 1 || keys[0].flag != "checkout" || keys[0].ctx != want {
		t.Fatalf("cache keys = %+v, want one {checkout %s}", keys, want)
	}

	// An equal context built separately (other map, other insertion order) shares the entry.
	equal := &Context{UserID: userID, Attributes: map[string]interface{}{"region": "eu", "plan": "pro"}}
	result, err := client.Evaluate("checkout", equal)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if result.Reason != "cached" {
		t.Errorf("equal context: reason = %q, want cached", result.Reason)
	}
	if n := cachedCount(client.cache); n != 1 {
		t.Errorf("equal context: %d entries, want 1", n)
	}

	// A different context gets its own entry.
	if _, err := client.Evaluate("checkout", &Context{UserID: "bob-raw-user-id"}); err != nil {
		t.Fatalf("err = %v", err)
	}
	if n := cachedCount(client.cache); n != 2 {
		t.Errorf("different context: %d entries, want 2", n)
	}
	if n := atomic.LoadInt32(&requests); n != 2 {
		t.Errorf("requests = %d, want 2", n)
	}

	for _, k := range cachedKeys(client.cache) {
		if len(k.ctx) != 64 || strings.Trim(k.ctx, "0123456789abcdef") != "" {
			t.Errorf("context key %q is not lowercase SHA-256 hex", k.ctx)
		}
		if strings.Contains(k.ctx, "raw-user-id") || strings.Contains(k.flag, "raw-user-id") {
			t.Errorf("cache key %+v holds the raw user id", k)
		}
	}
	client.cache.mu.Lock()
	for flag, digests := range client.cache.byFlag {
		for d := range digests {
			if strings.Contains(flag, "raw-user-id") || strings.Contains(d, "raw-user-id") {
				t.Errorf("per-flag index holds the raw user id: %q/%q", flag, d)
			}
		}
	}
	client.cache.mu.Unlock()
}

// TestCacheTotalBoundAcrossFlagsEvictsLeastRecentlyUsed pins the one total bound: entries
// across every flag never exceed the cap, and the least recently used entry goes first.
func TestCacheTotalBoundAcrossFlagsEvictsLeastRecentlyUsed(t *testing.T) {
	c := newCacheWithMaxEntries(time.Minute, 4)
	flags := []string{"f", "g", "h"}
	for i := 0; i < 12; i++ {
		c.Set(flags[i%len(flags)], fmt.Sprintf("ctx-%d", i), true, nil, "", 0, "")
		if n := cachedCount(c); n > 4 {
			t.Fatalf("after %d inserts, %d entries held, want at most 4", i+1, n)
		}
	}
	// The four newest survive, the eight oldest are gone.
	for i := 0; i < 12; i++ {
		_, found := c.Get(flags[i%len(flags)], fmt.Sprintf("ctx-%d", i))
		if want := i >= 8; found != want {
			t.Errorf("ctx-%d: found = %v, want %v", i, found, want)
		}
	}
	if defaultMaxEntries != 10000 {
		t.Errorf("defaultMaxEntries = %d, want 10000", defaultMaxEntries)
	}
	if got := newCache(time.Minute).maxEntries; got != defaultMaxEntries {
		t.Errorf("newCache maxEntries = %d, want %d", got, defaultMaxEntries)
	}
}

// TestCacheHitRefreshesRecency pins that a hit makes an entry most recently used, so it survives
// the next eviction.
func TestCacheHitRefreshesRecency(t *testing.T) {
	c := newCacheWithMaxEntries(time.Minute, 3)
	c.Set("f", "a", true, nil, "", 0, "")
	c.Set("g", "b", true, nil, "", 0, "")
	c.Set("f", "c", true, nil, "", 0, "")
	if _, found := c.GetEntry("f", "a"); !found {
		t.Fatal("f/a: want a hit")
	}
	c.Set("h", "d", true, nil, "", 0, "")
	if _, found := c.Get("f", "a"); !found {
		t.Error("f/a was evicted although it was just read")
	}
	if _, found := c.Get("g", "b"); found {
		t.Error("g/b survived although it was least recently used")
	}
	for _, k := range []cacheKey{{"f", "c"}, {"h", "d"}} {
		if _, found := c.Get(k.flag, k.ctx); !found {
			t.Errorf("%+v was evicted", k)
		}
	}
}

// TestCacheInvalidateFlagUnderTotalBound pins that Invalidate(flag) drops every context of that
// flag, leaves other flags alone, and frees the room it held under the total bound.
func TestCacheInvalidateFlagUnderTotalBound(t *testing.T) {
	c := newCacheWithMaxEntries(time.Minute, 4)
	c.Set("f", "a", true, nil, "", 0, "")
	c.Set("f", "b", true, nil, "", 0, "")
	c.Set("g", "a", true, nil, "", 0, "")
	c.Set("g", "b", true, nil, "", 0, "")
	c.Invalidate("f")
	for _, ctx := range []string{"a", "b"} {
		if _, found := c.Get("f", ctx); found {
			t.Errorf("f/%s survived Invalidate(f)", ctx)
		}
		if _, found := c.Get("g", ctx); !found {
			t.Errorf("g/%s was dropped by Invalidate(f)", ctx)
		}
	}
	if n := cachedCount(c); n != 2 {
		t.Errorf("%d entries after Invalidate(f), want 2", n)
	}
	c.mu.Lock()
	if _, ok := c.byFlag["f"]; ok {
		t.Error("the per-flag index still holds f")
	}
	c.mu.Unlock()
	// The freed room is reused without evicting g.
	c.Set("h", "a", true, nil, "", 0, "")
	c.Set("h", "b", true, nil, "", 0, "")
	for _, k := range []cacheKey{{"g", "a"}, {"g", "b"}, {"h", "a"}, {"h", "b"}} {
		if _, found := c.Get(k.flag, k.ctx); !found {
			t.Errorf("%+v missing", k)
		}
	}
}

// TestRequestBodyStillCarriesFullContext pins that only the cache key changed: the evaluate
// request still sends the whole context.
func TestRequestBodyStillCarriesFullContext(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		_, _ = w.Write([]byte(`{"enabled": true}`))
	}))
	defer srv.Close()
	client := newFlagKeyTestClient(t, srv.URL, nil, nil)
	if _, err := client.Evaluate("checkout", &Context{UserID: "alice", Attributes: map[string]interface{}{"plan": "pro"}}); err != nil {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(body, `"user_id":"alice"`) || !strings.Contains(body, `"plan":"pro"`) {
		t.Errorf("request body %s does not carry the full context", body)
	}
}
