# Savvagent Astro Example

Example Astro application demonstrating how to use the Savvagent Astro integration.

## Features

- Astro 7 with on-demand server rendering (`@astrojs/node` adapter)
- TypeScript
- Savvagent Astro integration: flags evaluated on the server through `Astro.locals.savvagent`
- A plain client script (no UI framework) that takes over in the browser: flag override panel (Ctrl+Shift+F), user switching, error tracking and realtime updates

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
   # Server-side evaluation (Astro.locals.savvagent)
   SAVVAGENT_API_URL=http://localhost:8080
   SAVVAGENT_SDK_KEY=your-sdk-key-here
   # Browser client
   PUBLIC_SAVVAGENT_API_URL=http://localhost:8080
   PUBLIC_SAVVAGENT_SDK_KEY=your-public-sdk-key-here
   ```

   `SAVVAGENT_SDK_KEY` and `SAVVAGENT_API_URL` are used by the server. The page
   sends `PUBLIC_SAVVAGENT_SDK_KEY` (a public client `sdk_` key, visible to every
   visitor) and `PUBLIC_SAVVAGENT_API_URL` to the browser client. The browser
   never falls back to the server's key or URL (the server's URL can be an
   internal address); without `PUBLIC_SAVVAGENT_API_URL` it uses
   `https://api.savvagent.com/flags`.

3. **Run the development server:**
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:4321](http://localhost:4321)

## Usage

### Configuration

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import savvagent from '@savvagent/astro';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    savvagent({
      // src/savvagent.config.mjs default-exports the client config; the
      // middleware imports it at server runtime, so process.env is read then.
      configModule: './src/savvagent.config.mjs',
      // Demo only: trust the `user_id` cookie set by the user switcher. Any
      // visitor can set it; a real app exports `getUserId` from the config
      // module instead (see the package README).
      trustUserIdCookie: true,
    }),
  ],
});
```

### Using in Pages

```astro
---
const isEnabled = await Astro.locals.savvagent.isEnabled('new-feature', {
  user_id: 'user-123',
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
