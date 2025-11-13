# Savvagent Svelte Example

Example Svelte application demonstrating how to use the Savvagent Svelte SDK with stores.

## Features

- Svelte 4 with reactive stores
- TypeScript
- Vite for fast development
- Savvagent Svelte stores (`featureFlag`, `savvagentContext`)
- Real-time feature flag updates
- Hot module replacement

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local`:
   ```bash
   VITE_SAVVAGENT_API_URL=http://localhost:8080
   VITE_SAVVAGENT_SDK_KEY=your-sdk-key-here
   ```

3. **Run the development server:**
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:5176](http://localhost:5176)

## Usage

### Using Svelte Stores

```svelte
<script lang="ts">
  import { featureFlag } from '@savvagent/svelte';

  const newFeature = featureFlag('new-feature', {
    userId: 'user-123',
    attributes: {
      email: 'user@example.com',
      plan: 'pro',
    },
  });
</script>

{#if $newFeature.loading}
  <div>Loading...</div>
{:else if $newFeature.isEnabled}
  <NewFeature />
{:else}
  <OldFeature />
{/if}
```

### Using the Context

```svelte
<script lang="ts">
  import { setSavvagentContext } from '@savvagent/svelte';

  setSavvagentContext({
    apiUrl: import.meta.env.VITE_SAVVAGENT_API_URL,
    sdkKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY,
  });
</script>

<slot />
```

## Learn More

- [Svelte Documentation](https://svelte.dev/)
- [Savvagent Svelte SDK Documentation](../../packages/svelte/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
