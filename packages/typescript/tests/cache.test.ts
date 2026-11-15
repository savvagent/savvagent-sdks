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
