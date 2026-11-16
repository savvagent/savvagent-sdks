---
'@savvagent/sdk': patch
---

Port fixes from the archived flags repo, and harden the evaluate path (#39).

- Flag keys are validated and sent as exactly one percent-encoded path segment. A key no flag can have (outside 1-128 characters of `[A-Za-z0-9._-]`, or `.` or `..`) no longer reaches the network, where `/`, `?`, `#` or `..` could steer the request and its SDK key to another endpoint. `evaluate` returns the default with `reason: 'error'` and the problem in `metadata.description`, and reports the same error to `onError`.
  - The key is checked before the override lookup, so a local-only override on an invalid key such as `'my flag'` now returns an error instead of the override value.
  - A non-string key from untyped JavaScript (`undefined`, `null`, a number, an object) now fails the same way instead of being interpolated into the URL.
- An evaluate response without a boolean `enabled` is a failed lookup: `evaluate` returns the default with `reason: 'error'`, reports it to `onError`, and does not cache it. Before, it was read as `false` and cached for the TTL. A `null` `configuration` or `variation` is now reported as `undefined`, as the types say.
- An evaluation whose request started before an invalidation is no longer cached, so a kill switch flipped mid-request is not undone by the stale answer. A realtime update, `clearCache()`, `setEnvironment()`, and setting or clearing an override all count; setting or clearing an override now also drops that flag's cached results. `FlagCache` gains `generation(key)` and an optional trailing `generation` parameter on `set`; existing calls are unchanged. The per-flag generation counts are bounded by `cacheMaxEntries`.
- A configured default is read only from `defaults`' own properties, and only `true` counts. A flag key such as `__proto__`, `toString` or `constructor` used to return `Object.prototype` or a function as its value on an error path; it now returns `false`.
- The 10 second request abort timer is cleared even when `fetch` throws synchronously (for example when it is not defined), so it no longer keeps a Node process alive.
- `metadata.version` reports the server's flag version on fresh and cached results, only when it is an integer; a malformed `version` or `scope` is dropped instead of failing the lookup.
