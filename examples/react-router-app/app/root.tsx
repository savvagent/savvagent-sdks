import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { SavvagentProvider, getSavvagent } from '@savvagent/react-router';
import type { FlagClientConfig } from '@savvagent/react-router';
import type { Route } from './+types/root';
import { browserConfig, savvagent } from './savvagent.server';
import { APPLICATION_ID, FLAG_DEFAULTS, FLAG_KEYS, browserContext } from './savvagent';
import { FlagOverridePanel } from './components/FlagOverridePanel';
import './app.css';

/**
 * Creates the per-request Savvagent scope (user from the server session,
 * anonymous ID cookie) for every loader and action.
 */
export const middleware: Route.MiddlewareFunction[] = [savvagent.middleware];

/**
 * Evaluate the page's flags on the server. The results are rendered into the
 * HTML and hydrated into <SavvagentProvider>, so there is no flash of defaults.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const savvagent = getSavvagent(context);
  const flags = await savvagent.evaluateFlags(FLAG_KEYS);
  // The language the server evaluated with (from Accept-Language), so the
  // browser SDK evaluates with the same one.
  return { flags, browser: browserConfig(), language: savvagent.context.language ?? null };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Storage key for local overrides (must match FlagOverridePanel)
const OVERRIDE_STORAGE_KEY = 'savvagent_local_overrides';

/** Overrides saved by the override panel. Browser only. */
function loadInitialOverrides(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(OVERRIDE_STORAGE_KEY);
    if (stored) return JSON.parse(stored) as Record<string, boolean>;
  } catch (e) {
    console.warn('[App] Failed to load initial overrides:', e);
  }
  return {};
}

export default function App({ loaderData }: Route.ComponentProps) {
  // Load overrides synchronously before the client is created.
  const initialOverrides = loadInitialOverrides();

  const config: FlagClientConfig = {
    apiKey: loaderData.browser.apiKey,
    baseUrl: loaderData.browser.baseUrl,
    applicationId: APPLICATION_ID,
    enableRealtime: true,
    enableTelemetry: true,
    cacheTtl: 60000,
    defaults: FLAG_DEFAULTS,
    onError: (error) => console.error('[App] Savvagent error:', error),
  };

  return (
    <SavvagentProvider
      config={config}
      defaultContext={
        loaderData.language ? { ...browserContext, language: loaderData.language } : browserContext
      }
      initialOverrides={initialOverrides}
      flags={loaderData.flags}
    >
      <Outlet />
      <FlagOverridePanel />
    </SavvagentProvider>
  );
}
