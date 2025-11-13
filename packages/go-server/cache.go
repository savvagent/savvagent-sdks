package savvagent

import (
	"sync"
	"time"
)

// cache provides thread-safe in-memory caching for flag values
type cache struct {
	mu      sync.RWMutex
	entries map[string]cacheEntry
	ttl     time.Duration
}

// newCache creates a new cache with the specified TTL
func newCache(ttl time.Duration) *cache {
	return &cache{
		entries: make(map[string]cacheEntry),
		ttl:     ttl,
	}
}

// Get retrieves a cached value if it exists and hasn't expired
func (c *cache) Get(key string) (bool, bool) {
	entry, found := c.GetEntry(key)
	if !found {
		return false, false
	}
	return entry.Value, true
}

// GetEntry retrieves a complete cached entry (includes configuration and variation)
func (c *cache) GetEntry(key string) (*cacheEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.entries[key]
	if !exists {
		return nil, false
	}

	// Check if expired
	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	return &entry, true
}

// Set stores a value in the cache with TTL
func (c *cache) Set(key string, value bool, configuration map[string]interface{}, variation string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[key] = cacheEntry{
		Value:         value,
		Configuration: configuration,
		Variation:     variation,
		ExpiresAt:     time.Now().Add(c.ttl),
	}
}

// Invalidate removes a specific key from the cache
// If key is empty, it clears all entries
func (c *cache) Invalidate(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if key == "" {
		c.entries = make(map[string]cacheEntry)
	} else {
		delete(c.entries, key)
	}
}

// Clear removes all entries from the cache
func (c *cache) Clear() {
	c.Invalidate("")
}
