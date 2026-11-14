---
'@savvagent/sveltekit': minor
---

Build and unit-test against SvelteKit 3 and widen the `@sveltejs/kit` peer range to `>=1.0.0 <4`. The lower bound is unchanged: the package imports only the `RequestEvent` type from Kit (a type-only import erased at build), and the `cookies` and `request` members it reads exist in every Kit release in range. Svelte 4 and 5 remain supported. The unit tests mock the Kit `RequestEvent`; there is no end-to-end coverage of the server helpers yet (#29).
