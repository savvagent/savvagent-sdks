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
  type SavvagentLocals,
} from '../src/index';
import { FlagClient } from '@savvagent/sdk';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:4321/', { headers });
}

function makeContext(request: Request) {
  return { request, locals: {} as Record<string, unknown> };
}

describe('createSavvagentLocals', () => {
  beforeEach(() => {
    mockIsEnabled.mockReset();
    mockEvaluate.mockReset();
    mockWithFlag.mockReset();
    mockTrackError.mockReset();
  });

  const client = new FlagClient({ apiKey: 'sdk_test' });

  it('evaluates flags with context derived from the request', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const locals = createSavvagentLocals(
      client,
      makeRequest({ cookie: 'user_id=u-1; session_id=s-1', 'accept-language': 'fr-FR,en' })
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
    const locals = createSavvagentLocals(client, makeRequest({ cookie: 'user_id=u-1' }));

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
    mockWithFlag.mockResolvedValue('ran');
    const locals = createSavvagentLocals(client, makeRequest({ cookie: 'user_id=u-9' }));

    await expect(locals.evaluate('f')).resolves.toBe(result);
    expect(mockEvaluate).toHaveBeenCalledWith('f', { user_id: 'u-9' });

    const cb = () => 'ran';
    await expect(locals.withFlag('f', cb)).resolves.toBe('ran');
    expect(mockWithFlag).toHaveBeenCalledWith('f', cb, { user_id: 'u-9' });

    const err = new Error('boom');
    locals.trackError('f', err);
    expect(mockTrackError).toHaveBeenCalledWith('f', err, { user_id: 'u-9' });

    expect(locals.client).toBe(client);
    expect(locals.context).toEqual({ user_id: 'u-9' });
  });
});

describe('createSavvagentMiddleware', () => {
  it('sets context.locals.savvagent and calls next', async () => {
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
    expect(mockIsEnabled).toHaveBeenLastCalledWith('new-feature', { user_id: 'u-5' });
    expect(locals.client).toBe(getSavvagent());
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
  function runSetup(config: Parameters<typeof savvagent>[0]['config']) {
    const addMiddleware = vi.fn();
    const updateConfig = vi.fn();
    const integration = savvagent({ config });
    const setup = integration.hooks['astro:config:setup'] as (opts: unknown) => void;
    setup({ addMiddleware, updateConfig });
    return { addMiddleware, updateConfig, integration };
  }

  it('registers the Savvagent middleware to run before user middleware', () => {
    const { addMiddleware } = runSetup({ apiKey: 'sdk_x' });
    expect(addMiddleware).toHaveBeenCalledWith({
      entrypoint: '@savvagent/astro/middleware',
      order: 'pre',
    });
  });

  it('serves the integration config to the middleware through a virtual module', async () => {
    const { updateConfig } = runSetup({
      apiKey: 'sdk_x',
      baseUrl: 'https://flags.example.com',
      applicationId: 'app-1',
    });

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

    const code = plugin.load(resolved as string);
    expect(code).toContain('export default');
    const json = (code as string).replace(/^export default\s*/, '').replace(/;\s*$/, '');
    expect(JSON.parse(json)).toEqual({
      apiKey: 'sdk_x',
      baseUrl: 'https://flags.example.com',
      applicationId: 'app-1',
    });
    expect(plugin.load('some-other-module')).toBeUndefined();
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
  it('turns realtime off by default for the server-side client', () => {
    expect(toServerConfig({ apiKey: 'sdk_x' })).toEqual({ apiKey: 'sdk_x', enableRealtime: false });
  });

  it('keeps an explicit enableRealtime setting', () => {
    expect(toServerConfig({ apiKey: 'sdk_x', enableRealtime: true })).toEqual({
      apiKey: 'sdk_x',
      enableRealtime: true,
    });
  });
});
