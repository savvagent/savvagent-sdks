import { CacheEntry, FlagEvaluationResult } from './types';

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
 * In-memory cache for flag evaluation results with TTL.
 *
 * Entries are keyed by flag key AND evaluation context (see
 * {@link contextCacheKey}), so a result evaluated for one user is never served
 * to another. Invalidating a flag key clears its entries for every context.
 * A TTL of 0 (or less) disables caching.
 */
export class FlagCache {
  private cache: Map<string, Map<string, CacheEntry>> = new Map();
  private ttl: number;

  constructor(ttl: number = 60000) {
    this.ttl = ttl;
  }

  /**
   * Get a cached entry (value plus metadata) for a flag and context key.
   */
  getEntry(key: string, contextKey: string = ''): CacheEntry | null {
    const byContext = this.cache.get(key);
    const entry = byContext?.get(contextKey);
    if (!byContext || !entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      byContext.delete(contextKey);
      if (byContext.size === 0) this.cache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Get a cached flag value for a flag and context key.
   */
  get(key: string, contextKey: string = ''): boolean | null {
    const entry = this.getEntry(key, contextKey);
    return entry ? entry.value : null;
  }

  /**
   * Cache a flag value for a flag and context key. No-op when the TTL is 0.
   */
  set(
    key: string,
    value: boolean,
    flagId?: string,
    contextKey: string = '',
    metadata?: FlagEvaluationResult['metadata']
  ): void {
    if (this.ttl <= 0) return;
    let byContext = this.cache.get(key);
    if (!byContext) {
      byContext = new Map();
      this.cache.set(key, byContext);
    }
    byContext.set(contextKey, {
      value,
      expiresAt: Date.now() + this.ttl,
      flagId,
      metadata,
    });
  }

  /**
   * Invalidate a flag for every context.
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cached flags
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get all cached flag keys (each flag listed once, whatever its contexts).
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}
