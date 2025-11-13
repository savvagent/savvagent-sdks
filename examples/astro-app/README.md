# Savvagent Astro Example

Example Astro application demonstrating how to use the Savvagent Astro integration.

## Features

- Astro with server-side rendering
- TypeScript
- Savvagent Astro integration
- Server-side feature flag evaluation
- Static site generation support

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
   SAVVAGENT_API_URL=http://localhost:8080
   SAVVAGENT_SDK_KEY=your-sdk-key-here
   ```

3. **Run the development server:**
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:4321](http://localhost:4321)

## Usage

### Configuration

```typescript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import savvagent from '@savvagent/astro';

export default defineConfig({
  integrations: [
    savvagent({
      apiUrl: process.env.SAVVAGENT_API_URL,
      sdkKey: process.env.SAVVAGENT_SDK_KEY,
    }),
  ],
});
```

### Using in Pages

```astro
---
const isEnabled = await Astro.locals.savvagent.isEnabled('new-feature', {
  userId: 'user-123',
  attributes: {
    email: 'user@example.com',
  },
});
---

{isEnabled ? (
  <NewFeature />
) : (
  <OldFeature />
)}
```

## Learn More

- [Astro Documentation](https://docs.astro.build/)
- [Savvagent Astro SDK Documentation](../../packages/astro/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
