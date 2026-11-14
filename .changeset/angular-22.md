---
'@savvagent/angular': minor
---

Support Angular 22. The `@angular/core` and `@angular/common` peer range widens from `>=14.0.0 <19` to `>=14.0.0 <23`. The floor stays at 14: the package is still built in partial compilation mode, and every declaration it emits needs a linker no newer than Angular 14 (`minVersion` 12.0.0 or 14.0.0).

The package is now built with ng-packagr 22 and TypeScript 6. Type declarations move to `dist/types/savvagent-angular.d.ts`, and `types` and `exports` point there. The `esm2022` and `esm` export conditions now resolve to the FESM bundle, because ng-packagr no longer emits a separate `esm2022` directory.

Fixes:
- After `setOverride`, `clearOverride` or `setOverrides`, active `flag$()` streams now re-evaluate and emit the new value. Before, re-evaluation threw while parsing the flag context back out of its cache key.
- `defaultContext.userId` now sets the client's user ID, as the React and Vue SDKs already did, so `getUserId()` returns it after initialization.
