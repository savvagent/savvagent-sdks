import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Test against the workspace sources, as the other packages do. The
      // subpath comes first: an alias also matches `<key>/...` specifiers.
      '@savvagent/sdk/server': src('../typescript/src/server/index.ts'),
      '@savvagent/sdk': src('../typescript/src/index.ts'),
      '@savvagent/react': src('../react/src/index.ts'),
    },
    dedupe: ['react', 'react-dom', 'react-router'],
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },
});
