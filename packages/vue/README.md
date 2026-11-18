# @savvagent/vue

Vue 3 SDK for [Savvagent Flags](https://github.com/savvagent/flags-sdks), the feature flag product of [savvagent-services](https://github.com/savvagent/savvagent-services), with Composition API composables.

## Installation

```bash
npm install @savvagent/vue
```

> **The copy on npm is older.** Installing by name gets 1.1.0 (published 2025-12-30), which predates the current source, until the next release is published. To use the current source now, see [Installation](https://github.com/savvagent/flags-sdks#installation) in the repository README.

## Quick Start

```vue
<script setup>
import { createApp } from 'vue';
import { SavvagentPlugin, useFlag } from '@savvagent/vue';
import App from './App.vue';

// Install plugin
const app = createApp(App);
app.use(SavvagentPlugin, {
  apiKey: 'sdk_...',
  applicationId: 'your-app-id',
});
app.mount('#app');
</script>
```

## Composables

### `useFlag(flagKey, options)`

```vue
<script setup>
import { useFlag } from '@savvagent/vue';

const { value: isEnabled, loading } = useFlag('new-feature', {
  context: { user_id: user.value?.id },
  defaultValue: false,
  realtime: true,
});
</script>

<template>
  <div v-if="loading">Loading...</div>
  <NewFeature v-else-if="isEnabled" />
  <OldFeature v-else />
</template>
```

### `useSavvagent()`

Get the client instance for advanced usage.

### `useUser()`

Manage user identification.

```vue
<script setup>
import { useUser } from '@savvagent/vue';
import { watch } from 'vue';

const { setUserId } = useUser();

watch(currentUser, (user) => {
  setUserId(user?.id || null);
});
</script>
```

### `useTrackError(flagKey, context)`

Track errors with flag context.

## License

MIT
