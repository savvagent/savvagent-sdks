---
'@savvagent/astro': patch
'@savvagent/react-router': patch
---

Defaults are read as own properties only. A flag key such as `__proto__`, `toString` or `constructor` no longer evaluates to an inherited value when the client is unavailable. It evaluates to `false`, matching `@savvagent/sdk`.
