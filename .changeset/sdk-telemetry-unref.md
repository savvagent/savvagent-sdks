---
'@savvagent/sdk': patch
---

The telemetry flush timer no longer keeps a Node.js process alive on its own, so a build that evaluates flags server-side (for example while prerendering Astro pages) can exit without closing the client.
