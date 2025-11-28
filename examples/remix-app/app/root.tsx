import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@remix-run/react';
import type { LinksFunction } from '@remix-run/node';
import { SavvagentProvider } from '@savvagent/remix';
import type { FlagClientConfig, DefaultFlagContext } from '@savvagent/remix';
import stylesheet from './styles.css?url';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export default function App() {
  // Per SDK Developer Guide: FlagClientConfig with proper authentication
  const config: FlagClientConfig = {
    // SDK API key (starts with sdk_) - safe to embed in client-side code
    apiKey: 'sdk_dev_a832ae4e55ece86995858755a843ec45',
    // Base URL for the Savvagent API
    baseUrl: 'http://localhost:8080',
    // Application ID for application-scoped flags
    applicationId: 'f8209ef5-a661-4f46-8b84-4c855a97d5ef',
    // Enable real-time updates via SSE (default: true)
    enableRealtime: true,
    // Enable telemetry tracking (default: true)
    enableTelemetry: true,
    // Cache TTL in milliseconds (default: 60000 = 1 minute)
    cacheTtl: 60000,
    // Default flag values when evaluation fails
    defaults: {
      'new-feature': false,
      'beta-feature': false,
      'enterprise-one': false,
    },
    // Custom error handler
    onError: (error) => {
      console.error('[App] Savvagent error:', error);
    },
  };

  // Per SDK Developer Guide: Default context values applied to all flag evaluations
  const defaultContext: DefaultFlagContext = {
    // Environment (development, staging, production)
    environment: 'development',
    // Default user ID (required for percentage rollouts)
    userId: 'user-123',
    // Organization ID for multi-tenant apps
    organizationId: 'org-456',
    // Session ID as fallback identifier
    sessionId: `session_${Date.now()}`,
    // User's language code
    language: 'en',
    // Custom attributes for targeting rules
    attributes: {
      plan: 'premium',
      country: 'US',
    },
  };

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <SavvagentProvider config={config} defaultContext={defaultContext}>
          <Outlet />
        </SavvagentProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
