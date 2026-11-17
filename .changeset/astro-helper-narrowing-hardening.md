---
'@savvagent/astro': patch
---

Harden request helpers that narrow trust with `trustUserIdCookie: false` on reused `Astro.locals.savvagent`. The narrowed scope's `context` no longer exposes a `user_id` that came from the cookie. When the reused scope is not the one the middleware created (for example a copy), the helper falls back to a fresh anonymous scope that no longer throws when the client was never initialised; it returns defaults instead. The behaviour is documented on `RequestHelperOptions`.
