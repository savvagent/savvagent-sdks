package savvagent

import (
	"testing"
	"time"
)

func TestCache_SetAndGet(t *testing.T) {
	cache := NewCache(time.Minute)

	cache.Set("test-flag", true)

	value, found := cache.Get("test-flag")
	if !found {
		t.Error("Expected to find cached value")
	}

	if value != true {
		t.Errorf("Expected true, got %v", value)
	}
}

func TestCache_GetNonExistent(t *testing.T) {
	cache := NewCache(time.Minute)

	_, found := cache.Get("non-existent")
	if found {
		t.Error("Expected not to find non-existent key")
	}
}

func TestCache_TTL(t *testing.T) {
	cache := NewCache(100 * time.Millisecond)

	cache.Set("test-flag", true)

	// Should exist immediately
	_, found := cache.Get("test-flag")
	if !found {
		t.Error("Expected to find cached value immediately")
	}

	// Wait for expiration
	time.Sleep(150 * time.Millisecond)

	// Should be expired
	_, found = cache.Get("test-flag")
	if found {
		t.Error("Expected value to be expired")
	}
}

func TestCache_Overwrite(t *testing.T) {
	cache := NewCache(time.Minute)

	cache.Set("test-flag", true)
	cache.Set("test-flag", false)

	value, found := cache.Get("test-flag")
	if !found {
		t.Error("Expected to find cached value")
	}

	if value != false {
		t.Errorf("Expected false, got %v", value)
	}
}

func TestCache_MultipleKeys(t *testing.T) {
	cache := NewCache(time.Minute)

	cache.Set("flag1", true)
	cache.Set("flag2", false)
	cache.Set("flag3", "value")

	if val, found := cache.Get("flag1"); !found || val != true {
		t.Error("flag1 not found or incorrect value")
	}

	if val, found := cache.Get("flag2"); !found || val != false {
		t.Error("flag2 not found or incorrect value")
	}

	if val, found := cache.Get("flag3"); !found || val != "value" {
		t.Error("flag3 not found or incorrect value")
	}
}

func TestCache_Invalidate(t *testing.T) {
	cache := NewCache(time.Minute)

	cache.Set("flag1", true)
	cache.Set("flag2", false)

	cache.Invalidate("flag1")

	if _, found := cache.Get("flag1"); found {
		t.Error("flag1 should be invalidated")
	}

	if _, found := cache.Get("flag2"); !found {
		t.Error("flag2 should still exist")
	}
}

func TestCache_Clear(t *testing.T) {
	cache := NewCache(time.Minute)

	cache.Set("flag1", true)
	cache.Set("flag2", false)
	cache.Set("flag3", "value")

	cache.Clear()

	if _, found := cache.Get("flag1"); found {
		t.Error("flag1 should be cleared")
	}

	if _, found := cache.Get("flag2"); found {
		t.Error("flag2 should be cleared")
	}

	if _, found := cache.Get("flag3"); found {
		t.Error("flag3 should be cleared")
	}
}

func TestCache_ConcurrentAccess(t *testing.T) {
	cache := NewCache(time.Minute)

	done := make(chan bool, 100)

	// Concurrent writes
	for i := 0; i < 50; i++ {
		go func(id int) {
			cache.Set("test-flag", id)
			done <- true
		}(i)
	}

	// Concurrent reads
	for i := 0; i < 50; i++ {
		go func() {
			cache.Get("test-flag")
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 100; i++ {
		<-done
	}

	// Should not panic or race
}

func TestCache_VariousTypes(t *testing.T) {
	cache := NewCache(time.Minute)

	tests := []struct {
		name  string
		key   string
		value interface{}
	}{
		{"bool", "bool-key", true},
		{"string", "string-key", "test value"},
		{"int", "int-key", 42},
		{"float", "float-key", 3.14},
		{"slice", "slice-key", []string{"a", "b", "c"}},
		{"map", "map-key", map[string]int{"a": 1, "b": 2}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cache.Set(tt.key, tt.value)

			value, found := cache.Get(tt.key)
			if !found {
				t.Errorf("Expected to find %s", tt.key)
			}

			// Type-specific comparison would go here
			if value == nil {
				t.Error("Value should not be nil")
			}
		})
	}
}

func TestCache_ZeroTTL(t *testing.T) {
	cache := NewCache(0)

	cache.Set("test-flag", true)

	// Behavior with 0 TTL depends on implementation
	// Either it doesn't cache or expires immediately
}
