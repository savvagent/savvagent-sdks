# @savvagent/astro

Astro integration for Savvagent with server-side rendering and middleware support.

## Installation

```bash
npm install @savvagent/astro
```

## Quick Start

### 1. Add Integration

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import savvagent from '@savvagent/astro';

export default defineConfig({
  integrations: [
    savvagent({
      config: {
        apiKey: process.env.SAVVAGENT_API_KEY,
        applicationId: process.env.SAVVAGENT_APP_ID,
      },
    }),
  ],
});
```

### 2. Use in Astro Components

```astro
---
import { isEnabled } from '@savvagent/astro';

const showNewLayout = await isEnabled('new-layout', {
  user_id: Astro.cookies.get('user_id')?.value,
});
---

{showNewLayout ? (
  <NewLayout />
) : (
  <OldLayout />
)}
```

## API Reference

### Server-Side Functions

#### `isEnabled(flagKey, context?)`

Check if a flag is enabled.

```astro
---
import { isEnabled } from '@savvagent/astro';

const enabled = await isEnabled('my-feature');
---
```

#### `evaluate(flagKey, context?)`

Get detailed evaluation result.

```astro
---
import { evaluate } from '@savvagent/astro';

const result = await evaluate('premium-features');
const { value, reason, metadata } = result;
---
```

#### `withFlag(flagKey, callback, context?)`

Execute code conditionally.

```astro
---
import { withFlag } from '@savvagent/astro';

const data = await withFlag('use-new-api', async () => {
  return await fetchFromNewAPI();
});
---
```

#### `evaluateForRequest(request, flagKey, context?)`

Evaluate with automatic request context.

```astro
---
import { evaluateForRequest } from '@savvagent/astro';

const showBeta = await evaluateForRequest(Astro.request, 'beta-ui');
---
```

### Middleware

Create middleware for flag-based routing:

```ts
// src/middleware.ts
import { sequence } from 'astro/middleware';
import { createFlagMiddleware } from '@savvagent/astro';

const flagMiddleware = createFlagMiddleware({
  'maintenance-mode': {
    redirect: '/maintenance',
  },
  'beta-access': {
    rewrite: (url) => '/beta' + url.pathname,
  },
});

export const onRequest = sequence(flagMiddleware);
```

## Using with UI Frameworks

Astro supports multiple UI frameworks. Use the appropriate SDK in your islands:

### React Islands

```astro
---
// Import server-side
import { isEnabled } from '@savvagent/astro';
const serverFlag = await isEnabled('ssr-feature');
---

<!-- Client-side React island -->
<ReactComponent client:load>
  {/* Use @savvagent/react hooks inside */}
</ReactComponent>
```

### Vue Islands

```astro
<VueComponent client:load>
  {/* Use @savvagent/vue composables inside */}
</VueComponent>
```

## License

MIT
