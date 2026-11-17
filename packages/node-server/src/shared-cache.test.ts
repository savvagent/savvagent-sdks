import * as sdk from '@savvagent/sdk';
import { FlagCache, contextCacheKey, DEFAULT_CACHE_MAX_ENTRIES } from './cache';
import * as nodeServer from './index';

// #27: node-server keeps no copy of the cache or its helpers; it uses
// @savvagent/sdk's (resolved from its built dist).
describe('node-server uses @savvagent/sdk for the cache (#27)', () => {
  test('the key helpers are the SDK exports themselves', () => {
    expect(contextCacheKey).toBe(sdk.contextCacheKey);
    expect(DEFAULT_CACHE_MAX_ENTRIES).toBe(sdk.DEFAULT_CACHE_MAX_ENTRIES);
  });

  test('FlagCache stores its entries in an @savvagent/sdk FlagCache', () => {
    const cache = new FlagCache(60000, 7);
    const shared = (cache as any).shared;
    expect(shared).toBeInstanceOf(sdk.FlagCache);
    cache.set('flag', true, 'id-1', { a: 1 }, 'blue', 'ctx', { version: 3, scope: 'application' });
    expect(shared.get('flag', 'ctx')).toBe(true);
    expect(shared.getEntry('flag', 'ctx').metadata).toEqual({
      configuration: { a: 1 },
      variation: 'blue',
      version: 3,
      scope: 'application',
    });
  });

  test('FlagCache is still exported from the package', () => {
    expect(nodeServer.FlagCache).toBe(FlagCache);
  });
});

// The published call shape and the documented contract.
describe('node-server FlagCache public contract', () => {
  test('getEntry returns configuration, variation, version and scope as fields', () => {
    const cache = new FlagCache(60000);
    cache.set('flag', true, 'id-1', { color: 'red' }, 'treatment', 'ctx', { version: 2, scope: 'enterprise' });
    expect(cache.getEntry('flag', 'ctx')).toEqual({
      value: true,
      configuration: { color: 'red' },
      variation: 'treatment',
      expiresAt: expect.any(Number),
      flagId: 'id-1',
      version: 2,
      scope: 'enterprise',
    });
  });

  test('the 1.x five-argument set still stores configuration and variation', () => {
    const cache = new FlagCache(60000);
    cache.set('flag', false, 'id-2', { limit: 5 }, 'control');
    const entry = cache.getEntry('flag');
    expect(entry?.value).toBe(false);
    expect(entry?.configuration).toEqual({ limit: 5 });
    expect(entry?.variation).toBe('control');
  });

  test('get(key) and getEntry(key) read only the empty-context entry', () => {
    const cache = new FlagCache(60000);
    const userKey = contextCacheKey({ user_id: 'u1' });
    cache.set('flag', true, undefined, undefined, undefined, userKey);
    expect(cache.get('flag')).toBeNull();
    expect(cache.getEntry('flag')).toBeNull();
    expect(cache.get('flag', userKey)).toBe(true);

    cache.set('flag', false);
    expect(cache.get('flag')).toBe(false);
    expect(cache.get('flag', userKey)).toBe(true);
  });

  test('invalidate() without a key clears every flag and advances generations', () => {
    const cache = new FlagCache(60000);
    cache.set('a', true);
    cache.set('b', true, undefined, undefined, undefined, 'ctx');
    const before = cache.generation('a');
    cache.invalidate();
    expect(cache.size).toBe(0);
    expect(cache.generation('a')).not.toBe(before);
  });

  test('keys() lists each cached flag once', () => {
    const cache = new FlagCache(60000);
    cache.set('a', true, undefined, undefined, undefined, 'c1');
    cache.set('a', true, undefined, undefined, undefined, 'c2');
    cache.set('b', false);
    expect(cache.keys().sort()).toEqual(['a', 'b']);
  });
});
