import { CacheEntry } from './types';

/**
 * Simple in-memory cache for flag values with TTL
 */
export class FlagCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttl: number;

  constructor(ttl: number = 60000) {
    this.ttl = ttl;
  }

  /**
   * Get a cached flag value
   */
  get(key: string): boolean | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

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
   * Invalidate a specific flag
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
   * Get all cached keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}
