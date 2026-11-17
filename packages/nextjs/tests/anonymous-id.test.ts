/**
 * @jest-environment node
 *
 * Per-visitor anonymous ID (#26): Next.js evaluates every visitor with
 * their own `savvagent_anonymous_id`, and stores a new one in the cookie
 * (not HttpOnly, Path=/, SameSite=Lax, one year, Secure on https).
 */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

// React's `cache` memoizes per request on the server; outside React Server
// Components it does not memoize. Each test loads a fresh module, so this
// models one request per test.
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  cache: (fn: () => unknown) => {
    let memo: { value: unknown } | undefined;
    return () => (memo ??= { value: fn() }).value;
  },
}));

type ServerModule = typeof import('../src/server');
type MiddlewareModule = typeof import('../src/middleware');

const COOKIE_OPTIONS = { path: '/', maxAge: 31_536_000, sameSite: 'lax', httpOnly: false };
const ok = { key: 'flag', value: true, reason: 'evaluated' as const };

function load() {
  let server!: ServerModule;
  let middleware!: MiddlewareModule;
  let FlagClient!: typeof import('@savvagent/sdk').FlagClient;
  let nextHeaders!: { cookies: jest.Mock; headers: jest.Mock };
  jest.isolateModules(() => {
    nextHeaders = require('next/headers');
    server = require('../src/server');
    middleware = require('../src/middleware');
    FlagClient = require('@savvagent/sdk').FlagClient;
  });
  const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);
  return { server, middleware, nextHeaders, evaluate };
}

function cookieStore(values: Record<string, string>, set: jest.Mock = jest.fn()) {
  return { get: (name: string) => (name in values ? { value: values[name] } : undefined), set };
}

function headerList(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}

afterEach(() => jest.restoreAllMocks());

describe('Server Components, Server Actions and Route Handlers', () => {
  it('evaluates a visitor without the cookie with one new anonymous ID per request, and stores it', async () => {
    const { server, nextHeaders, evaluate } = load();
    const set = jest.fn();
    nextHeaders.cookies.mockResolvedValue(cookieStore({}, set));
    nextHeaders.headers.mockResolvedValue(headerList({ 'x-forwarded-proto': 'https' }));
    server.initServerClient({ apiKey: 'sdk_test' });

    await server.isEnabled('a');
    await server.evaluate('b');
    await server.evaluateMultiple(['c']);

    const ids = evaluate.mock.calls.map(([, context]) => context?.anonymous_id);
    expect(ids[0]).toMatch(/^anon_[0-9a-f-]{36}$/);
    expect(new Set(ids)).toEqual(new Set([ids[0]]));
    expect(set).toHaveBeenCalledWith('savvagent_anonymous_id', ids[0], { ...COOKIE_OPTIONS, secure: true });
  });

  it('sets Secure only when the request came over https', async () => {
    const { server, nextHeaders } = load();
    const set = jest.fn();
    nextHeaders.cookies.mockResolvedValue(cookieStore({}, set));
    nextHeaders.headers.mockResolvedValue(headerList({ 'x-forwarded-proto': 'http' }));
    server.initServerClient({ apiKey: 'sdk_test' });

    await server.isEnabled('a');

    expect(set).toHaveBeenCalledWith('savvagent_anonymous_id', expect.any(String), { ...COOKIE_OPTIONS, secure: false });
  });

  it('still evaluates with the new ID when the cookie store is read-only (Server Components)', async () => {
    const { server, nextHeaders, evaluate } = load();
    const set = jest.fn(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
    });
    nextHeaders.cookies.mockResolvedValue(cookieStore({}, set));
    nextHeaders.headers.mockResolvedValue(headerList({}));
    server.initServerClient({ apiKey: 'sdk_test' });

    await expect(server.isEnabled('a')).resolves.toBe(true);

    expect(set).toHaveBeenCalled();
    expect(evaluate.mock.calls[0][1]?.anonymous_id).toMatch(/^anon_/);
  });

  it('uses the cookie and writes nothing for a returning visitor', async () => {
    const { server, nextHeaders, evaluate } = load();
    const set = jest.fn();
    nextHeaders.cookies.mockResolvedValue(cookieStore({ savvagent_anonymous_id: 'anon_returning' }, set));
    nextHeaders.headers.mockResolvedValue(headerList({}));
    server.initServerClient({ apiKey: 'sdk_test' });

    await server.isEnabled('a');

    expect(evaluate.mock.calls[0][1]?.anonymous_id).toBe('anon_returning');
    expect(set).not.toHaveBeenCalled();
  });

  it('evaluateForRequest gives one ID per request and stores it through cookies()', async () => {
    const { server, nextHeaders, evaluate } = load();
    const set = jest.fn();
    nextHeaders.cookies.mockResolvedValue(cookieStore({}, set));
    server.initServerClient({ apiKey: 'sdk_test' });
    const request = new Request('https://example.com/api');

    await server.evaluateForRequest(request, 'a');
    await server.evaluateForRequest(request, 'b');
    await server.evaluateForRequest(new Request('http://example.com/api'), 'c');

    const ids = evaluate.mock.calls.map(([, context]) => context?.anonymous_id);
    expect(ids[0]).toMatch(/^anon_/);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(set).toHaveBeenNthCalledWith(1, 'savvagent_anonymous_id', ids[0], { ...COOKIE_OPTIONS, secure: true });
    expect(set).toHaveBeenLastCalledWith('savvagent_anonymous_id', ids[2], { ...COOKIE_OPTIONS, secure: false });
  });

  it('evaluateForRequest still evaluates when there is no cookie store', async () => {
    const { server, nextHeaders, evaluate } = load();
    nextHeaders.cookies.mockRejectedValue(new Error('called outside a request scope'));
    server.initServerClient({ apiKey: 'sdk_test' });

    await expect(server.evaluateForRequest(new Request('https://example.com'), 'a')).resolves.toBe(true);
    expect(evaluate.mock.calls[0][1]?.anonymous_id).toMatch(/^anon_/);
  });
});

describe('middleware', () => {
  const setCookieOf = (response: Response) => response.headers.get('set-cookie') ?? '';
  const anonymousIdIn = (setCookie: string) => /savvagent_anonymous_id=([^;]+)/.exec(setCookie)?.[1];

  it('assigns a new visitor an ID, forwards it to the page and sets the cookie on the response', async () => {
    const { middleware, evaluate } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' });
    let evaluatedWith: string | undefined;
    const handler = middleware.createMiddleware({
      async onRequest(request) {
        await middleware.isEnabledInMiddleware(request, 'flag');
        evaluatedWith = evaluate.mock.calls[0][1]?.anonymous_id;
      },
    });

    const response = await handler(new NextRequest('https://example.com/page', { headers: { cookie: 'a=1' } }));

    const setCookie = setCookieOf(response);
    const id = anonymousIdIn(setCookie);
    expect(id).toMatch(/^anon_[0-9a-f-]{36}$/);
    expect(evaluatedWith).toBe(id);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=31536000/);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).not.toMatch(/HttpOnly/i);
    // The page rendered for this request sees the same ID in its Cookie header.
    expect(response.headers.get('x-middleware-override-headers')).toContain('cookie');
    expect(response.headers.get('x-middleware-request-cookie')).toBe(`a=1; savvagent_anonymous_id=${id}`);
  });

  it('does not set Secure over http', async () => {
    const { middleware } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' });

    const response = await middleware.createMiddleware()(new NextRequest('http://localhost:3000/'));

    expect(anonymousIdIn(setCookieOf(response))).toMatch(/^anon_/);
    expect(setCookieOf(response)).not.toMatch(/Secure/);
  });

  it('sets Secure behind a TLS-terminating proxy (x-forwarded-proto: https)', async () => {
    const { middleware } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' });
    const request = new NextRequest('http://internal:3000/', { headers: { 'x-forwarded-proto': 'https, http' } });

    const response = await middleware.createMiddleware()(request);

    expect(anonymousIdIn(setCookieOf(response))).toMatch(/^anon_/);
    expect(setCookieOf(response)).toMatch(/Secure/);
    const id = middleware.getAnonymousId(request);
    expect(middleware.setAnonymousIdCookie(request, new Response('ok')).headers.get('set-cookie')).toBe(
      `savvagent_anonymous_id=${id}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
    );
  });

  it('does not set Secure when x-forwarded-proto is http', async () => {
    const { middleware } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' });

    const response = await middleware.createMiddleware()(
      new NextRequest('http://internal:3000/', { headers: { 'x-forwarded-proto': 'http' } })
    );

    expect(setCookieOf(response)).not.toMatch(/Secure/);
  });

  it('leaves a returning visitor alone', async () => {
    const { middleware, evaluate } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' });
    const request = new NextRequest('https://example.com/', {
      headers: { cookie: 'savvagent_anonymous_id=anon_returning' },
    });

    const response = await middleware.createMiddleware({
      onRequest: async (req) => void (await middleware.isEnabledInMiddleware(req, 'flag')),
    })(request);

    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
    expect(evaluate.mock.calls[0][1]?.anonymous_id).toBe('anon_returning');
  });

  it('sets the cookie on a response returned by onRequest, and on redirects and rewrites', async () => {
    const { middleware } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' });

    const custom = await middleware.createMiddleware({
      onRequest: async () => NextResponse.json({ ok: true }),
    })(new NextRequest('https://example.com/'));
    const redirect = await middleware.redirectIfEnabled(new NextRequest('https://example.com/'), 'flag', '/new');
    const rewrite = await middleware.rewriteIfEnabled(new NextRequest('https://example.com/'), 'flag', '/beta');

    expect(anonymousIdIn(setCookieOf(custom))).toMatch(/^anon_/);
    expect(anonymousIdIn(setCookieOf(redirect!))).toMatch(/^anon_/);
    const rewriteId = anonymousIdIn(setCookieOf(rewrite!));
    expect(rewriteId).toMatch(/^anon_/);
    expect(rewrite!.headers.get('x-middleware-request-cookie')).toBe(`savvagent_anonymous_id=${rewriteId}`);
  });

  it('getAnonymousId and getRequestContext agree within a request', () => {
    const { middleware } = load();
    const request = new NextRequest('https://example.com/');
    const id = middleware.getAnonymousId(request);

    expect(middleware.getAnonymousId(request)).toBe(id);
    expect(middleware.getRequestContext(request).anonymous_id).toBe(id);
    expect(middleware.getAnonymousId(new NextRequest('https://example.com/'))).not.toBe(id);
  });

  it('setAnonymousIdCookie writes the exact cookie on plain and immutable responses', () => {
    const { middleware } = load();
    const request = new NextRequest('https://example.com/');
    const id = middleware.getAnonymousId(request);
    const expected = `savvagent_anonymous_id=${id}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;

    expect(middleware.setAnonymousIdCookie(request, new Response('ok')).headers.get('set-cookie')).toBe(expected);
    const immutable = Response.redirect('https://example.com/elsewhere', 302);
    const copy = middleware.setAnonymousIdCookie(request, immutable);
    expect(copy.status).toBe(302);
    expect(copy.headers.get('set-cookie')).toBe(expected);
  });

  it('setAnonymousIdCookie does nothing when no ID was assigned', () => {
    const { middleware } = load();
    const response = new Response('ok');
    expect(middleware.setAnonymousIdCookie(new NextRequest('https://example.com/'), response)).toBe(response);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('an anonymous_id passed by the caller', () => {
  it('is used, and no new ID is assigned or stored', async () => {
    const { server, middleware, nextHeaders, evaluate } = load();
    const set = jest.fn();
    nextHeaders.cookies.mockResolvedValue(cookieStore({}, set));
    nextHeaders.headers.mockResolvedValue(headerList({}));
    server.initServerClient({ apiKey: 'sdk_test' });
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' });
    const request = new NextRequest('https://example.com/');

    await server.isEnabled('a', { anonymous_id: 'anon_mine' });
    await server.evaluateForRequest(new Request('https://example.com/'), 'b', { anonymous_id: 'anon_mine' });
    await middleware.isEnabledInMiddleware(request, 'c', { anonymous_id: 'anon_mine' });

    expect(evaluate.mock.calls.map(([, context]) => context?.anonymous_id)).toEqual([
      'anon_mine',
      'anon_mine',
      'anon_mine',
    ]);
    expect(set).not.toHaveBeenCalled();
    expect(middleware.setAnonymousIdCookie(request, new Response('ok')).headers.get('set-cookie')).toBeNull();
  });
});
