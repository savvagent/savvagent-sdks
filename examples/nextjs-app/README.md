# Savvagent Next.js Example

Example Next.js application demonstrating how to use the Savvagent SDK with React Server Components and Client Components.

## Features

- Next.js 16 with App Router
- TypeScript
- Client-side feature flag evaluation
- Server Component evaluation and middleware (`@savvagent/nextjs/server`, `@savvagent/nextjs/middleware`)
- Real-time updates (optional)
- Tailwind CSS styling

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
   NEXT_PUBLIC_SAVVAGENT_API_URL=http://localhost:8080
   NEXT_PUBLIC_SAVVAGENT_SDK_KEY=your-sdk-key-here
   ```

3. **Run the development server:**
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Server-side evaluation

`app/components/ServerFlag.tsx` is a Server Component that evaluates
`server-demo` with `evaluate` from `@savvagent/nextjs/server`, so the result
is in the initial HTML. `middleware.ts` uses `createMiddleware` from
`@savvagent/nextjs/middleware` to give a first-time visitor the
`savvagent_anonymous_id` cookie; the page rendered for that request
evaluates with the same ID. The `user_id` cookie is not trusted (pass
`getUserId` to `initServerClient` to identify signed-in users).

Both read server-only variables (`lib/savvagent-server-config.ts`):

```bash
SAVVAGENT_FLAGS_API_KEY=your-server-key-here
# Optional; defaults to the SDK's Flags API
SAVVAGENT_FLAGS_API_URL=http://localhost:8080
```

The E2E suite points `SAVVAGENT_FLAGS_API_URL` at a mock Flags API
(`examples/e2e/mock-flags-api.mjs`); see `examples/e2e/specs/server-evaluation.spec.ts`.

## Usage

### Client Component Example

```typescript
'use client';

import { SavvagentClient } from '@savvagent/sdk';
import { useEffect, useState } from 'react';

export default function MyComponent() {
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    const client = new SavvagentClient({
      apiUrl: process.env.NEXT_PUBLIC_SAVVAGENT_API_URL!,
      sdkKey: process.env.NEXT_PUBLIC_SAVVAGENT_SDK_KEY!,
    });

    client.isEnabled('new-feature', { userId: 'user-123' })
      .then(setIsEnabled);
  }, []);

  return isEnabled ? <NewFeature /> : <OldFeature />;
}
```

### Custom Hook

See `app/hooks/useFeatureFlag.ts` for a reusable hook.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Savvagent SDK Documentation](../../packages/typescript/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
