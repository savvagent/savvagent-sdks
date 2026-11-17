/**
 * Cookies the server integrations read and write, and the visitor's
 * anonymous ID.
 */

/** Cookie that keeps a visitor's anonymous ID stable across requests. */
export const ANONYMOUS_ID_COOKIE = 'savvagent_anonymous_id';
/** Cookie read for `user_id` only when `trustUserIdCookie` is enabled. */
export const USER_ID_COOKIE = 'user_id';
/** Cookie read for `session_id`. */
export const SESSION_ID_COOKIE = 'session_id';
/** Lifetime of the anonymous ID cookie: one year, in seconds. */
export const ANONYMOUS_ID_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Parse a `Cookie` header into a name/value map. Values are URI-decoded
 * when they decode cleanly, surrounding double quotes are removed, and the
 * first occurrence of a name wins. The map has no prototype, so a cookie
 * named `__proto__` or `constructor` is an ordinary entry.
 */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null);
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    const raw = part.slice(index + 1).trim().replace(/^"(.*)"$/, '$1');
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
};

/**
 * A new random anonymous ID, `anon_<uuid>`: the format the browser SDK
 * generates and reads back from the {@link ANONYMOUS_ID_COOKIE} cookie.
 * Uses Web Crypto (`crypto.randomUUID`, else `crypto.getRandomValues`),
 * which every runtime the server integrations support provides: Node 19
 * and later, edge runtimes, Deno and Bun.
 *
 * @throws Error if the runtime has no Web Crypto.
 */
export function newAnonymousId(): string {
  const source = globalThis.crypto as CryptoLike | undefined;
  if (source?.randomUUID) return `anon_${source.randomUUID()}`;
  if (source?.getRandomValues) {
    const bytes = source.getRandomValues(new Uint8Array(16));
    // RFC 4122 version 4, variant 1.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `anon_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('[Savvagent] No Web Crypto in this runtime; cannot generate an anonymous ID');
}

/**
 * Attributes of the anonymous ID cookie, in the shape framework cookie APIs
 * take (`cookies.set(name, value, options)` in SvelteKit, Astro and Next.js).
 */
export interface AnonymousIdCookieOptions {
  path: '/';
  maxAge: number;
  sameSite: 'lax';
  secure: boolean;
  /**
   * Always false: the browser SDK reads the cookie so that client-side
   * evaluations bucket the visitor the same way as the server.
   */
  httpOnly: false;
}

/**
 * The anonymous ID cookie's attributes: `Path=/`, one year, `SameSite=Lax`,
 * not HttpOnly, and `Secure` when the site is served over https.
 */
export function anonymousIdCookieOptions(secure: boolean): AnonymousIdCookieOptions {
  return { path: '/', maxAge: ANONYMOUS_ID_MAX_AGE, sameSite: 'lax', secure, httpOnly: false };
}

/**
 * A `Set-Cookie` header value that stores `anonymousId` in the
 * {@link ANONYMOUS_ID_COOKIE} cookie, with the attributes of
 * {@link anonymousIdCookieOptions}.
 */
export function serializeAnonymousIdCookie(anonymousId: string, options: { secure: boolean }): string {
  return (
    `${ANONYMOUS_ID_COOKIE}=${encodeURIComponent(anonymousId)}; Path=/; ` +
    `Max-Age=${ANONYMOUS_ID_MAX_AGE}; SameSite=Lax${options.secure ? '; Secure' : ''}`
  );
}

/**
 * Whether `url` uses https, i.e. whether a cookie set for it should be
 * `Secure`. A missing or unparsable URL counts as not secure.
 */
export function isSecureUrl(url: string | URL | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
