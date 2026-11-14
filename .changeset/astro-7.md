---
'@savvagent/astro': major
---

Support Astro 5, 6 and 7 and provide `Astro.locals.savvagent`.

- The peer range is now `astro >=5.0.0 <8` (was `>=3.0.0 <5`). The integration registers its middleware with `addMiddleware` and injects `App.Locals` types with `injectTypes`, which Astro 4 and earlier lack, so Astro 3 and 4 are no longer supported. Built and tested on Astro 7.4; the example's full E2E suite also passes on Astro 5.18 and 6.4.
- The integration now actually provides `Astro.locals.savvagent` (`isEnabled`, `evaluate`, `withFlag`, `trackError`, `context`, `client`) on every request, with context taken from the request's cookies and `Accept-Language`. Previously pages that read it threw. The `SavvagentLocals` type and `createSavvagentMiddleware()` are exported.
- The server-side client is created by the middleware at request time instead of in `astro:config:setup`, and realtime (SSE) is off on the server unless `enableRealtime: true` is set.
- The integration `config` is serialized as JSON into the server bundle, so function options such as `onError` no longer reach the integration's client.
