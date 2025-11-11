# Savvagent SvelteKit Example

Example SvelteKit application demonstrating how to use the Savvagent SDK with Svelte 5.

## Features

- SvelteKit 2 with Svelte 5
- TypeScript
- Runes for reactivity
- Client-side feature flag evaluation
- Error handling

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```bash
   VITE_SAVVAGENT_API_URL=http://localhost:8080
   VITE_SAVVAGENT_SDK_KEY=your-sdk-key-here
   ```

3. **Run the development server:**
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:5173](http://localhost:5173)

## Usage

### Basic Example

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { SavvagentClient } from '@savvagent/sdk';

  let isEnabled = $state(false);
  let loading = $state(true);

  onMount(async () => {
    const client = new SavvagentClient({
      apiUrl: import.meta.env.VITE_SAVVAGENT_API_URL,
      sdkKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY,
    });

    isEnabled = await client.isEnabled('new-feature', {
      userId: 'user-123',
    });
    loading = false;
  });
</script>

{#if loading}
  <p>Loading...</p>
{:else if isEnabled}
  <NewFeature />
{:else}
  <OldFeature />
{/if}
```

### With Error Handling

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { SavvagentClient } from '@savvagent/sdk';

  let isEnabled = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const client = new SavvagentClient({
        apiUrl: import.meta.env.VITE_SAVVAGENT_API_URL,
        sdkKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY,
      });

      isEnabled = await client.isEnabled('new-feature', {
        userId: 'user-123',
      });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading = false;
    }
  });
</script>
```

## Learn More

- [SvelteKit Documentation](https://kit.svelte.dev/)
- [Svelte 5 Documentation](https://svelte-5-preview.vercel.app/)
- [Savvagent SDK Documentation](../../packages/typescript/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
