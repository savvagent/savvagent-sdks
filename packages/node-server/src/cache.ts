import {
  FlagCache as SharedFlagCache,
  contextCacheKey,
  DEFAULT_CACHE_MAX_ENTRIES,
} from '@savvagent/sdk';
import { CacheEntry } from './types';

export { contextCacheKey, DEFAULT_CACHE_MAX_ENTRIES };

/**
 * In-memory cache for flag values with TTL and LRU eviction.
 *
 * The cache itself is `@savvagent/sdk`'s `FlagCache` (#27): keying, the LRU
 * cap, expiry and the invalidation generations live there, once. This class
 * only keeps node-server's published call shape: `set` takes the
 * configuration and variation as their own arguments, `getEntry` returns them
 * (and the server's version and scope) as top-level {@link CacheEntry}
 * fields, and `invalidate()` with no key clears every flag.
 *
 * Public contract:
 *
 * - Entries are keyed by flag key and context key. The context key is
 *   {@link contextCacheKey} of the evaluation context as sent to the server
 *   (the caller's context with `application_id` and `environment` filled in).
 *   It defaults to `''`, the empty-context entry: `get(key)` and
 *   `getEntry(key)` read only a value stored with `set(key, value)` (or an
 *   explicit `''`), never a value cached for some other context.
 * - A read returns `null` for a missing or expired entry; a hit becomes the
 *   most recently used entry. At most `maxEntries` entries are kept.
 * - {@link FlagCache.invalidate} drops a flag for every context (or every
 *   flag, without a key) and {@link FlagCache.clear} drops everything; both
 *   advance the {@link FlagCache.generation} that {@link FlagCache.set}
 *   checks, so a result whose request started before the invalidation is not
 *   cached.
 * - A TTL of 0 (or less), or `maxEntries` of 0, stores nothing.
 */
export class FlagCache {
  private readonly shared: SharedFlagCache;

  constructor(ttl: number = 60000, maxEntries: number = DEFAULT_CACHE_MAX_ENTRIES) {
    this.shared = new SharedFlagCache(ttl, maxEntries);
  }

  /** Number of cached (flag, context) entries. */
  get size(): number {
    return this.shared.size;
  }

  /**
   * Get a cached flag value for a flag and context key, or `null` on a miss.
   * Without `contextKey` this reads only the empty-context entry.
   */
  get(key: string, contextKey: string = ''): boolean | null {
    return this.shared.get(key, contextKey);
  }

  /**
   * Get a complete cached entry (value, configuration, variation and the
   * server's metadata) for a flag and context key, or `null` on a miss.
   * Without `contextKey` this reads only the empty-context entry.
   */
  getEntry(key: string, contextKey: string = ''): CacheEntry | null {
    const entry = this.shared.getEntry(key, contextKey);
    if (!entry) return null;
    const metadata = entry.metadata ?? {};
    return {
      value: entry.value,
      configuration: metadata.configuration,
      variation: metadata.variation ?? undefined,
      expiresAt: entry.expiresAt,
      flagId: entry.flagId,
      version: metadata.version,
      scope: metadata.scope ?? undefined,
    };
  }

  /**
   * The flag's invalidation generation. Read it before sending an evaluate
   * request and pass it to {@link FlagCache.set}, which drops the write if
   * the flag was invalidated (or the cache cleared) in the meantime.
   */
  generation(key: string): string {
    return this.shared.generation(key);
  }

  /**
   * Set a flag value in cache. No-op when the TTL is 0.
   *
   * @param metadata - The server's version and scope, returned with cached results.
   * @param generation - The value of {@link FlagCache.generation} read before
   *   the request; the write is dropped if the flag has been invalidated since.
   *   Omit it to always write.
   */
  set(
    key: string,
    value: boolean,
    flagId?: string,
    configuration?: any,
    variation?: string,
    contextKey: string = '',
    metadata?: { version?: number; scope?: string },
    generation?: string
  ): void {
    this.shared.set(
      key,
      value,
      flagId,
      contextKey,
      { configuration, variation, version: metadata?.version, scope: metadata?.scope },
      generation
    );
  }

  /**
   * Invalidate a specific flag (for every context) or, without a key, all flags.
   */
  invalidate(key?: string): void {
    if (!key) {
      this.shared.clear();
      return;
    }
    this.shared.invalidate(key);
  }

  /**
   * Clear all cached values.
   */
  clear(): void {
    this.shared.clear();
  }

  /**
   * Get all cached flag keys (each flag listed once, whatever its contexts).
   */
  keys(): string[] {
    return this.shared.keys();
  }
}
