import { CacheEntry } from './types';

/**
 * In-memory cache for flag values with TTL
 */
export class FlagCache {
  private cache: Map<string, CacheEntry>;
  private ttl: number;

  constructor(ttl: number = 60000) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  /**
   * Get a cached flag value
   */
  get(key: string): boolean | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set a flag value in cache
   */
  set(key: string, value: boolean, flagId?: string): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttl,
      flagId,
    });
  }

  /**
   * Invalidate a specific flag or all flags
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
