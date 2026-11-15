---
'@savvagent/angular': patch
'@savvagent/astro': patch
'@savvagent/nextjs': patch
'@savvagent/react': patch
'@savvagent/solid': patch
'@savvagent/svelte': patch
'@savvagent/sveltekit': patch
'@savvagent/vue': patch
---

Cap peer dependency ranges at the framework majors the SDKs are built and tested against, so package managers no longer claim support for untested future majors. Lower bounds are unchanged.
