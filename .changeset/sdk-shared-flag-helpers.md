---
'@savvagent/sdk': patch
---

`defaultFor` and `isValidFlagKey` now have one definition, shared by the client and `@savvagent/sdk/server`; both entry points export the same functions, with the same signatures. `fallbackResult` from `@savvagent/sdk/server` takes an optional `{ timestamp: true }` that adds `metadata.timestamp`. `parseLanguage` and `compactContext` are no longer exported from `@savvagent/sdk/server` (the subpath is unreleased and no package used them).
