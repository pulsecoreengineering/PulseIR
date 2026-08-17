#!/usr/bin/env node
/**
 * Build script for the PulseIR VS Code extension.
 *
 * Produces two self-contained CJS bundles:
 *   client/out/extension.js  — the thin VS Code extension host entry point
 *   server/out/server.js     — the LSP server (includes parser + validator)
 *
 * Run with --watch for incremental rebuilds during development.
 */

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const repoRoot = path.resolve(__dirname, '..');

/** esbuild plugin: rewrite relative *.js imports to their .ts counterparts,
 *  but ONLY when the importing file is inside our repo source tree (not inside
 *  node_modules, which ships real .js files). */
const tsImportPlugin = {
  name: 'ts-import',
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, args => {
      if (!args.path.startsWith('.') && !args.path.startsWith('/')) return;
      // Skip any importer that lives inside node_modules.
      if (args.resolveDir.includes('node_modules')) return;
      const abs = path.resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
      return { path: abs };
    });
  },
};

const sharedOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  plugins: [tsImportPlugin],
  logLevel: 'info',
};

async function build() {
  const ctx = await Promise.all([
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['client/src/extension.ts'],
      outfile: 'client/out/extension.js',
    }),
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['server/src/server.ts'],
      outfile: 'server/out/server.js',
    }),
  ]);

  if (watch) {
    await Promise.all(ctx.map(c => c.watch()));
    console.log('Watching for changes…');
  } else {
    await Promise.all(ctx.map(c => c.rebuild()));
    await Promise.all(ctx.map(c => c.dispose()));
    console.log('Done.');
  }
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
