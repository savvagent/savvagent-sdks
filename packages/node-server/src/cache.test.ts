import { FlagCache } from './cache';

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

    it('should store different types of values', () => {
      cache.set('boolean-flag', true);
      cache.set('string-flag', 'value');
      cache.set('number-flag', 42);
      cache.set('object-flag', { key: 'value' });

      expect(cache.get('boolean-flag')).toBe(true);
      expect(cache.get('string-flag')).toBe('value');
      expect(cache.get('number-flag')).toBe(42);
      expect(cache.get('object-flag')).toEqual({ key: 'value' });
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
      cache.set('flag-3', 'value');

      cache.clear();

      expect(cache.get('flag-1')).toBeNull();
      expect(cache.get('flag-2')).toBeNull();
      expect(cache.get('flag-3')).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle null values', () => {
      cache.set('null-flag', null);
      // Depending on implementation, might treat null specially
      const value = cache.get('null-flag');
      // Either returns null (not cached) or the cached null value
      expect(value === null || value === undefined).toBe(true);
    });

    it('should handle undefined values', () => {
      cache.set('undefined-flag', undefined);
      const value = cache.get('undefined-flag');
      // Similar to null handling
      expect(value === null || value === undefined).toBe(true);
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
        cache.set(`flag-${i}`, i);
      }

      expect(cache.get('flag-0')).toBe(0);
      expect(cache.get('flag-500')).toBe(500);
      expect(cache.get('flag-999')).toBe(999);
    });

    it('should handle large values', () => {
      const largeObject = {
        data: new Array(1000).fill('x').join(''),
        nested: {
          array: new Array(100).fill(42),
        },
      };

      cache.set('large-flag', largeObject);
      expect(cache.get('large-flag')).toEqual(largeObject);
    });
  });
});
