/**
 * Bundles the web editor.
 *
 * Uses esbuild's JS API rather than shelling out to its binary: invoking
 * `esbuild` from an npm script depends on the platform's .bin shim being on
 * PATH, which fails on Windows with a bare "not recognized as an internal or
 * external command" that says nothing about the actual cause.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error(`
esbuild is not installed, so the editor bundle cannot be rebuilt.

  npm install

You do not need it just to use the editor - web/app.js is committed:

  npm run serve        (or open web/index.html directly)
`);
  process.exit(1);
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'dist/web/main.js')],
  outfile: path.join(repoRoot, 'web/app.js'),
  bundle: true,
  format: 'iife',
  logLevel: 'warning',
});

console.log('✓ Bundled the editor into web/app.js');
