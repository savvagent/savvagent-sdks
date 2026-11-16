---
'@savvagent/sdk': patch
---

Port two fixes from the archived flags repo (#39).

- Flag keys are validated and sent as exactly one percent-encoded path segment. A key no flag can have (outside 1-128 characters of `[A-Za-z0-9._-]`, or `.` or `..`) no longer reaches the network, where `/`, `?`, `#` or `..` could steer the request and its SDK key to another endpoint. `evaluate` returns the default with `reason: 'error'` and the problem in `metadata.description`, and reports the same error to `onError`.
- An evaluation whose request started before an invalidation is no longer cached, so a kill switch flipped mid-request is not undone by the stale answer. A realtime update, `clearCache()`, `setEnvironment()`, and setting or clearing an override all count; setting or clearing an override now also drops that flag's cached results. `FlagCache` gains `generation(key)` and an optional trailing `generation` parameter on `set`; existing calls are unchanged.
