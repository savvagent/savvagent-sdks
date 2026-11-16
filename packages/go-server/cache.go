package savvagentflags

import (
	"sync"
	"time"
)

// maxContextsPerFlag bounds how many contexts the cache holds for one flag, so a host that
// evaluates a flag for many users cannot grow memory without limit.
const maxContextsPerFlag = 10000

// cache provides thread-safe in-memory caching for flag values. Entries are held per flag and
// then per context (the JSON of the evaluation context), because the server's answer depends on
// the context.
type cache struct {
	mu                 sync.RWMutex
	entries            map[string]map[string]cacheEntry
	ttl                time.Duration
	maxContextsPerFlag int

	// epoch and generations are bumped by every invalidation, so a result fetched before
	// one can be dropped instead of cached (see Generation and SetAt).
	epoch       uint64
	generations map[string]uint64
}

// cacheGeneration is a flag's invalidation generation at one moment.
type cacheGeneration struct{ epoch, n uint64 }

// newCache creates a new cache with the specified TTL
func newCache(ttl time.Duration) *cache {
	return &cache{
		entries:            make(map[string]map[string]cacheEntry),
		ttl:                ttl,
		maxContextsPerFlag: maxContextsPerFlag,
		generations:        make(map[string]uint64),
	}
}

// Get retrieves a cached value for the flag and context if it exists and hasn't expired
func (c *cache) Get(key, ctxKey string) (bool, bool) {
	entry, found := c.GetEntry(key, ctxKey)
	if !found {
		return false, false
	}
	return entry.Value, true
}

// GetEntry retrieves a complete cached entry (includes configuration and variation)
func (c *cache) GetEntry(key, ctxKey string) (*cacheEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.entries[key][ctxKey]
	if !exists {
		return nil, false
	}

	// Check if expired
	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	return &entry, true
}

// Set stores a value in the cache with TTL. When the flag already holds the maximum number of
// contexts, expired entries are dropped first, and if more than half the bound is still live
// the flag's contexts are cleared, so a sweep runs at most once per half-bound of new contexts.
func (c *cache) Set(key, ctxKey string, value bool, configuration map[string]interface{}, variation string, version int64, scope string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.setLocked(key, ctxKey, value, configuration, variation, version, scope)
}

// Generation returns the flag's invalidation generation. Read it before sending an evaluate
// request and pass it to SetAt, which drops the write if the flag was invalidated since.
func (c *cache) Generation(key string) cacheGeneration {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return cacheGeneration{c.epoch, c.generations[key]}
}

// SetAt is Set, except that it stores nothing when the flag was invalidated after gen was read.
func (c *cache) SetAt(gen cacheGeneration, key, ctxKey string, value bool, configuration map[string]interface{}, variation string, version int64, scope string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if gen != (cacheGeneration{c.epoch, c.generations[key]}) {
		return
	}
	c.setLocked(key, ctxKey, value, configuration, variation, version, scope)
}

func (c *cache) setLocked(key, ctxKey string, value bool, configuration map[string]interface{}, variation string, version int64, scope string) {
	contexts, ok := c.entries[key]
	if !ok {
		contexts = make(map[string]cacheEntry)
		c.entries[key] = contexts
	}
	if _, present := contexts[ctxKey]; !present && len(contexts) >= c.maxContextsPerFlag {
		now := time.Now()
		for k, e := range contexts {
			if now.After(e.ExpiresAt) {
				delete(contexts, k)
			}
		}
		if len(contexts) > c.maxContextsPerFlag/2 {
			for k := range contexts {
				delete(contexts, k)
			}
		}
	}

	contexts[ctxKey] = cacheEntry{
		Value:         value,
		Configuration: configuration,
		Variation:     variation,
		Version:       version,
		Scope:         scope,
		ExpiresAt:     time.Now().Add(c.ttl),
	}
}

// Invalidate removes every context cached for a flag
// If key is empty, it clears all entries
func (c *cache) Invalidate(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if key == "" {
		c.epoch++
		c.generations = make(map[string]uint64)
		c.entries = make(map[string]map[string]cacheEntry)
	} else {
		c.generations[key]++
		delete(c.entries, key)
	}
}

// Clear removes all entries from the cache
func (c *cache) Clear() {
	c.Invalidate("")
}
