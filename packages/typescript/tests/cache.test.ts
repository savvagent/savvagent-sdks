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
