/**
 * @jest-environment node
 *
 * User identity (#23) and bounded evaluation (#25) for @savvagent/nextjs/server.
 * Each test loads a fresh copy of the module, because initServerClient
 * keeps the first client it creates.
 */

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

type ServerModule = typeof import('../src/server');

const cookieValues: Record<string, string> = {
  user_id: 'forged-user',
  savvagent_anonymous_id: 'anon-1',
};

function load(): { server: ServerModule; FlagClient: typeof import('@savvagent/sdk').FlagClient } {
  let server!: ServerModule;
  let FlagClient!: typeof import('@savvagent/sdk').FlagClient;
  jest.isolateModules(() => {
    const nextHeaders = require('next/headers');
    nextHeaders.cookies.mockResolvedValue({
      get: (name: string) => (name in cookieValues ? { value: cookieValues[name] } : undefined),
    });
    nextHeaders.headers.mockResolvedValue({ get: () => null });
    server = require('../src/server');
    FlagClient = require('@savvagent/sdk').FlagClient;
  });
  return { server, FlagClient };
}

const ok = { key: 'flag', value: true, reason: 'evaluated' as const };

describe('user_id resolution', () => {
  afterEach(() => jest.restoreAllMocks());

  it('ignores the user_id cookie by default', async () => {
    const { server, FlagClient } = load();
    server.initServerClient({ apiKey: 'sdk_test' });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await server.isEnabled('flag');

    expect(evaluate.mock.calls[0][1]?.user_id).toBeUndefined();
    expect(evaluate.mock.calls[0][1]?.anonymous_id).toBe('anon-1');
  });

  it('reads the user_id cookie when trustUserIdCookie is set', async () => {
    const { server, FlagClient } = load();
    server.initServerClient({ apiKey: 'sdk_test' }, { trustUserIdCookie: true });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await server.isEnabled('flag');
    await server.evaluateForRequest(new Request('https://x.test', { headers: { cookie: 'user_id=req-user' } }), 'flag');

    expect(evaluate.mock.calls[0][1]?.user_id).toBe('forged-user');
    expect(evaluate.mock.calls[1][1]?.user_id).toBe('req-user');
  });

  it('uses getUserId over the cookie, and an explicit user_id over both', async () => {
    const { server, FlagClient } = load();
    const getUserId = jest.fn(async () => 'session-user');
    server.initServerClient({ apiKey: 'sdk_test' }, { getUserId, trustUserIdCookie: true });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await server.isEnabled('flag');
    await server.isEnabled('flag', { user_id: 'explicit' });
    const request = new Request('https://x.test');
    await server.evaluateForRequest(request, 'flag');

    expect(evaluate.mock.calls[0][1]?.user_id).toBe('session-user');
    expect(evaluate.mock.calls[1][1]?.user_id).toBe('explicit');
    expect(evaluate.mock.calls[2][1]?.user_id).toBe('session-user');
    expect(getUserId).toHaveBeenCalledTimes(2);
    expect(getUserId).toHaveBeenLastCalledWith(request);
  });

  it("treats a per-call user_id of '', null or undefined as not given: getUserId still runs", async () => {
    const { server, FlagClient } = load();
    const getUserId = jest.fn(async () => 'session-user');
    server.initServerClient({ apiKey: 'sdk_test' }, { getUserId });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);
    const request = new Request('https://x.test');

    await server.isEnabled('flag', { user_id: '' });
    await server.evaluateForRequest(request, 'flag', { user_id: '' });
    await server.evaluateForRequest(request, 'flag', { user_id: null as unknown as string });
    await server.evaluateForRequest(request, 'flag', { user_id: undefined });

    expect(getUserId).toHaveBeenCalledTimes(4);
    for (const call of evaluate.mock.calls) expect(call[1]?.user_id).toBe('session-user');
  });

  it('evaluates without a user and reports the error when getUserId throws', async () => {
    const { server, FlagClient } = load();
    const onError = jest.fn();
    server.initServerClient(
      { apiKey: 'sdk_test', onError },
      {
        getUserId: () => {
          throw new Error('auth down');
        },
      }
    );
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await expect(server.isEnabled('flag')).resolves.toBe(true);

    expect(evaluate.mock.calls[0][1]?.user_id).toBeUndefined();
    // A fixed message keeps attacker-influenced error text out of logs; the original is the cause.
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'getUserId failed; evaluating without a user_id',
        cause: expect.objectContaining({ message: 'auth down' }),
      })
    );
  });
});

describe('getUserId is time-bounded (#26)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('drops a trusted cookie user and evaluates when getUserId hangs', async () => {
    const { server, FlagClient } = load();
    const onError = jest.fn();
    server.initServerClient(
      { apiKey: 'sdk_test', onError },
      { trustUserIdCookie: true, evaluationTimeoutMs: 30, getUserId: () => new Promise<string>(() => {}) }
    );
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    const started = Date.now();
    await expect(server.isEnabled('flag')).resolves.toBe(true);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(evaluate.mock.calls[0][1]).not.toHaveProperty('user_id');
    expect(evaluate.mock.calls[0][1]?.anonymous_id).toBe('anon-1');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'getUserId timed out after 30ms; evaluating without a user_id' })
    );
  });

  it('keeps a trusted cookie user when getUserId returns undefined', async () => {
    const { server, FlagClient } = load();
    server.initServerClient({ apiKey: 'sdk_test' }, { trustUserIdCookie: true, getUserId: () => undefined });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await server.isEnabled('flag');

    expect(evaluate.mock.calls[0][1]?.user_id).toBe('forged-user');
  });
});

describe('bounded evaluation when the Flags API is down', () => {
  const realFetch = global.fetch;
  // Requests that never answer during the test; released afterwards so the
  // client's own request timers are cleared and Jest can exit.
  let pending: Array<() => void> = [];
  const hangingFetch = () =>
    jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(new Response('{}', { status: 503 })));
        })
    ) as unknown as typeof fetch;

  afterEach(async () => {
    pending.forEach((release) => release());
    pending = [];
    await new Promise((resolve) => setImmediate(resolve));
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('returns the default within about the timeout when the API hangs', async () => {
    global.fetch = hangingFetch();
    const { server } = load();
    const onError = jest.fn();
    server.initServerClient(
      { apiKey: 'sdk_test', onError, defaults: { flag: true } },
      { evaluationTimeoutMs: 50 }
    );

    const started = Date.now();
    const result = await server.evaluate('flag');
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ key: 'flag', value: true, reason: 'error' });
    expect(elapsed).toBeLessThan(1000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('timed out') }));
  });

  it('returns defaults without retrying when the API answers 503', async () => {
    const fetchMock = jest.fn(async (_url: unknown, _init?: unknown) => new Response('unavailable', { status: 503 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { server } = load();
    server.initServerClient({ apiKey: 'sdk_test', onError: () => {} });

    const started = Date.now();
    const values = await server.isEnabledMultiple(['a', 'b'], undefined, { b: true });
    const elapsed = Date.now() - started;

    expect(values).toEqual({ a: false, b: true });
    expect(elapsed).toBeLessThan(1500);
    // One attempt per flag: no retries while the page waits.
    const evaluateCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/evaluate'));
    expect(evaluateCalls).toHaveLength(2);
  });

  it('reports the same error to onError at most once per interval', async () => {
    global.fetch = hangingFetch();
    const { server } = load();
    const onError = jest.fn();
    server.initServerClient({ apiKey: 'sdk_test', onError }, { evaluationTimeoutMs: 20 });

    await server.isEnabled('flag');
    await server.isEnabled('flag');
    await server.isEnabled('flag');

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('an undefined user_id in the context', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not discard the getUserId result', async () => {
    const { server, FlagClient } = load();
    server.initServerClient({ apiKey: 'sdk_test' }, { getUserId: () => 'session-user' });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await server.isEnabled('flag', { user_id: undefined });
    await server.evaluateForRequest(new Request('https://x.test'), 'flag', { user_id: undefined });

    expect(evaluate.mock.calls[0][1]?.user_id).toBe('session-user');
    expect(evaluate.mock.calls[1][1]?.user_id).toBe('session-user');
  });
});
