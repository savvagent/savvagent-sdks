import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Served by the integration's Vite plugin at runtime; a fixture in tests.
      'virtual:@savvagent/astro/config': fileURLToPath(
        new URL('./tests/fixtures/virtual-config.ts', import.meta.url)
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'tests/**/*'],
    },
    include: ['tests/**/*.test.ts'],
    mockReset: true,
    restoreMocks: true,
  },
});
