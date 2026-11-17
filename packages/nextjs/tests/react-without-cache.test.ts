/**
 * @jest-environment node
 *
 * React exports `cache` only under the `react-server` condition. In the Pages
 * Router, or with React 18 outside Server Components, it is missing, and
 * importing @savvagent/nextjs/server must still work.
 */

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

jest.mock('react', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cache, ...withoutCache } = jest.requireActual('react');
  return withoutCache;
});

const ok = { key: 'flag', value: true, reason: 'evaluated' as const };

describe('@savvagent/nextjs/server without React cache', () => {
  afterEach(() => jest.restoreAllMocks());

  it('imports, and evaluates a new visitor with a fresh anonymous ID per call', async () => {
    expect(require('react').cache).toBeUndefined();
    let server!: typeof import('../src/server');
    let FlagClient!: typeof import('@savvagent/sdk').FlagClient;
    let nextHeaders!: { cookies: jest.Mock; headers: jest.Mock };
    expect(() =>
      jest.isolateModules(() => {
        nextHeaders = require('next/headers');
        server = require('../src/server');
        FlagClient = require('@savvagent/sdk').FlagClient;
      })
    ).not.toThrow();
    const set = jest.fn();
    nextHeaders.cookies.mockResolvedValue({ get: () => undefined, set });
    nextHeaders.headers.mockResolvedValue({ get: () => null });
    server.initServerClient({ apiKey: 'sdk_test' });
    const evaluate = jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue(ok);

    await expect(server.isEnabled('a')).resolves.toBe(true);
    await expect(server.isEnabled('b')).resolves.toBe(true);

    const ids = evaluate.mock.calls.map(([, context]) => context?.anonymous_id);
    expect(ids[0]).toMatch(/^anon_/);
    expect(ids[1]).toMatch(/^anon_/);
    expect(ids[1]).not.toBe(ids[0]);
    expect(set).toHaveBeenCalledWith('savvagent_anonymous_id', ids[0], expect.objectContaining({ httpOnly: false }));
  });
});
