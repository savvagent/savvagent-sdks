// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import {
  createBrowserRouter,
  createStaticHandler,
  createStaticRouter,
  RouterProvider,
  StaticRouterProvider,
  useLoaderData,
} from 'react-router';
import type { StaticHandlerContext } from 'react-router';
import {
  createSavvagentServer,
  SavvagentProvider,
  useFlag,
  useFlags,
  useSavvagent,
} from '../src';
import type { FlagClientConfig, SavvagentFlags } from '../src';
import { config, mockFlagsApi, request } from './helpers';

const clientConfig: FlagClientConfig = { ...config, enableRealtime: false };
const KEYS = ['new-feature', 'beta-feature'];

const serverFlags: SavvagentFlags = {
  'new-feature': { key: 'new-feature', value: true, reason: 'evaluated', metadata: { variation: 'server' } },
  'beta-feature': { key: 'beta-feature', value: false, reason: 'evaluated' },
};

// Tell React this environment supports act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  document.body.innerHTML = '';
  localStorage.clear();
  vi.unstubAllGlobals();
});

type Snapshot = { loading: boolean; values: Record<string, boolean> };

/** Renders flag state as text and records every render. */
function Demo({ renders }: { renders?: Snapshot[] }) {
  const { values, loading, results } = useFlags(KEYS, { defaultValues: { 'new-feature': false } });
  renders?.push({ loading, values });
  if (loading) return <p className="loading">Loading feature flags...</p>;
  return (
    <ul>
      {KEYS.map((key) => (
        <li key={key} data-flag={key}>
          {`${key}: ${values[key] ? 'Enabled' : 'Disabled'}` +
            (results[key]?.metadata?.variation ? ` (${results[key]?.metadata?.variation})` : '')}
        </li>
      ))}
    </ul>
  );
}

function hydrate(container: HTMLElement, element: React.ReactNode) {
  const onRecoverableError = vi.fn();
  let root!: Root;
  act(() => {
    root = hydrateRoot(container, element, { onRecoverableError });
  });
  roots.push(root);
  return { onRecoverableError };
}

async function settle() {
  // Let the client evaluations (mocked fetch) resolve and re-render.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe('server rendering with hydrated flags', () => {
  it('renders the server values, not the loading state or defaults', () => {
    const html = renderToString(
      <SavvagentProvider config={clientConfig} flags={serverFlags}>
        <Demo />
      </SavvagentProvider>
    );
    expect(html).toContain('new-feature: Enabled (server)');
    expect(html).toContain('beta-feature: Disabled');
    expect(html).not.toContain('Loading');
  });

  it('falls back to the live hook when a flag was not hydrated', () => {
    const html = renderToString(
      <SavvagentProvider config={clientConfig} flags={{ 'new-feature': serverFlags['new-feature'] }}>
        <Demo />
      </SavvagentProvider>
    );
    expect(html).toContain('Loading');
  });

  it('does not hydrate results the server failed to evaluate', () => {
    const html = renderToString(
      <SavvagentProvider
        config={clientConfig}
        flags={{ ...serverFlags, 'beta-feature': { key: 'beta-feature', value: false, reason: 'error' } }}
      >
        <Demo />
      </SavvagentProvider>
    );
    expect(html).toContain('Loading');
  });

  it('works without a flags prop, like @savvagent/react', () => {
    const html = renderToString(
      <SavvagentProvider config={clientConfig}>
        <Demo />
      </SavvagentProvider>
    );
    expect(html).toContain('Loading');
  });
});

describe('framework-mode loader to hydrated client', () => {
  it('evaluates in the loader, then hydrates without a flash of default values', async () => {
    // The server and the browser see the same flag state; browser responses are slow.
    const { calls } = mockFlagsApi((flagKey) => flagKey === 'new-feature', { delayMs: 30 });
    const savvagent = createSavvagentServer(config);

    function Root({ renders }: { renders?: Snapshot[] }) {
      const { flags } = useLoaderData() as { flags: SavvagentFlags };
      return (
        <SavvagentProvider config={clientConfig} flags={flags} defaultContext={{ userId: 'user-123' }}>
          <Demo renders={renders} />
        </SavvagentProvider>
      );
    }

    // --- Server: run the loader and render, as entry.server does.
    const loader = async ({ request: req }: { request: Request }) => {
      const scope = await savvagent.forRequest(req, { userId: 'user-123' });
      return { flags: await scope.evaluateFlags(KEYS) };
    };
    const serverRoutes = [{ id: 'root', path: '/', loader, Component: () => <Root /> }];
    const handler = createStaticHandler(serverRoutes);
    const context = (await handler.query(
      request('http://localhost/', { cookie: 'savvagent_anonymous_id=anon-1' })
    )) as StaticHandlerContext;
    const html = renderToString(
      <StaticRouterProvider router={createStaticRouter(handler.dataRoutes, context)} context={context} hydrate={false} />
    );
    expect(html).toContain('new-feature: Enabled (server)');
    expect(calls.map((c) => c.context.user_id)).toEqual(['user-123', 'user-123']);

    // --- Browser: hydrate the server HTML with the loader data.
    const renders: Snapshot[] = [];
    const router = createBrowserRouter(
      [{ id: 'root', path: '/', loader, Component: () => <Root renders={renders} /> }],
      { hydrationData: { loaderData: context.loaderData } }
    );
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    const { onRecoverableError } = hydrate(container, <RouterProvider router={router} />);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(html);

    await settle();
    // The browser client evaluated the flags itself...
    expect(calls.length).toBe(4);
    expect(container.textContent).toContain('new-feature: Enabled (server)');
    // ...and no render, from hydration to the live result, showed defaults or loading.
    expect(renders.length).toBeGreaterThan(1);
    for (const snapshot of renders) {
      expect(snapshot).toEqual({ loading: false, values: { 'new-feature': true, 'beta-feature': false } });
    }
    router.dispose();
  });
});

describe('overrides', () => {
  function OverrideControls() {
    const { client, isReady } = useSavvagent();
    if (!isReady) return null;
    return (
      <button type="button" onClick={() => client?.setOverride('beta-feature', true)}>
        override beta
      </button>
    );
  }

  it('applies initial overrides as soon as the client is ready, before it has evaluated', async () => {
    // Slow browser evaluations: the override must not wait for them.
    const { calls } = mockFlagsApi((flagKey) => flagKey === 'new-feature', { delayMs: 200 });
    const element = (
      <SavvagentProvider config={clientConfig} flags={serverFlags} initialOverrides={{ 'new-feature': false }}>
        <Demo />
        <OverrideControls />
      </SavvagentProvider>
    );
    const html = renderToString(element);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    const { onRecoverableError } = hydrate(container, element);
    expect(onRecoverableError).not.toHaveBeenCalled();
    // The client exists now, but its evaluations are still in flight.
    expect(container.querySelector('button')).not.toBeNull();
    expect(calls.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-flag="new-feature"]')?.textContent).toBe('new-feature: Disabled');

    await settle();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(container.querySelector('[data-flag="new-feature"]')?.textContent).toBe('new-feature: Disabled');

    act(() => container.querySelector('button')!.click());
    await settle();
    expect(container.querySelector('[data-flag="beta-feature"]')?.textContent).toBe('beta-feature: Enabled');
  });
});

describe('useFlag', () => {
  function Single() {
    const { value, loading, result } = useFlag('new-feature');
    if (loading) return <p>Loading</p>;
    return (
      <p>{`${value ? 'on' : 'off'} ${result?.reason}`}</p>
    );
  }

  it('starts from the hydrated value and switches to the live result', async () => {
    mockFlagsApi(() => true);
    const element = (
      <SavvagentProvider config={clientConfig} flags={serverFlags}>
        <Single />
      </SavvagentProvider>
    );
    const html = renderToString(element);
    expect(html).toContain('on evaluated');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const { onRecoverableError } = hydrate(container, element);
    expect(onRecoverableError).not.toHaveBeenCalled();

    await settle();
    expect(container.textContent).toBe('on evaluated');
  });

  it('shows loading without a hydrated value', () => {
    expect(
      renderToString(
        <SavvagentProvider config={clientConfig} flags={{}}>
          <Single />
        </SavvagentProvider>
      )
    ).toContain('Loading');
  });
});
