/**
 * A config the FlagClient rejects must not turn every request into a 500:
 * the middleware reports it once and serves flag defaults. Own file so the
 * client singleton starts empty.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@savvagent/sdk', () => {
  class MockFlagClient {
    constructor() {
      throw new Error('Invalid API key. SDK keys must start with "sdk_"');
    }
  }
  return { FlagClient: MockFlagClient };
});

import { createSavvagentMiddleware, type SavvagentLocals } from '../src/index';

describe('middleware with an invalid config', () => {
  it('serves defaults and reports the failure once', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onRequest = createSavvagentMiddleware({
      apiKey: 'bad',
      defaults: { 'new-feature': true },
    });

    for (let i = 0; i < 2; i++) {
      const context = {
        request: new Request('http://localhost/'),
        isPrerendered: false,
        cookies: { get: () => undefined, set: vi.fn() },
        locals: {} as Record<string, unknown>,
      };
      const response = await onRequest(context as never, async () => new Response('ok'));
      expect((response as Response).status).toBe(200);
      const locals = context.locals.savvagent as SavvagentLocals;
      expect(locals.client).toBeNull();
      await expect(locals.isEnabled('new-feature')).resolves.toBe(true);
      // Inherited property names are never defaults.
      for (const key of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
        await expect(locals.isEnabled(key)).resolves.toBe(false);
        expect((await locals.evaluate(key)).value).toBe(false);
      }
    }

    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
