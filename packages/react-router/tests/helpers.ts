import { vi } from 'vitest';
import type { FlagClientConfig, FlagContext } from '@savvagent/sdk';

export const config: FlagClientConfig = {
  apiKey: 'sdk_test_key',
  baseUrl: 'https://flags.test',
  applicationId: 'app-1',
  enableTelemetry: false,
  retryAttempts: 1,
  retryDelay: 0,
};

export interface EvaluateCall {
  flagKey: string;
  context: FlagContext;
}

/**
 * Stub global fetch with a fake Flags API. `decide` returns whether a flag is
 * enabled for the evaluation context in the request body.
 */
export function mockFlagsApi(
  decide: (flagKey: string, context: FlagContext) => boolean,
  options: { delayMs?: number } = {}
) {
  const calls: EvaluateCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = url.match(/\/api\/flags\/([^/]+)\/evaluate$/);
    if (!match) return new Response('{}', { status: 200 });
    const flagKey = decodeURIComponent(match[1]);
    const { context } = JSON.parse(String(init?.body)) as { context: FlagContext };
    calls.push({ flagKey, context });
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    return new Response(
      JSON.stringify({ key: flagKey, enabled: decide(flagKey, context), variation: 'server' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function request(url = 'http://localhost/', init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(url, { ...init, headers });
}
