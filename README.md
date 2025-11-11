# Savvagent SDKs

Official SDKs, MCP servers, and example applications for [Savvagent](https://github.com/yourusername/savvagent-flags) - the AI-powered feature flag platform that prevents production incidents.

## Packages

### SDKs

- **[@savvagent/sdk](./packages/typescript)** - TypeScript/JavaScript SDK for feature flags
  - Works with React, Next.js, SvelteKit, Node.js, and more
  - Real-time flag updates via WebSocket
  - Built-in caching and telemetry
  - Type-safe API

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

- **[Next.js App](./examples/nextjs-app)** - React Server Components + Client Components
- **[SvelteKit App](./examples/sveltekit-app)** - Svelte 5 with runes
- **[Node.js Backend](./examples/node-backend)** - Express API server

## Documentation

- **[SDK Integration Guide](./docs/SDK-INTEGRATION.md)** - Complete integration instructions
- **[Migration Guide](./docs/MIGRATION.md)** - Migrating from the old repo structure
- **[API Reference](./packages/typescript/README.md)** - Full SDK API documentation
- **[MCP Integration Guide](./packages/mcp-sdk/README.md)** - Building MCP servers

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
│   ├── typescript/          # @savvagent/sdk
│   ├── mcp-sdk/            # @savvagent/mcp-sdk
│   └── mcp-sentry/         # @savvagent/mcp-sentry
├── examples/
│   ├── nextjs-app/         # Next.js example
│   ├── sveltekit-app/      # SvelteKit example
│   └── node-backend/       # Node.js example
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
- **Issues**: [GitHub Issues](https://github.com/yourusername/savvagent-sdks/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/savvagent-sdks/discussions)

## Related Projects

- **[Savvagent Platform](https://github.com/yourusername/savvagent-flags)** - The main platform repository
- **[Savvagent Docs](https://docs.savvagent.com)** - Official documentation

## Packages Status

| Package | Version | Status |
|---------|---------|--------|
| [@savvagent/sdk](./packages/typescript) | [![npm](https://img.shields.io/npm/v/@savvagent/sdk)](https://www.npmjs.com/package/@savvagent/sdk) | Stable |
| [@savvagent/mcp-sdk](./packages/mcp-sdk) | [![npm](https://img.shields.io/npm/v/@savvagent/mcp-sdk)](https://www.npmjs.com/package/@savvagent/mcp-sdk) | Beta |
| [@savvagent/mcp-sentry](./packages/mcp-sentry) | [![npm](https://img.shields.io/npm/v/@savvagent/mcp-sentry)](https://www.npmjs.com/package/@savvagent/mcp-sentry) | Beta |
