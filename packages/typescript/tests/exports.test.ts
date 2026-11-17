import * as sdk from '../src/index';
import { FlagCache as CacheModuleFlagCache, contextCacheKey as cacheModuleContextCacheKey } from '../src/cache';

// The cache and the helpers server SDKs share (#27) are part of the public
// entry point, so @savvagent/node-server can import them instead of copying.
describe('@savvagent/sdk public exports', () => {
  test('exports the flag cache and its key helpers', () => {
    expect(sdk.FlagCache).toBe(CacheModuleFlagCache);
    expect(sdk.contextCacheKey).toBe(cacheModuleContextCacheKey);
    expect(sdk.DEFAULT_CACHE_MAX_ENTRIES).toBe(10000);
  });

  test('contextCacheKey is order-independent and drops undefined values', () => {
    expect(sdk.contextCacheKey({ b: 1, a: { d: 2, c: undefined } })).toBe(
      sdk.contextCacheKey({ a: { d: 2 }, b: 1 })
    );
    expect(sdk.contextCacheKey({ user_id: 'u1' })).not.toBe(sdk.contextCacheKey({ user_id: 'u2' }));
  });

  describe('isValidFlagKey', () => {
    test.each(['a', 'new-checkout', 'v1.2_beta', 'x'.repeat(128), '...', '__proto__'])(
      'accepts %j',
      (key) => {
        expect(sdk.isValidFlagKey(key)).toBe(true);
      }
    );

    test.each(['', '.', '..', 'x'.repeat(129), 'a/b', 'a b', 'a?b', 'a#b', '%2e', 'é'])(
      'rejects %j',
      (key) => {
        expect(sdk.isValidFlagKey(key)).toBe(false);
      }
    );

    test.each([undefined, null, 1, {}, ['a']])('rejects the non-string %j', (key) => {
      expect(sdk.isValidFlagKey(key)).toBe(false);
    });
  });

  describe('defaultFor', () => {
    test('is true only for an own `true` entry', () => {
      const defaults = { on: true, off: false };
      expect(sdk.defaultFor(defaults, 'on')).toBe(true);
      expect(sdk.defaultFor(defaults, 'off')).toBe(false);
      expect(sdk.defaultFor(defaults, 'missing')).toBe(false);
    });

    test('never reads inherited properties', () => {
      for (const key of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
        expect(sdk.defaultFor({}, key)).toBe(false);
      }
      const inherited = Object.create({ flag: true }) as Record<string, boolean>;
      expect(sdk.defaultFor(inherited, 'flag')).toBe(false);
    });

    test('treats missing defaults as all false', () => {
      expect(sdk.defaultFor(undefined, 'any')).toBe(false);
    });

    test('a non-boolean truthy value does not count', () => {
      expect(sdk.defaultFor({ flag: 'true' } as unknown as Record<string, boolean>, 'flag')).toBe(false);
    });
  });
});

// The public FlagCache contract (#27), documented on the class.
describe('FlagCache public contract', () => {
  test('get(key) and getEntry(key) read only the empty-context entry', () => {
    const cache = new sdk.FlagCache(60000);
    cache.set('flag', true, 'id-1', sdk.contextCacheKey({ user_id: 'u1' }));
    expect(cache.get('flag')).toBeNull();
    expect(cache.getEntry('flag')).toBeNull();

    cache.set('flag', false);
    expect(cache.get('flag')).toBe(false);
    expect(cache.get('flag', '')).toBe(false);
    expect(cache.get('flag', sdk.contextCacheKey({ user_id: 'u1' }))).toBe(true);
  });

  test('a write with a stale generation is dropped', () => {
    const cache = new sdk.FlagCache(60000);
    const generation = cache.generation('flag');
    cache.invalidate('flag');
    cache.set('flag', true, undefined, '', undefined, generation);
    expect(cache.get('flag')).toBeNull();
    cache.set('flag', true, undefined, '', undefined, cache.generation('flag'));
    expect(cache.get('flag')).toBe(true);
  });
});
