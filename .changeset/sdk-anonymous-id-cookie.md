---
'@savvagent/sdk': patch
---

In the browser, the client now uses the `savvagent_anonymous_id` cookie as its anonymous ID when one is present (and mirrors it to localStorage), falling back to the localStorage ID as before. Server integrations such as `@savvagent/astro` and `@savvagent/react-router` set that cookie, so server-rendered and client-side evaluations put a visitor in the same rollout bucket.

Server-set and browser-generated IDs use the same `anon_<uuid>` format. A returning visitor who already has a localStorage ID moves to the cookie ID the first time the server sets it, so their percentage-rollout bucket can change once.
