/**
 * Tests for the `@savvagent/astro/middleware` entrypoint that the
 * integration registers with `addMiddleware`. Runs in its own file so the
 * client singleton starts empty.
 */

import { describe, it, expect, vi } from 'vitest';

const constructedConfigs: unknown[] = [];

vi.mock('@savvagent/sdk', () => {
  class MockFlagClient {
    isEnabled = vi.fn().mockResolvedValue(true);
    constructor(config: unknown) {
      constructedConfigs.push(config);
    }
  }
  return { FlagClient: MockFlagClient };
});

import { onRequest } from '../src/middleware';

describe('@savvagent/astro/middleware', () => {
  it('provides Astro.locals.savvagent using the integration config', async () => {
    const context = {
      request: new Request('http://localhost:4321/', { headers: { cookie: 'user_id=u-7' } }),
      locals: {} as Record<string, any>,
    };
    const next = vi.fn().mockResolvedValue(new Response('ok'));

    await onRequest(context as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.locals.savvagent).toBeDefined();
    await expect(context.locals.savvagent.isEnabled('new-feature')).resolves.toBe(true);

    expect(constructedConfigs).toHaveLength(1);
    // Realtime (SSE) needs browser globals, so it is off by default on the server.
    expect(constructedConfigs[0]).toEqual({
      apiKey: 'sdk_fixture',
      applicationId: 'fixture-app',
      enableRealtime: false,
    });
  });
});
