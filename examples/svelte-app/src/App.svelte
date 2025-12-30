<script lang="ts">
  import { createFlagsStore, createUserIdStore, createOverridesStore, trackError } from '@savvagent/svelte';
  import FlagOverridePanel from './FlagOverridePanel.svelte';

  /**
   * Feature Demo Component
   * Demonstrates best practices for using Savvagent Svelte SDK
   */

  // Per SDK Developer Guide: Use createFlagsStore for multiple flags in the same component
  const flags = createFlagsStore(
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

  // Reactive user ID store
  const userId = createUserIdStore();

  // Reactive overrides store for UI reactivity
  const overrides = createOverridesStore();

  // Example error handler demonstrating error tracking
  async function handleRiskyAction() {
    try {
      // Simulated action that might fail
      throw new Error('Example error for demonstration');
    } catch (error) {
      // Track errors for AI-powered correlation
      trackError('new-feature', error as Error);
      console.error('Action failed:', error);
    }
  }

  // User management handlers
  function setRandomUserId() {
    $userId = 'user-' + Date.now();
  }

  function clearUserId() {
    $userId = null;
  }

  // Reactive statements for override status - using $overrides for reactivity
  $: newFeatureOverridden = 'new-feature' in $overrides.overrides;
  $: betaFeatureOverridden = 'beta-feature' in $overrides.overrides;
  $: enterpriseOneOverridden = 'enterprise-one' in $overrides.overrides;
</script>

<div class="container">
  <h1>Savvagent Svelte Example</h1>
  <p class="subtitle">SDK Developer Guide Best Practices Demo</p>

  {#if $flags.loading}
    <p class="loading">Loading feature flags...</p>
  {:else}
    <div>
      {#key $overrides.count}
      <div class="feature-card" class:feature-card-overridden={newFeatureOverridden}>
        <h2>
          New Feature
          {#if newFeatureOverridden}
            <span class="override-badge-inline">LOCAL OVERRIDE</span>
          {/if}
        </h2>
        <p>
          Status:
          <span class="status" class:enabled={$flags.values['new-feature']} class:disabled={!$flags.values['new-feature']}>
            {$flags.values['new-feature'] ? 'Enabled' : 'Disabled'}
          </span>
        </p>
        {#if newFeatureOverridden}
          <p class="server-value">
            Server value: {$flags.values['new-feature'] ? 'Enabled' : 'Disabled'}
          </p>
        {/if}
        {#if $flags.results['new-feature']?.metadata?.variation}
          <p class="variation">
            Variation: {$flags.results['new-feature'].metadata.variation}
          </p>
        {/if}
        {#if $flags.results['new-feature']?.metadata?.configuration}
          <p class="config">
            Config: <code>{JSON.stringify($flags.results['new-feature'].metadata.configuration)}</code>
          </p>
        {/if}
      </div>

      <div class="feature-card" class:feature-card-overridden={betaFeatureOverridden}>
        <h2>
          Beta Feature
          {#if betaFeatureOverridden}
            <span class="override-badge-inline">LOCAL OVERRIDE</span>
          {/if}
        </h2>
        <p>
          Status:
          <span class="status" class:enabled={$flags.values['beta-feature']} class:disabled={!$flags.values['beta-feature']}>
            {$flags.values['beta-feature'] ? 'Enabled' : 'Disabled'}
          </span>
        </p>
        {#if betaFeatureOverridden}
          <p class="server-value">
            Server value: {$flags.values['beta-feature'] ? 'Enabled' : 'Disabled'}
          </p>
        {/if}
        {#if $flags.results['beta-feature']?.metadata?.variation}
          <p class="variation">
            Variation: {$flags.results['beta-feature'].metadata.variation}
          </p>
        {/if}
      </div>

      <div class="feature-card" class:feature-card-overridden={enterpriseOneOverridden}>
        <h2>
          Enterprise One
          {#if enterpriseOneOverridden}
            <span class="override-badge-inline">LOCAL OVERRIDE</span>
          {/if}
        </h2>
        <p>
          Status:
          <span class="status" class:enabled={$flags.values['enterprise-one']} class:disabled={!$flags.values['enterprise-one']}>
            {$flags.values['enterprise-one'] ? 'Enabled' : 'Disabled'}
          </span>
        </p>
        {#if enterpriseOneOverridden}
          <p class="server-value">
            Server value: {$flags.values['enterprise-one'] ? 'Enabled' : 'Disabled'}
          </p>
        {/if}
        {#if $flags.results['enterprise-one']?.metadata?.variation}
          <p class="variation">
            Variation: {$flags.results['enterprise-one'].metadata.variation}
          </p>
        {/if}
        {#if $flags.results['enterprise-one']?.metadata?.configuration}
          <p class="config">
            Config: <code>{JSON.stringify($flags.results['enterprise-one'].metadata.configuration)}</code>
          </p>
        {/if}
      </div>
      {/key}

      {#if $flags.values['new-feature']}
        <div class="alert alert-success">
          <strong>New Feature Enabled!</strong>
          <p>This feature is enabled for you based on your user attributes.</p>
          <button on:click={handleRiskyAction} class="btn">
            Test Error Tracking
          </button>
        </div>
      {/if}

      <div class="user-section">
        <h3>User Management</h3>
        <p>Current User ID: <code>{$userId || 'Not set'}</code></p>
        <button on:click={setRandomUserId} class="btn">
          Set Random User ID
        </button>
        <button on:click={clearUserId} class="btn btn-secondary">
          Clear User ID
        </button>
      </div>
    </div>
  {/if}
</div>

<FlagOverridePanel />
