/**
 * Flag-key validation and configured defaults. Dependency-free: imported by
 * both the client and `./server`, so the two share one definition.
 */

/**
 * Whether `key` can be a flag key. Mirrors the server's rule: 1-128 characters
 * from `[A-Za-z0-9._-]`, and not `.` or `..`. The key is sent as one URL path
 * segment, and `.` and `..` cannot be carried in one (clients normalize them
 * away), so no flag can have those keys. Checking before the request keeps an
 * invalid key, and the SDK key sent with it, from steering the request to
 * another endpoint.
 *
 * Shared by the Savvagent JavaScript SDKs (`@savvagent/node-server` imports
 * it), so every SDK applies the same rule.
 */
export function isValidFlagKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key !== '.' &&
    key !== '..' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(key)
  );
}

/**
 * The configured default for a flag: `true` only when `defaults` has its own
 * `true` entry for the key, else `false`. A plain index would read inherited
 * properties, so `__proto__`, `toString` and `constructor` (all valid flag
 * keys) would return `Object.prototype` or a function instead of a boolean.
 *
 * Shared by the Savvagent JavaScript SDKs (`@savvagent/node-server` imports
 * it), so every SDK reads defaults the same way.
 */
export function defaultFor(defaults: Readonly<Record<string, boolean>> | undefined, key: string): boolean {
  return (
    defaults !== undefined &&
    defaults !== null &&
    Object.prototype.hasOwnProperty.call(defaults, key) &&
    defaults[key] === true
  );
}
