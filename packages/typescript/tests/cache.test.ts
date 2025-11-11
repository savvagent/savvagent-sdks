import { FlagCache } from '../src/cache';

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
