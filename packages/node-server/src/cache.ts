import { CacheEntry } from './types';

/**
 * Deterministic cache key for an evaluation context: object keys are sorted
 * at every level and undefined values are dropped, so equal contexts always
 * produce the same key regardless of property order.
 */
export function contextCacheKey(context: unknown): string {
  return JSON.stringify(normalize(context)) ?? '';
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : normalize(item)));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = normalize(item);
    }
    return out;
  }
  return value;
}

/**
 * In-memory cache for flag values with TTL.
 *
 * Entries are keyed by flag key AND evaluation context (see
 * {@link contextCacheKey}), so a result evaluated for one user is never
 * served to another. Invalidating a flag key clears its entries for every
 * context. A TTL of 0 (or less) disables caching.
 */
export class FlagCache {
  private cache: Map<string, Map<string, CacheEntry>>;
  private ttl: number;

  constructor(ttl: number = 60000) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  /**
   * Get a cached flag value
   */
  get(key: string, contextKey: string = ''): boolean | null {
    const entry = this.getEntry(key, contextKey);
    return entry ? entry.value : null;
  }

  /**
   * Get a complete cached entry (includes configuration and variation)
   */
  getEntry(key: string, contextKey: string = ''): CacheEntry | null {
    const byContext = this.cache.get(key);
    const entry = byContext?.get(contextKey);
    if (!byContext || !entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      byContext.delete(contextKey);
      if (byContext.size === 0) this.cache.delete(key);
      return null;
    }

    return entry;
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
    if (this.ttl <= 0) return;
    let byContext = this.cache.get(key);
    if (!byContext) {
      byContext = new Map();
      this.cache.set(key, byContext);
    }
    byContext.set(contextKey, {
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
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.cache.clear();
  }
}
