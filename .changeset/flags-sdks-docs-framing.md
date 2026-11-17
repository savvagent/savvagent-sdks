---
"@savvagent/sdk": patch
"@savvagent/react": patch
"@savvagent/angular": patch
"@savvagent/vue": patch
"@savvagent/solid": patch
"@savvagent/svelte": patch
"@savvagent/nextjs": patch
"@savvagent/react-router": patch
"@savvagent/sveltekit": patch
"@savvagent/astro": patch
"@savvagent/node-server": patch
---

Docs: the READMEs describe these packages as the Flags SDKs for savvagent-services, say that the copies on npm before this release are older than the source (and that `@savvagent/react-router` had none), and link the repository's install-from-source route. The `@savvagent/sdk` README now names the package `@savvagent/sdk` instead of `@savvagent/typescript`. The `@savvagent/nextjs` README explains moving from `middleware.ts` to Next.js 16's `proxy.ts`, and that the anonymous-ID cookie's `Secure` attribute trusts the `x-forwarded-proto` header as sent.
