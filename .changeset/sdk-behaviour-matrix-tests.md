---
'@savvagent/sdk': patch
'@savvagent/node-server': patch
---

Add tests that pin behaviours recorded in the cross-SDK behaviour matrix (`docs/SDK-DEVELOPER-GUIDE.md`). For `@savvagent/sdk`: a `srv_` key is rejected, `trackError` without a context reports `flagEnabled: true` with no last-value fallback, there is no static client, cache-only read or env-derived default, and a realtime event's key is not validated before its cache entry is invalidated. For `@savvagent/node-server`: a `srv_` key is accepted, and a realtime event's key is not validated before its cache entry is invalidated. No runtime change.
