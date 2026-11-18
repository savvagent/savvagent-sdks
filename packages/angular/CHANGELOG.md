# @savvagent/angular

## 1.2.0

### Minor Changes

- 8b34482: Support Angular 22. The `@angular/core` and `@angular/common` peer range widens from `>=14.0.0 <19` to `>=14.0.0 <23`. The floor stays at 14: the package is still built in partial compilation mode, and every declaration it emits needs a linker no newer than Angular 14 (`minVersion` 12.0.0 or 14.0.0).

  The package is now built with ng-packagr 22 and TypeScript 6. Type declarations move to `dist/types/savvagent-angular.d.ts`. The package's exports now have only `types` and `default`, the same shape as Angular's own packages; the `esm2022` and `esm` conditions are removed, because ng-packagr no longer emits a separate `esm2022` directory. A `files` list limits the published tarball to `dist/fesm2022`, `dist/types`, the README and the CHANGELOG.

  The package's unit tests run against a stub of `@angular/core`, so they do not exercise a real Angular runtime. The Angular 22 runtime is covered by the `examples/angular-app` end-to-end suite.

  Fixes:
  - After `setOverride`, `clearOverride` or `setOverrides`, active `flag$()` streams now re-evaluate and emit the new value. Before, re-evaluation threw while parsing the flag context back out of its cache key. If re-evaluation fails, the stream falls back to its `defaultValue`.
  - `flag$()` streams are now shared per flag key and context only while they have subscribers. When the last subscriber unsubscribes, the stream's realtime subscription is closed and it is no longer re-evaluated. A stream is evaluated when it is first subscribed to, not when `flag$()` is called.
  - `defaultContext.userId` now sets the client's user ID, as the React and Vue SDKs already did, so `getUserId()` returns it after initialization.

### Patch Changes

- 0a297ce: Fix the package's type entry points for ESM and CJS consumers (publint/attw clean).
- 8b34482: Cap peer dependency ranges at the framework majors the SDKs are built and tested against, so package managers no longer claim support for untested future majors. Lower bounds are unchanged.
- 68621dd: Default the Flags API base URL to `https://api.savvagent.com/flags` and strip trailing slashes from a supplied base URL. `@savvagent/node-server` now reads `enabled` from the evaluate response; before, every flag returned its configured default.
- 0a297ce: Docs: the READMEs describe these packages as the Flags SDKs for savvagent-services, say that the copies on npm before this release are older than the source (and that `@savvagent/react-router` had none), and link the repository's install-from-source route. The `@savvagent/sdk` README now names the package `@savvagent/sdk` instead of `@savvagent/typescript`. The `@savvagent/nextjs` README explains moving from `middleware.ts` to Next.js 16's `proxy.ts`, and that the anonymous-ID cookie's `Secure` attribute trusts the `x-forwarded-proto` header as sent.
- Updated dependencies [1965cc7]
- Updated dependencies [68621dd]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [8b34482]
- Updated dependencies [0a297ce]
- Updated dependencies [8b34482]
- Updated dependencies [f92d5f2]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [8b34482]
  - @savvagent/sdk@1.2.0

## 1.1.0

### Minor Changes

- Add environment support with setEnvironment/getEnvironment methods across all SDKs for dynamic environment switching at runtime.

### Patch Changes

- Updated dependencies
  - @savvagent/sdk@1.1.0

## 1.0.1

### Patch Changes

- Updates for new API parameters
- Updated dependencies
  - @savvagent/sdk@1.0.1

## 1.0.0

### Features

- Initial release of Angular SDK for Savvagent feature flags
- `SavvagentModule` - Angular module for easy SDK configuration with `forRoot()`
- `SavvagentService` - Injectable service with full feature flag functionality
- Reactive API with RxJS Observables (`flag$`, `flagValue$`, `getAllFlags$`)
- Promise-based API for non-reactive use cases (`evaluate`, `isEnabled`, `withFlag`)
- Real-time flag updates via SSE subscription
- Local override support for development and testing
- User identification and anonymous ID management
- Error tracking with flag context for AI-powered analysis
- Full TypeScript support with comprehensive type definitions
- Support for Angular 14+ (including standalone components)
- Default context configuration for application-wide settings
