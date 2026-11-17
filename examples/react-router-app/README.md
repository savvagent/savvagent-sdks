# Savvagent React Router Example

React Router 8 app in framework mode using [`@savvagent/react-router`](../../packages/react-router).

- The root middleware creates a per-request Savvagent scope (user from the server session, anonymous ID cookie).
- The root loader evaluates the demo flags on the server, and `<SavvagentProvider flags>` hydrates them, so the page renders real flag values without a flash of defaults.
- In the browser, the `@savvagent/react` hooks take over: local overrides (the flag override panel, Ctrl+Shift+F), realtime updates, error tracking and user-ID controls.

## Setup

1. Install dependencies from the repository root and build the packages:

   ```bash
   pnpm install
   pnpm build
   ```

2. Configure environment variables:

   ```bash
   cp .env.example .env
   ```

   `SAVVAGENT_FLAGS_API_KEY` and `SAVVAGENT_FLAGS_API_URL` are used by the server (root loader). The root loader sends `VITE_SAVVAGENT_FLAGS_API_KEY` (a public client `sdk_` key, visible to every visitor) and `VITE_SAVVAGENT_FLAGS_API_URL` to the browser SDK.

3. Run the dev server:

   ```bash
   pnpm dev
   ```

4. Open [http://localhost:5178](http://localhost:5178).

## Files

- `app/savvagent.server.ts`: the server integration (`createSavvagentServer`).
- `app/savvagent.ts`: flag keys and evaluation context shared by the server and the browser.
- `app/root.tsx`: middleware, loader, and the provider with hydrated flags.
- `app/components/FeatureDemo.tsx`: feature cards, error tracking and user-ID controls.
- `app/components/FlagOverridePanel.tsx`: local override panel.

The demo user ID (`user-123`) stands in for a real session lookup. The user-ID buttons change only the browser client's user, not the server's.

## E2E tests

From `examples/`:

```bash
pnpm test:e2e:react-router-app
```
