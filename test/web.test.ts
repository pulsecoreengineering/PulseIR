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
  const boiler = read('examples/boiler/pulse.yaml');

  // JSON.stringify of the exact file contents must appear verbatim.
  assert(
    module.includes(JSON.stringify(boiler)),
    'the boiler example in the editor is not identical to examples/boiler.yaml'
  );
});

test('multi-file examples are baked with every file they include', () => {
  const module = read('web/examples.ts');
  const dir = path.join(repoRoot, 'examples/greenhouse');

  // The editor resolves includes between open buffers, so every file the
  // model references has to be present or the example cannot load.
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
    const contents = fs.readFileSync(path.join(dir, name), 'utf8');
    assert(module.includes(JSON.stringify(name)), `greenhouse example is missing ${name}`);
    assert(module.includes(JSON.stringify(contents)), `${name} in the editor differs from disk`);
  }

  assert(
    module.includes('entry: "greenhouse.yaml"'),
    'greenhouse example does not name its entry file'
  );
});

test('the committed bundle exists and carries the current pipeline', () => {
  const bundlePath = path.join(repoRoot, 'web/app.js');
  assert(fs.existsSync(bundlePath), 'web/app.js is missing - run `npm run build:web`');

  const bundle = fs.readFileSync(bundlePath, 'utf8');
  assert(bundle.length > 50_000, `bundle looks truncated (${bundle.length} bytes)`);

  // Markers from each stage the editor is supposed to run.
  for (const marker of [
    'PULSEHSM_MAX_STATES',
    'pulseir/topics@1',
    'pulseir/libraries@1',
    'SystemContext',
    'Include cycle',        // the multi-file loader is bundled
  ]) {
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

test('the highlight overlay shares every metric with the textarea', () => {
  // The colour layer sits exactly beneath the textarea, so any property that
  // moves a glyph must come from one shared place. This broke once already: a
  // bare `pre code` rule meant for the output panes also matched the overlay's
  // inner <code> and shrank it to 12.5px/1.5, drifting further from the caret
  // on every line down the file.
  const html = read('web/index.html');

  assert(
    /id="highlight"[^>]*class="[^"]*\beditor-text\b/.test(html),
    'the highlight layer does not use the shared .editor-text metrics'
  );
  assert(
    /id="source"[^>]*class="[^"]*\beditor-text\b/.test(html),
    'the textarea does not use the shared .editor-text metrics'
  );

  // The pane rule must stay scoped, or it reaches the overlay again.
  assert(
    !/^\s*pre\s+code\s*\{/m.test(html.replace(/^(\s*)\.pane pre code/gm, '$1.pane-scoped')),
    'an unscoped "pre code" rule is back; scope it to .pane or it hits the editor'
  );

  // And the overlay's <code> must inherit rather than set its own.
  assert(
    /#highlight code\s*\{[^}]*font:\s*inherit/.test(html),
    'the overlay <code> does not inherit its font from .editor-text'
  );

  // Transparent text with a visible caret is what makes the trick work.
  assert(
    /color:\s*transparent;\s*caret-color:/.test(html),
    'the textarea must hide its own text but keep its caret'
  );
});

test('the editor paints highlighting on every path that changes the text', () => {
  // Miss one and the colour layer shows the previous file's contents.
  const main = read('web/main.ts');
  const painted = (main.match(/\bpaint\(\)/g) || []).length;

  assert(
    painted >= 6,
    `only ${painted} paint() calls; switching files, loading an example, typing, ` +
    'tabbing and first load all have to repaint'
  );
  assert(
    main.includes("source.addEventListener('scroll', syncScroll"),
    'the colour layer is not kept in step when the textarea scrolls'
  );
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} web test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Web tests passed!');
