import { createHash } from 'node:crypto';
import { FlagCache, contextCacheKey } from '../src/cache';

describe('FlagCache', () => {
  let cache: FlagCache;

  beforeEach(() => {
    cache = new FlagCache(1000); // 1 second TTL
  });

  test('should cache and retrieve values', () => {
    cache.set('test-flag', true);
    expect(cache.get('test-flag')).toBe(true);
  });

  test('should return null for non-existent keys', () => {
    expect(cache.get('non-existent')).toBeNull();
  });

  test('should expire cached values after TTL', (done) => {
    cache.set('test-flag', true);
    expect(cache.get('test-flag')).toBe(true);

    setTimeout(() => {
      expect(cache.get('test-flag')).toBeNull();
      done();
    }, 1100);
  });

  test('should invalidate specific keys', () => {
    cache.set('flag1', true);
    cache.set('flag2', false);

    cache.invalidate('flag1');

    expect(cache.get('flag1')).toBeNull();
    expect(cache.get('flag2')).toBe(false);
  });

  test('should clear all cached values', () => {
    cache.set('flag1', true);
    cache.set('flag2', false);

    cache.clear();

    expect(cache.get('flag1')).toBeNull();
    expect(cache.get('flag2')).toBeNull();
  });

  test('should return all cached keys', () => {
    cache.set('flag1', true);
    cache.set('flag2', false);

    const keys = cache.keys();
    expect(keys).toContain('flag1');
    expect(keys).toContain('flag2');
    expect(keys.length).toBe(2);
  });
});

describe('FlagCache per-context entries', () => {
  test('keeps separate entries per context key', () => {
    const cache = new FlagCache(1000);
    cache.set('flag', true, 'flag', 'ctx-a');
    cache.set('flag', false, 'flag', 'ctx-b');
    expect(cache.get('flag', 'ctx-a')).toBe(true);
    expect(cache.get('flag', 'ctx-b')).toBe(false);
    expect(cache.get('flag', 'ctx-c')).toBeNull();
    expect(cache.keys()).toEqual(['flag']);
  });

  test('invalidate(flagKey) clears the flag for every context', () => {
    const cache = new FlagCache(1000);
    cache.set('flag', true, 'flag', 'ctx-a');
    cache.set('flag', false, 'flag', 'ctx-b');
    cache.set('other', true, 'other', 'ctx-a');
    cache.invalidate('flag');
    expect(cache.get('flag', 'ctx-a')).toBeNull();
    expect(cache.get('flag', 'ctx-b')).toBeNull();
    expect(cache.get('other', 'ctx-a')).toBe(true);
  });

  test('a TTL of 0 never caches', () => {
    const cache = new FlagCache(0);
    cache.set('flag', true);
    expect(cache.get('flag')).toBeNull();
  });

  test('stores metadata with the entry', () => {
    const cache = new FlagCache(1000);
    cache.set('flag', true, 'flag', 'ctx', { variation: 'b', configuration: { n: 1 } });
    expect(cache.getEntry('flag', 'ctx')?.metadata).toEqual({ variation: 'b', configuration: { n: 1 } });
  });
});

describe('contextCacheKey', () => {
  test('is independent of key order at every level and ignores undefined', () => {
    expect(
      contextCacheKey({ user_id: 'u', attributes: { a: 1, b: { y: 2, x: 1 } }, language: undefined })
    ).toBe(contextCacheKey({ attributes: { b: { x: 1, y: 2 }, a: 1 }, user_id: 'u' }));
  });

  test('differs for different contexts', () => {
    expect(contextCacheKey({ user_id: 'a' })).not.toBe(contextCacheKey({ user_id: 'b' }));
    expect(contextCacheKey({ attributes: { plan: 'pro' } })).not.toBe(
      contextCacheKey({ attributes: { plan: 'free' } })
    );
  });
});

describe('contextCacheKey digest (#30)', () => {
  test('digest key: is the lowercase SHA-256 hex of the canonical JSON', () => {
    const key = contextCacheKey({ user_id: 'secret-user-1', attributes: { b: 2, a: 1 } });
    expect(key).toBe(
      createHash('sha256').update('{"attributes":{"a":1,"b":2},"user_id":"secret-user-1"}', 'utf8').digest('hex')
    );
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test('digest key: equal contexts share one entry, different contexts get different entries', () => {
    const cache = new FlagCache(60000);
    cache.set('f', true, undefined, contextCacheKey({ user_id: 'u', language: 'en' }));
    cache.set('f', true, undefined, contextCacheKey({ language: 'en', user_id: 'u' }));
    expect(cache.size).toBe(1);
    cache.set('f', true, undefined, contextCacheKey({ user_id: 'v', language: 'en' }));
    expect(cache.size).toBe(2);
  });

  test('digest key: the raw user_id appears in no cache key', () => {
    const cache = new FlagCache(60000);
    const ctx = contextCacheKey({ user_id: 'raw-user-id-123' });
    cache.set('f', true, undefined, ctx);
    const internals = cache as any;
    const keys = [...internals.entries.keys(), ...internals.byFlag.keys()];
    for (const set of internals.byFlag.values()) keys.push(...set);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).not.toContain('raw-user-id-123');
  });
});

describe('FlagCache total bound across flags (#30)', () => {
  test('total bound: entries across several flags never exceed the cap and the LRU entry goes first', () => {
    const cache = new FlagCache(60000, 4);
    const c = (n: number) => contextCacheKey({ user_id: `u${n}` });
    cache.set('f1', true, undefined, c(1));
    cache.set('f2', true, undefined, c(1));
    cache.set('f1', true, undefined, c(2));
    cache.set('f2', true, undefined, c(2));
    cache.set('f3', true, undefined, c(3));
    expect(cache.size).toBe(4);
    expect(cache.get('f1', c(1))).toBeNull(); // oldest went first
    for (let i = 10; i < 100; i++) {
      cache.set(`f${i % 3}`, true, undefined, c(i));
      expect(cache.size).toBeLessThanOrEqual(4);
    }
  });

  test('recency: a hit refreshes recency so the entry just read survives the next eviction', () => {
    const cache = new FlagCache(60000, 3);
    cache.set('f1', true, undefined, 'a');
    cache.set('f2', true, undefined, 'a');
    cache.set('f1', true, undefined, 'b');
    expect(cache.get('f1', 'a')).toBe(true);
    cache.set('f2', true, undefined, 'b'); // evicts (f2, a)
    expect(cache.get('f2', 'a')).toBeNull();
    expect(cache.get('f1', 'a')).toBe(true);
  });

  test('invalidation: invalidate(flag) removes all of that flag contexts and leaves other flags alone', () => {
    const cache = new FlagCache(60000);
    cache.set('f1', true, undefined, contextCacheKey({ user_id: 'a' }));
    cache.set('f1', true, undefined, contextCacheKey({ user_id: 'b' }));
    cache.set('f2', true, undefined, contextCacheKey({ user_id: 'a' }));
    cache.invalidate('f1');
    expect(cache.size).toBe(1);
    expect(cache.get('f1', contextCacheKey({ user_id: 'a' }))).toBeNull();
    expect(cache.get('f2', contextCacheKey({ user_id: 'a' }))).toBe(true);
  });
});

describe('FlagCache size cap (LRU)', () => {
  test('keeps at most maxEntries entries across many distinct contexts', () => {
    const cache = new FlagCache(60000, 100);
    for (let i = 0; i < 5000; i++) {
      cache.set('flag', i % 2 === 0, undefined, `ctx-${i}`);
      expect(cache.size).toBeLessThanOrEqual(100);
    }
    expect(cache.size).toBe(100);
    // The most recent entries survive, the oldest were evicted.
    expect(cache.get('flag', 'ctx-4999')).toBe(false);
    expect(cache.get('flag', 'ctx-0')).toBeNull();
  });

  test('evicts the least recently used entry; a hit refreshes recency', () => {
    const cache = new FlagCache(60000, 3);
    cache.set('f', true, undefined, 'a');
    cache.set('f', true, undefined, 'b');
    cache.set('f', true, undefined, 'c');
    expect(cache.get('f', 'a')).toBe(true); // a is now most recent
    cache.set('f', true, undefined, 'd'); // evicts b
    expect(cache.get('f', 'b')).toBeNull();
    expect(cache.get('f', 'a')).toBe(true);
    expect(cache.get('f', 'c')).toBe(true);
    expect(cache.get('f', 'd')).toBe(true);
  });

  test('sweeps expired entries before evicting live ones', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const cache = new FlagCache(100, 2);
    cache.set('f', true, undefined, 'old');
    now.mockReturnValue(1050);
    cache.set('f', true, undefined, 'live');
    now.mockReturnValue(1150); // 'old' expired, 'live' still valid
    cache.set('f', true, undefined, 'new');
    expect(cache.get('f', 'live')).toBe(true);
    expect(cache.get('f', 'new')).toBe(true);
    expect(cache.size).toBe(2);
    now.mockRestore();
  });

  test('invalidate clears exactly one flag, with no prefix collisions', () => {
    const cache = new FlagCache(60000, 100);
    cache.set('flag', true, undefined, 'x');
    cache.set('flag', true, undefined, 'y');
    cache.set('flag-2', true, undefined, 'x');
    cache.set('fla', true, undefined, 'gx');
    cache.set('flag\0x', true, undefined, 'y');
    cache.invalidate('flag');
    expect(cache.get('flag', 'x')).toBeNull();
    expect(cache.get('flag', 'y')).toBeNull();
    expect(cache.get('flag-2', 'x')).toBe(true);
    expect(cache.get('fla', 'gx')).toBe(true);
    expect(cache.get('flag\0x', 'y')).toBe(true);
    expect(cache.size).toBe(3);
  });

  test('evicting the last entry of a flag forgets the flag', () => {
    const cache = new FlagCache(60000, 1);
    cache.set('a', true, undefined, '1');
    cache.set('b', true, undefined, '1');
    expect(cache.get('a', '1')).toBeNull();
    cache.invalidate('b');
    expect(cache.size).toBe(0);
  });
});

describe('contextCacheKey edge values', () => {
  test('distinguishes Date values the way the request body does', () => {
    const a = { attributes: { since: new Date('2024-01-01T00:00:00Z') } };
    const b = { attributes: { since: new Date('2025-06-01T00:00:00Z') } };
    expect(contextCacheKey(a)).not.toBe(contextCacheKey(b));
    expect(contextCacheKey(a)).toBe(
      contextCacheKey({ attributes: { since: '2024-01-01T00:00:00.000Z' } })
    );
  });

  test('keeps an own "__proto__" attribute as data', () => {
    const withProto = JSON.parse('{"attributes":{"__proto__":{"plan":"pro"}}}');
    const other = JSON.parse('{"attributes":{"__proto__":{"plan":"free"}}}');
    expect(contextCacheKey(withProto)).toMatch(/^[0-9a-f]{64}$/);
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
      (cache as any).store('flag', `ctx-${i}`, { value: true, expiresAt: Date.now() + 60000 });
    }
    expect(cache.size).toBe(10000);
  });

  it('sweeps expired entries at most once per TTL when the cache is full', () => {
    const cache = new FlagCache(60000, 10);
    const sweep = jest.spyOn(cache as any, 'sweepExpired');
    for (let i = 0; i < 200; i++) (cache as any).store('flag', `ctx-${i}`, { value: true, expiresAt: Date.now() + 60000 });
    expect(cache.size).toBe(10);
    expect(sweep.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('FlagCache invalidation generations (stale re-cache guard)', () => {
  let cache: FlagCache;

  beforeEach(() => {
    cache = new FlagCache(60000);
  });

  test('a write carrying the current generation is stored', () => {
    const generation = cache.generation('flag');
    cache.set('flag', true, 'flag', 'ctx', undefined, generation);
    expect(cache.get('flag', 'ctx')).toBe(true);
  });

  test('a write without a generation is stored as before', () => {
    cache.invalidate('flag');
    cache.set('flag', true, 'flag', 'ctx');
    expect(cache.get('flag', 'ctx')).toBe(true);
  });

  test('invalidating the flag drops a write read before it, even with nothing cached', () => {
    const generation = cache.generation('flag');
    cache.invalidate('flag');
    cache.set('flag', true, 'flag', 'ctx', undefined, generation);
    expect(cache.get('flag', 'ctx')).toBeNull();
    expect(cache.size).toBe(0);
  });

  test('clear drops a write read before it, for every flag', () => {
    const a = cache.generation('a');
    const b = cache.generation('b');
    cache.clear();
    cache.set('a', true, 'a', 'ctx', undefined, a);
    cache.set('b', true, 'b', 'ctx', undefined, b);
    expect(cache.size).toBe(0);
  });

  test('invalidating another flag does not drop the write', () => {
    const generation = cache.generation('flag');
    cache.invalidate('other');
    cache.set('flag', true, 'flag', 'ctx', undefined, generation);
    expect(cache.get('flag', 'ctx')).toBe(true);
  });

  test('a generation read after the invalidation is current again', () => {
    cache.invalidate('flag');
    cache.clear();
    const generation = cache.generation('flag');
    cache.set('flag', false, 'flag', 'ctx', undefined, generation);
    expect(cache.get('flag', 'ctx')).toBe(false);
  });
});

describe('FlagCache generation map bound', () => {
  test('the per-flag generations stay within maxEntries', () => {
    const cache = new FlagCache(60000, 3);
    for (let i = 0; i < 50; i++) cache.invalidate(`flag-${i}`);
    expect((cache as any).generations.size).toBeLessThanOrEqual(3);
  });

  test('reaching the cap still drops a write read before an invalidation', () => {
    const cache = new FlagCache(60000, 3);
    const generation = cache.generation('flag');
    cache.invalidate('flag');
    // Overflow the map so the epoch advances and the counts are dropped.
    for (let i = 0; i < 3; i++) cache.invalidate(`other-${i}`);
    expect((cache as any).generations.has('flag')).toBe(false);
    cache.set('flag', true, 'flag', 'ctx', undefined, generation);
    expect(cache.get('flag', 'ctx')).toBeNull();
  });

  test('a generation read after the cap was reached is current', () => {
    const cache = new FlagCache(60000, 3);
    for (let i = 0; i < 10; i++) cache.invalidate(`other-${i}`);
    const generation = cache.generation('flag');
    cache.set('flag', true, 'flag', 'ctx', undefined, generation);
    expect(cache.get('flag', 'ctx')).toBe(true);
  });
});
