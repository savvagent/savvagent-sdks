# Savvagent SDKs

Official SDKs, MCP servers, and example applications for [Savvagent](https://www.savvagent.com) - the AI-powered feature flag platform that prevents production incidents.

## Packages

### Client SDKs

- **[@savvagent/sdk](./packages/typescript)** - TypeScript/JavaScript SDK for feature flags
  - Works with React, Next.js, SvelteKit, Node.js, and more
  - Real-time flag updates via WebSocket
  - Built-in caching and telemetry
  - Type-safe API

### Framework SDKs

- **[@savvagent/react](./packages/react)** - React hooks for feature flags
- **[@savvagent/vue](./packages/vue)** - Vue 3 composables for feature flags
- **[@savvagent/solid](./packages/solid)** - SolidJS primitives for feature flags
- **[@savvagent/svelte](./packages/svelte)** - Svelte stores for feature flags
- **[@savvagent/nextjs](./packages/nextjs)** - Next.js integration with App Router & Pages Router
- **[@savvagent/remix](./packages/remix)** - Remix loaders and actions integration
- **[@savvagent/sveltekit](./packages/sveltekit)** - SvelteKit server-side integration
- **[@savvagent/astro](./packages/astro)** - Astro integration for feature flags

### Mobile SDKs

- **[SavvagentSDK (iOS)](./packages/ios-sdk)** - iOS SDK
  - Native Swift with async/await
  - SwiftUI and UIKit support
  - Real-time updates via WebSocket
  - Works on iOS, macOS, tvOS, and watchOS

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

- **[savvagent-java-server-sdk](./packages/java-server)** - Java Server SDK
  - Maven and Gradle support
  - Thread-safe concurrent access
  - OkHttp-based HTTP client
  - Comprehensive JavaDocs

- **[savvagent-go-server-sdk](./packages/go-server)** - Go Server SDK
  - Goroutine-safe concurrent access
  - Idiomatic Go patterns
  - Minimal dependencies
  - High-performance caching

- **[savvagent (Rust)](./packages/rust-server)** - Rust Server SDK
  - Async/await with Tokio runtime
  - Zero-cost abstractions
  - Memory-safe with Rust ownership
  - Full type safety

### MCP Servers

- **[@savvagent/mcp-sdk](./packages/mcp-sdk)** - Base SDK for building MCP integrations
- **[@savvagent/mcp-sentry](./packages/mcp-sentry)** - Sentry error tracking integration

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
import { SavvagentClient } from '@savvagent/sdk';

const client = new SavvagentClient({
  apiUrl: 'https://api.savvagent.com',
  sdkKey: 'your-sdk-key',
  environment: 'production',
});

// Check if a feature is enabled
const isEnabled = await client.isEnabled('new-feature', {
  userId: 'user-123',
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

- **[React App](./examples/react-app)** - React 18 with Vite and hooks
- **[Vue App](./examples/vue-app)** - Vue 3 with Composition API
- **[Solid App](./examples/solid-app)** - SolidJS with reactive primitives
- **[Svelte App](./examples/svelte-app)** - Svelte 4 with stores
- **[Next.js App](./examples/nextjs-app)** - React Server Components + Client Components
- **[Remix App](./examples/remix-app)** - Remix with loaders and server-side evaluation
- **[SvelteKit App](./examples/sveltekit-app)** - Svelte 5 with runes
- **[Astro App](./examples/astro-app)** - Astro with integration

### Server Examples

- **[Node.js Backend](./examples/node-backend)** - Express API server
- **[Java Server](./examples/java-server)** - Spring Boot 3.2 with Maven
- **[Go Server](./examples/go-server)** - Go with Gin framework
- **[Rust Server](./examples/rust-server)** - Rust with Axum and Tokio

## Documentation

- **[SDK Integration Guide](./docs/SDK-INTEGRATION.md)** - Complete integration instructions
- **[Migration Guide](./docs/MIGRATION.md)** - Migrating from the old repo structure
- **[API Reference](./packages/typescript/README.md)** - Full SDK API documentation
- **[MCP Integration Guide](./packages/mcp-sdk/README.md)** - Building MCP servers

## AI-Assisted Development

Use AI coding assistants (Claude Code, Cursor, GitHub Copilot) to integrate Savvagent faster. We provide AI-optimized documentation:

| File | Description | Use Case |
|------|-------------|----------|
| [llms.txt](./llms.txt) | Quick reference (~4KB) | Fast lookups, links to detailed docs |
| [llms-full.txt](./llms-full.txt) | Complete docs (~15KB) | Full context for complex integrations |

### Quick Start with AI

**Claude Code / Cursor:**
```
Add Savvagent feature flags to my React app.
Reference: https://raw.githubusercontent.com/savvagent/savvagent-sdks/main/llms-full.txt
```

**Add to project context** for better suggestions:
```bash
# Claude Code - add to .claude/settings.json
# Cursor - add to Settings > Features > Docs
https://raw.githubusercontent.com/savvagent/savvagent-sdks/main/llms-full.txt
```

See **[AI-Assisted Development Guide](./docs/AI-ASSISTED-DEVELOPMENT.md)** for detailed instructions.

## Development

This is a pnpm workspace monorepo with independent package versioning.

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/savvagent-sdks.git
cd savvagent-sdks

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
    "@savvagent/sdk": "file:../savvagent-sdks/packages/typescript"
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
savvagent-sdks/
├── packages/
│   ├── typescript/          # @savvagent/sdk (base TypeScript SDK)
│   ├── react/              # @savvagent/react
│   ├── vue/                # @savvagent/vue
│   ├── solid/              # @savvagent/solid
│   ├── svelte/             # @savvagent/svelte
│   ├── nextjs/             # @savvagent/nextjs
│   ├── remix/              # @savvagent/remix
│   ├── sveltekit/          # @savvagent/sveltekit
│   ├── astro/              # @savvagent/astro
│   ├── ios-sdk/            # iOS SDK (Swift)
│   ├── android-sdk/        # Android SDK (Kotlin)
│   ├── node-server/        # @savvagent/node-server
│   ├── java-server/        # Java server SDK
│   ├── go-server/          # Go server SDK
│   ├── rust-server/        # Rust server SDK
│   ├── mcp-sdk/            # @savvagent/mcp-sdk
│   └── mcp-sentry/         # @savvagent/mcp-sentry
├── examples/
│   ├── ios-app/            # iOS SwiftUI example
│   ├── android-app/        # Android Jetpack Compose example
│   ├── react-app/          # React example
│   ├── vue-app/            # Vue example
│   ├── solid-app/          # SolidJS example
│   ├── svelte-app/         # Svelte example
│   ├── nextjs-app/         # Next.js example
│   ├── remix-app/          # Remix example
│   ├── sveltekit-app/      # SvelteKit example
│   ├── astro-app/          # Astro example
│   ├── node-backend/       # Node.js example
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

All pull requests run:
- Linting
- Type checking
- Unit tests
- Build verification

### Automated Publishing

On merge to `main`:
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

- TypeScript for all code
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
- **Issues**: [GitHub Issues](https://github.com/savvagent/savvagent-sdks/issues)
- **Discussions**: [GitHub Discussions](https://github.com/savvagent/savvagent-sdks/discussions)

## Related Projects

- **[Savvagent Platform](https://www.savvagent.com)** - The main platform repository
- **[Savvagent Docs](https://www.savvagent.com/docs)** - Official documentation

## Packages Status

### Mobile SDKs

| Package | Platform | Version | Status |
|---------|----------|---------|--------|
| [SavvagentSDK](./packages/ios-sdk) | iOS 13+ | v0.1.0 | Beta |
| [savvagent-android-sdk](./packages/android-sdk) | Android 5.0+ | v0.1.0 | Beta |

### Client & Framework SDKs

| Package | Version | Status |
|---------|---------|--------|
| [@savvagent/sdk](./packages/typescript) | [![npm](https://img.shields.io/npm/v/@savvagent/sdk)](https://www.npmjs.com/package/@savvagent/sdk) | Stable |
| [@savvagent/react](./packages/react) | [![npm](https://img.shields.io/npm/v/@savvagent/react)](https://www.npmjs.com/package/@savvagent/react) | Beta |
| [@savvagent/vue](./packages/vue) | [![npm](https://img.shields.io/npm/v/@savvagent/vue)](https://www.npmjs.com/package/@savvagent/vue) | Beta |
| [@savvagent/solid](./packages/solid) | [![npm](https://img.shields.io/npm/v/@savvagent/solid)](https://www.npmjs.com/package/@savvagent/solid) | Beta |
| [@savvagent/svelte](./packages/svelte) | [![npm](https://img.shields.io/npm/v/@savvagent/svelte)](https://www.npmjs.com/package/@savvagent/svelte) | Beta |
| [@savvagent/nextjs](./packages/nextjs) | [![npm](https://img.shields.io/npm/v/@savvagent/nextjs)](https://www.npmjs.com/package/@savvagent/nextjs) | Beta |
| [@savvagent/remix](./packages/remix) | [![npm](https://img.shields.io/npm/v/@savvagent/remix)](https://www.npmjs.com/package/@savvagent/remix) | Beta |
| [@savvagent/sveltekit](./packages/sveltekit) | [![npm](https://img.shields.io/npm/v/@savvagent/sveltekit)](https://www.npmjs.com/package/@savvagent/sveltekit) | Beta |
| [@savvagent/astro](./packages/astro) | [![npm](https://img.shields.io/npm/v/@savvagent/astro)](https://www.npmjs.com/package/@savvagent/astro) | Beta |

### Server SDKs

| Package | Language | Version | Status |
|---------|----------|---------|--------|
| [@savvagent/node-server](./packages/node-server) | Node.js | v0.1.0 | Beta |
| [savvagent-java-server-sdk](./packages/java-server) | Java 11+ | v0.1.0 | Beta |
| [savvagent-go-server-sdk](./packages/go-server) | Go 1.21+ | v0.1.0 | Beta |
| [savvagent](./packages/rust-server) | Rust 1.70+ | v0.1.0 | Beta |

### MCP Servers

| Package | Version | Status |
|---------|---------|--------|
| [@savvagent/mcp-sdk](./packages/mcp-sdk) | [![npm](https://img.shields.io/npm/v/@savvagent/mcp-sdk)](https://www.npmjs.com/package/@savvagent/mcp-sdk) | Beta |
| [@savvagent/mcp-sentry](./packages/mcp-sentry) | [![npm](https://img.shields.io/npm/v/@savvagent/mcp-sentry)](https://www.npmjs.com/package/@savvagent/mcp-sentry) | Beta |
