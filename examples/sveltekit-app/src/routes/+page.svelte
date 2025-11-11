<script lang="ts">
  import { onMount } from 'svelte';
  import { SavvagentClient } from '@savvagent/sdk';

  let newFeatureEnabled = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const client = new SavvagentClient({
        apiUrl: import.meta.env.VITE_SAVVAGENT_API_URL || 'http://localhost:8080',
        sdkKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY || 'your-sdk-key',
        environment: 'development',
      });

      newFeatureEnabled = await client.isEnabled('new-feature', {
        userId: 'user-123',
        attributes: {
          email: 'user@example.com',
          plan: 'pro',
        },
      });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error checking flag:', err);
    } finally {
      loading = false;
    }
  });
</script>

<main class="container mx-auto p-8">
  <h1 class="text-4xl font-bold mb-8">Savvagent SvelteKit Example</h1>

  {#if loading}
    <p>Loading feature flags...</p>
  {:else if error}
    <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
      <strong class="font-bold">Error:</strong>
      <span class="block sm:inline">{error}</span>
    </div>
  {:else}
    <div class="space-y-4">
      <div class="border p-4 rounded">
        <h2 class="text-2xl font-semibold mb-2">New Feature</h2>
        <p>
          Status:
          <span class={newFeatureEnabled ? 'text-green-600' : 'text-red-600'}>
            {newFeatureEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </p>
      </div>

      {#if newFeatureEnabled}
        <div class="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
          <strong class="font-bold">New Feature!</strong>
          <span class="block sm:inline">This feature is enabled for you.</span>
        </div>
      {/if}
    </div>
  {/if}
</main>

<style>
  main {
    min-height: 100vh;
  }
</style>
