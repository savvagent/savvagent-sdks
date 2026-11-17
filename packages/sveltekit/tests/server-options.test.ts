/**
 * User identity (#23) and bounded evaluation (#25) for @savvagent/sveltekit/server,
 * against the real FlagClient with a mocked fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function event(cookies: Record<string, string>, locals: Record<string, unknown> = {}) {
  return {
    cookies: { get: (name: string) => cookies[name] },
    request: new Request('https://example.com/'),
    locals,
  } as any;
}

const ok = { key: 'flag', value: true, reason: 'evaluated' as const };

describe('user_id resolution', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores the user_id cookie by default', async () => {
    const server = await import('../src/server');
    const { FlagClient } = await import('@savvagent/sdk');
    server.initSvelteKitServer({ apiKey: 'sdk_test' });
    const evaluate = vi.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await server.evaluateForEvent(event({ user_id: 'forged', savvagent_anonymous_id: 'anon-1' }), 'flag');

    expect(evaluate.mock.calls[0][1]?.user_id).toBeUndefined();
    expect(evaluate.mock.calls[0][1]?.anonymous_id).toBe('anon-1');
  });

  it('reads the user_id cookie when trustUserIdCookie is set', async () => {
    const server = await import('../src/server');
    const { FlagClient } = await import('@savvagent/sdk');
    server.initSvelteKitServer({ apiKey: 'sdk_test' }, { trustUserIdCookie: true });
    const evaluate = vi.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await server.evaluateForEvent(event({ user_id: 'demo-user' }), 'flag');

    expect(evaluate.mock.calls[0][1]?.user_id).toBe('demo-user');
  });

  it('uses getUserId(event) over the cookie, and an explicit user_id over both', async () => {
    const server = await import('../src/server');
    const { FlagClient } = await import('@savvagent/sdk');
    const getUserId = vi.fn((e: any) => e.locals.user?.id);
    server.initSvelteKitServer({ apiKey: 'sdk_test' }, { getUserId, trustUserIdCookie: true });
    const evaluate = vi.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);
    const e = event({ user_id: 'forged' }, { user: { id: 'session-user' } });

    await server.evaluateForEvent(e, 'flag');
    await server.evaluateForEvent(e, 'flag', { user_id: 'explicit' });

    expect(getUserId).toHaveBeenCalledTimes(1);
    expect(getUserId).toHaveBeenCalledWith(e);
    expect(evaluate.mock.calls[0][1]?.user_id).toBe('session-user');
    expect(evaluate.mock.calls[1][1]?.user_id).toBe('explicit');
  });

  it('evaluates without a user and reports the error when getUserId rejects', async () => {
    const server = await import('../src/server');
    const { FlagClient } = await import('@savvagent/sdk');
    const onError = vi.fn();
    server.initSvelteKitServer(
      { apiKey: 'sdk_test', onError },
      { getUserId: async () => Promise.reject(new Error('auth down')) }
    );
    const evaluate = vi.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await expect(server.evaluateForEvent(event({}), 'flag')).resolves.toBe(true);

    expect(evaluate.mock.calls[0][1]?.user_id).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'auth down' }));
  });
});

describe('bounded evaluation when the Flags API is down', () => {
  const realFetch = globalThis.fetch;
  // Requests that never answer during the test; released afterwards so the
  // client's own request timers are cleared.
  let pending: Array<() => void> = [];

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(async () => {
    pending.forEach((release) => release());
    pending = [];
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  const hangingFetch = () =>
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(new Response('{}', { status: 503 })));
        })
    ) as unknown as typeof fetch;

  it('returns the default within about the timeout when the API hangs', async () => {
    globalThis.fetch = hangingFetch();
    const server = await import('../src/server');
    const onError = vi.fn();
    server.initSvelteKitServer({ apiKey: 'sdk_test', onError, defaults: { flag: true } }, { evaluationTimeoutMs: 50 });

    const started = Date.now();
    const result = await server.evaluate('flag');

    expect(result).toMatchObject({ key: 'flag', value: true, reason: 'error' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('timed out') }));
  });

  it('returns the default without retrying when the API answers 503', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response('unavailable', { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = await import('../src/server');
    server.initSvelteKitServer({ apiKey: 'sdk_test', onError: () => {} });

    const started = Date.now();
    await expect(server.isEnabled('flag')).resolves.toBe(false);

    expect(Date.now() - started).toBeLessThan(1500);
    const evaluateCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/evaluate'));
    expect(evaluateCalls).toHaveLength(1);
  });

  it('reports the same error to onError at most once per interval', async () => {
    globalThis.fetch = hangingFetch();
    const server = await import('../src/server');
    const onError = vi.fn();
    server.initSvelteKitServer({ apiKey: 'sdk_test', onError }, { evaluationTimeoutMs: 20 });

    await server.isEnabled('flag');
    await server.isEnabled('flag');
    await server.isEnabled('flag');

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('an undefined user_id in the context', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not discard the getUserId result or a trusted cookie', async () => {
    const server = await import('../src/server');
    const { FlagClient } = await import('@savvagent/sdk');
    server.initSvelteKitServer({ apiKey: 'sdk_test' }, { getUserId: () => 'session-user' });
    const evaluate = vi.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await server.evaluateForEvent(event({}), 'flag', { user_id: undefined });

    expect(evaluate.mock.calls[0][1]?.user_id).toBe('session-user');
    expect(
      server.getEventContext(event({ user_id: 'demo' }), { user_id: undefined }, { trustUserIdCookie: true }).user_id
    ).toBe('demo');
    vi.restoreAllMocks();
  });
});
