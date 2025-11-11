# Changesets

This directory contains changeset files that document changes to packages in this monorepo.

## How to use

When you make changes to a package, run:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages have changed
2. Choose the type of change (major, minor, patch)
3. Write a summary of the changes

The changeset will be used to automatically update package versions and CHANGELOGs when you run:

```bash
pnpm version-packages
```

## Publishing

To publish all changed packages:

```bash
pnpm release
```

This will:
1. Build all packages
2. Publish them to npm
3. Create git tags for the new versions
