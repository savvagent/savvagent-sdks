import { defineConfig } from 'tsup';
import { solidPlugin } from 'esbuild-plugin-solid';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['cjs', 'esm'],
  dts: true,
  external: ['solid-js'],
  esbuildPlugins: [
    solidPlugin({ solid: { generate: 'dom' } }),
  ],
});
