# Contributing to Savvagent SDKs

Thank you for your interest in contributing to Savvagent SDKs! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- pnpm 8 or higher
- Git

### Setup

1. **Fork the repository** on GitHub

2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/savvagent-sdks.git
   cd savvagent-sdks
   ```

3. **Add upstream remote:**
   ```bash
   git remote add upstream https://github.com/yourusername/savvagent-sdks.git
   ```

4. **Install dependencies:**
   ```bash
   pnpm install
   ```

5. **Build packages:**
   ```bash
   pnpm build
   ```

## Development Workflow

### 1. Create a Branch

Create a branch for your changes:

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/bug-description
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or fixes

### 2. Make Your Changes

- Write clean, readable code
- Follow existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @savvagent/sdk test

# Run linter
pnpm lint

# Format code
pnpm format
```

### 4. Add a Changeset

For any changes that affect published packages, add a changeset:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages changed
2. Choose the type of change (major, minor, patch)
3. Write a user-facing changelog entry

**When to add a changeset:**
- ✅ New features
- ✅ Bug fixes
- ✅ Breaking changes
- ✅ Performance improvements
- ❌ Documentation-only changes
- ❌ Test-only changes
- ❌ Internal refactoring (no API changes)

### 5. Commit Your Changes

We use conventional commits:

```bash
git add .
git commit -m "feat: add new feature"
```

**Commit message format:**
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Test additions or changes
- `chore:` - Build process or auxiliary tool changes

**Examples:**
```bash
git commit -m "feat(sdk): add real-time flag updates"
git commit -m "fix(mcp-sentry): handle connection errors"
git commit -m "docs: update integration guide"
```

### 6. Push and Create Pull Request

```bash
git push origin feature/my-feature
```

Then create a pull request on GitHub with:
- Clear title describing the change
- Description of what changed and why
- Link to any related issues
- Screenshots (for UI changes)

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass (`pnpm test`)
- [ ] Linter passes (`pnpm lint`)
- [ ] Code is formatted (`pnpm format`)
- [ ] Changeset added (if needed)
- [ ] Documentation updated (if needed)
- [ ] Examples updated (if API changed)

### PR Description

Include:
1. **What**: What does this PR do?
2. **Why**: Why is this change needed?
3. **How**: How does it work?
4. **Testing**: How was it tested?

## Code Style

### TypeScript

- Use TypeScript for all code
- Prefer `interface` over `type` for objects
- Use explicit return types for functions
- Avoid `any` types

**Good:**
```typescript
interface FlagContext {
  userId: string;
  attributes?: Record<string, unknown>;
}

function evaluateFlag(key: string, context: FlagContext): Promise<boolean> {
  // ...
}
```

**Bad:**
```typescript
function evaluateFlag(key: any, context: any): any {
  // ...
}
```

### Formatting

- 2 spaces for indentation
- Single quotes for strings
- Trailing commas in objects/arrays
- Semicolons required

Run `pnpm format` to auto-format.

### Naming Conventions

- `camelCase` for variables and functions
- `PascalCase` for classes and types
- `UPPER_CASE` for constants
- Descriptive names (no abbreviations)

## Testing

### Writing Tests

- Place tests in `tests/` directory or `*.test.ts` files
- Use descriptive test names
- Follow Arrange-Act-Assert pattern

```typescript
describe('SavvagentClient', () => {
  it('should evaluate flag correctly', async () => {
    // Arrange
    const client = new SavvagentClient({ ... });

    // Act
    const result = await client.isEnabled('test-flag', { userId: '123' });

    // Assert
    expect(result).toBe(true);
  });
});
```

### Test Coverage

- Aim for >80% coverage for new code
- Test happy paths and error cases
- Mock external dependencies

## Documentation

### Code Comments

- Use JSDoc for public APIs
- Comment complex logic
- Don't comment obvious code

```typescript
/**
 * Evaluates a feature flag for the given context.
 *
 * @param key - The feature flag key
 * @param context - User context for evaluation
 * @returns Promise resolving to flag state
 * @throws {NetworkError} If API request fails
 */
async isEnabled(key: string, context: FlagContext): Promise<boolean> {
  // ...
}
```

### README Updates

Update relevant READMEs when:
- Adding new features
- Changing APIs
- Adding configuration options
- Updating dependencies

### Documentation Files

Update documentation in `docs/` for:
- New SDK features
- Integration guides
- Migration guides
- Best practices

## Package-Specific Guidelines

### @savvagent/sdk

- Keep bundle size small
- Ensure browser compatibility
- Cache aggressively for performance
- Handle network errors gracefully

### @savvagent/mcp-sdk

- Follow MCP protocol standards
- Support extensibility
- Document integration patterns

### @savvagent/mcp-sentry

- Handle Sentry API changes
- Provide clear error messages
- Support all Sentry SDK versions

## Release Process

Releases are automated via GitHub Actions:

1. Merge PR to `main`
2. Changesets creates "Version Packages" PR
3. Review and merge version PR
4. Packages automatically publish to npm
5. Git tags created for versions

## Questions?

- Open an issue for bugs
- Start a discussion for questions
- Check existing issues first

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
