import './app.css';
import { initSavvagent } from '@savvagent/svelte';
import type { FlagClientConfig, DefaultFlagContext } from '@savvagent/svelte';
import App from './App.svelte';

// Storage key for local overrides (must match FlagOverridePanel)
const OVERRIDE_STORAGE_KEY = 'savvagent_local_overrides';

/**
 * Load overrides from localStorage for initial SDK configuration.
 */
function loadInitialOverrides(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(OVERRIDE_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as Record<string, boolean>;
    }
  } catch (e) {
    console.warn('[App] Failed to load initial overrides:', e);
  }
  return {};
}

// Per SDK Developer Guide: FlagClientConfig with proper authentication
const config: FlagClientConfig = {
  // SDK API key (starts with sdk_) - safe to embed in client-side code
  apiKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY || 'sdk_your_key_here',
  // Base URL for the Savvagent API
  baseUrl: import.meta.env.VITE_SAVVAGENT_API_URL || 'http://localhost:8080',
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
  // Custom error handler - filter out expected AbortErrors from SSE disconnection
  onError: (error) => {
    // AbortErrors are expected when the page navigates or SSE connection is interrupted
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
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

// Initialize the Savvagent client before mounting the app
const client = initSavvagent({ config, defaultContext });

// Initialize userId from defaultContext
if (defaultContext.userId) {
  client.setUserId(defaultContext.userId);
}

// Apply initial overrides from localStorage
const initialOverrides = loadInitialOverrides();
if (Object.keys(initialOverrides).length > 0) {
  client.setOverrides(initialOverrides);
}

const app = new App({
  target: document.getElementById('app')!,
});

export default app;
