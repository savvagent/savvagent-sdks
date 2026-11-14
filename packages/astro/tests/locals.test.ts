/**
 * Tests for the request-scoped `Astro.locals.savvagent` API (issue #3):
 * the integration must register middleware that provides it, and the
 * middleware must populate it on every request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsEnabled = vi.fn();
const mockEvaluate = vi.fn();
const mockWithFlag = vi.fn();
const mockTrackError = vi.fn();
const mockClose = vi.fn();

vi.mock('@savvagent/sdk', () => {
  class MockFlagClient {
    isEnabled = mockIsEnabled;
    evaluate = mockEvaluate;
    withFlag = mockWithFlag;
    trackError = mockTrackError;
    close = mockClose;
  }
  return { FlagClient: MockFlagClient };
});

import savvagent, {
  createSavvagentLocals,
  createSavvagentMiddleware,
  getSavvagent,
  SAVVAGENT_CONFIG_MODULE_ID,
  toServerConfig,
  toImportPath,
  newAnonymousId,
  getRequestContext,
  ANONYMOUS_ID_COOKIE,
  type SavvagentLocals,
} from '../src/index';
import { FlagClient } from '@savvagent/sdk';
import { fileURLToPath } from 'node:url';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:4321/', { headers });
}

function makeCookies(request: Request) {
  const jar = new Map<string, string>();
  for (const part of (request.headers.get('cookie') ?? '').split('; ')) {
    const [key, ...rest] = part.split('=');
    if (key) jar.set(key, rest.join('='));
  }
  return {
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: vi.fn((name: string, value: string) => void jar.set(name, value)),
  };
}

function makeContext(request: Request, isPrerendered = false) {
  return {
    request,
    url: new URL(request.url),
    isPrerendered,
    cookies: makeCookies(request),
    locals: {} as Record<string, unknown>,
  };
}

describe('createSavvagentLocals', () => {
  beforeEach(() => {
    mockIsEnabled.mockReset();
    mockEvaluate.mockReset();
    mockWithFlag.mockReset();
    mockTrackError.mockReset();
  });

  const client = new FlagClient({ apiKey: 'sdk_test' });

  it('ignores the user_id cookie by default, since the browser controls it (#23)', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const locals = createSavvagentLocals(
      client,
      makeRequest({ cookie: 'user_id=u-1; session_id=s-1', 'accept-language': 'fr-FR,en' })
    );

    await locals.isEnabled('new-feature');
    expect(mockIsEnabled).toHaveBeenCalledWith('new-feature', { session_id: 's-1', language: 'fr-FR' });
    expect(locals.context).not.toHaveProperty('user_id');
  });

  it('evaluates flags with context derived from the request, user_id cookie included when trusted', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const locals = createSavvagentLocals(
      client,
      makeRequest({ cookie: 'user_id=u-1; session_id=s-1', 'accept-language': 'fr-FR,en' }),
      { trustUserIdCookie: true }
    );

    await expect(locals.isEnabled('new-feature')).resolves.toBe(true);
    expect(mockIsEnabled).toHaveBeenCalledWith('new-feature', {
      user_id: 'u-1',
      session_id: 's-1',
      language: 'fr-FR',
    });
  });

  it('lets per-call context override and extend the request context', async () => {
    mockIsEnabled.mockResolvedValue(false);
    const locals = createSavvagentLocals(client, makeRequest({ cookie: 'user_id=u-1' }), {
      trustUserIdCookie: true,
    });

    await locals.isEnabled('beta-feature', {
      user_id: 'u-2',
      attributes: { plan: 'pro' },
    });

    expect(mockIsEnabled).toHaveBeenCalledWith('beta-feature', {
      user_id: 'u-2',
      attributes: { plan: 'pro' },
    });
  });

  it('does not pass undefined request fields that would mask client defaults', async () => {
    mockIsEnabled.mockResolvedValue(false);
    const locals = createSavvagentLocals(client, makeRequest());

    await locals.isEnabled('new-feature');

    const passed = mockIsEnabled.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.values(passed)).not.toContain(undefined);
    expect(passed).not.toHaveProperty('anonymous_id');
  });

  it('exposes evaluate, withFlag, trackError, the client and the request context', async () => {
    const result = { key: 'f', value: true, reason: 'default' };
    mockEvaluate.mockResolvedValue(result);
    mockIsEnabled.mockResolvedValue(true);
    const locals = createSavvagentLocals(client, makeRequest({ cookie: 'user_id=u-9' }), {
      trustUserIdCookie: true,
    });

    await expect(locals.evaluate('f')).resolves.toBe(result);
    expect(mockEvaluate).toHaveBeenCalledWith('f', { user_id: 'u-9' });

    // withFlag evaluates through the bounded isEnabled, then runs the callback.
    const cb = vi.fn(() => 'ran');
    await expect(locals.withFlag('f', cb)).resolves.toBe('ran');
    expect(mockIsEnabled).toHaveBeenCalledWith('f', { user_id: 'u-9' });
    expect(cb).toHaveBeenCalledTimes(1);

    const err = new Error('boom');
    locals.trackError('f', err);
    expect(mockTrackError).toHaveBeenCalledWith('f', err, { user_id: 'u-9' });

    expect(locals.client).toBe(client);
    expect(locals.context).toEqual({ user_id: 'u-9' });
  });
});

describe('withFlag errors', () => {
  it('tracks a throwing callback exactly once and re-throws it', async () => {
    mockIsEnabled.mockReset();
    mockTrackError.mockReset();
    mockIsEnabled.mockResolvedValue(true);
    const client = new FlagClient({ apiKey: 'sdk_test' });
    const locals = createSavvagentLocals(client, makeRequest({ cookie: 'session_id=s-1' }));
    const boom = new Error('boom');

    await expect(
      locals.withFlag('f', () => {
        throw boom;
      }, { attributes: { plan: 'pro' } })
    ).rejects.toBe(boom);

    expect(mockTrackError).toHaveBeenCalledTimes(1);
    expect(mockTrackError).toHaveBeenCalledWith('f', boom, {
      session_id: 's-1',
      attributes: { plan: 'pro' },
    });
  });

  it('does not run or track the callback when the flag is off', async () => {
    mockIsEnabled.mockReset();
    mockTrackError.mockReset();
    mockIsEnabled.mockResolvedValue(false);
    const client = new FlagClient({ apiKey: 'sdk_test' });
    const callback = vi.fn();

    await expect(createSavvagentLocals(client, makeRequest()).withFlag('f', callback)).resolves.toBeNull();
    expect(callback).not.toHaveBeenCalled();
    expect(mockTrackError).not.toHaveBeenCalled();
  });
});

describe('createSavvagentMiddleware', () => {
  it('sets context.locals.savvagent and calls next, ignoring the user_id cookie by default', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' });
    const context = makeContext(makeRequest({ cookie: 'user_id=u-5' }));
    const response = new Response('ok');
    const next = vi.fn().mockResolvedValue(response);

    await expect(onRequest(context as never, next)).resolves.toBe(response);
    expect(next).toHaveBeenCalledTimes(1);

    const locals = context.locals.savvagent as SavvagentLocals;
    expect(locals).toBeDefined();
    await expect(locals.isEnabled('new-feature')).resolves.toBe(true);
    expect(mockIsEnabled).toHaveBeenLastCalledWith('new-feature', {
      anonymous_id: expect.any(String),
    });
    expect(locals.client).toBe(getSavvagent());
  });

  it('reads the user_id cookie when trustUserIdCookie is set', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' }, { trustUserIdCookie: true });
    const context = makeContext(makeRequest({ cookie: 'user_id=u-5' }));
    await onRequest(context as never, async () => new Response('ok'));

    await (context.locals.savvagent as SavvagentLocals).isEnabled('new-feature');
    expect(mockIsEnabled).toHaveBeenLastCalledWith('new-feature', {
      user_id: 'u-5',
      anonymous_id: expect.any(String),
    });
  });

  it('prefers getUserId over the trusted cookie and passes it the request and locals', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const getUserId = vi.fn(({ locals }: { locals: Record<string, unknown> }) => locals.sessionUser as string);
    const onRequest = createSavvagentMiddleware(
      { apiKey: 'sdk_mw' },
      { trustUserIdCookie: true, getUserId: getUserId as never }
    );
    const context = makeContext(makeRequest({ cookie: 'user_id=u-cookie' }));
    await onRequest(context as never, async () => {
      // Set by the app's own auth middleware, which runs after Savvagent's.
      context.locals.sessionUser = 'u-session';
      const savvagent = context.locals.savvagent as SavvagentLocals;
      await savvagent.isEnabled('a');
      await savvagent.isEnabled('b');
      return new Response('ok');
    });

    expect(mockIsEnabled).toHaveBeenLastCalledWith('b', {
      user_id: 'u-session',
      anonymous_id: expect.any(String),
    });
    // Resolved once per request.
    expect(getUserId).toHaveBeenCalledTimes(1);
    expect(getUserId.mock.calls[0][0]).toMatchObject({ request: context.request, locals: context.locals });
    expect((context.locals.savvagent as SavvagentLocals).context.user_id).toBe('u-session');
  });

  it('reports a failing getUserId through the throttled onError once across requests', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const onError = vi.fn();
    const onRequest = createSavvagentMiddleware(
      { apiKey: 'sdk_mw', onError },
      { getUserId: async () => Promise.reject(new Error('auth down')) }
    );
    for (let i = 0; i < 3; i++) {
      const context = makeContext(makeRequest());
      await onRequest(context as never, async () => new Response('ok'));
      await expect((context.locals.savvagent as SavvagentLocals).isEnabled('a')).resolves.toBe(true);
      expect(mockIsEnabled.mock.calls.at(-1)?.[1]).not.toHaveProperty('user_id');
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('auth down');
  });

  it('gives two requests through one middleware their own getUserId users', async () => {
    mockIsEnabled.mockReset();
    mockIsEnabled.mockResolvedValue(true);
    const onRequest = createSavvagentMiddleware(
      { apiKey: 'sdk_mw' },
      { getUserId: ({ request }) => request.headers.get('x-test-user') ?? undefined }
    );
    const alice = makeContext(makeRequest({ 'x-test-user': 'alice' }));
    const bob = makeContext(makeRequest({ 'x-test-user': 'bob' }));
    const next = async () => new Response('ok');
    await onRequest(alice as never, next);
    await onRequest(bob as never, next);

    // Evaluate interleaved, so a shared scope would show up as a leak.
    await Promise.all([
      (alice.locals.savvagent as SavvagentLocals).isEnabled('f'),
      (bob.locals.savvagent as SavvagentLocals).isEnabled('f'),
    ]);

    const users = mockIsEnabled.mock.calls.map(([, context]) => context.user_id).sort();
    expect(users).toEqual(['alice', 'bob']);
    expect((alice.locals.savvagent as SavvagentLocals).context.user_id).toBe('alice');
    expect((bob.locals.savvagent as SavvagentLocals).context.user_id).toBe('bob');
    expect((alice.locals.savvagent as SavvagentLocals).context.anonymous_id).not.toBe(
      (bob.locals.savvagent as SavvagentLocals).context.anonymous_id
    );
  });

  it('falls back to no user_id when getUserId returns nothing and the cookie is not trusted', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' }, { getUserId: () => undefined });
    const context = makeContext(makeRequest({ cookie: 'user_id=u-cookie' }));
    await onRequest(context as never, async () => new Response('ok'));
    await (context.locals.savvagent as SavvagentLocals).isEnabled('a');
    expect(mockIsEnabled.mock.calls.at(-1)?.[1]).not.toHaveProperty('user_id');
  });

  it('sets locals before next() runs, so pages can read them', async () => {
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' });
    const context = makeContext(makeRequest());
    let seenDuringNext: unknown;
    await onRequest(context as never, async () => {
      seenDuringNext = context.locals.savvagent;
      return new Response('ok');
    });
    expect(seenDuringNext).toBeDefined();
  });

  it('reuses one client across requests', async () => {
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' });
    const a = makeContext(makeRequest());
    const b = makeContext(makeRequest());
    const next = vi.fn().mockResolvedValue(new Response('ok'));
    await onRequest(a as never, next);
    await onRequest(b as never, next);
    expect((a.locals.savvagent as SavvagentLocals).client).toBe(
      (b.locals.savvagent as SavvagentLocals).client
    );
  });
});

describe('integration wiring', () => {
  async function runSetup(options: Parameters<typeof savvagent>[0]) {
    const addMiddleware = vi.fn();
    const updateConfig = vi.fn();
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const integration = savvagent(options);
    const setup = integration.hooks['astro:config:setup'] as (opts: unknown) => Promise<void>;
    await setup({
      addMiddleware,
      updateConfig,
      logger,
      config: { root: new URL('./fixtures/', import.meta.url) },
    });
    const plugin = updateConfig.mock.calls[0][0].vite.plugins[0] as {
      resolveId: (id: string) => string | undefined;
      load: (id: string) => string | undefined;
    };
    const virtualCode = plugin.load(plugin.resolveId(SAVVAGENT_CONFIG_MODULE_ID) as string) as string;
    return { addMiddleware, updateConfig, logger, integration, virtualCode };
  }

  it('registers the Savvagent middleware to run before user middleware', async () => {
    const { addMiddleware } = await runSetup({ config: { apiKey: 'sdk_x' } });
    expect(addMiddleware).toHaveBeenCalledWith({
      entrypoint: '@savvagent/astro/middleware',
      order: 'pre',
    });
  });

  it('serves the integration config to the middleware through a virtual module', async () => {
    const { updateConfig, logger } = await runSetup({
      config: {
        apiKey: 'sdk_x',
        baseUrl: 'https://flags.example.com',
        applicationId: 'app-1',
      },
    });
    // An inline apiKey ends up in the server bundle, so the integration says so.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('server bundle'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('configModule'));
    expect(logger.error).not.toHaveBeenCalled();

    const plugins = updateConfig.mock.calls[0][0].vite.plugins as Array<{
      name: string;
      resolveId: (id: string) => string | undefined;
      load: (id: string) => string | undefined;
    }>;
    expect(plugins).toHaveLength(1);
    const plugin = plugins[0];

    const resolved = plugin.resolveId(SAVVAGENT_CONFIG_MODULE_ID);
    expect(resolved).toBeTruthy();
    expect(plugin.resolveId('some-other-module')).toBeUndefined();

    const code = plugin.load(resolved as string) as string;
    const json = code.match(/^export default (.*);$/m)?.[1] as string;
    expect(JSON.parse(json)).toEqual({
      apiKey: 'sdk_x',
      baseUrl: 'https://flags.example.com',
      applicationId: 'app-1',
    });
    expect(plugin.load('some-other-module')).toBeUndefined();
  });

  it('re-exports configModule from the virtual module, resolved against the project root', async () => {
    const { virtualCode, logger } = await runSetup({ configModule: './runtime-config.mjs' });
    const expected = fileURLToPath(new URL('./fixtures/runtime-config.mjs', import.meta.url));
    expect(virtualCode).toBe(
      `export { default } from ${JSON.stringify(expected)};\n` +
        'export const getUserId = undefined;\n' +
        'export const options = {};'
    );
    // The module is valid, so nothing is reported.
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('prefers configModule over config', async () => {
    const { virtualCode } = await runSetup({
      configModule: './runtime-config.mjs',
      config: { apiKey: 'sdk_inline' },
    });
    expect(virtualCode).toContain('export { default } from');
    expect(virtualCode).not.toContain('sdk_inline');
  });

  it('re-exports getUserId from configModule when the module defines it', async () => {
    const { virtualCode, logger } = await runSetup({ configModule: './get-user-id-config.mjs' });
    const expected = fileURLToPath(new URL('./fixtures/get-user-id-config.mjs', import.meta.url));
    expect(virtualCode).toContain(`export { default, getUserId } from ${JSON.stringify(expected)};`);
    expect(virtualCode).not.toContain('export const getUserId');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads getUserId from the module namespace when the module cannot be loaded at startup', async () => {
    const { virtualCode } = await runSetup({ configModule: './does-not-exist.mjs' });
    expect(virtualCode).toContain('import * as configModule from');
    expect(virtualCode).toContain('export const getUserId = configModule.getUserId;');
  });

  it('serves trustUserIdCookie and evaluationTimeoutMs to the middleware', async () => {
    const { virtualCode } = await runSetup({
      config: { apiKey: 'sdk_x' },
      trustUserIdCookie: true,
      evaluationTimeoutMs: 250,
    });
    expect(virtualCode).toContain('export const options = {"trustUserIdCookie":true,"evaluationTimeoutMs":250};');
    expect(virtualCode).toContain('export const getUserId = undefined;');
  });

  it('does not warn about the server bundle for configModule', async () => {
    const { logger } = await runSetup({ configModule: './runtime-config.mjs' });
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('server bundle'));
  });

  it('warns (not errors) about an invalid configModule, since it is checked again at runtime', async () => {
    const { logger } = await runSetup({ configModule: './invalid-config.mjs' });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('apiKey'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('checked again at server runtime'));
  });

  it('warns when configModule cannot be loaded for validation', async () => {
    const { logger, addMiddleware } = await runSetup({ configModule: './does-not-exist.mjs' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does-not-exist.mjs'));
    expect(addMiddleware).toHaveBeenCalled();
  });

  it('reports a missing or invalid apiKey in the JSON config with logger.error', async () => {
    const missing = await runSetup({ config: { apiKey: '' } });
    expect(missing.logger.error).toHaveBeenCalledWith(expect.stringContaining('`apiKey` is missing'));
    const wrong = await runSetup({ config: { apiKey: 'pk_live_123' } });
    expect(wrong.logger.error).toHaveBeenCalledWith(expect.stringContaining('sdk_'));
    const none = await runSetup({});
    expect(none.logger.error).toHaveBeenCalled();
  });

  it('warns about function-valued config keys dropped from the JSON config', async () => {
    const { logger, virtualCode } = await runSetup({
      config: { apiKey: 'sdk_x', onError: () => {} },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('onError'));
    expect(virtualCode).not.toContain('onError');
  });

  it('injects App.Locals types for consumers', () => {
    const integration = savvagent({ config: { apiKey: 'sdk_x' } });
    const injectTypes = vi.fn();
    const done = integration.hooks['astro:config:done'] as (opts: unknown) => void;
    done({ injectTypes });
    expect(injectTypes).toHaveBeenCalledWith({
      filename: 'types.d.ts',
      content: expect.stringContaining('@savvagent/astro'),
    });
  });
});

describe('toServerConfig', () => {
  it('turns off realtime, language detection and retries by default for the server-side client', () => {
    expect(toServerConfig({ apiKey: 'sdk_x' })).toEqual({
      apiKey: 'sdk_x',
      enableRealtime: false,
      disableLanguageDetection: true,
      retryAttempts: 1,
    });
  });

  it('keeps explicit settings', () => {
    expect(
      toServerConfig({
        apiKey: 'sdk_x',
        enableRealtime: true,
        disableLanguageDetection: false,
        retryAttempts: 3,
      })
    ).toEqual({
      apiKey: 'sdk_x',
      enableRealtime: true,
      disableLanguageDetection: false,
      retryAttempts: 3,
    });
  });
});

describe('anonymous ID and prerendering', () => {
  it('gives a visitor without the cookie a fresh anonymous ID and sets the cookie', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' });
    const a = makeContext(makeRequest());
    const b = makeContext(makeRequest());
    const next = vi.fn().mockResolvedValue(new Response('ok'));
    await onRequest(a as never, next);
    await onRequest(b as never, next);

    const idA = (a.locals.savvagent as SavvagentLocals).context.anonymous_id;
    const idB = (b.locals.savvagent as SavvagentLocals).context.anonymous_id;
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
    expect(a.cookies.set).toHaveBeenCalledWith(
      ANONYMOUS_ID_COOKIE,
      idA,
      expect.objectContaining({ path: '/', sameSite: 'lax' })
    );

    await (a.locals.savvagent as SavvagentLocals).isEnabled('f');
    expect(mockIsEnabled).toHaveBeenLastCalledWith('f', { anonymous_id: idA });
  });

  it('keeps the anonymous ID from an existing cookie', async () => {
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' });
    const context = makeContext(makeRequest({ cookie: `${ANONYMOUS_ID_COOKIE}=anon-1` }));
    await onRequest(context as never, async () => new Response('ok'));
    expect(context.cookies.set).not.toHaveBeenCalled();
    expect((context.locals.savvagent as SavvagentLocals).context.anonymous_id).toBe('anon-1');
  });

  it('reads no headers or cookies on prerendered pages', async () => {
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' });
    const request = makeRequest({ cookie: 'user_id=u-1', 'accept-language': 'fr' });
    const context = makeContext(request, true);
    const headersGet = vi.spyOn(request.headers, 'get');
    await onRequest(context as never, async () => new Response('ok'));

    expect(headersGet).not.toHaveBeenCalled();
    expect(context.cookies.set).not.toHaveBeenCalled();
    expect((context.locals.savvagent as SavvagentLocals).context).toEqual({});
  });
});

describe('getRequestContext cookie decoding', () => {
  it('URL-decodes cookie values', () => {
    const context = getRequestContext(
      makeRequest({ cookie: 'user_id=user%40example.com; session_id=a%20b' }),
      undefined,
      { trustUserIdCookie: true }
    );
    expect(context.user_id).toBe('user@example.com');
    expect(context.session_id).toBe('a b');
  });

  it('keeps malformed encodings as-is', () => {
    expect(getRequestContext(makeRequest({ cookie: 'user_id=%E0%A4%A' }), undefined, { trustUserIdCookie: true }).user_id).toBe('%E0%A4%A');
  });
});

describe('createSavvagentLocals without a client', () => {
  it('returns defaults instead of throwing', async () => {
    const locals = createSavvagentLocals(null, makeRequest(), { defaults: { on: true } });
    await expect(locals.isEnabled('on')).resolves.toBe(true);
    await expect(locals.isEnabled('off')).resolves.toBe(false);
    await expect(locals.evaluate('on')).resolves.toMatchObject({ value: true, reason: 'error' });
    await expect(locals.withFlag('off', () => 'x')).resolves.toBeNull();
    expect(() => locals.trackError('on', new Error('e'))).not.toThrow();
    expect(locals.client).toBeNull();
  });
});

describe('anonymous ID cookie attributes and source', () => {
  it('sets a non-HttpOnly cookie, Secure only over https', async () => {
    const onRequest = createSavvagentMiddleware({ apiKey: 'sdk_mw' });
    const http = makeContext(makeRequest());
    await onRequest(http as never, async () => new Response('ok'));
    expect(http.cookies.set.mock.calls[0][2]).toMatchObject({ secure: false, httpOnly: false });

    const https = makeContext(new Request('https://example.com/'));
    await onRequest(https as never, async () => new Response('ok'));
    expect(https.cookies.set.mock.calls[0][2]).toMatchObject({ secure: true, httpOnly: false });
  });

  it('generates IDs from crypto, never Math.random, even without globalThis.crypto', async () => {
    const random = vi.spyOn(Math, 'random');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    // Same `anon_` format as the browser SDK and @savvagent/react-router.
    expect(await newAnonymousId()).toMatch(/^anon_[0-9a-f-]{36}$/);
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const a = await newAnonymousId();
      const b = await newAnonymousId();
      expect(a).toMatch(/^anon_[0-9a-f-]{32,36}$/);
      expect(a).not.toBe(b);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
    expect(random).not.toHaveBeenCalled();
  });
});

describe('toImportPath', () => {
  it('turns Windows separators into forward slashes', () => {
    expect(toImportPath('C:\\proj\\src\\savvagent.config.mjs')).toBe('C:/proj/src/savvagent.config.mjs');
    expect(toImportPath('/proj/src/savvagent.config.mjs')).toBe('/proj/src/savvagent.config.mjs');
  });
});
