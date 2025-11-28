import { Show } from 'solid-js';
import { SavvagentProvider, createFlags, createUser, createTrackError, useSavvagent } from '@savvagent/solid';
import type { FlagClientConfig, DefaultFlagContext } from '@savvagent/solid';
import { FlagOverridePanel } from './FlagOverridePanel';

/**
 * Feature Demo Component
 * Demonstrates best practices for using Savvagent SolidJS SDK
 *
 * Uses the createFlags function for optimal performance - evaluates multiple flags
 * with a single state update, preventing unnecessary re-renders.
 */
function FeatureDemo() {
  const { client } = useSavvagent();

  // Per SDK Developer Guide: Use createFlags for multiple flags in the same component
  // This is more performant than multiple createFlag calls as it:
  // 1. Uses a single state object for atomic updates
  // 2. Evaluates all flags in parallel
  // 3. Only triggers one re-render when any flag changes
  // 4. Automatically respects local overrides set via client.setOverride()
  const flags = createFlags(
    ['new-feature', 'beta-feature', 'enterprise-one'],
    {
      defaultValues: {
        'new-feature': false,
        'beta-feature': false,
        'enterprise-one': false,
      },
      realtime: true, // Enable real-time updates for all flags
    }
  );

  // Flag values now automatically include overrides (applied in client.evaluate)
  const newFeatureEnabled = () => flags.values()['new-feature'];
  const betaFeatureEnabled = () => flags.values()['beta-feature'];
  const enterpriseOneEnabled = () => flags.values()['enterprise-one'];

  // Check if flags are overridden (for UI indication)
  const isNewFeatureOverridden = () => client.hasOverride('new-feature');
  const isBetaFeatureOverridden = () => client.hasOverride('beta-feature');
  const isEnterpriseOneOverridden = () => client.hasOverride('enterprise-one');

  // Extract results for metadata access
  const result1 = () => flags.results()['new-feature'];
  const result2 = () => flags.results()['beta-feature'];
  const result3 = () => flags.results()['enterprise-one'];

  // Function for error tracking - per SDK Developer Guide telemetry
  const trackError = createTrackError('new-feature');

  // User management
  const user = createUser();

  // Example error handler demonstrating error tracking
  const handleRiskyAction = async () => {
    try {
      // Simulated action that might fail
      throw new Error('Example error for demonstration');
    } catch (error) {
      // Track errors for AI-powered correlation
      trackError(error as Error);
      console.error('Action failed:', error);
    }
  };

  return (
    <div class="container">
      <h1>Savvagent SolidJS Example</h1>
      <p class="subtitle">SDK Developer Guide Best Practices Demo</p>

      <Show when={!flags.loading()} fallback={<p class="loading">Loading feature flags...</p>}>
        <div>
          <div class={`feature-card ${isNewFeatureOverridden() ? 'feature-card-overridden' : ''}`}>
            <h2>
              New Feature
              <Show when={isNewFeatureOverridden()}>
                <span class="override-badge-inline">LOCAL OVERRIDE</span>
              </Show>
            </h2>
            <p>
              Status:
              <span class={`status ${newFeatureEnabled() ? 'enabled' : 'disabled'}`}>
                {newFeatureEnabled() ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            <Show when={isNewFeatureOverridden()}>
              <p class="server-value">Server value: {flags.values()['new-feature'] ? 'Enabled' : 'Disabled'}</p>
            </Show>
            <Show when={result1()?.metadata?.variation}>
              <p class="variation">Variation: {result1()?.metadata?.variation}</p>
            </Show>
            <Show when={result1()?.metadata?.configuration}>
              <p class="config">
                Config: <code>{JSON.stringify(result1()?.metadata?.configuration)}</code>
              </p>
            </Show>
          </div>

          <div class={`feature-card ${isBetaFeatureOverridden() ? 'feature-card-overridden' : ''}`}>
            <h2>
              Beta Feature
              <Show when={isBetaFeatureOverridden()}>
                <span class="override-badge-inline">LOCAL OVERRIDE</span>
              </Show>
            </h2>
            <p>
              Status:
              <span class={`status ${betaFeatureEnabled() ? 'enabled' : 'disabled'}`}>
                {betaFeatureEnabled() ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            <Show when={isBetaFeatureOverridden()}>
              <p class="server-value">Server value: {flags.values()['beta-feature'] ? 'Enabled' : 'Disabled'}</p>
            </Show>
            <Show when={result2()?.metadata?.variation}>
              <p class="variation">Variation: {result2()?.metadata?.variation}</p>
            </Show>
          </div>

          <div class={`feature-card ${isEnterpriseOneOverridden() ? 'feature-card-overridden' : ''}`}>
            <h2>
              Enterprise One
              <Show when={isEnterpriseOneOverridden()}>
                <span class="override-badge-inline">LOCAL OVERRIDE</span>
              </Show>
            </h2>
            <p>
              Status:
              <span class={`status ${enterpriseOneEnabled() ? 'enabled' : 'disabled'}`}>
                {enterpriseOneEnabled() ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            <Show when={isEnterpriseOneOverridden()}>
              <p class="server-value">Server value: {flags.values()['enterprise-one'] ? 'Enabled' : 'Disabled'}</p>
            </Show>
            <Show when={result3()?.metadata?.variation}>
              <p class="variation">Variation: {result3()?.metadata?.variation}</p>
            </Show>
            <Show when={result3()?.metadata?.configuration}>
              <p class="config">
                Config: <code>{JSON.stringify(result3()?.metadata?.configuration)}</code>
              </p>
            </Show>
          </div>

          <Show when={newFeatureEnabled()}>
            <div class="alert alert-success">
              <strong>New Feature Enabled!</strong>
              <p>This feature is enabled for you based on your user attributes.</p>
              <button onClick={handleRiskyAction} class="btn">
                Test Error Tracking
              </button>
            </div>
          </Show>

          <div class="user-section">
            <h3>User Management</h3>
            <p>Current User ID: <code>{user.getUserId() || 'Not set'}</code></p>
            <button onClick={() => user.setUserId('user-' + Date.now())} class="btn">
              Set Random User ID
            </button>
            <button onClick={() => user.setUserId(null)} class="btn btn-secondary">
              Clear User ID
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

/**
 * Main App Component
 * Per SDK Developer Guide: Initialize once, create a single SDK instance at application startup
 */
function App() {
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
    // Custom error handler
    onError: (error) => {
      console.error('[App] Savvagent error:', error);
    },
  };

  // Per SDK Developer Guide: Default context values applied to all flag evaluations
  // Always provide user context for consistent rollout behavior
  // See: docs/SDK-DEVELOPER-GUIDE.md for complete context field reference
  const defaultContext: DefaultFlagContext = {
    // Environment (development, staging, production)
    environment: 'development',
    // Default user ID (required for percentage rollouts)
    userId: 'user-123',
    // Organization ID for multi-tenant apps
    organizationId: 'org-456',
    // Session ID as fallback identifier (per SDK Developer Guide)
    sessionId: `session_${Date.now()}`,
    // User's language code (e.g., "en", "es")
    language: 'en',
    // Custom attributes for targeting rules
    attributes: {
      plan: 'premium',
      country: 'US',
    },
  };

  return (
    <SavvagentProvider config={config} defaultContext={defaultContext}>
      <FeatureDemo />
      <FlagOverridePanel />
    </SavvagentProvider>
  );
}

export default App;
