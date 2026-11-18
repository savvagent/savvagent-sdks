import { FlagCache, contextCacheKey } from './cache';

describe('FlagCache', () => {
  let cache: FlagCache;

  beforeEach(() => {
    cache = new FlagCache(1000); // 1 second TTL
  });

  describe('Basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('test-flag', true);
      expect(cache.get('test-flag')).toBe(true);
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('non-existent')).toBeNull();
    });

    it('should overwrite existing values', () => {
      cache.set('test-flag', true);
      cache.set('test-flag', false);
      expect(cache.get('test-flag')).toBe(false);
    });

    it('should store multiple boolean values', () => {
      cache.set('boolean-flag-1', true);
      cache.set('boolean-flag-2', false);
      cache.set('boolean-flag-3', true);

      expect(cache.get('boolean-flag-1')).toBe(true);
      expect(cache.get('boolean-flag-2')).toBe(false);
      expect(cache.get('boolean-flag-3')).toBe(true);
    });
  });

  describe('TTL behavior', () => {
    it('should expire values after TTL', (done) => {
      const shortCache = new FlagCache(100); // 100ms TTL

      shortCache.set('test-flag', true);
      expect(shortCache.get('test-flag')).toBe(true);

      setTimeout(() => {
        expect(shortCache.get('test-flag')).toBeNull();
        done();
      }, 150);
    });

    it('should not expire before TTL', (done) => {
      const longCache = new FlagCache(500); // 500ms TTL

      longCache.set('test-flag', true);

      setTimeout(() => {
        expect(longCache.get('test-flag')).toBe(true);
        done();
      }, 250);
    });

    it('should handle zero TTL', () => {
      const noCache = new FlagCache(0);

      noCache.set('test-flag', true);
      // With 0 TTL, value should expire immediately or not cache
      // Behavior depends on implementation
    });
  });

  describe('Invalidation', () => {
    it('should invalidate specific key', () => {
      cache.set('flag-1', true);
      cache.set('flag-2', false);

      cache.invalidate('flag-1');

      expect(cache.get('flag-1')).toBeNull();
      expect(cache.get('flag-2')).toBe(false);
    });

    it('should handle invalidating non-existent keys', () => {
      expect(() => cache.invalidate('non-existent')).not.toThrow();
    });

    it('should clear all cached values', () => {
      cache.set('flag-1', true);
      cache.set('flag-2', false);
      cache.set('flag-3', true);

      cache.clear();

      expect(cache.get('flag-1')).toBeNull();
      expect(cache.get('flag-2')).toBeNull();
      expect(cache.get('flag-3')).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle boolean false values', () => {
      cache.set('false-flag', false);
      const value = cache.get('false-flag');
      expect(value).toBe(false);
    });

    it('should handle boolean true values', () => {
      cache.set('true-flag', true);
      const value = cache.get('true-flag');
      expect(value).toBe(true);
    });

    it('should handle empty string keys', () => {
      cache.set('', true);
      expect(cache.get('')).toBe(true);
    });

    it('should handle special characters in keys', () => {
      const specialKey = 'flag-with-!@#$%^&*()';
      cache.set(specialKey, true);
      expect(cache.get(specialKey)).toBe(true);
    });

    it('should handle very long keys', () => {
      const longKey = 'a'.repeat(1000);
      cache.set(longKey, true);
      expect(cache.get(longKey)).toBe(true);
    });
  });

  describe('Size and memory', () => {
    it('should handle large number of entries', () => {
      for (let i = 0; i < 1000; i++) {
        cache.set(`flag-${i}`, i % 2 === 0);
      }

      expect(cache.get('flag-0')).toBe(true);
      expect(cache.get('flag-500')).toBe(true);
      expect(cache.get('flag-999')).toBe(false);
    });

    it('should handle multiple cached flags', () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`flag-${i}`, true);
      }

      expect(cache.get('flag-0')).toBe(true);
      expect(cache.get('flag-50')).toBe(true);
      expect(cache.get('flag-99')).toBe(true);
    });
  });
});

describe('FlagCache per-context entries', () => {
  it('keeps separate entries per context key', () => {
    const cache = new FlagCache(1000);
    cache.set('flag', true, 'flag', undefined, undefined, 'ctx-a');
    cache.set('flag', false, 'flag', undefined, undefined, 'ctx-b');
    expect(cache.get('flag', 'ctx-a')).toBe(true);
    expect(cache.get('flag', 'ctx-b')).toBe(false);
    expect(cache.get('flag', 'ctx-c')).toBeNull();
  });

  it('invalidate(flagKey) clears the flag for every context', () => {
    const cache = new FlagCache(1000);
    cache.set('flag', true, 'flag', undefined, undefined, 'ctx-a');
    cache.set('flag', false, 'flag', undefined, undefined, 'ctx-b');
    cache.set('other', true, 'other', undefined, undefined, 'ctx-a');
    cache.invalidate('flag');
    expect(cache.get('flag', 'ctx-a')).toBeNull();
    expect(cache.get('flag', 'ctx-b')).toBeNull();
    expect(cache.get('other', 'ctx-a')).toBe(true);
  });

  it('a TTL of 0 never caches', () => {
    const cache = new FlagCache(0);
    cache.set('flag', true);
    expect(cache.get('flag')).toBeNull();
  });

  it('contextCacheKey ignores key order and undefined values', () => {
    expect(contextCacheKey({ user_id: 'u', attributes: { b: 2, a: 1 }, language: undefined })).toBe(
      contextCacheKey({ attributes: { a: 1, b: 2 }, user_id: 'u' })
    );
    expect(contextCacheKey({ user_id: 'a' })).not.toBe(contextCacheKey({ user_id: 'b' }));
  });
});

describe('FlagCache size cap (LRU)', () => {
  it('keeps at most maxEntries entries across many distinct contexts', () => {
    const cache = new FlagCache(60000, 100);
    for (let i = 0; i < 5000; i++) {
      cache.set('flag', i % 2 === 0, undefined, undefined, undefined, `ctx-${i}`);
      expect(cache.size).toBeLessThanOrEqual(100);
    }
    expect(cache.size).toBe(100);
    // The most recent entries survive, the oldest were evicted.
    expect(cache.get('flag', 'ctx-4999')).toBe(false);
    expect(cache.get('flag', 'ctx-0')).toBeNull();
  });

  it('evicts the least recently used entry; a hit refreshes recency', () => {
    const cache = new FlagCache(60000, 3);
    cache.set('f', true, undefined, undefined, undefined, 'a');
    cache.set('f', true, undefined, undefined, undefined, 'b');
    cache.set('f', true, undefined, undefined, undefined, 'c');
    expect(cache.get('f', 'a')).toBe(true); // a is now most recent
    cache.set('f', true, undefined, undefined, undefined, 'd'); // evicts b
    expect(cache.get('f', 'b')).toBeNull();
    expect(cache.get('f', 'a')).toBe(true);
    expect(cache.get('f', 'c')).toBe(true);
    expect(cache.get('f', 'd')).toBe(true);
  });

  it('sweeps expired entries before evicting live ones', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const cache = new FlagCache(100, 2);
    cache.set('f', true, undefined, undefined, undefined, 'old');
    now.mockReturnValue(1050);
    cache.set('f', true, undefined, undefined, undefined, 'live');
    now.mockReturnValue(1150); // 'old' expired, 'live' still valid
    cache.set('f', true, undefined, undefined, undefined, 'new');
    expect(cache.get('f', 'live')).toBe(true);
    expect(cache.get('f', 'new')).toBe(true);
    expect(cache.size).toBe(2);
    now.mockRestore();
  });

  it('invalidate clears exactly one flag, with no prefix collisions', () => {
    const cache = new FlagCache(60000, 100);
    cache.set('flag', true, undefined, undefined, undefined, 'x');
    cache.set('flag', true, undefined, undefined, undefined, 'y');
    cache.set('flag-2', true, undefined, undefined, undefined, 'x');
    cache.set('fla', true, undefined, undefined, undefined, 'gx');
    cache.set('flag\0x', true, undefined, undefined, undefined, 'y');
    cache.invalidate('flag');
    expect(cache.get('flag', 'x')).toBeNull();
    expect(cache.get('flag', 'y')).toBeNull();
    expect(cache.get('flag-2', 'x')).toBe(true);
    expect(cache.get('fla', 'gx')).toBe(true);
    expect(cache.get('flag\0x', 'y')).toBe(true);
    expect(cache.size).toBe(3);
  });

  it('evicting the last entry of a flag forgets the flag', () => {
    const cache = new FlagCache(60000, 1);
    cache.set('a', true, undefined, undefined, undefined, '1');
    cache.set('b', true, undefined, undefined, undefined, '1');
    expect(cache.get('a', '1')).toBeNull();
    cache.invalidate('b');
    expect(cache.size).toBe(0);
  });
});

describe('contextCacheKey edge values', () => {
  it('distinguishes Date values the way the request body does', () => {
    const a = { attributes: { since: new Date('2024-01-01T00:00:00Z') } };
    const b = { attributes: { since: new Date('2025-06-01T00:00:00Z') } };
    expect(contextCacheKey(a)).not.toBe(contextCacheKey(b));
    expect(contextCacheKey(a)).toBe(
      contextCacheKey({ attributes: { since: '2024-01-01T00:00:00.000Z' } })
    );
  });

  it('keeps an own "__proto__" attribute as data', () => {
    const withProto = JSON.parse('{"attributes":{"__proto__":{"plan":"pro"}}}');
    const other = JSON.parse('{"attributes":{"__proto__":{"plan":"free"}}}');
    expect(contextCacheKey(withProto)).toContain('__proto__');
    expect(contextCacheKey(withProto)).not.toBe(contextCacheKey(other));
    expect(contextCacheKey(withProto)).not.toBe(contextCacheKey({ attributes: {} }));
  });
});

describe('contextCacheKey toJSON and cycles', () => {
  it('calls toJSON once, like JSON.stringify, so a toJSON returning this does not recurse', () => {
    const selfJson = { a: 1, toJSON() { return this; } };
    expect(() => contextCacheKey({ attributes: { x: selfJson } })).not.toThrow();
    expect(contextCacheKey({ attributes: { x: selfJson } })).toBe(contextCacheKey({ attributes: { x: { a: 1 } } }));
  });

  it('throws a TypeError for a cyclic context, as JSON.stringify would', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => contextCacheKey({ attributes: cyclic })).toThrow(TypeError);
  });

  it('accepts a shared, non-cyclic reference', () => {
    const shared = { k: 'v' };
    expect(() => contextCacheKey({ attributes: { one: shared, two: shared } })).not.toThrow();
  });
});

describe('FlagCache cap handling', () => {
  it('falls back to the default cap when maxEntries is NaN', () => {
    const cache = new FlagCache(60000, Number.NaN);
    for (let i = 0; i < 10050; i++) {
      (cache as any).shared.store('flag', `ctx-${i}`, { value: true, expiresAt: Date.now() + 60000 });
    }
    expect(cache.size).toBe(10000);
  });

  it('sweeps expired entries at most once per TTL when the cache is full', () => {
    const cache = new FlagCache(60000, 10);
    const sweep = jest.spyOn((cache as any).shared, 'sweepExpired');
    for (let i = 0; i < 200; i++) (cache as any).shared.store('flag', `ctx-${i}`, { value: true, expiresAt: Date.now() + 60000 });
    expect(cache.size).toBe(10);
    expect(sweep.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('FlagCache result metadata (#165)', () => {
  it('stores version and scope with the entry', () => {
    const cache = new FlagCache(60000);
    cache.set('flag', true, 'flag-1', undefined, undefined, 'ctx', { version: 3, scope: 'application' });
    expect(cache.getEntry('flag', 'ctx')).toMatchObject({
      value: true,
      flagId: 'flag-1',
      version: 3,
      scope: 'application',
    });
  });

  it('leaves version and scope undefined when none are given', () => {
    const cache = new FlagCache(60000);
    cache.set('flag', true, undefined, undefined, undefined, 'ctx');
    const entry = cache.getEntry('flag', 'ctx');
    expect(entry?.version).toBeUndefined();
    expect(entry?.scope).toBeUndefined();
  });
});

describe('FlagCache generation (stale re-cache guard, #166)', () => {
  it('a write with the current generation is stored', () => {
    const cache = new FlagCache(60000);
    const generation = cache.generation('flag');
    cache.set('flag', true, undefined, undefined, undefined, 'ctx', undefined, generation);
    expect(cache.get('flag', 'ctx')).toBe(true);
  });

  it('invalidating the flag drops a write read before it', () => {
    const cache = new FlagCache(60000);
    const generation = cache.generation('flag');
    cache.invalidate('flag');
    cache.set('flag', true, undefined, undefined, undefined, 'ctx', undefined, generation);
    expect(cache.get('flag', 'ctx')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it.each([
    ['invalidate()', (c: FlagCache) => c.invalidate()],
    ['clear()', (c: FlagCache) => c.clear()],
  ])('%s drops a write for every flag read before it', (_name, wipe) => {
    const cache = new FlagCache(60000);
    const a = cache.generation('a');
    const b = cache.generation('b');
    wipe(cache);
    cache.set('a', true, undefined, undefined, undefined, '', undefined, a);
    cache.set('b', true, undefined, undefined, undefined, '', undefined, b);
    expect(cache.size).toBe(0);
  });

  it("invalidating another flag does not change this flag's generation", () => {
    const cache = new FlagCache(60000);
    const generation = cache.generation('flag');
    cache.invalidate('other');
    expect(cache.generation('flag')).toBe(generation);
    cache.set('flag', true, undefined, undefined, undefined, '', undefined, generation);
    expect(cache.get('flag')).toBe(true);
  });

  it('a generation is never reused after an epoch bump resets per-flag counters', () => {
    const cache = new FlagCache(60000);
    cache.invalidate('flag');
    const before = cache.generation('flag');
    cache.clear();
    expect(cache.generation('flag')).not.toBe(before);
    cache.invalidate('flag');
    expect(cache.generation('flag')).not.toBe(before);
  });

  it('a write without a generation is always stored', () => {
    const cache = new FlagCache(60000);
    cache.invalidate('flag');
    cache.set('flag', true);
    expect(cache.get('flag')).toBe(true);
  });
});

describe('FlagCache generation bound (#166)', () => {
  it('keeps at most maxEntries per-flag counters, moving to a new epoch past the cap', () => {
    const cache = new FlagCache(60000, 3);
    const before = cache.generation('kept');
    for (let i = 0; i < 100; i++) cache.invalidate(`flag-${i}`);
    expect((cache as any).shared.generations.size).toBeLessThanOrEqual(3);
    // The epoch move is conservative: a write read before it is dropped.
    cache.set('kept', true, undefined, undefined, undefined, '', undefined, before);
    expect(cache.get('kept')).toBeNull();
  });

  it('a generation read after the epoch move still writes', () => {
    const cache = new FlagCache(60000, 1);
    cache.invalidate('a');
    cache.invalidate('b'); // past the cap
    const generation = cache.generation('a');
    cache.set('a', true, undefined, undefined, undefined, '', undefined, generation);
    expect(cache.get('a')).toBe(true);
  });

  it('an invalidated flag never gets back a generation it had before', () => {
    const cache = new FlagCache(60000, 1);
    const seen = new Set<string>([cache.generation('a')]);
    for (let i = 0; i < 20; i++) {
      cache.invalidate(i % 2 === 0 ? 'a' : `other-${i}`);
      const g = cache.generation('a');
      if (i % 2 === 0) {
        expect(seen.has(g)).toBe(false);
        seen.add(g);
      }
    }
  });
});
