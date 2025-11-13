<script lang="ts">
  import { onMount } from 'svelte';
  import { setSavvagentContext, featureFlag } from '@savvagent/svelte';

  onMount(() => {
    setSavvagentContext({
      apiUrl: import.meta.env.VITE_SAVVAGENT_API_URL || 'http://localhost:8080',
      sdkKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY || 'your-sdk-key',
      environment: 'development',
    });
  });

  const newFeature = featureFlag('new-feature', {
    userId: 'user-123',
    attributes: {
      email: 'user@example.com',
      plan: 'pro',
    },
  });

  const betaFeature = featureFlag('beta-feature', {
    userId: 'user-123',
  });

  $: loading = $newFeature.loading || $betaFeature.loading;
</script>

<div class="container">
  <h1>Savvagent Svelte Example</h1>

  {#if loading}
    <p class="loading">Loading feature flags...</p>
  {:else}
    <div>
      <div class="feature-card">
        <h2>New Feature</h2>
        <p>
          Status:
          <span class="status {$newFeature.isEnabled ? 'enabled' : 'disabled'}">
            {$newFeature.isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </p>
      </div>

      <div class="feature-card">
        <h2>Beta Feature</h2>
        <p>
          Status:
          <span class="status {$betaFeature.isEnabled ? 'enabled' : 'disabled'}">
            {$betaFeature.isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </p>
      </div>

      {#if $newFeature.isEnabled}
        <div class="alert alert-success">
          <strong>New Feature Enabled!</strong>
          <p>This feature is enabled for you based on your user attributes.</p>
        </div>
      {/if}
    </div>
  {/if}
</div>
