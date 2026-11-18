# Migration Guide

This guide is for code that still uses the SDKs from their old homes: the `sdks/` folder of the archived `savvagent-flags` repository, or this repository before it was renamed. The Flags SDKs for [savvagent-services](https://github.com/savvagent/savvagent-services) now live in [savvagent/flags-sdks](https://github.com/savvagent/flags-sdks). GitHub redirects the old repository URL, but update your links and clones.

For the v1 to v2 API changes (dynamic configuration and multi-variant flags), see [MIGRATION-GUIDE.md](./MIGRATION-GUIDE.md).

## Package name changes

| Old package name | New package name |
|-----------------|------------------|
| `@savvagent/typescript` | `@savvagent/sdk` |
| `@savvagent/remix` | `@savvagent/react-router` ([migration](../packages/react-router/README.md#migrating-from-savvagentremix)) |

## For application developers

### Step 1: Update package.json

**Before:**
```json
{
  "dependencies": {
    "@savvagent/typescript": "file:../savvagent-flags/sdks/typescript"
  }
}
```

**After:**
```json
{
  "dependencies": {
    "@savvagent/sdk": "^1.1.0"
  }
}
```

The copies on npm today (1.1.0) predate the fixes in this repository; the next release publishes them. To use the current source before then, build this repository at a pinned commit and depend on it with `file:` (see [Local development](#local-development)).

### Step 2: Update imports

The client class is now `FlagClient`:

**Before:**
```typescript
import { SavvagentClient } from '@savvagent/typescript';
```

**After:**
```typescript
import { FlagClient } from '@savvagent/sdk';
```

### Step 3: Point at the Flags API

Every SDK defaults to `https://api.savvagent.com/flags`. If your code sets `baseUrl` to an older host, remove it or change it to that URL.

## Local development

```bash
git clone https://github.com/savvagent/flags-sdks
cd flags-sdks
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
```

Then depend on the built package from your app:

```json
{
  "dependencies": {
    "@savvagent/sdk": "file:../flags-sdks/packages/typescript"
  }
}
```

## Troubleshooting

### "Cannot find module '@savvagent/typescript'"

You're still importing the old package name. Import `FlagClient` from `@savvagent/sdk` instead.

### "Module not found" after migration

Remove `node_modules` and reinstall. Keep your lockfile unless you mean to re-resolve every dependency.

## Related documentation

- [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) - the REST wire contract and the cross-SDK behaviour matrix
- [SDK-INTEGRATION.md](./SDK-INTEGRATION.md) - SDK integration guide

## Support

- GitHub Issues: https://github.com/savvagent/flags-sdks/issues
- Examples: https://github.com/savvagent/flags-sdks/tree/master/examples
