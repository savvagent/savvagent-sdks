---
'@savvagent/sdk': minor
'@savvagent/node-server': patch
---

Cache entries are now keyed by the lowercase SHA-256 hex digest of the canonical evaluation context instead of the raw context JSON, so user IDs and attributes are no longer held as cache keys. The exported `contextCacheKey` now returns that 64-character digest. The total entry cap (`maxEntries` / `cacheMaxEntries`, default 10,000, least recently used evicted first) is unchanged. (#30)
