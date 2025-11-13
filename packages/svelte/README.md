# @savvagent/svelte

Svelte SDK for Savvagent with stores and real-time updates. Compatible with Svelte 4 and 5.

## Installation

```bash
npm install @savvagent/svelte
```

## Quick Start

```svelte
<!-- +layout.svelte -->
<script>
import { initSavvagent } from '@savvagent/svelte';

initSavvagent({
  apiKey: 'sdk_...',
  applicationId: 'your-app-id',
});
</script>

<slot />
```

## Stores

### `createFlagStore(flagKey, options)`

Full flag state with loading and error handling.

```svelte
<script>
import { createFlagStore } from '@savvagent/svelte';

const featureFlag = createFlagStore('new-feature', {
  context: { user_id: $user?.id },
  defaultValue: false,
  realtime: true,
});
</script>

{#if $featureFlag.loading}
  <p>Loading...</p>
{:else if $featureFlag.value}
  <NewFeature />
{:else}
  <OldFeature />
{/if}
```

### `createFlag(flagKey, options)`

Simple boolean store.

```svelte
<script>
import { createFlag } from '@savvagent/svelte';

const isEnabled = createFlag('new-feature');
</script>

{#if $isEnabled}
  <NewFeature />
{/if}
```

### `createUserIdStore()`

Manage user identification.

```svelte
<script>
import { createUserIdStore } from '@savvagent/svelte';

const userId = createUserIdStore();

// Set on login
$userId = user.id;

// Clear on logout
$userId = null;
</script>
```

## Functions

### `trackError(flagKey, error, context?)`

Track errors with flag context.

```svelte
<script>
import { trackError } from '@savvagent/svelte';

async function handleAction() {
  try {
    await doSomething();
  } catch (error) {
    trackError('new-feature', error);
  }
}
</script>
```

## License

MIT
