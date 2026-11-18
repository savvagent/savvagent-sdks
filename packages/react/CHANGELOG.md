# @savvagent/react

## 1.2.0

### Minor Changes

- 8b34482: Support React 19 and Next.js 16. The peer ranges are widened to `react >=16.8.0 <20` for `@savvagent/react`, and to `next >=13.0.0 <17` and `react >=18.0.0 <20` for `@savvagent/nextjs`. Lower bounds are unchanged. Both packages are now built and unit-tested against React 19.3 (and Next 16.4 for `@savvagent/nextjs`). The `@savvagent/nextjs/server` and `@savvagent/nextjs/middleware` entries are covered only by unit tests that mock `next/headers` and `next/server`; end-to-end coverage is tracked in #29.

### Patch Changes

- 8b34482: Cap peer dependency ranges at the framework majors the SDKs are built and tested against, so package managers no longer claim support for untested future majors. Lower bounds are unchanged.
- 0a297ce: Docs: the READMEs describe these packages as the Flags SDKs for savvagent-services, say that the copies on npm before this release are older than the source (and that `@savvagent/react-router` had none), and link the repository's install-from-source route. The `@savvagent/sdk` README now names the package `@savvagent/sdk` instead of `@savvagent/typescript`. The `@savvagent/nextjs` README explains moving from `middleware.ts` to Next.js 16's `proxy.ts`, and that the anonymous-ID cookie's `Secure` attribute trusts the `x-forwarded-proto` header as sent.
- 0a297ce: Fix the package's type entry points for ESM and CJS consumers (publint/attw clean).
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

### Major Changes

- Initial Release of Savvagent SDKs

### Patch Changes

- Updated dependencies
  - @savvagent/sdk@1.0.0
