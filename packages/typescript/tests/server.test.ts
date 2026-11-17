/**
 * @savvagent/sdk/server: the request scope shared by the server integrations (#26).
 */

import {
  ANONYMOUS_ID_COOKIE,
  ANONYMOUS_ID_MAX_AGE,
  DEFAULT_EVALUATION_TIMEOUT_MS,
  ERROR_REPORT_INTERVAL_MS,
  EvaluatingClient,
  anonymousIdCookieOptions,
  assignAnonymousId,
  buildRequestContext,
  createRequestScope,
  createServerClient,
  defaultFor,
  evaluateBounded,
  isSecureUrl,
  mergeContext,
  newAnonymousId,
  parseCookies,
  parseLanguage,
  resolveUserId,
  serializeAnonymousIdCookie,
  throttleErrors,
  toServerConfig,
} from '../src/server';
import type { FlagClientConfig, FlagContext, FlagEvaluationResult } from '../src/types';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ok = (key: string): FlagEvaluationResult => ({ key, value: true, reason: 'evaluated' });

function fakeClient(evaluate?: (flagKey: string, context?: FlagContext) => Promise<FlagEvaluationResult>) {
  return {
    evaluate: jest.fn(evaluate ?? (async (flagKey: string) => ok(flagKey))),
    trackError: jest.fn(),
  };
}

/** A promise that never settles, for "the Flags API hangs". */
const never = <T>() => new Promise<T>(() => {});

describe('parseCookies', () => {
  it('parses, trims, unquotes and URI-decodes values', () => {
    const cookies = parseCookies(' a=1;b = two ; c="quoted"; d=caf%C3%A9; e=x=y');
    expect({ ...cookies }).toEqual({ a: '1', b: 'two', c: 'quoted', d: 'café', e: 'x=y' });
  });

  it('keeps the first occurrence of a name and a raw value that does not decode', () => {
    expect({ ...parseCookies('a=1; a=2; bad=%E0%A4%A') }).toEqual({ a: '1', bad: '%E0%A4%A' });
  });

  it('returns an empty map for a missing header and skips parts without a name or =', () => {
    expect({ ...parseCookies(null) }).toEqual({});
    expect({ ...parseCookies(undefined) }).toEqual({});
    expect({ ...parseCookies('novalue; =x; ok=1') }).toEqual({ ok: '1' });
  });

  it('treats __proto__ and constructor as ordinary cookie names', () => {
    const cookies = parseCookies('__proto__=p; constructor=c; toString=t');
    expect(Object.getPrototypeOf(cookies)).toBeNull();
    expect(cookies.__proto__).toBe('p');
    expect(cookies.constructor).toBe('c');
    expect(cookies.toString).toBe('t');
  });
});

describe('anonymous ID', () => {
  const realCrypto = globalThis.crypto;
  const setCrypto = (value: unknown) =>
    Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });
  afterEach(() => setCrypto(realCrypto));

  it('is anon_<uuid v4>, fresh each time', () => {
    const a = newAnonymousId();
    const b = newAnonymousId();
    expect(a).toMatch(/^anon_/);
    expect(a.slice(5)).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it('formats a v4 UUID from getRandomValues when randomUUID is missing', () => {
    setCrypto({ getRandomValues: (array: Uint8Array) => array.fill(0xff) });
    expect(newAnonymousId()).toBe('anon_ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('throws a clear error without Web Crypto', () => {
    setCrypto(undefined);
    expect(() => newAnonymousId()).toThrow(/No Web Crypto/);
  });

  it('assignAnonymousId keeps an existing ID and assigns a new one otherwise', () => {
    const existing: FlagContext = { anonymous_id: 'anon_existing' };
    expect(assignAnonymousId(existing)).toEqual({ anonymousId: 'anon_existing', isNew: false });

    const missing: FlagContext = { user_id: 'u' };
    const assigned = assignAnonymousId(missing);
    expect(assigned.isNew).toBe(true);
    expect(assigned.anonymousId).toMatch(/^anon_/);
    expect(missing.anonymous_id).toBe(assigned.anonymousId);
  });
});

describe('anonymous ID cookie', () => {
  it('is savvagent_anonymous_id, not HttpOnly, Path=/, SameSite=Lax, one year, Secure on https', () => {
    expect(ANONYMOUS_ID_COOKIE).toBe('savvagent_anonymous_id');
    expect(ANONYMOUS_ID_MAX_AGE).toBe(31_536_000);
    expect(serializeAnonymousIdCookie('anon_1', { secure: false })).toBe(
      'savvagent_anonymous_id=anon_1; Path=/; Max-Age=31536000; SameSite=Lax'
    );
    expect(serializeAnonymousIdCookie('anon_1', { secure: true })).toBe(
      'savvagent_anonymous_id=anon_1; Path=/; Max-Age=31536000; SameSite=Lax; Secure'
    );
    expect(serializeAnonymousIdCookie('anon_1', { secure: true })).not.toMatch(/HttpOnly/i);
  });

  it('gives the same attributes in the shape framework cookie APIs take', () => {
    expect(anonymousIdCookieOptions(true)).toEqual({
      path: '/',
      maxAge: 31_536_000,
      sameSite: 'lax',
      secure: true,
      httpOnly: false,
    });
    expect(anonymousIdCookieOptions(false).secure).toBe(false);
  });

  it('encodes the value', () => {
    expect(serializeAnonymousIdCookie('a b;c', { secure: false })).toMatch(/^savvagent_anonymous_id=a%20b%3Bc;/);
  });

  it('isSecureUrl is true only for https URLs', () => {
    expect(isSecureUrl('https://example.com/a')).toBe(true);
    expect(isSecureUrl(new URL('https://example.com'))).toBe(true);
    expect(isSecureUrl('http://localhost:3000/')).toBe(false);
    expect(isSecureUrl('not a url')).toBe(false);
    expect(isSecureUrl(undefined)).toBe(false);
  });
});

describe('toServerConfig', () => {
  it('turns off realtime and language detection and makes one attempt', () => {
    expect(toServerConfig({ apiKey: 'sdk_x' })).toEqual({
      apiKey: 'sdk_x',
      enableRealtime: false,
      disableLanguageDetection: true,
      retryAttempts: 1,
    });
  });

  it('keeps values the config sets', () => {
    expect(
      toServerConfig({ apiKey: 'sdk_x', enableRealtime: true, disableLanguageDetection: false, retryAttempts: 3 })
    ).toMatchObject({ enableRealtime: true, disableLanguageDetection: false, retryAttempts: 3 });
  });
});

describe('throttleErrors', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports the same message once per minute', () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const onError = jest.fn();
    const report = throttleErrors(onError);

    report(new Error('down'));
    report(new Error('down'));
    report(new Error('other'));
    now += ERROR_REPORT_INTERVAL_MS - 1;
    report(new Error('down'));
    now += 1;
    report(new Error('down'));

    expect(ERROR_REPORT_INTERVAL_MS).toBe(60_000);
    expect(onError.mock.calls.map(([e]) => e.message)).toEqual(['down', 'other', 'down']);
  });

  it('logs a throwing handler instead of propagating', () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const report = throttleErrors(() => {
      throw new Error('handler bug');
    });

    expect(() => report(new Error('down'))).not.toThrow();
    expect(log).toHaveBeenCalledWith('[Savvagent] onError handler threw', expect.any(Error));
  });

  it('tracks at most 100 messages, evicting the oldest', () => {
    const onError = jest.fn();
    const report = throttleErrors(onError);
    for (let i = 0; i < 101; i++) report(new Error(`m${i}`));
    report(new Error('m0'));
    report(new Error('m100'));

    expect(onError).toHaveBeenCalledTimes(102);
  });
});

describe('defaultFor', () => {
  it('reads own properties only', () => {
    expect(defaultFor({ on: true, off: false }, 'on')).toBe(true);
    expect(defaultFor({ on: true }, 'off')).toBe(false);
    expect(defaultFor(undefined, 'on')).toBe(false);
    expect(defaultFor({}, '__proto__')).toBe(false);
    expect(defaultFor({}, 'constructor')).toBe(false);
  });
});

describe('evaluateBounded', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns the client result', async () => {
    const client = fakeClient();
    await expect(evaluateBounded(client, 'f', { user_id: 'u' })).resolves.toEqual(ok('f'));
    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(client.evaluate).toHaveBeenCalledWith('f', { user_id: 'u' });
  });

  it('defaults to a 1000 ms bound and falls back to the default, reason error, on timeout', async () => {
    jest.useFakeTimers();
    const client = fakeClient(() => never());
    const reportError = jest.fn();

    const result = evaluateBounded(client, 'f', undefined, { reportError, defaults: { f: true } });
    await jest.advanceTimersByTimeAsync(DEFAULT_EVALUATION_TIMEOUT_MS - 1);
    expect(reportError).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ key: 'f', value: true, reason: 'error' });
    expect(DEFAULT_EVALUATION_TIMEOUT_MS).toBe(1000);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Flag evaluation (f) timed out after 1000ms' })
    );
    expect(client.evaluate).toHaveBeenCalledTimes(1);
  });

  it('honours timeoutMs', async () => {
    jest.useFakeTimers();
    const result = evaluateBounded(fakeClient(() => never()), 'f', undefined, {
      timeoutMs: 50,
      reportError: () => {},
    });
    await jest.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toMatchObject({ value: false, reason: 'error' });
  });

  it('falls back when evaluation rejects or throws, and calls onFailure', async () => {
    const reportError = jest.fn();
    const onFailure = jest.fn();
    const rejecting = fakeClient(async () => {
      throw new Error('boom');
    });
    const throwing = {
      evaluate: () => {
        throw 'not an error';
      },
      trackError: () => {},
    } as unknown as EvaluatingClient;

    await expect(evaluateBounded(rejecting, 'f', undefined, { reportError, onFailure })).resolves.toEqual({
      key: 'f',
      value: false,
      reason: 'error',
    });
    await expect(evaluateBounded(throwing, 'g', undefined, { reportError })).resolves.toMatchObject({
      reason: 'error',
    });
    expect(reportError.mock.calls.map(([e]) => e.message)).toEqual(['boom', 'not an error']);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });

  it('returns the fallback without a client', async () => {
    await expect(evaluateBounded(null, 'f', undefined, { defaults: { f: true } })).resolves.toEqual({
      key: 'f',
      value: true,
      reason: 'error',
    });
  });

  it('uses a custom fallback', async () => {
    const fallback = (key: string): FlagEvaluationResult => ({ key, value: false, reason: 'error', metadata: {} });
    await expect(evaluateBounded(null, 'f', undefined, { fallback })).resolves.toEqual(fallback('f'));
  });

  it('does not let a throwing reportError escape the timer', async () => {
    jest.useFakeTimers();
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = evaluateBounded(fakeClient(() => never()), 'f', undefined, {
      reportError: () => {
        throw new Error('reporter bug');
      },
    });
    await jest.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toMatchObject({ reason: 'error' });
    expect(log).toHaveBeenCalledWith('[Savvagent] onError handler threw', expect.any(Error));
  });
});

describe('createServerClient', () => {
  it('creates the client with server defaults and a throttled onError', () => {
    const configs: FlagClientConfig[] = [];
    class Ctor {
      evaluate = jest.fn();
      trackError = jest.fn();
      constructor(config: FlagClientConfig) {
        configs.push(config);
      }
    }
    const onError = jest.fn();
    const server = createServerClient(Ctor, { apiKey: 'sdk_x', onError });

    expect(server.client).toBeInstanceOf(Ctor);
    expect(server.timeoutMs).toBe(1000);
    expect(server.config.onError).toBe(onError);
    expect(configs[0]).toMatchObject({ enableRealtime: false, disableLanguageDetection: true, retryAttempts: 1 });
    expect(configs[0].onError).toBe(server.reportError);

    server.reportError(new Error('x'));
    server.reportError(new Error('x'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(createServerClient(Ctor, { apiKey: 'sdk_x' }, { evaluationTimeoutMs: 5 }).timeoutMs).toBe(5);
  });

  it('lets a constructor error propagate', () => {
    class Broken {
      evaluate = jest.fn();
      trackError = jest.fn();
      constructor() {
        throw new Error('bad key');
      }
    }
    expect(() => createServerClient(Broken, { apiKey: '' })).toThrow('bad key');
  });
});

describe('parseLanguage', () => {
  it('returns the first language tag without its weight', () => {
    expect(parseLanguage('de-DE,de;q=0.9,en;q=0.8')).toBe('de-DE');
    expect(parseLanguage('fr;q=0.9, en')).toBe('fr');
    expect(parseLanguage(' en ')).toBe('en');
    expect(parseLanguage('')).toBeUndefined();
    expect(parseLanguage(null)).toBeUndefined();
  });
});

describe('buildRequestContext', () => {
  const cookies = { user_id: 'forged', savvagent_anonymous_id: 'anon_1', session_id: 's1' };

  it('ignores the user_id cookie by default and does not even read it', () => {
    const get = jest.fn((name: string) => (cookies as Record<string, string>)[name]);

    expect(buildRequestContext({ cookies, acceptLanguage: 'en-US,en;q=0.9' })).toEqual({
      anonymous_id: 'anon_1',
      session_id: 's1',
      language: 'en-US',
    });
    expect(buildRequestContext({ cookies: get })).not.toHaveProperty('user_id');
    expect(get).not.toHaveBeenCalledWith('user_id');
  });

  it('reads the user_id cookie when trustUserIdCookie is set', () => {
    expect(buildRequestContext({ cookies, trustUserIdCookie: true }).user_id).toBe('forged');
  });

  it('lets overrides win, except undefined, null and empty values', () => {
    const context = buildRequestContext(
      { cookies, trustUserIdCookie: true },
      { user_id: 'explicit', session_id: undefined, anonymous_id: '', organization_id: 'org' }
    );
    expect(context).toEqual({ user_id: 'explicit', anonymous_id: 'anon_1', session_id: 's1', organization_id: 'org' });
  });

  it('puts defaultContext under the request values and merges attributes', () => {
    const context = buildRequestContext(
      { cookies: { session_id: 's1' }, defaultContext: { environment: 'staging', session_id: 'x', attributes: { a: 1 } } },
      { attributes: { b: 2 } }
    );
    expect(context).toEqual({ environment: 'staging', session_id: 's1', attributes: { a: 1, b: 2 } });
  });

  it('leaves out empty cookies and ignores inherited names', () => {
    expect(buildRequestContext({ cookies: { session_id: '', savvagent_anonymous_id: undefined } })).toEqual({});
    expect(buildRequestContext({ cookies: parseCookies('') })).toEqual({});
  });

  it('mergeContext copies the base', () => {
    const base = { user_id: 'u' };
    expect(mergeContext(base)).not.toBe(base);
  });
});

describe('resolveUserId', () => {
  afterEach(() => jest.useRealTimers());

  it('returns a non-empty string result', async () => {
    await expect(resolveUserId(() => 'u1')).resolves.toEqual({ userId: 'u1', failed: false });
    await expect(resolveUserId(async () => 'u2')).resolves.toEqual({ userId: 'u2', failed: false });
  });

  it('returns no user, not a failure, for undefined, null, empty or non-string results', async () => {
    for (const value of [undefined, null, '', 42]) {
      await expect(resolveUserId(() => value)).resolves.toEqual({ failed: false });
    }
    await expect(resolveUserId(undefined)).resolves.toEqual({ failed: false });
  });

  it('reports a throw or rejection with a fixed message and the original as cause', async () => {
    const reportError = jest.fn();
    const sync = await resolveUserId(
      () => {
        throw new Error('attacker text');
      },
      { reportError }
    );
    const rejected = await resolveUserId(() => Promise.reject(new Error('auth down')), { reportError });

    expect(sync).toEqual({ failed: true });
    expect(rejected).toEqual({ failed: true });
    expect(reportError.mock.calls[0][0].message).toBe('getUserId failed; evaluating without a user_id');
    expect(reportError.mock.calls[0][0].cause.message).toBe('attacker text');
    expect(reportError.mock.calls[1][0].cause.message).toBe('auth down');
  });

  it('gives up after the timeout (default 1000 ms)', async () => {
    jest.useFakeTimers();
    const reportError = jest.fn();
    const result = resolveUserId(() => never(), { reportError });
    await jest.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual({ failed: true });
    expect(reportError.mock.calls[0][0].message).toBe(
      'getUserId timed out after 1000ms; evaluating without a user_id'
    );
  });
});

describe('createRequestScope', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const trusted: FlagContext = { user_id: 'cookie-user', anonymous_id: 'anon_1' };

  it('evaluates with the request context merged with the call context', async () => {
    const client = fakeClient();
    const scope = createRequestScope({ client, context: { anonymous_id: 'anon_1', language: 'en' } });

    await scope.evaluate('f', { language: 'de', session_id: undefined, attributes: { plan: 'pro' } });

    expect(client.evaluate).toHaveBeenCalledWith('f', {
      anonymous_id: 'anon_1',
      language: 'de',
      attributes: { plan: 'pro' },
    });
  });

  it('calls getUserId once per scope, on the first evaluation, and uses its user', async () => {
    const client = fakeClient();
    const getUserId = jest.fn(async () => 'session-user');
    const scope = createRequestScope({ client, context: trusted, getUserId });
    expect(getUserId).not.toHaveBeenCalled();

    await scope.isEnabled('a');
    await scope.evaluateFlags(['b', 'c']);

    expect(getUserId).toHaveBeenCalledTimes(1);
    expect(client.evaluate.mock.calls.map(([, c]) => c?.user_id)).toEqual([
      'session-user',
      'session-user',
      'session-user',
    ]);
    expect(scope.context.user_id).toBe('session-user');
  });

  it('lets an explicit userId win over getUserId and the cookie; null means no user', async () => {
    const client = fakeClient();
    const getUserId = jest.fn(() => 'session-user');

    await createRequestScope({ client, context: trusted, getUserId, userId: 'explicit' }).evaluate('f');
    await createRequestScope({ client, context: trusted, getUserId, userId: null }).evaluate('f');

    expect(getUserId).not.toHaveBeenCalled();
    expect(client.evaluate.mock.calls[0][1]?.user_id).toBe('explicit');
    expect(client.evaluate.mock.calls[1][1]).not.toHaveProperty('user_id');
  });

  it('keeps the trusted cookie user when getUserId returns undefined', async () => {
    const client = fakeClient();
    await createRequestScope({ client, context: trusted, getUserId: () => undefined }).evaluate('f');
    expect(client.evaluate.mock.calls[0][1]?.user_id).toBe('cookie-user');
  });

  it('drops the trusted cookie user when getUserId hangs, and still evaluates', async () => {
    jest.useFakeTimers();
    const client = fakeClient();
    const reportError = jest.fn();
    const scope = createRequestScope({ client, context: trusted, getUserId: () => never(), reportError });

    const result = scope.evaluate('f');
    await jest.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual(ok('f'));
    expect(client.evaluate.mock.calls[0][1]).not.toHaveProperty('user_id');
    expect(client.evaluate.mock.calls[0][1]?.anonymous_id).toBe('anon_1');
    expect(reportError.mock.calls[0][0].message).toMatch(/getUserId timed out after 1000ms/);
  });

  it('drops the trusted cookie user when getUserId throws', async () => {
    const client = fakeClient();
    const reportError = jest.fn();
    await createRequestScope({
      client,
      context: trusted,
      reportError,
      getUserId: () => {
        throw new Error('auth down');
      },
    }).evaluate('f');

    expect(client.evaluate.mock.calls[0][1]).not.toHaveProperty('user_id');
    expect(reportError.mock.calls[0][0].message).toBe('getUserId failed; evaluating without a user_id');
  });

  it('bounds evaluations by evaluationTimeoutMs and falls back to the default', async () => {
    jest.useFakeTimers();
    const reportError = jest.fn();
    const scope = createRequestScope({
      client: fakeClient(() => never()),
      evaluationTimeoutMs: 200,
      defaults: { f: true },
      reportError,
    });

    const result = scope.evaluate('f');
    await jest.advanceTimersByTimeAsync(200);

    await expect(result).resolves.toEqual({ key: 'f', value: true, reason: 'error' });
    expect(reportError.mock.calls[0][0].message).toBe('Flag evaluation (f) timed out after 200ms');
  });

  it('does not let a throwing reportError escape the getUserId or evaluation timers', async () => {
    jest.useFakeTimers();
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const scope = createRequestScope({
      client: fakeClient(() => never()),
      context: trusted,
      getUserId: () => never(),
      reportError: () => {
        throw new Error('reporter bug');
      },
    });

    const result = scope.evaluate('f');
    await jest.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toMatchObject({ reason: 'error' });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('returns defaults without a client, runs withFlag callbacks for defaults that are on', async () => {
    const getUserId = jest.fn(() => 'u');
    const scope = createRequestScope({ client: null, defaults: { on: true }, getUserId });

    await expect(scope.evaluate('on')).resolves.toEqual({ key: 'on', value: true, reason: 'error' });
    await expect(scope.isEnabled('off')).resolves.toBe(false);
    await expect(scope.withFlag('on', () => 'ran')).resolves.toBe('ran');
    await expect(scope.withFlag('off', () => 'ran')).resolves.toBeNull();
    expect(() => scope.trackError('on', new Error('x'))).not.toThrow();
    expect(getUserId).not.toHaveBeenCalled();
  });

  it('withFlag tracks a callback error against the flag and re-throws it', async () => {
    const client = fakeClient();
    const scope = createRequestScope({ client, context: { anonymous_id: 'anon_1' } });
    const error = new Error('callback failed');

    await expect(
      scope.withFlag('f', () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(client.trackError).toHaveBeenCalledWith('f', error, { anonymous_id: 'anon_1' });
  });

  it('evaluateFlags keys results by flag key', async () => {
    const scope = createRequestScope({ client: fakeClient() });
    await expect(scope.evaluateFlags(['a', 'b'])).resolves.toEqual({ a: ok('a'), b: ok('b') });
  });

  it('resolveContext returns the merged context with the resolved user', async () => {
    const scope = createRequestScope({ client: fakeClient(), context: { anonymous_id: 'anon_1' }, getUserId: () => 'u' });
    await expect(scope.resolveContext({ language: 'en' })).resolves.toEqual({
      anonymous_id: 'anon_1',
      user_id: 'u',
      language: 'en',
    });
  });

  it('does not mutate the context it was given', async () => {
    const context: FlagContext = { anonymous_id: 'anon_1' };
    await createRequestScope({ client: fakeClient(), context, getUserId: () => 'u' }).evaluate('f');
    expect(context).toEqual({ anonymous_id: 'anon_1' });
  });
});
