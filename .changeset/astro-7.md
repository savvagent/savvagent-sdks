---
'@savvagent/astro': major
---

Support Astro 4.14 through 7 and provide `Astro.locals.savvagent`.

- The peer range is now `astro >=4.14.0 <8` (was `>=3.0.0 <5`). The integration injects its `App.Locals` types with `injectTypes`, which Astro added in 4.14, so Astro 3.x and 4.0 to 4.13 are no longer supported. Built and tested on Astro 7.4; the example's full E2E suite also passes on Astro 4.16, 5.18 and 6.4.
- The integration now actually provides `Astro.locals.savvagent` (`isEnabled`, `evaluate`, `withFlag`, `trackError`, `context`, `client`) on every request, with context from the request's cookies and `Accept-Language`. Previously pages that read it threw. The `SavvagentLocals` type and `createSavvagentMiddleware()` are exported. `client` is process-wide and must not be mutated per request.
- Visitors without a `savvagent_anonymous_id` cookie get a random anonymous ID, set as that cookie, so they keep a stable rollout bucket. Prerendered pages read no request headers or cookies (Astro 5+).
- New `configModule` option: a module whose default export is the config, imported by the middleware at server runtime, so environment variables are read when the server starts and function options such as `onError` are kept. The inline `config` option still works but is inlined as JSON at build time and drops function options (with a warning).
- The config is validated at startup and problems are logged. If the client cannot be created, requests render with flag defaults instead of failing.
- The server-side client is created by the middleware instead of in `astro:config:setup`, and realtime (SSE) is off on the server unless `enableRealtime: true` is set.
- The `./middleware` entry is ESM only.
