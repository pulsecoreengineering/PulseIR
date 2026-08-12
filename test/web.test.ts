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

/**
 * Read a repo file with line endings normalised.
 *
 * A Windows checkout hands these back as CRLF, and every comparison below is
 * about content rather than line endings - see the LF test at the bottom for
 * the part that does care.
 */
const read = (relative: string): string =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\r\n?/g, '\n');

/** Read without normalising, for the tests that are about the bytes. */
const readRaw = (relative: string): string =>
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
    const contents = read(path.join('examples/greenhouse', name));
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

  // And the overlay's <code> must inherit rather than set its own. The rule is
  // a selector list, since the gutter's inner layer needs the same treatment.
  assert(
    /#highlight code[^{]*\{[^}]*font:\s*inherit/.test(html),
    'the overlay <code> does not inherit its font from .editor-text'
  );

  // Transparent text with a visible caret is what makes the trick work.
  assert(
    /color:\s*transparent;\s*caret-color:/.test(html),
    'the textarea must hide its own text but keep its caret'
  );
});

test('the editor paints highlighting on every path that changes the text', () => {
  // Miss one and the colour layer shows the previous file's contents while the
  // caret moves over it. Counting paint() calls used to stand in for this and
  // was wrong the moment the repaint was funnelled through one place; the real
  // invariant is that nothing sets the text without repainting after it.
  const main = read('web/main.ts');
  const lines = main.split('\n');

  const assignments = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*source\.value = /.test(line));

  assert(assignments.length > 0, 'no assignments to source.value found - has it been renamed?');

  for (const { line, index } of assignments) {
    const follows = lines.slice(index + 1, index + 5).join('\n');
    assert(
      /\bpaint\(\)/.test(follows),
      `web/main.ts:${index + 1} sets the text without repainting:\n    ${line.trim()}`
    );
  }

  // Typing does not assign to source.value, so it needs its own check.
  assert(
    /source\.addEventListener\('input'[\s\S]{0,200}?paint\(\)/.test(main),
    'typing does not repaint'
  );
  assert(
    main.includes("source.addEventListener('scroll', syncScroll"),
    'the colour layer is not kept in step when the textarea scrolls'
  );
});

test('the line gutter lines up with the text and stays out of a copy', () => {
  const html = read('web/index.html');

  // Same metrics block as the other two layers, or the numbers drift.
  assert(
    /id="gutter"[^>]*class="[^"]*\beditor-text\b/.test(html),
    'the gutter does not use the shared .editor-text metrics'
  );

  // Selecting code and copying it must not pick up the line numbers.
  assert(
    /#gutter\s*\{[^}]*user-select:\s*none/.test(html),
    'line numbers would end up in a copied selection'
  );

  // The text layers have to leave room for it, from the same variable the
  // gutter is sized by.
  assert(
    /#source,\s*#highlight\s*\{[^}]*padding-left:\s*var\(--gutter-width/.test(html),
    'the text layers do not reserve the gutter width'
  );

  const main = read('web/main.ts');

  // Vertical only: numbers stay put while a long line scrolls sideways.
  assert(
    /gutterLines\.style\.transform = `translateY\(\$\{-y\}px\)`/.test(main),
    'the gutter is not kept in step with the text'
  );
  assert(
    !/gutterLines\.style\.transform = `translate\(/.test(main),
    'the gutter must not move sideways with the text'
  );

  // Numbers survive the degraded path, where colouring is switched off.
  const paintBody = /function paint\(\): void \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? '';
  const gutterAt = paintBody.indexOf('paintGutter()');
  const limitAt = paintBody.indexOf('HIGHLIGHT_LIMIT');
  assert(
    gutterAt !== -1 && limitAt !== -1 && gutterAt < limitAt,
    'a file too large to highlight would be left with stale line numbers'
  );
});

test('the overlays are moved by transform, never by scrolling them', () => {
  // This shipped broken. The layers were kept in step by setting their
  // scrollTop, which the browser clamps to each element's own
  // `scrollHeight - clientHeight`. A classic Windows scrollbar takes up layout
  // space and shortens the *textarea's* client box but not the overlays', so
  // the textarea could scroll ~15px further than they could follow: near the
  // bottom of a long file the caret sat most of a line away from its own text.
  // Headless Linux uses overlay scrollbars, which take no space, which is
  // exactly why the browser check missed it. A transform has no clamp.
  //
  // `npm run check:editor` measures the real thing; this stops the mechanism
  // being swapped back.
  const main = read('web/main.ts');
  const sync = /function syncScroll\(\): void \{([\s\S]*?)\n\}/.exec(main)?.[1];

  assert(!!sync, 'syncScroll() not found - has it been renamed?');
  assert(
    /\.style\.transform = /.test(sync!),
    'syncScroll() no longer positions the layers with a transform'
  );
  assert(
    !/\.scroll(Top|Left) = /.test(sync!),
    'syncScroll() sets scrollTop/scrollLeft on an overlay; that clamps, and the ' +
    'layers drift from the caret near the bottom of a long file on any platform ' +
    'with scrollbars that take up space'
  );
});

test('the committed artefacts are LF, so a rebuild is a no-op on any platform', () => {
  // This blocked a `git pull` twice. web/app.js and web/examples.ts are
  // generated but committed; on a Windows checkout the sources arrive as CRLF,
  // the rebuild carries that into the output, and the regenerated files really
  // are different - so git reports local changes and refuses to merge.
  //
  // Fixed in two places, and both are checked here: .gitattributes pins the
  // working tree to LF, and the build normalises whatever it is handed.
  for (const artefact of ['web/app.js', 'web/examples.ts']) {
    const contents = readRaw(artefact);
    const at = contents.indexOf('\r');
    assert(
      at === -1,
      `${artefact} contains a CR at offset ${at}; generated files must be LF-only`
    );
  }

  // examples.ts embeds the models as escaped strings, so a CRLF that got in
  // before JSON.stringify survives as a literal backslash-r and would never be
  // caught by normalising the finished file. It has to be fixed at the read.
  const baked = readRaw('web/examples.ts');
  assert(
    !baked.includes('\\r\\n'),
    'web/examples.ts has CRLF baked inside a model string - normalise when reading, ' +
    'not when writing'
  );
});

test('.gitattributes pins the working tree to LF', () => {
  const attributes = read('.gitattributes');
  assert(
    /^\*\s+text=auto\s+eol=lf\s*$/m.test(attributes),
    '.gitattributes no longer forces LF; a Windows checkout will break `git pull` again'
  );
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} web test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Web tests passed!');
