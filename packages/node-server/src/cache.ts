import { CacheEntry } from './types';

/**
 * Deterministic cache key for an evaluation context: object keys are sorted
 * at every level, undefined values are dropped and values with `toJSON`
 * (such as Date) are serialized the way the request body serializes them,
 * so equal contexts always produce the same key and different request
 * bodies never share one.
 */
export function contextCacheKey(context: unknown): string {
  return JSON.stringify(normalize(context)) ?? '';
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : normalize(item)));
  }
  if (value !== null && typeof value === 'object') {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      return normalize(toJSON.call(value));
    }
    // A null-prototype object keeps an own "__proto__" key as plain data.
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = normalize(item);
    }
    return out;
  }
  return value;
}

/** Default maximum number of cached (flag, context) entries. */
export const DEFAULT_CACHE_MAX_ENTRIES = 10000;

/**
 * In-memory cache for flag values with TTL and LRU eviction.
 *
 * Entries are keyed by flag key AND evaluation context (see
 * {@link contextCacheKey}), so a result evaluated for one user is never
 * served to another. At most `maxEntries` entries are kept (least recently
 * used are evicted), so a server seeing many distinct contexts stays
 * bounded. Invalidating a flag key clears its entries for every context.
 * A TTL of 0 (or less) disables caching.
 */
export class FlagCache {
  /** Entries in least-recently-used order (Map iteration order). */
  private entries: Map<string, CacheEntry> = new Map();
  /** Entry keys per flag key, so a flag can be invalidated exactly. */
  private byFlag: Map<string, Set<string>> = new Map();
  private ttl: number;
  private maxEntries: number;

  constructor(ttl: number = 60000, maxEntries: number = DEFAULT_CACHE_MAX_ENTRIES) {
    this.ttl = ttl;
    this.maxEntries = Math.max(0, Math.floor(maxEntries));
  }

  /** Number of cached (flag, context) entries. */
  get size(): number {
    return this.entries.size;
  }

  private static entryKey(key: string, contextKey: string): string {
    return `${key}\0${contextKey}`;
  }

  private remove(key: string, entryKey: string): void {
    this.entries.delete(entryKey);
    const keys = this.byFlag.get(key);
    if (keys) {
      keys.delete(entryKey);
      if (keys.size === 0) this.byFlag.delete(key);
    }
  }

  /**
   * Get a cached entry for a flag and context key. A hit becomes the most
   * recently used entry.
   */
  getEntry(key: string, contextKey: string = ''): CacheEntry | null {
    const entryKey = FlagCache.entryKey(key, contextKey);
    const entry = this.entries.get(entryKey);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.remove(key, entryKey);
      return null;
    }

    // Refresh LRU position.
    this.entries.delete(entryKey);
    this.entries.set(entryKey, entry);
    return entry;
  }

  /**
   * Get a cached flag value for a flag and context key.
   */
  get(key: string, contextKey: string = ''): boolean | null {
    const entry = this.getEntry(key, contextKey);
    return entry ? entry.value : null;
  }

  private store(key: string, contextKey: string, entry: CacheEntry): void {
    if (this.ttl <= 0 || this.maxEntries === 0) return;
    const entryKey = FlagCache.entryKey(key, contextKey);
    this.entries.delete(entryKey);
    this.entries.set(entryKey, entry);
    let keys = this.byFlag.get(key);
    if (!keys) {
      keys = new Set();
      this.byFlag.set(key, keys);
    }
    keys.add(entryKey);

    if (this.entries.size > this.maxEntries) {
      this.sweepExpired();
    }
    // Evict least recently used entries until within the cap.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.remove(oldest.slice(0, oldest.lastIndexOf('\0')), oldest);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [entryKey, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.remove(entryKey.slice(0, entryKey.lastIndexOf('\0')), entryKey);
      }
    }
  }

  /**
   * Set a flag value in cache. No-op when the TTL is 0.
   */
  set(
    key: string,
    value: boolean,
    flagId?: string,
    configuration?: any,
    variation?: string,
    contextKey: string = ''
  ): void {
    this.store(key, contextKey, {
      value,
      configuration,
      variation,
      expiresAt: Date.now() + this.ttl,
      flagId,
    });
  }

  /**
   * Invalidate a specific flag (for every context) or all flags
   */
  invalidate(key?: string): void {
    if (!key) {
      this.clear();
      return;
    }
    const keys = this.byFlag.get(key);
    if (!keys) return;
    for (const entryKey of keys) this.entries.delete(entryKey);
    this.byFlag.delete(key);
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.entries.clear();
    this.byFlag.clear();
  }
}
