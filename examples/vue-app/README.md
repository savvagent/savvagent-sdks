# Savvagent Vue Example

Example Vue 3 application demonstrating how to use the Savvagent Vue SDK with composables.

## Features

- Vue 3 with Composition API
- TypeScript
- Vite for fast development
- Savvagent Vue composables (`useFeatureFlag`, `useSavvagent`)
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

4. Open [http://localhost:5174](http://localhost:5174)

## Usage

### Using the Vue Composable

```vue
<script setup lang="ts">
import { useFeatureFlag } from '@savvagent/vue';

const { isEnabled, loading } = useFeatureFlag('new-feature', {
  userId: 'user-123',
  attributes: {
    email: 'user@example.com',
    plan: 'pro',
  },
});
</script>

<template>
  <div v-if="loading">Loading...</div>
  <NewFeature v-else-if="isEnabled" />
  <OldFeature v-else />
</template>
```

### Using the Plugin

```typescript
import { createApp } from 'vue';
import { createSavvagent } from '@savvagent/vue';
import App from './App.vue';

const app = createApp(App);

app.use(createSavvagent({
  apiUrl: import.meta.env.VITE_SAVVAGENT_API_URL,
  sdkKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY,
}));

app.mount('#app');
```

## Learn More

- [Vue 3 Documentation](https://vuejs.org/)
- [Savvagent Vue SDK Documentation](../../packages/vue/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
