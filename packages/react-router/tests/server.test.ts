import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStaticHandler, RouterContextProvider } from 'react-router';
import type { StaticHandlerContext } from 'react-router';
import {
  createSavvagentServer,
  getSavvagent,
  parseCookies,
  toServerConfig,
  savvagentContext,
} from '../src';
import { config, mockFlagsApi, request } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseCookies', () => {
  it('parses, trims and decodes cookie values', () => {
    expect(parseCookies('a=1; b=hello%20world;c="quoted"; =skip; noeq')).toEqual({
      a: '1',
      b: 'hello world',
      c: 'quoted',
    });
  });

  it('keeps the first value of a repeated cookie and tolerates bad encoding', () => {
    expect(parseCookies('a=1; a=2; bad=%E0%A4%A')).toEqual({ a: '1', bad: '%E0%A4%A' });
    expect(parseCookies(null)).toEqual({});
  });
});

describe('toServerConfig', () => {
  it('turns off realtime and language detection unless set', () => {
    expect(toServerConfig(config)).toMatchObject({ enableRealtime: false, disableLanguageDetection: true });
    expect(toServerConfig({ ...config, enableRealtime: true, disableLanguageDetection: false })).toMatchObject({
      enableRealtime: true,
      disableLanguageDetection: false,
    });
  });
});

describe('getRequestContext', () => {
  it('reads the anonymous and session cookies and Accept-Language', () => {
    const savvagent = createSavvagentServer(config, { defaultContext: { environment: 'staging' } });
    const context = savvagent.getRequestContext(
      request('http://localhost/', {
        cookie: 'savvagent_anonymous_id=anon-1; session_id=s-1; user_id=mallory',
        headers: { 'accept-language': 'fr-CA;q=0.9,en;q=0.8' },
      })
    );
    expect(context).toEqual({
      environment: 'staging',
      anonymous_id: 'anon-1',
      session_id: 's-1',
      language: 'fr-CA',
    });
  });

  it('ignores the client-controlled user_id cookie by default', () => {
    const savvagent = createSavvagentServer(config);
    const context = savvagent.getRequestContext(request('http://localhost/', { cookie: 'user_id=mallory' }));
    expect(context.user_id).toBeUndefined();
  });

  it('reads the user_id cookie only when trustUserIdCookie is set', () => {
    const savvagent = createSavvagentServer(config, { trustUserIdCookie: true });
    const context = savvagent.getRequestContext(request('http://localhost/', { cookie: 'user_id=alice' }));
    expect(context.user_id).toBe('alice');
  });

  it('merges overrides over request values, attributes deeply', () => {
    const savvagent = createSavvagentServer(config, {
      defaultContext: { environment: 'production', attributes: { plan: 'free', country: 'US' } },
    });
    const context = savvagent.getRequestContext(request(), {
      environment: 'development',
      attributes: { plan: 'pro' },
    });
    expect(context).toEqual({ environment: 'development', attributes: { plan: 'pro', country: 'US' } });
  });
});

describe('forRequest', () => {
  it('assigns a new anonymous ID and returns a Set-Cookie for it', async () => {
    const savvagent = createSavvagentServer(config);
    const scope = await savvagent.forRequest(request('https://example.com/'));
    expect(scope.context.anonymous_id).toMatch(/^anon_[0-9a-f-]{36}$/);
    const [cookie] = scope.headers.getSetCookie();
    expect(cookie).toContain(`savvagent_anonymous_id=${scope.context.anonymous_id}`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).not.toContain('HttpOnly');
  });

  it('keeps an existing anonymous ID and sets no cookie', async () => {
    const savvagent = createSavvagentServer(config);
    const scope = await savvagent.forRequest(request('http://localhost/', { cookie: 'savvagent_anonymous_id=anon-1' }));
    expect(scope.context.anonymous_id).toBe('anon-1');
    expect(scope.headers.getSetCookie()).toEqual([]);
  });

  it('does not set the cookie when setAnonymousIdCookie is false', async () => {
    const savvagent = createSavvagentServer(config, { setAnonymousIdCookie: false });
    const scope = await savvagent.forRequest(request());
    expect(scope.context.anonymous_id).toBeTruthy();
    expect(scope.headers.getSetCookie()).toEqual([]);
  });

  it('takes the user ID from getUserId, and an explicit userId over it', async () => {
    const getUserId = vi.fn(async () => 'from-auth');
    const savvagent = createSavvagentServer(config, { getUserId, trustUserIdCookie: true });
    const req = request('http://localhost/', { cookie: 'user_id=from-cookie' });

    expect((await savvagent.forRequest(req)).context.user_id).toBe('from-auth');
    expect(getUserId).toHaveBeenCalledWith({ request: req, context: undefined });
    expect((await savvagent.forRequest(req, { userId: 'explicit' })).context.user_id).toBe('explicit');
    expect((await savvagent.forRequest(req, { userId: null })).context.user_id).toBeUndefined();
  });
});

describe('loader and action evaluation', () => {
  it('evaluates flags in a loader with the request context', async () => {
    const { calls } = mockFlagsApi((flagKey) => flagKey === 'new-feature');
    const savvagent = createSavvagentServer(config, { defaultContext: { environment: 'development' } });
    const handler = createStaticHandler([
      {
        id: 'root',
        path: '/',
        loader: async ({ request: req }) => {
          const scope = await savvagent.forRequest(req, { userId: 'user-123' });
          return { flags: await scope.evaluateFlags(['new-feature', 'beta-feature']) };
        },
      },
    ]);

    const result = (await handler.query(
      request('http://localhost/', { cookie: 'savvagent_anonymous_id=anon-1' })
    )) as StaticHandlerContext;

    const { flags } = result.loaderData.root as { flags: Record<string, { value: boolean; reason: string }> };
    expect(flags['new-feature']).toMatchObject({ key: 'new-feature', value: true, reason: 'evaluated' });
    expect(flags['beta-feature']).toMatchObject({ key: 'beta-feature', value: false, reason: 'evaluated' });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.context).toMatchObject({
        user_id: 'user-123',
        anonymous_id: 'anon-1',
        environment: 'development',
        application_id: 'app-1',
      });
    }
  });

  it('evaluates flags in an action, with withFlag and trackError', async () => {
    mockFlagsApi((flagKey) => flagKey === 'new-processor');
    const savvagent = createSavvagentServer(config);
    const handler = createStaticHandler([
      {
        id: 'form',
        path: '/form',
        action: async ({ request: req }) => {
          const scope = await savvagent.forRequest(req, { userId: 'user-1' });
          const form = await req.formData();
          const processed = await scope.withFlag('new-processor', () => `new:${form.get('name')}`);
          const legacy = await scope.withFlag('legacy-processor', () => 'legacy');
          const trackError = vi.spyOn(savvagent.client!, 'trackError');
          scope.trackError('new-processor', new Error('boom'), { attributes: { step: 'save' } });
          return {
            processed,
            legacy,
            enabled: await scope.isEnabled('new-processor'),
            trackedWith: trackError.mock.calls[0][2],
          };
        },
      },
    ]);

    const body = new URLSearchParams({ name: 'ada' });
    const result = (await handler.query(
      request('http://localhost/form', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        cookie: 'savvagent_anonymous_id=anon-9',
      })
    )) as StaticHandlerContext;

    expect(result.actionData?.form).toEqual({
      processed: 'new:ada',
      legacy: null,
      enabled: true,
      trackedWith: { user_id: 'user-1', anonymous_id: 'anon-9', attributes: { step: 'save' } },
    });
  });
});

describe('per-request context isolation', () => {
  it('never serves one user the result evaluated for another', async () => {
    // Targeted at alice only; responses are delayed so the two requests overlap.
    const { calls } = mockFlagsApi((_flagKey, context) => context.user_id === 'alice', { delayMs: 20 });
    const savvagent = createSavvagentServer(config, {
      getUserId: ({ request: req }) => req.headers.get('x-user') ?? undefined,
    });

    const evaluateFor = async (user: string) => {
      const scope = await savvagent.forRequest(
        request('http://localhost/', { headers: { 'x-user': user }, cookie: `savvagent_anonymous_id=anon-${user}` })
      );
      return scope.evaluateFlags(['vip']);
    };

    const [alice, bob] = await Promise.all([evaluateFor('alice'), evaluateFor('bob')]);
    expect(alice.vip.value).toBe(true);
    expect(bob.vip.value).toBe(false);

    // Repeat sequentially, so the second user hits the cache warmed by the first.
    expect((await evaluateFor('alice')).vip).toMatchObject({ value: true, reason: 'cached' });
    expect((await evaluateFor('bob')).vip).toMatchObject({ value: false, reason: 'cached' });

    expect(calls.map((c) => c.context.user_id).sort()).toEqual(['alice', 'bob']);
    expect(calls.map((c) => c.context.anonymous_id).sort()).toEqual(['anon-alice', 'anon-bob']);
    // Identity is never stored on the shared client.
    expect(savvagent.client!.getUserId()).toBeNull();
  });

  it('never evaluates a visitor without a cookie with the shared client\'s anonymous ID', async () => {
    const { calls } = mockFlagsApi(() => true);
    const savvagent = createSavvagentServer(config);
    await (await savvagent.forRequest(request())).isEnabled('a');
    await (await savvagent.forRequest(request())).isEnabled('a');
    expect(calls).toHaveLength(2);
    expect(calls[0].context.anonymous_id).not.toBe(calls[1].context.anonymous_id);
    expect(calls.some((c) => c.context.anonymous_id === savvagent.client!.getAnonymousId())).toBe(false);
  });

  it('shares one client across requests', async () => {
    mockFlagsApi(() => true);
    const savvagent = createSavvagentServer(config);
    const first = savvagent.client;
    await (await savvagent.forRequest(request())).isEnabled('a');
    expect(savvagent.client).toBe(first);
  });
});

describe('middleware', () => {
  const routes = (savvagent: ReturnType<typeof createSavvagentServer>) => [
    {
      id: 'root',
      path: '/',
      middleware: [savvagent.middleware],
      loader: async ({ context }: { context: Readonly<RouterContextProvider> }) => {
        const scope = getSavvagent(context);
        return Response.json({
          flags: await scope.evaluateFlags(['new-feature']),
          anonymousId: scope.context.anonymous_id,
        });
      },
    },
  ];

  it('provides the request scope to loaders and sets the anonymous ID cookie', async () => {
    mockFlagsApi(() => true);
    const savvagent = createSavvagentServer(config);
    const handler = createStaticHandler(routes(savvagent));
    const req = request('http://localhost/');

    const response: Response = await handler.queryRoute(req, {
      requestContext: new RouterContextProvider(),
      generateMiddlewareResponse: (queryRoute) => queryRoute(req),
    });

    const body = await response.json();
    expect(body.flags['new-feature'].value).toBe(true);
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringContaining(`savvagent_anonymous_id=${body.anonymousId}`),
    ]);
  });

  it('passes the router context to getUserId', async () => {
    const { calls } = mockFlagsApi(() => true);
    const authUser = (await import('react-router')).createContext<string | null>(null);
    const savvagent = createSavvagentServer(config, { getUserId: ({ context }) => context?.get(authUser) });
    const handler = createStaticHandler(routes(savvagent));
    const req = request('http://localhost/', { cookie: 'savvagent_anonymous_id=anon-1' });
    const requestContext = new RouterContextProvider();
    requestContext.set(authUser, 'session-user');

    const response: Response = await handler.queryRoute(req, {
      requestContext,
      generateMiddlewareResponse: (queryRoute) => queryRoute(req),
    });

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(calls[0].context).toMatchObject({ user_id: 'session-user', anonymous_id: 'anon-1' });
  });

  it('creates one scope and one cookie when mounted on nested routes', async () => {
    mockFlagsApi(() => true);
    const savvagent = createSavvagentServer(config);
    const handler = createStaticHandler([
      {
        id: 'root',
        path: '/',
        middleware: [savvagent.middleware],
        children: [
          {
            id: 'child',
            index: true,
            middleware: [savvagent.middleware],
            loader: ({ context }: { context: Readonly<RouterContextProvider> }) =>
              Response.json({ anonymousId: getSavvagent(context).context.anonymous_id }),
          },
        ],
      },
    ]);
    const req = request('http://localhost/');
    const response: Response = await handler.queryRoute(req, {
      routeId: 'child',
      requestContext: new RouterContextProvider(),
      generateMiddlewareResponse: (queryRoute) => queryRoute(req),
    });
    const { anonymousId } = await response.json();
    expect(response.headers.getSetCookie()).toEqual([expect.stringContaining(`savvagent_anonymous_id=${anonymousId}`)]);
  });

  it('adds the cookie to responses with immutable headers', async () => {
    const savvagent = createSavvagentServer(config);
    const context = new RouterContextProvider();
    const response = await savvagent.middleware(
      { request: request(), context, params: {}, url: new URL('http://localhost/'), pattern: '/' } as never,
      async () => Response.redirect('http://localhost/elsewhere', 302)
    );
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.getSetCookie()).toHaveLength(1);
    expect(context.get(savvagentContext)).not.toBeNull();
  });

  it('getSavvagent explains how to fix a missing middleware', () => {
    expect(() => getSavvagent(new RouterContextProvider())).toThrow(/savvagent\.middleware/);
  });
});

describe('invalid configuration', () => {
  it('returns configured defaults and reports the problem once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const savvagent = createSavvagentServer({ apiKey: '', defaults: { 'on-by-default': true } });
    const scope = await savvagent.forRequest(request());

    expect(await scope.isEnabled('on-by-default')).toBe(true);
    expect(await scope.evaluate('other')).toEqual({ key: 'other', value: false, reason: 'error' });
    expect(await scope.withFlag('on-by-default', () => 'ran')).toBe('ran');
    expect(await scope.withFlag('other', () => 'ran')).toBeNull();
    expect(() => scope.trackError('other', new Error('x'))).not.toThrow();
    expect(savvagent.client).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
