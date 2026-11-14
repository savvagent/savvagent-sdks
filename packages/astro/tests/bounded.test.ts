/**
 * Server-side evaluations through `Astro.locals.savvagent` are bounded: an
 * unreachable or hanging Flags API must not hold up a page. Uses the real
 * FlagClient (no SDK mock) with a stubbed `fetch`, in its own file so the
 * client singleton starts empty.
 */

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import {
  createSavvagentLocals,
  createSavvagentMiddleware,
  getSavvagent,
  throttleErrors,
  type SavvagentLocals,
} from '../src/index';
import { FlagClient } from '@savvagent/sdk';

type FetchMode = 'unavailable' | 'hang';
let mode: FetchMode = 'unavailable';
const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
  if (mode === 'unavailable') return Promise.resolve(new Response('down', { status: 503 }));
  // Never answers; rejects only when the SDK's own 10 s timeout aborts it.
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
});

const onError = vi.fn();
const TIMEOUT_MS = 200;
const onRequest = createSavvagentMiddleware(
  {
    apiKey: 'sdk_bounded',
    baseUrl: 'https://flags.invalid',
    enableTelemetry: false,
    defaults: { 'on-by-default': true },
    onError,
  },
  { evaluationTimeoutMs: TIMEOUT_MS }
);

function makeContext() {
  return {
    request: new Request('http://localhost:4321/'),
    url: new URL('http://localhost:4321/'),
    isPrerendered: false,
    cookies: { get: () => undefined, set: vi.fn() },
    locals: {} as Record<string, unknown>,
  };
}

async function locals(): Promise<SavvagentLocals> {
  const context = makeContext();
  await onRequest(context as never, async () => new Response('ok'));
  return context.locals.savvagent as SavvagentLocals;
}

describe('bounded server-side evaluation', () => {
  vi.stubGlobal('fetch', fetchMock);

  afterEach(() => {
    fetchMock.mockClear();
  });

  afterAll(() => {
    getSavvagent().close();
    vi.unstubAllGlobals();
  });

  it('falls back to the default after one attempt when the Flags API returns 503', async () => {
    mode = 'unavailable';
    const savvagent = await locals();
    const started = Date.now();

    await expect(savvagent.evaluate('on-by-default')).resolves.toMatchObject({
      key: 'on-by-default',
      value: true,
      reason: 'error',
    });
    await expect(savvagent.isEnabled('off-by-default')).resolves.toBe(false);

    // No retries with backoff: one request per evaluation, well inside the bound.
    expect(Date.now() - started).toBeLessThan(TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // One report per distinct message (the SDK's message names the flag).
    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      'Flag evaluation (on-by-default) failed: 503',
      'Flag evaluation (off-by-default) failed: 503',
    ]);

    // Later requests fail the same way; onError is not called again.
    for (let i = 0; i < 4; i++) {
      await (await locals()).isEnabled('off-by-default');
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('falls back within about the timeout when the Flags API hangs', async () => {
    mode = 'hang';
    onError.mockClear();
    const savvagent = await locals();
    const started = Date.now();

    const [evaluated, enabled, ran] = await Promise.all([
      savvagent.evaluate('hang-a'),
      savvagent.isEnabled('on-by-default'),
      savvagent.withFlag('hang-b', () => 'ran'),
    ]);

    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 20);
    expect(elapsed).toBeLessThan(TIMEOUT_MS + 500);
    expect(evaluated).toEqual({ key: 'hang-a', value: false, reason: 'error' });
    expect(enabled).toBe(true);
    expect(ran).toBeNull();
    // One timeout message per flag key, each reported once.
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onError.mock.calls[0][0].message).toMatch(/timed out after 200ms/);
  });
});

describe('evaluation timer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is cleared when the evaluation settles first', async () => {
    vi.useFakeTimers();
    const client = { isEnabled: vi.fn().mockResolvedValue(true), evaluate: vi.fn() } as unknown as FlagClient;
    const savvagent = createSavvagentLocals(client, new Request('http://localhost/'));

    await expect(savvagent.isEnabled('f')).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves with the default at the timeout and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const reportError = vi.fn();
    const client = {
      evaluate: vi.fn(() => new Promise(() => {})),
      isEnabled: vi.fn(() => new Promise(() => {})),
    } as unknown as FlagClient;
    const savvagent = createSavvagentLocals(client, new Request('http://localhost/'), {
      defaults: { f: true },
      evaluationTimeoutMs: 1000,
      reportError,
    });

    const result = savvagent.evaluate('f');
    await vi.advanceTimersByTimeAsync(999);
    expect(reportError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ key: 'f', value: true, reason: 'error' });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('getUserId isolation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const makeClient = () =>
    ({ isEnabled: vi.fn().mockResolvedValue(true), evaluate: vi.fn() }) as unknown as FlagClient & {
      isEnabled: ReturnType<typeof vi.fn>;
    };

  it('bounds a slow getUserId and evaluates without a user_id', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const reportError = vi.fn();
    const savvagent = createSavvagentLocals(client, new Request('http://localhost/'), {
      getUserId: () => new Promise(() => {}),
      evaluationTimeoutMs: 1000,
      reportError,
    });

    const result = savvagent.isEnabled('f');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(true);
    expect(client.isEnabled).toHaveBeenCalledWith('f', {});
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0].message).toMatch(/getUserId timed out after 1000ms/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('session store down'))],
    [
      'throws synchronously',
      () => {
        throw new Error('session store down');
      },
    ],
  ])('falls back to anonymous when getUserId %s, and reports it once', async (_label, getUserId) => {
    const client = makeClient();
    const reportError = vi.fn();
    const savvagent = createSavvagentLocals(
      client,
      new Request('http://localhost/', { headers: { cookie: 'user_id=forged' } }),
      { getUserId, anonymousId: 'anon_1', reportError }
    );

    await expect(savvagent.isEnabled('a')).resolves.toBe(true);
    await expect(savvagent.isEnabled('b')).resolves.toBe(true);
    expect(client.isEnabled).toHaveBeenNthCalledWith(1, 'a', { anonymous_id: 'anon_1' });
    expect(client.isEnabled).toHaveBeenNthCalledWith(2, 'b', { anonymous_id: 'anon_1' });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0].message).toMatch(/getUserId failed \(session store down\)/);
  });
});

describe('throttleErrors', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a message once per interval', () => {
    vi.useFakeTimers();
    const sink = vi.fn();
    const report = throttleErrors(sink, 60_000);
    report(new Error('down'));
    report(new Error('down'));
    report(new Error('other'));
    expect(sink).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    report(new Error('down'));
    expect(sink).toHaveBeenCalledTimes(3);
  });

  it('tracks at most 100 messages, dropping the oldest', () => {
    vi.useFakeTimers();
    const sink = vi.fn();
    const report = throttleErrors(sink, 60_000);
    for (let i = 0; i < 101; i++) report(new Error(`m${i}`));
    expect(sink).toHaveBeenCalledTimes(101);
    // m0 was evicted to make room, so it is reported again inside the window.
    report(new Error('m0'));
    expect(sink).toHaveBeenCalledTimes(102);
    // m100 is still tracked.
    report(new Error('m100'));
    expect(sink).toHaveBeenCalledTimes(102);
  });

  it('evicts the least recently reported message, not the first one ever seen', () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const report = throttleErrors(onError, 60_000);
      report(new Error('m0')); // t = 0
      vi.advanceTimersByTime(59_000);
      for (let i = 1; i < 99; i++) report(new Error(`m${i}`)); // t = 59 s, 99 tracked
      vi.advanceTimersByTime(2_000); // t = 61 s: only m0 is outside the window
      report(new Error('m0')); // reported again, and now the most recent entry
      report(new Error('fill')); // 100 tracked
      expect(onError).toHaveBeenCalledTimes(101);
      // The map is full and nothing is stale, so a new message evicts the
      // least recently reported entry: m1, not m0.
      report(new Error('new'));
      expect(onError).toHaveBeenCalledTimes(102);
      report(new Error('m0'));
      expect(onError).toHaveBeenCalledTimes(102);
      report(new Error('m1'));
      expect(onError).toHaveBeenCalledTimes(103);
    } finally {
      vi.useRealTimers();
    }
  });
});
