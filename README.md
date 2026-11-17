# Savvagent SDKs

Official SDKs and example applications for [Savvagent](https://savvagent.com) - the AI-powered feature flag platform that prevents production incidents.

## Packages

### Client SDKs

- **[@savvagent/sdk](./packages/typescript)** - TypeScript/JavaScript SDK for feature flags
  - Works with React, Next.js, SvelteKit, Node.js, and more
  - Real-time flag updates via Server-Sent Events (SSE)
  - Built-in caching and telemetry
  - Type-safe API

### Framework SDKs

- **[@savvagent/react](./packages/react)** - React hooks for feature flags
- **[@savvagent/angular](./packages/angular)** - Angular module and injectable service (RxJS observables) for feature flags
- **[@savvagent/vue](./packages/vue)** - Vue 3 composables for feature flags
- **[@savvagent/solid](./packages/solid)** - SolidJS primitives for feature flags
- **[@savvagent/svelte](./packages/svelte)** - Svelte stores for feature flags
- **[@savvagent/nextjs](./packages/nextjs)** - Next.js integration with App Router & Pages Router
- **[@savvagent/react-router](./packages/react-router)** - React Router 8 (framework mode): flags evaluated in loaders, actions and middleware, hydrated without a flash of defaults. Replaces `@savvagent/remix` ([migration](./packages/react-router#migrating-from-savvagentremix))
- **[@savvagent/sveltekit](./packages/sveltekit)** - SvelteKit server-side integration
- **[@savvagent/astro](./packages/astro)** - Astro integration for feature flags

### Mobile SDKs

- **[SavvagentSDK (iOS)](./packages/ios-sdk)** - iOS SDK
  - Native Swift with async/await
  - SwiftUI and UIKit support
  - Real-time updates via Server-Sent Events (SSE)
  - iOS 15+, macOS 12+, tvOS 15+ and watchOS 8+

- **[savvagent-android-sdk](./packages/android-sdk)** - Android SDK
  - Native Kotlin with Coroutines
  - Jetpack Compose integration
  - Flow-based reactive updates
  - Material Design 3 support

### Server SDKs

- **[@savvagent/node-server](./packages/node-server)** - Node.js Server SDK
  - Built for Express, Fastify, NestJS, and more
  - Server-Sent Events for real-time updates
  - In-memory caching with configurable TTL
  - Full TypeScript support

- **[savvagent-flags (Python)](./packages/python-server)** - Python Server SDK
  - Distribution `savvagent-flags`, import `savvagent_flags`
  - Synchronous and asynchronous clients
  - Type hints (PEP 561)
  - Examples for FastAPI, Flask and Django

- **[savvagent-flags-java-server-sdk](./packages/java-server)** - Java Server SDK
  - Maven coordinates `com.savvagent.flags:savvagent-flags-java-server-sdk`
  - Maven and Gradle support
  - Thread-safe concurrent access
  - OkHttp-based HTTP client
  - Comprehensive JavaDocs

- **[Go server SDK](./packages/go-server)** - Go Server SDK
  - Module `github.com/savvagent/flags-sdks/packages/go-server` (package `savvagentflags`)
  - Goroutine-safe concurrent access
  - Idiomatic Go patterns
  - Minimal dependencies
  - High-performance caching

- **[savvagent-flags (Rust)](./packages/rust-server)** - Rust Server SDK
  - Crate `savvagent-flags`, library `savvagent_flags`
  - Async/await with Tokio runtime
  - Zero-cost abstractions
  - Memory-safe with Rust ownership
  - Full type safety

#### Installing the Python, Go, Rust and Java SDKs

These SDKs are not published to a package registry yet (Java is not published to Maven Central). Install them from this repository, pinned to a commit
(replace `<commit>` with the commit you want):

```bash
# Python
uv add "savvagent-flags @ git+https://github.com/savvagent/flags-sdks@<commit>#subdirectory=packages/python-server"
# or: pip install "savvagent-flags @ git+https://github.com/savvagent/flags-sdks@<commit>#subdirectory=packages/python-server"

# Go
go get github.com/savvagent/flags-sdks/packages/go-server@<commit>
```

```toml
# Rust (Cargo.toml)
[dependencies]
savvagent-flags = { git = "https://github.com/savvagent/flags-sdks", rev = "<commit>" }
```

Java: The Java SDK is not published to Maven Central. Build it from source at a pinned commit (replace `<commit>`), which installs it into your local Maven repository:

```bash
git clone https://github.com/savvagent/flags-sdks
git -C flags-sdks checkout <commit>
mvn -B -f flags-sdks/packages/java-server/pom.xml install
```

Then add the dependency:

```xml
<dependency>
  <groupId>com.savvagent.flags</groupId>
  <artifactId>savvagent-flags-java-server-sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

## Quick Start

### Installation

```bash
# Using pnpm (recommended)
pnpm add @savvagent/sdk

# Using npm
npm install @savvagent/sdk

# Using yarn
yarn add @savvagent/sdk
```

### Basic Usage

```typescript
import { FlagClient } from '@savvagent/sdk';

const client = new FlagClient({
  apiKey: 'sdk_your_key', // an SDK key, which starts with sdk_
  environment: 'production',
  // baseUrl defaults to https://api.savvagent.com/flags
});

// Check if a feature is enabled
const isEnabled = await client.isEnabled('new-feature', {
  user_id: 'user-123',
  attributes: {
    email: 'user@example.com',
    plan: 'pro',
  },
});

if (isEnabled) {
  // Show new feature
} else {
  // Show old feature
}
```

## Examples

Working example applications are available in the [examples](./examples) directory:

### Mobile Examples

- **[iOS App](./examples/ios-app)** - SwiftUI app with native iOS SDK
- **[Android App](./examples/android-app)** - Jetpack Compose app with Kotlin

### Client & Framework Examples

- **[React App](./examples/react-app)** - React 19 with Vite and hooks
- **[Angular App](./examples/angular-app)** - Angular with the Savvagent service
- **[Vue App](./examples/vue-app)** - Vue 3 with Composition API
- **[Solid App](./examples/solid-app)** - SolidJS with reactive primitives
- **[Svelte App](./examples/svelte-app)** - Svelte 5 with stores
- **[Next.js App](./examples/nextjs-app)** - React Server Components + Client Components
- **[React Router App](./examples/react-router-app)** - React Router 8 framework mode, flags evaluated in the root loader
- **[SvelteKit App](./examples/sveltekit-app)** - SvelteKit 3 with Svelte 5 runes
- **[Astro App](./examples/astro-app)** - Astro with integration

### Server Examples

- **[Node.js Backend](./examples/node-backend)** - Express API server
- **[Python Server](./examples/python-server)** - Python with FastAPI and Flask
- **[Java Server](./examples/java-server)** - Spring Boot 3.2 with Maven
- **[Go Server](./examples/go-server)** - Go with Gin framework
- **[Rust Server](./examples/rust-server)** - Rust with Axum and Tokio

## Documentation

- **[SDK Integration Guide](./docs/SDK-INTEGRATION.md)** - Complete integration instructions
- **[Migration Guide](./docs/MIGRATION.md)** - Migrating from the old repo structure
- **[API Reference](./packages/typescript/README.md)** - Full SDK API documentation

## AI-Assisted Development

Use AI coding assistants (Claude Code, Cursor, GitHub Copilot) to integrate Savvagent faster. We provide AI-optimized documentation:

| File | Description | Use Case |
|------|-------------|----------|
| [llms.txt](./llms.txt) | Quick reference (~6KB) | Fast lookups, links to detailed docs |
| [llms-full.txt](./llms-full.txt) | Complete docs (~22KB) | Full context for complex integrations |

### Quick Start with AI

**Claude Code / Cursor:**
```
Add Savvagent feature flags to my React app.
Reference: https://raw.githubusercontent.com/savvagent/flags-sdks/master/llms-full.txt
```

**Add to project context** for better suggestions:
```bash
# Claude Code - add to .claude/settings.json
# Cursor - add to Settings > Features > Docs
https://raw.githubusercontent.com/savvagent/flags-sdks/master/llms-full.txt
```

See **[AI-Assisted Development Guide](./docs/AI-ASSISTED-DEVELOPMENT.md)** for detailed instructions.

## Development

This is a pnpm workspace monorepo with independent package versioning.

### Prerequisites

- Node.js 22.23.4+
- pnpm 10 (pinned with `packageManager`; run `corepack enable` or let pnpm switch itself)

### Setup

```bash
# Clone the repository
git clone https://github.com/savvagent/flags-sdks.git
cd flags-sdks

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

### Local Development

To use local packages in another project:

```json
{
  "dependencies": {
    "@savvagent/sdk": "file:../flags-sdks/packages/typescript"
  }
}
```

### Making Changes

1. Create a branch for your changes
2. Make your changes
3. Add a changeset:
   ```bash
   pnpm changeset
   ```
4. Commit and push your changes
5. Create a pull request

When your PR is merged:
- A "Version Packages" PR will be created automatically
- Merging that PR will publish to npm

### Project Structure

```
flags-sdks/
├── packages/
│   ├── typescript/          # @savvagent/sdk (base TypeScript SDK)
│   ├── react/              # @savvagent/react
│   ├── angular/            # @savvagent/angular
│   ├── vue/                # @savvagent/vue
│   ├── solid/              # @savvagent/solid
│   ├── svelte/             # @savvagent/svelte
│   ├── nextjs/             # @savvagent/nextjs
│   ├── react-router/       # @savvagent/react-router
│   ├── sveltekit/          # @savvagent/sveltekit
│   ├── astro/              # @savvagent/astro
│   ├── ios-sdk/            # iOS SDK (Swift)
│   ├── android-sdk/        # Android SDK (Kotlin)
│   ├── node-server/        # @savvagent/node-server
│   ├── python-server/      # Python server SDK (savvagent-flags)
│   ├── java-server/        # Java server SDK
│   ├── go-server/          # Go server SDK
│   └── rust-server/        # Rust server SDK
├── examples/
│   ├── ios-app/            # iOS SwiftUI example
│   ├── android-app/        # Android Jetpack Compose example
│   ├── react-app/          # React example
│   ├── angular-app/        # Angular example
│   ├── vue-app/            # Vue example
│   ├── solid-app/          # SolidJS example
│   ├── svelte-app/         # Svelte example
│   ├── nextjs-app/         # Next.js example
│   ├── react-router-app/   # React Router 8 example
│   ├── sveltekit-app/      # SvelteKit example
│   ├── astro-app/          # Astro example
│   ├── node-backend/       # Node.js example
│   ├── python-server/      # Python server example
│   ├── java-server/        # Java server example
│   ├── go-server/          # Go server example
│   └── rust-server/        # Rust server example
├── docs/                   # Documentation
├── .changeset/             # Changesets for versioning
└── .github/workflows/      # CI/CD pipelines
```

## Versioning

This monorepo uses [Changesets](https://github.com/changesets/changesets) for independent package versioning. Each package can have its own version number and be published independently.

### Semantic Versioning

- **Major (x.0.0)**: Breaking changes
- **Minor (0.x.0)**: New features (backwards compatible)
- **Patch (0.0.x)**: Bug fixes

## CI/CD

### Continuous Integration

Every pull request runs [`ci.yml`](./.github/workflows/ci.yml):
- JS packages: lint, build and unit tests
- E2E tests (Playwright) for each framework example app
- Rust SDK and example: `cargo fmt`, `clippy` and tests
- Python SDK: `ruff`, `mypy` and `pytest`
- Go SDK and example: `gofmt`, `go vet` and `go test -race`
- Java SDK and example: `mvn install`

### Automated Publishing

On merge to `master`:
1. Changesets creates a "Version Packages" PR
2. Merging that PR triggers npm publish
3. Git tags are created for each published version

## Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run `pnpm changeset` to document changes
6. Submit a pull request

### Code Style

- TypeScript for the JS packages; each other SDK follows its language's standard tooling (rustfmt, ruff, gofmt)
- ESLint + Prettier for formatting
- Conventional commits for messages

### Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @savvagent/sdk test

# Watch mode
pnpm --filter @savvagent/sdk test:watch
```

## License

MIT License - see [LICENSE](./LICENSE) for details

## Support

- **Documentation**: [docs/](./docs)
- **Examples**: [examples/](./examples)
- **Issues**: [GitHub Issues](https://github.com/savvagent/flags-sdks/issues)
- **Discussions**: [GitHub Discussions](https://github.com/savvagent/flags-sdks/discussions)

## Related Projects

- **[Savvagent](https://savvagent.com)** - The Savvagent platform

## Packages Status

### Mobile SDKs

| Package | Platform | Version | Status |
|---------|----------|---------|--------|
| [SavvagentSDK](./packages/ios-sdk) | iOS 15+ | v0.1.0 | Beta |
| [savvagent-android-sdk](./packages/android-sdk) | Android 5.0+ | v0.1.0 | Beta |

### Client & Framework SDKs

| Package | Version | Status |
|---------|---------|--------|
| [@savvagent/sdk](./packages/typescript) | [![npm](https://img.shields.io/npm/v/@savvagent/sdk)](https://www.npmjs.com/package/@savvagent/sdk) | Stable |
| [@savvagent/angular](./packages/angular) | [![npm](https://img.shields.io/npm/v/@savvagent/angular)](https://www.npmjs.com/package/@savvagent/angular) | Beta |
| [@savvagent/react](./packages/react) | [![npm](https://img.shields.io/npm/v/@savvagent/react)](https://www.npmjs.com/package/@savvagent/react) | Beta |
| [@savvagent/vue](./packages/vue) | [![npm](https://img.shields.io/npm/v/@savvagent/vue)](https://www.npmjs.com/package/@savvagent/vue) | Beta |
| [@savvagent/solid](./packages/solid) | [![npm](https://img.shields.io/npm/v/@savvagent/solid)](https://www.npmjs.com/package/@savvagent/solid) | Beta |
| [@savvagent/svelte](./packages/svelte) | [![npm](https://img.shields.io/npm/v/@savvagent/svelte)](https://www.npmjs.com/package/@savvagent/svelte) | Beta |
| [@savvagent/nextjs](./packages/nextjs) | [![npm](https://img.shields.io/npm/v/@savvagent/nextjs)](https://www.npmjs.com/package/@savvagent/nextjs) | Beta |
| [@savvagent/react-router](./packages/react-router) | [![npm](https://img.shields.io/npm/v/@savvagent/react-router)](https://www.npmjs.com/package/@savvagent/react-router) | Beta |
| [@savvagent/sveltekit](./packages/sveltekit) | [![npm](https://img.shields.io/npm/v/@savvagent/sveltekit)](https://www.npmjs.com/package/@savvagent/sveltekit) | Beta |
| [@savvagent/astro](./packages/astro) | [![npm](https://img.shields.io/npm/v/@savvagent/astro)](https://www.npmjs.com/package/@savvagent/astro) | Beta |

> Remix is now React Router. Use [`@savvagent/react-router`](./packages/react-router) instead of `@savvagent/remix`; see [Migrating from @savvagent/remix](./packages/react-router#migrating-from-savvagentremix).

### Server SDKs

| Package | Language | Version | Status |
|---------|----------|---------|--------|
| [@savvagent/node-server](./packages/node-server) | Node.js | v1.1.0 | Beta |
| [savvagent-flags](./packages/python-server) | Python 3.9+ | v1.1.0 | Beta |
| [savvagent-flags-java-server-sdk](./packages/java-server) | Java 11+ | v0.1.0 | Beta |
| [github.com/savvagent/flags-sdks/packages/go-server](./packages/go-server) | Go 1.21+ | v0.1.0 | Beta |
| [savvagent-flags](./packages/rust-server) | Rust (stable) | v0.1.0 | Beta |
