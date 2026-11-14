---
'@savvagent/angular': minor
---

Support Angular 22. The `@angular/core` and `@angular/common` peer range widens from `>=14.0.0 <19` to `>=14.0.0 <23`. The floor stays at 14: the package is still built in partial compilation mode, and every declaration it emits needs a linker no newer than Angular 14 (`minVersion` 12.0.0 or 14.0.0).

The package is now built with ng-packagr 22 and TypeScript 6. Type declarations move to `dist/types/savvagent-angular.d.ts`. The package's exports now have only `types` and `default`, the same shape as Angular's own packages; the `esm2022` and `esm` conditions are removed, because ng-packagr no longer emits a separate `esm2022` directory. A `files` list limits the published tarball to `dist/fesm2022`, `dist/types`, the README and the CHANGELOG.

The package's unit tests run against a stub of `@angular/core`, so they do not exercise a real Angular runtime. The Angular 22 runtime is covered by the `examples/angular-app` end-to-end suite.

Fixes:
- After `setOverride`, `clearOverride` or `setOverrides`, active `flag$()` streams now re-evaluate and emit the new value. Before, re-evaluation threw while parsing the flag context back out of its cache key. If re-evaluation fails, the stream falls back to its `defaultValue`.
- `flag$()` streams are now shared per flag key and context only while they have subscribers. When the last subscriber unsubscribes, the stream's realtime subscription is closed and it is no longer re-evaluated. A stream is evaluated when it is first subscribed to, not when `flag$()` is called.
- `defaultContext.userId` now sets the client's user ID, as the React and Vue SDKs already did, so `getUserId()` returns it after initialization.
