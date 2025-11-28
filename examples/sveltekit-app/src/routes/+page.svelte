<script lang="ts">
  import { onMount } from 'svelte';
  import {
    initSavvagent,
    getSavvagent,
    createFlagsStore,
    createUserIdStore,
    trackError,
    type FlagClientConfig,
    type DefaultFlagContext,
  } from '@savvagent/svelte';
  import FlagOverridePanel from '$lib/FlagOverridePanel.svelte';

  let initialized = $state(false);
  let client: ReturnType<typeof getSavvagent> | null = null;
  let flagsStore: ReturnType<typeof createFlagsStore> | null = null;
  let userIdStore: ReturnType<typeof createUserIdStore> | null = null;

  // Flag values state
  let values = $state<Record<string, boolean>>({});
  let loading = $state(true);
  let results = $state<Record<string, any>>({});

  // User state
  let currentUserId = $state<string | null>(null);

  // Override check state
  let isNewFeatureOverridden = $state(false);
  let isBetaFeatureOverridden = $state(false);
  let isEnterpriseOneOverridden = $state(false);

  onMount(() => {
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
    const defaultContext: DefaultFlagContext = {
      // Environment (development, staging, production)
      environment: 'development',
      // Default user ID (required for percentage rollouts)
      userId: 'user-123',
      // Organization ID for multi-tenant apps
      organizationId: 'org-456',
      // Session ID as fallback identifier (per SDK Developer Guide)
      sessionId: `session_${Date.now()}`,
      // User's language code
      language: 'en',
      // Custom attributes for targeting rules
      attributes: {
        plan: 'premium',
        country: 'US',
      },
    };

    // Initialize Savvagent with config and default context
    initSavvagent({ config, defaultContext });
    client = getSavvagent();
    initialized = true;

    // Create flags store for multiple flags
    flagsStore = createFlagsStore(
      ['new-feature', 'beta-feature', 'enterprise-one'],
      {
        defaultValues: {
          'new-feature': false,
          'beta-feature': false,
          'enterprise-one': false,
        },
        realtime: true,
      }
    );

    // Subscribe to flags store
    const unsubFlags = flagsStore.subscribe((state) => {
      values = state.values;
      loading = state.loading;
      results = state.results;

      // Update override status
      if (client) {
        isNewFeatureOverridden = client.hasOverride('new-feature');
        isBetaFeatureOverridden = client.hasOverride('beta-feature');
        isEnterpriseOneOverridden = client.hasOverride('enterprise-one');
      }
    });

    // Create user ID store
    userIdStore = createUserIdStore();

    // Subscribe to user ID changes
    const unsubUser = userIdStore.subscribe((id) => {
      currentUserId = id;
    });

    // Subscribe to override changes to update override status
    const unsubOverrides = client.onOverrideChange(() => {
      isNewFeatureOverridden = client!.hasOverride('new-feature');
      isBetaFeatureOverridden = client!.hasOverride('beta-feature');
      isEnterpriseOneOverridden = client!.hasOverride('enterprise-one');
    });

    return () => {
      unsubFlags();
      unsubUser();
      unsubOverrides();
    };
  });

  // Example error handler demonstrating error tracking
  function handleRiskyAction() {
    try {
      // Simulated action that might fail
      throw new Error('Example error for demonstration');
    } catch (error) {
      // Track errors for AI-powered correlation
      trackError('new-feature', error as Error);
      console.error('Action failed:', error);
    }
  }

  function setRandomUserId() {
    userIdStore?.set('user-' + Date.now());
  }

  function clearUserId() {
    userIdStore?.set(null);
  }

  // Derived values
  let newFeatureEnabled = $derived(values['new-feature'] ?? false);
  let betaFeatureEnabled = $derived(values['beta-feature'] ?? false);
  let enterpriseOneEnabled = $derived(values['enterprise-one'] ?? false);

  let result1 = $derived(results['new-feature']);
  let result2 = $derived(results['beta-feature']);
  let result3 = $derived(results['enterprise-one']);
</script>

<svelte:head>
  <title>Savvagent SvelteKit Example</title>
</svelte:head>

<div class="container">
  <h1>Savvagent SvelteKit Example</h1>
  <p class="subtitle">SDK Developer Guide Best Practices Demo</p>

  {#if !initialized}
    <p class="loading">Initializing...</p>
  {:else if loading}
    <p class="loading">Loading feature flags...</p>
  {:else}
    <div>
      <div class="feature-card" class:feature-card-overridden={isNewFeatureOverridden}>
        <h2>
          New Feature
          {#if isNewFeatureOverridden}
            <span class="override-badge-inline">LOCAL OVERRIDE</span>
          {/if}
        </h2>
        <p>
          Status:
          <span class="status" class:enabled={newFeatureEnabled} class:disabled={!newFeatureEnabled}>
            {newFeatureEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </p>
        {#if isNewFeatureOverridden}
          <p class="server-value">Server value: {values['new-feature'] ? 'Enabled' : 'Disabled'}</p>
        {/if}
        {#if result1?.metadata?.variation}
          <p class="variation">Variation: {result1.metadata.variation}</p>
        {/if}
        {#if result1?.metadata?.configuration}
          <p class="config">
            Config: <code>{JSON.stringify(result1.metadata.configuration)}</code>
          </p>
        {/if}
      </div>

      <div class="feature-card" class:feature-card-overridden={isBetaFeatureOverridden}>
        <h2>
          Beta Feature
          {#if isBetaFeatureOverridden}
            <span class="override-badge-inline">LOCAL OVERRIDE</span>
          {/if}
        </h2>
        <p>
          Status:
          <span class="status" class:enabled={betaFeatureEnabled} class:disabled={!betaFeatureEnabled}>
            {betaFeatureEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </p>
        {#if isBetaFeatureOverridden}
          <p class="server-value">Server value: {values['beta-feature'] ? 'Enabled' : 'Disabled'}</p>
        {/if}
        {#if result2?.metadata?.variation}
          <p class="variation">Variation: {result2.metadata.variation}</p>
        {/if}
      </div>

      <div class="feature-card" class:feature-card-overridden={isEnterpriseOneOverridden}>
        <h2>
          Enterprise One
          {#if isEnterpriseOneOverridden}
            <span class="override-badge-inline">LOCAL OVERRIDE</span>
          {/if}
        </h2>
        <p>
          Status:
          <span class="status" class:enabled={enterpriseOneEnabled} class:disabled={!enterpriseOneEnabled}>
            {enterpriseOneEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </p>
        {#if isEnterpriseOneOverridden}
          <p class="server-value">Server value: {values['enterprise-one'] ? 'Enabled' : 'Disabled'}</p>
        {/if}
        {#if result3?.metadata?.variation}
          <p class="variation">Variation: {result3.metadata.variation}</p>
        {/if}
        {#if result3?.metadata?.configuration}
          <p class="config">
            Config: <code>{JSON.stringify(result3.metadata.configuration)}</code>
          </p>
        {/if}
      </div>

      {#if newFeatureEnabled}
        <div class="alert alert-success">
          <strong>New Feature Enabled!</strong>
          <p>This feature is enabled for you based on your user attributes.</p>
          <button onclick={handleRiskyAction} class="btn">
            Test Error Tracking
          </button>
        </div>
      {/if}

      <div class="user-section">
        <h3>User Management</h3>
        <p>Current User ID: <code>{currentUserId || 'Not set'}</code></p>
        <button onclick={setRandomUserId} class="btn">
          Set Random User ID
        </button>
        <button onclick={clearUserId} class="btn btn-secondary">
          Clear User ID
        </button>
      </div>
    </div>
  {/if}
</div>

{#if initialized}
  <FlagOverridePanel />
{/if}

<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
      sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background: #f5f5f5;
  }

  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    font-size: 2.5rem;
    margin-bottom: 2rem;
    color: #333;
  }

  h2 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
    color: #555;
  }

  .feature-card {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .status {
    font-weight: bold;
    margin-left: 0.5rem;
  }

  .status.enabled {
    color: #22c55e;
  }

  .status.disabled {
    color: #ef4444;
  }

  .alert {
    padding: 1rem 1.5rem;
    border-radius: 8px;
    margin-top: 1rem;
  }

  .alert-success {
    background: #dcfce7;
    border: 1px solid #86efac;
    color: #166534;
  }

  .loading {
    color: #666;
    font-style: italic;
  }

  .subtitle {
    color: #666;
    margin-bottom: 1.5rem;
  }

  .variation {
    font-size: 0.875rem;
    color: #666;
    margin-top: 0.5rem;
  }

  .config {
    font-size: 0.875rem;
    color: #666;
    margin-top: 0.5rem;
  }

  .config code {
    background: #f1f5f9;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
  }

  .user-section {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    margin-top: 1.5rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .user-section h3 {
    margin-bottom: 1rem;
    color: #333;
  }

  .user-section code {
    background: #f1f5f9;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    margin-right: 0.5rem;
    margin-top: 0.5rem;
    transition: background 0.2s;
  }

  .btn:hover {
    background: #2563eb;
  }

  .btn-secondary {
    background: #6b7280;
  }

  .btn-secondary:hover {
    background: #4b5563;
  }

  /* Feature card override styles */
  .feature-card-overridden {
    border: 2px solid #f59e0b;
    background: #fffbeb;
  }

  .override-badge-inline {
    background: #f59e0b;
    color: white;
    font-size: 0.625rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    margin-left: 10px;
    letter-spacing: 0.5px;
    vertical-align: middle;
  }

  .server-value {
    font-size: 0.8125rem;
    color: #92400e;
    margin-top: 0.25rem;
    font-style: italic;
  }
</style>
