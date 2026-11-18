import { sha256Hex } from './sha256';
import { CacheEntry, FlagEvaluationResult } from './types';

/**
 * Deterministic cache key for an evaluation context: the lowercase SHA-256
 * hex digest (64 characters) of the UTF-8 canonical JSON of the context.
 * Object keys are sorted at every level, undefined values are dropped and
 * values with `toJSON` (such as Date) are serialized the way the request
 * body serializes them, so equal contexts always produce the same key and
 * different request bodies never share one. Only the digest is kept by the
 * cache, so the raw context (user IDs, attributes) is never held as a key.
 * A cyclic context throws a TypeError.
 */
export function contextCacheKey(context: unknown): string {
  return sha256Hex(JSON.stringify(normalize(context, new WeakSet())) ?? '');
}

/**
 * Mirrors JSON.stringify: `toJSON` is called at most once per value (its
 * result is not asked for `toJSON` again, so a `toJSON` returning `this`
 * cannot recurse), and a cyclic context throws a TypeError, as
 * JSON.stringify would when building the request body.
 */
function normalize(value: unknown, seen: WeakSet<object>, applyToJSON = true): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (applyToJSON) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      return normalize(toJSON.call(value), seen, false);
    }
  }
  if (seen.has(value)) {
    throw new TypeError('Cannot build a cache key for a cyclic evaluation context');
  }
  seen.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => (item === undefined ? null : normalize(item, seen)));
  } else {
    // A null-prototype object keeps an own "__proto__" key as plain data.
    const obj: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) obj[key] = normalize(item, seen);
    }
    out = obj;
  }
  // Only ancestors count as a cycle; a shared (non-cyclic) reference is fine.
  seen.delete(value);
  return out;
}

/** Default maximum number of cached (flag, context) entries. */
export const DEFAULT_CACHE_MAX_ENTRIES = 10000;

/**
 * In-memory cache for flag evaluation results with TTL and LRU eviction.
 *
 * Entries are keyed by flag key AND evaluation context (see
 * {@link contextCacheKey}), so a result evaluated for one user is never served
 * to another. At most `maxEntries` entries are kept (least recently used are
 * evicted), so a server seeing many distinct contexts stays bounded.
 * Invalidating a flag key clears its entries for every context. A TTL of 0
 * (or less) disables caching.
 *
 * Every invalidation also advances an invalidation generation (per flag for
 * {@link FlagCache.invalidate}, for every flag for {@link FlagCache.clear}).
 * Read {@link FlagCache.generation} before sending an evaluate request and pass
 * it to {@link FlagCache.set}: a result whose request started before an
 * invalidation is then not cached, so a kill switch flipped mid-request is not
 * undone by the stale answer.
 *
 * Public contract (exported from `@savvagent/sdk` and used by
 * `@savvagent/node-server`):
 *
 * - Every read and write takes a flag key and a context key. The context key
 *   is {@link contextCacheKey} of the evaluation context exactly as it is sent
 *   to the server (after the client fills in `application_id`, `environment`
 *   and the user and anonymous IDs). It defaults to `''`, the empty-context
 *   entry: `get(key)` and `getEntry(key)` read only a value stored with
 *   `set(key, value)` (or an explicit `''`), never a value cached for some
 *   other context. To read what a client cached for a user, pass that user's
 *   context key.
 * - A read returns `null` for a missing or expired entry; a hit becomes the
 *   most recently used entry.
 * - {@link FlagCache.invalidate} drops a flag for every context and
 *   {@link FlagCache.clear} drops everything; both advance the
 *   {@link FlagCache.generation} that {@link FlagCache.set} checks.
 * - A TTL of 0 (or less), or `maxEntries` of 0, stores nothing.
 *
 * Context keys must come from {@link contextCacheKey}; any other string is
 * stored as given, so raw context JSON passed here is kept in the cache.
 */
export class FlagCache {
  /** Entries in least-recently-used order (Map iteration order). */
  private entries: Map<string, CacheEntry> = new Map();
  /** Entry keys per flag key, so a flag can be invalidated exactly. */
  private byFlag: Map<string, Set<string>> = new Map();
  private ttl: number;
  private maxEntries: number;
  private lastSweep = 0;
  /** Advanced by {@link clear}, which invalidates every flag at once. */
  private epoch = 0;
  /** Invalidation count per flag key since the last {@link clear}. */
  private generations: Map<string, number> = new Map();

  constructor(ttl: number = 60000, maxEntries: number = DEFAULT_CACHE_MAX_ENTRIES) {
    this.ttl = ttl;
    // Infinity means "no cap"; NaN (e.g. Number(undefinedEnvVar)) falls back
    // to the default rather than silently disabling the cap.
    this.maxEntries =
      maxEntries === Infinity
        ? Infinity
        : Number.isFinite(maxEntries)
          ? Math.max(0, Math.floor(maxEntries))
          : DEFAULT_CACHE_MAX_ENTRIES;
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
   * recently used entry. Without `contextKey` this reads only the
   * empty-context entry (`''`), not a value cached for another context.
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
   * Get a cached flag value for a flag and context key, or `null` on a miss.
   * Without `contextKey` this reads only the empty-context entry (`''`), not a
   * value cached for another context.
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

    // Sweeping is O(size), so do it at most once per TTL: with a full cache
    // and nothing expired, sweeping on every write would scan the whole map
    // each time. All entries share one TTL, so evicting the least recently
    // used entry below is close to evicting the next one to expire anyway.
    if (this.entries.size > this.maxEntries && Date.now() - this.lastSweep >= this.ttl) {
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
    this.lastSweep = now;
    for (const [entryKey, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.remove(entryKey.slice(0, entryKey.lastIndexOf('\0')), entryKey);
      }
    }
  }

  /**
   * The flag's current invalidation generation: an opaque token that changes
   * whenever the flag is invalidated or the cache is cleared. Read it before
   * sending an evaluate request and pass it to {@link set}.
   */
  generation(key: string): string {
    return `${this.epoch}.${this.generations.get(key) ?? 0}`;
  }

  /**
   * Cache a flag value for a flag and context key. No-op when the TTL is 0.
   *
   * @param generation - The {@link generation} read before the value was
   *   requested. When given and the flag has been invalidated since, the value
   *   is stale and is not cached. When omitted, the value is always cached.
   */
  set(
    key: string,
    value: boolean,
    flagId?: string,
    contextKey: string = '',
    metadata?: FlagEvaluationResult['metadata'],
    generation?: string
  ): void {
    if (generation !== undefined && generation !== this.generation(key)) return;
    this.store(key, contextKey, { value, expiresAt: Date.now() + this.ttl, flagId, metadata });
  }

  /**
   * Invalidate a flag for every context.
   */
  invalidate(key: string): void {
    // Advance even when nothing is cached: a request may be in flight.
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    // Bound the map: past the cap, advancing the epoch invalidates every
    // outstanding generation at once, so the per-flag counts can be dropped.
    if (this.generations.size > this.maxEntries) {
      this.epoch++;
      this.generations.clear();
    }
    const keys = this.byFlag.get(key);
    if (!keys) return;
    for (const entryKey of keys) this.entries.delete(entryKey);
    this.byFlag.delete(key);
  }

  /**
   * Clear all cached flags
   */
  clear(): void {
    this.epoch++;
    this.generations.clear();
    this.entries.clear();
    this.byFlag.clear();
  }

  /**
   * Get all cached flag keys (each flag listed once, whatever its contexts).
   */
  keys(): string[] {
    return Array.from(this.byFlag.keys());
  }
}
