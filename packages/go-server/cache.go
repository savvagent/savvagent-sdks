package savvagentflags

import (
	"container/list"
	"sync"
	"time"
)

// defaultMaxEntries bounds how many entries the cache holds across every flag, so a host that
// evaluates flags for many users cannot grow memory without limit. When it is full, the least
// recently used entry is evicted.
const defaultMaxEntries = 10000

// cacheKey names one entry: the flag key and the context key, which is the SHA-256 hex digest
// of the context's canonical JSON (see FlagClient.contextKey), never the context itself.
type cacheKey struct{ flag, ctx string }

// lruItem is the value of one element of the recency list.
type lruItem struct {
	key   cacheKey
	entry cacheEntry
}

// cache provides thread-safe in-memory caching for flag values. Entries are held per flag and
// per context, because the server's answer depends on the context, under one least recently
// used bound across every flag.
type cache struct {
	mu         sync.Mutex
	items      map[cacheKey]*list.Element
	byFlag     map[string]map[string]struct{} // flag key to its cached context digests
	lru        *list.List                     // front is the most recently used
	ttl        time.Duration
	maxEntries int

	// epoch and generations are bumped by every invalidation, so a result fetched before
	// one can be dropped instead of cached (see Generation and SetAt).
	epoch       uint64
	generations map[string]uint64
}

// cacheGeneration is a flag's invalidation generation at one moment.
type cacheGeneration struct{ epoch, n uint64 }

// newCache creates a new cache with the specified TTL and the default bound.
func newCache(ttl time.Duration) *cache {
	return newCacheWithMaxEntries(ttl, defaultMaxEntries)
}

// newCacheWithMaxEntries creates a cache that holds at most maxEntries entries across every flag.
func newCacheWithMaxEntries(ttl time.Duration, maxEntries int) *cache {
	return &cache{
		items:       make(map[cacheKey]*list.Element),
		byFlag:      make(map[string]map[string]struct{}),
		lru:         list.New(),
		ttl:         ttl,
		maxEntries:  maxEntries,
		generations: make(map[string]uint64),
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

// GetEntry retrieves a complete cached entry (includes configuration and variation). A hit
// makes the entry the most recently used; an expired entry is dropped and is a miss.
func (c *cache) GetEntry(key, ctxKey string) (*cacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	el, exists := c.items[cacheKey{key, ctxKey}]
	if !exists {
		return nil, false
	}
	item := el.Value.(*lruItem)
	if time.Now().After(item.entry.ExpiresAt) {
		c.removeLocked(el)
		return nil, false
	}
	c.lru.MoveToFront(el)
	entry := item.entry
	return &entry, true
}

// Set stores a value in the cache with TTL. When the cache is full, the least recently used
// entry (of any flag) is evicted.
func (c *cache) Set(key, ctxKey string, value bool, configuration map[string]interface{}, variation string, version int64, scope string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.setLocked(key, ctxKey, value, configuration, variation, version, scope)
}

// Generation returns the flag's invalidation generation. Read it before sending an evaluate
// request and pass it to SetAt, which drops the write if the flag was invalidated since.
func (c *cache) Generation(key string) cacheGeneration {
	c.mu.Lock()
	defer c.mu.Unlock()
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
	entry := cacheEntry{
		Value:         value,
		Configuration: configuration,
		Variation:     variation,
		Version:       version,
		Scope:         scope,
		ExpiresAt:     time.Now().Add(c.ttl),
	}
	k := cacheKey{key, ctxKey}
	if el, ok := c.items[k]; ok {
		el.Value.(*lruItem).entry = entry
		c.lru.MoveToFront(el)
		return
	}
	for c.lru.Len() > 0 && c.lru.Len() >= c.maxEntries {
		c.removeLocked(c.lru.Back())
	}
	c.items[k] = c.lru.PushFront(&lruItem{key: k, entry: entry})
	digests, ok := c.byFlag[key]
	if !ok {
		digests = make(map[string]struct{})
		c.byFlag[key] = digests
	}
	digests[ctxKey] = struct{}{}
}

// removeLocked drops one entry from the list, the entry map and the per-flag index.
func (c *cache) removeLocked(el *list.Element) {
	k := c.lru.Remove(el).(*lruItem).key
	delete(c.items, k)
	if digests, ok := c.byFlag[k.flag]; ok {
		delete(digests, k.ctx)
		if len(digests) == 0 {
			delete(c.byFlag, k.flag)
		}
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
		c.items = make(map[cacheKey]*list.Element)
		c.byFlag = make(map[string]map[string]struct{})
		c.lru.Init()
		return
	}
	c.generations[key]++
	for ctxKey := range c.byFlag[key] {
		k := cacheKey{key, ctxKey}
		c.lru.Remove(c.items[k])
		delete(c.items, k)
	}
	delete(c.byFlag, key)
}

// Clear removes all entries from the cache
func (c *cache) Clear() {
	c.Invalidate("")
}
