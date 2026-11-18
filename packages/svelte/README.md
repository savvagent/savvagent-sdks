# @savvagent/svelte

Svelte SDK for [Savvagent Flags](https://github.com/savvagent/flags-sdks), the feature flag product of [savvagent-services](https://github.com/savvagent/savvagent-services), with stores and real-time updates. Compatible with Svelte 4 and 5.

## Installation

```bash
npm install @savvagent/svelte
```

> **The copy on npm is older.** Installing by name gets 1.1.0 (published 2025-12-30), which predates the current source, until the next release is published. To use the current source now, see [Installation](https://github.com/savvagent/flags-sdks#installation) in the repository README.

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
