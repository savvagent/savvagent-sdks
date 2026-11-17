/**
 * @jest-environment node
 *
 * User identity (#23) and bounded evaluation (#25) for @savvagent/nextjs/middleware.
 * Each test loads a fresh copy of the module, because initMiddlewareClient
 * keeps the first client it creates.
 */

import type { NextRequest } from 'next/server';

type MiddlewareModule = typeof import('../src/middleware');

function load(): { middleware: MiddlewareModule; FlagClient: typeof import('@savvagent/sdk').FlagClient } {
  let middleware!: MiddlewareModule;
  let FlagClient!: typeof import('@savvagent/sdk').FlagClient;
  jest.isolateModules(() => {
    middleware = require('../src/middleware');
    FlagClient = require('@savvagent/sdk').FlagClient;
  });
  return { middleware, FlagClient };
}

function request(cookies: Record<string, string>): NextRequest {
  return {
    cookies: { get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined) },
    headers: { get: () => null },
    url: 'https://example.com/',
  } as unknown as NextRequest;
}

const ok = { key: 'flag', value: true, reason: 'evaluated' as const };

describe('middleware user_id resolution', () => {
  afterEach(() => jest.restoreAllMocks());

  it('ignores the user_id cookie by default', async () => {
    const { middleware, FlagClient } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await middleware.isEnabledInMiddleware(request({ user_id: 'forged' }), 'flag');

    expect(evaluate.mock.calls[0][1]?.user_id).toBeUndefined();
  });

  it('reads the cookie when trustUserIdCookie is set in initMiddlewareClient', async () => {
    const { middleware, FlagClient } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' }, { trustUserIdCookie: true });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await middleware.redirectIfEnabled(request({ user_id: 'demo-user' }), 'flag', '/x');

    expect(evaluate.mock.calls[0][1]?.user_id).toBe('demo-user');
  });

  it('passes the request to getUserId and prefers its result to the cookie', async () => {
    const { middleware, FlagClient } = load();
    const getUserId = jest.fn(() => 'verified-user');
    middleware.initMiddlewareClient({ apiKey: 'sdk_test' }, { getUserId, trustUserIdCookie: true });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);
    const req = request({ user_id: 'forged' });

    await middleware.rewriteIfEnabled(req, 'flag', '/beta');

    expect(getUserId).toHaveBeenCalledWith(req);
    expect(evaluate.mock.calls[0][1]?.user_id).toBe('verified-user');
  });
});

describe('middleware getUserId is time-bounded (#26)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('drops a trusted cookie user and evaluates when getUserId hangs', async () => {
    const { middleware, FlagClient } = load();
    const onError = jest.fn();
    middleware.initMiddlewareClient(
      { apiKey: 'sdk_test', onError },
      { trustUserIdCookie: true, evaluationTimeoutMs: 30, getUserId: () => new Promise<string>(() => {}) }
    );
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await expect(middleware.isEnabledInMiddleware(request({ user_id: 'demo-user' }), 'flag')).resolves.toBe(true);

    expect(evaluate.mock.calls[0][1]).not.toHaveProperty('user_id');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('getUserId timed out') }));
  });

  it('evaluates without a user when getUserId throws, with the error as cause', async () => {
    const { middleware, FlagClient } = load();
    const onError = jest.fn();
    middleware.initMiddlewareClient(
      { apiKey: 'sdk_test', onError },
      {
        trustUserIdCookie: true,
        getUserId: () => {
          throw new Error('auth down');
        },
      }
    );
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await middleware.isEnabledInMiddleware(request({ user_id: 'demo-user' }), 'flag');

    expect(evaluate.mock.calls[0][1]).not.toHaveProperty('user_id');
    expect(onError.mock.calls[0][0].cause.message).toBe('auth down');
  });
});

describe('middleware bounded evaluation', () => {
  const realFetch = global.fetch;
  let pending: Array<() => void> = [];

  afterEach(async () => {
    pending.forEach((release) => release());
    pending = [];
    await new Promise((resolve) => setImmediate(resolve));
    global.fetch = realFetch;
  });

  it('evaluates to the default within about the timeout when the API hangs', async () => {
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(new Response('{}', { status: 503 })));
        })
    ) as unknown as typeof fetch;
    const { middleware } = load();
    middleware.initMiddlewareClient({ apiKey: 'sdk_test', onError: () => {} }, { evaluationTimeoutMs: 50 });

    const started = Date.now();
    const redirect = await middleware.redirectIfEnabled(request({}), 'flag', '/x');

    expect(redirect).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
