import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    transformMode: {
      web: [/\.[jt]sx?$/],
    },
    deps: {
      inline: [/solid-js/, /@solidjs\/testing-library/],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.{ts,tsx}',
        '**/*.config.{ts,js}',
        '**/test-setup.ts',
      ],
    },
    // Don't fail tests on unhandled rejections since Solid's createResource throws them
    dangerouslyIgnoreUnhandledErrors: true,
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
});
