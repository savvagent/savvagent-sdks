package savvagentflags

import (
	"testing"
	"time"
)

func TestCache_SetAndGet(t *testing.T) {
	cache := newCache(time.Minute)

	cache.Set("test-flag", "ctx-a", true, nil, "", 0, "")

	value, found := cache.Get("test-flag", "ctx-a")
	if !found {
		t.Fatal("Expected to find cached value")
	}
	if !value {
		t.Errorf("Expected true, got %v", value)
	}
}

func TestCache_GetNonExistent(t *testing.T) {
	cache := newCache(time.Minute)

	if _, found := cache.Get("non-existent", "ctx-a"); found {
		t.Error("Expected not to find non-existent key")
	}
	if _, found := cache.GetEntry("non-existent", "ctx-a"); found {
		t.Error("Expected no entry for non-existent key")
	}
}

func TestCache_TTL(t *testing.T) {
	cache := newCache(100 * time.Millisecond)

	cache.Set("test-flag", "ctx-a", true, nil, "", 0, "")

	// Should exist immediately
	if _, found := cache.Get("test-flag", "ctx-a"); !found {
		t.Fatal("Expected to find cached value immediately")
	}

	// Wait for expiration
	time.Sleep(150 * time.Millisecond)

	// Should be expired
	if _, found := cache.Get("test-flag", "ctx-a"); found {
		t.Error("Expected value to be expired")
	}
}

func TestCache_Overwrite(t *testing.T) {
	cache := newCache(time.Minute)

	cache.Set("test-flag", "ctx-a", true, nil, "", 0, "")
	cache.Set("test-flag", "ctx-a", false, nil, "", 0, "")

	value, found := cache.Get("test-flag", "ctx-a")
	if !found {
		t.Fatal("Expected to find cached value")
	}
	if value {
		t.Errorf("Expected false, got %v", value)
	}
}

func TestCache_MultipleKeysAndContexts(t *testing.T) {
	cache := newCache(time.Minute)

	cache.Set("flag1", "ctx-a", true, nil, "", 0, "")
	cache.Set("flag1", "ctx-b", false, nil, "", 0, "")
	cache.Set("flag2", "ctx-a", false, nil, "", 0, "")

	if val, found := cache.Get("flag1", "ctx-a"); !found || !val {
		t.Error("flag1/ctx-a not found or incorrect value")
	}
	if val, found := cache.Get("flag1", "ctx-b"); !found || val {
		t.Error("flag1/ctx-b not found or incorrect value")
	}
	if val, found := cache.Get("flag2", "ctx-a"); !found || val {
		t.Error("flag2/ctx-a not found or incorrect value")
	}
}

func TestCache_GetEntryIncludesConfigurationAndVariation(t *testing.T) {
	cache := newCache(time.Minute)
	configuration := map[string]interface{}{"theme": "dark"}

	cache.Set("flag", "ctx-a", true, configuration, "variant_a", 0, "")

	entry, found := cache.GetEntry("flag", "ctx-a")
	if !found {
		t.Fatal("Expected to find cached entry")
	}
	if entry.Value != true {
		t.Errorf("Value = %v, want true", entry.Value)
	}
	if entry.Variation != "variant_a" {
		t.Errorf("Variation = %q, want variant_a", entry.Variation)
	}
	if entry.Configuration["theme"] != "dark" {
		t.Errorf("Configuration = %v, want theme=dark", entry.Configuration)
	}
}

func TestCache_Invalidate(t *testing.T) {
	cache := newCache(time.Minute)

	cache.Set("flag1", "ctx-a", true, nil, "", 0, "")
	cache.Set("flag1", "ctx-b", true, nil, "", 0, "")
	cache.Set("flag2", "ctx-a", false, nil, "", 0, "")

	cache.Invalidate("flag1")

	if _, found := cache.Get("flag1", "ctx-a"); found {
		t.Error("flag1/ctx-a should be invalidated")
	}
	if _, found := cache.Get("flag1", "ctx-b"); found {
		t.Error("flag1/ctx-b should be invalidated")
	}
	if _, found := cache.Get("flag2", "ctx-a"); !found {
		t.Error("flag2/ctx-a should still exist")
	}
}

func TestCache_Clear(t *testing.T) {
	cache := newCache(time.Minute)

	cache.Set("flag1", "ctx-a", true, nil, "", 0, "")
	cache.Set("flag2", "ctx-a", false, nil, "", 0, "")

	cache.Clear()

	if _, found := cache.Get("flag1", "ctx-a"); found {
		t.Error("flag1 should be cleared")
	}
	if _, found := cache.Get("flag2", "ctx-a"); found {
		t.Error("flag2 should be cleared")
	}
}

func TestCache_ConcurrentAccess(t *testing.T) {
	cache := newCache(time.Minute)

	done := make(chan bool, 100)

	// Concurrent writes
	for i := 0; i < 50; i++ {
		go func(id int) {
			cache.Set("test-flag", "ctx-a", id%2 == 0, nil, "", 0, "")
			done <- true
		}(i)
	}

	// Concurrent reads
	for i := 0; i < 50; i++ {
		go func() {
			cache.Get("test-flag", "ctx-a")
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 100; i++ {
		<-done
	}

	// Should not panic or race
}
