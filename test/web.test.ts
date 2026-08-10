/**
 * Web editor build tests.
 *
 * `web/app.js` and `web/examples.ts` are generated but committed, so the
 * editor opens from a clone with no npm install. That convenience only holds
 * if the committed artefacts match the source they came from - a stale bundle
 * would quietly teach a student something the CLI no longer does.
 *
 * Run `npm run build:web` if either of these fails.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const read = (relative: string): string =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8');

// ============================================================================

console.log('🌐 Testing web editor build...\n');

test('baked examples match the models on disk', () => {
  // Regenerating is deterministic, so a diff means someone edited a model
  // without rebuilding the editor. Write to a scratch file - a test must not
  // "fix" the tracked one as a side effect of checking it.
  const scratch = path.join(repoRoot, 'dist/examples.check.ts');
  const committed = read('web/examples.ts');
  execFileSync('node', [path.join(repoRoot, 'scripts/build-examples.mjs'), scratch], { stdio: 'pipe' });
  const rebuilt = fs.readFileSync(scratch, 'utf8');
  fs.rmSync(scratch, { force: true });

  assert(
    committed === rebuilt,
    'web/examples.ts is out of date with the example models - run `npm run build:web`'
  );
});

test('baked examples are the real files, byte for byte', () => {
  const module = read('web/examples.ts');
  const boiler = read('examples/boiler.yaml');

  // JSON.stringify of the exact file contents must appear verbatim.
  assert(
    module.includes(JSON.stringify(boiler)),
    'the boiler example in the editor is not identical to examples/boiler.yaml'
  );
});

test('the committed bundle exists and carries the current pipeline', () => {
  const bundlePath = path.join(repoRoot, 'web/app.js');
  assert(fs.existsSync(bundlePath), 'web/app.js is missing - run `npm run build:web`');

  const bundle = fs.readFileSync(bundlePath, 'utf8');
  assert(bundle.length > 50_000, `bundle looks truncated (${bundle.length} bytes)`);

  // Markers from each stage the editor is supposed to run.
  for (const marker of ['PULSEHSM_MAX_STATES', 'pulseir/topics@1', 'SystemContext']) {
    assert(bundle.includes(marker), `bundle is stale: no sign of "${marker}"`);
  }

  // The retired guard schema must not survive in a shipped bundle.
  assert(
    !bundle.includes('Guard of type "expression"'),
    'bundle predates the guard schema change - run `npm run build:web`'
  );
});

test('the page loads the bundle and nothing external', () => {
  const html = read('web/index.html');

  assert(html.includes('./app.js'), 'index.html does not load the bundle');

  // A CDN reference would break the offline promise.
  assert(
    !/(src|href)\s*=\s*["']https?:/i.test(html),
    'index.html references an external resource; the editor must work offline'
  );
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} web test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Web tests passed!');
