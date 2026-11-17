#!/usr/bin/env node
// Checks the shape of every published package the way a consumer receives it:
// build it, `pnpm pack` it into a temporary directory outside the repo, then run
// publint and @arethetypeswrong/cli (attw) against the tarball.
//
// Usage: pnpm check:packages [--no-build] [package-dir-name ...]
//   --no-build   skip the per-package build (CI runs `pnpm build` first)
//   names        only check these packages/* directories, e.g. `typescript astro`
//
// publint runs with --strict, so its warnings fail the check too.
//
// attw runs with `--profile node16`: it checks node16 (from CJS and from ESM)
// and bundler resolution, and skips node10 (`moduleResolution: "node"`). The
// packages expose subpaths (`@savvagent/sdk/server`, `@savvagent/nextjs/client`,
// ...) only through `exports`, which node10 resolution does not read, so node10
// consumers cannot resolve them by design.
//
// Every other attw rule is enforced, except where ATTW_RUNS below says so, with
// the reason next to it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules', '.bin', name);

// Per-package attw runs. A package not listed gets one run over all its
// entrypoints with no ignored rules.
const ATTW_RUNS = {
  '@savvagent/angular': [
    {
      // Angular Package Format libraries are ESM only (ng-packagr emits only
      // fesm2022); there is no CommonJS build to point `require` at. Node 22's
      // require(esm) and every Angular toolchain load it as ESM.
      ignoreRules: ['cjs-resolves-to-esm'],
    },
  ],
  '@savvagent/astro': [
    { entrypoints: ['.'] },
    {
      // `@savvagent/astro/middleware` is ESM only by design (it imports Astro's
      // virtual config module and is loaded only by Astro's Vite pipeline), as
      // the astro-7 changeset records. Only this entrypoint ignores the rule.
      entrypoints: ['./middleware'],
      ignoreRules: ['cjs-resolves-to-esm'],
    },
  ],
};

const args = process.argv.slice(2);
const build = !args.includes('--no-build');
const only = args.filter((a) => !a.startsWith('--'));

const packagesDir = join(root, 'packages');
const packages = readdirSync(packagesDir)
  .filter((dir) => existsSync(join(packagesDir, dir, 'package.json')))
  .filter((dir) => only.length === 0 || only.includes(dir))
  .map((dir) => {
    const path = join(packagesDir, dir);
    return { dir, path, manifest: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) };
  })
  .filter(({ manifest }) => !manifest.private);

if (only.length > 0 && packages.length !== only.length) {
  console.error(`Unknown or private package in: ${only.join(', ')}`);
  process.exit(1);
}

const run = (cmd, cmdArgs, cwd) => {
  try {
    execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
};

const outDir = mkdtempSync(join(tmpdir(), 'savvagent-check-packages-'));
const failures = [];

try {
  for (const { dir, path, manifest } of packages) {
    const name = manifest.name;
    console.log(`\n=== ${name} (packages/${dir})`);

    if (build && !run('pnpm', ['run', 'build'], path)) {
      failures.push(`${name}: build`);
      continue;
    }

    const packDir = mkdtempSync(join(outDir, `${dir}-`));
    if (!run('pnpm', ['pack', '--pack-destination', packDir], path)) {
      failures.push(`${name}: pnpm pack`);
      continue;
    }
    const tarballs = readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      failures.push(`${name}: expected one tarball, found ${tarballs.length}`);
      continue;
    }
    const tarball = join(packDir, tarballs[0]);

    if (!run(bin('publint'), ['--strict', tarball], root)) {
      failures.push(`${name}: publint`);
    }

    for (const attwRun of ATTW_RUNS[name] ?? [{}]) {
      const attwArgs = [tarball, '--profile', 'node16', '--format', 'ascii'];
      if (attwRun.entrypoints) attwArgs.push('--entrypoints', ...attwRun.entrypoints);
      if (attwRun.ignoreRules) attwArgs.push('--ignore-rules', ...attwRun.ignoreRules);
      if (!run(bin('attw'), attwArgs, root)) {
        failures.push(`${name}: attw${attwRun.entrypoints ? ` (${attwRun.entrypoints.join(', ')})` : ''}`);
      }
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nPackage shape check failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`\nPackage shape check passed for ${packages.length} package(s).`);
