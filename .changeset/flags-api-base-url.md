---
'@savvagent/sdk': patch
'@savvagent/node-server': patch
'@savvagent/angular': patch
'@savvagent/nextjs': patch
---

Default the Flags API base URL to `https://api.savvagent.com/flags` and strip trailing slashes from a supplied base URL. `@savvagent/node-server` now reads `enabled` from the evaluate response; before, every flag returned its configured default.
