---
'@savvagent/sdk': patch
---

In the browser, the client now uses the `savvagent_anonymous_id` cookie as its anonymous ID when one is present (and mirrors it to localStorage), falling back to the localStorage ID as before. Server integrations such as `@savvagent/astro` set that cookie, so server-rendered and client-side evaluations put a visitor in the same rollout bucket.
