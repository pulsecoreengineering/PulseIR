/**
 * YAML highlighter tests.
 *
 * The highlighted HTML is rendered behind a transparent textarea, so the one
 * unforgivable bug is changing the text: a single dropped or added character
 * shifts every line below it out from under the caret. The round-trip property
 * at the bottom is checked against every model in the repo, and is worth more
 * than all the colour assertions put together.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { highlight, stripTags } from '../web/highlight.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

/** Assert `needle` is highlighted as `kind`. */
function kind(source: string, needle: string, expected: string): void {
  const html = highlight(source);
  const wanted = `<span class="y-${expected}">${needle}</span>`;
  assert(html.includes(wanted), `expected ${needle} as ${expected}, got:\n  ${html}`);
}

function notKind(source: string, needle: string, forbidden: string): void {
  const html = highlight(source);
  const wanted = `<span class="y-${forbidden}">${needle}</span>`;
  assert(!html.includes(wanted), `${needle} must not be ${forbidden}:\n  ${html}`);
}

/** Every .yaml in the repo, so the property test runs on real models. */
function everyModel(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ya?ml$/.test(entry.name)) found.push(full);
    }
  };
  walk(repoRoot);
  return found;
}

// ============================================================================

console.log('🎨 Testing YAML highlighting...\n');

test('keys, values and comments get their own colours', () => {
  kind('project:\n  name: boiler\n', 'project', 'key');
  kind('project:\n  name: boiler\n', 'name', 'key');
  kind('# a note\n', '# a note', 'comment');
  kind('  version: "1.0"\n', '"1.0"', 'string');
  kind('  default: 60.5\n', '60.5', 'number');
  kind('  tls: true\n', 'true', 'boolean');
  kind('  value: null\n', 'null', 'null');
});

test('"on" and "off" are keys here, not booleans', () => {
  // Our schema uses `on:` for the event of a transition, and the blinker
  // example has states literally named `on` and `off`. YAML 1.1 would read
  // them as booleans, which would colour half the models wrong.
  kind('    - from: idle\n      on: START\n', 'on', 'key');
  notKind('      on: START\n', 'on', 'boolean');

  kind('  states:\n    off:\n    on:\n', 'off', 'key');
  kind('  states:\n    off:\n    on:\n', 'on', 'key');

  // As a value, though, it really is a boolean.
  kind('  enabled: on\n', 'on', 'boolean');
});

test('a # inside a string is not a comment', () => {
  const html = highlight('  topic: "sensors/#"\n');
  assert(
    html.includes('<span class="y-string">"sensors/#"</span>'),
    `the string was cut at the hash:\n  ${html}`
  );
  assert(!html.includes('y-comment'), `found a comment that is not there:\n  ${html}`);
});

test('a trailing comment after a value is still a comment', () => {
  kind('  pin: GPIO25  # the pump\n', '# the pump', 'comment');
  kind('  pin: GPIO25  # the pump\n', 'pin', 'key');
});

test('a colon inside a value does not make a second key', () => {
  // "http://x" and "12:30" both contain a colon that does not end a key.
  const html = highlight('  url: http://example.com/x\n');
  assert(
    (html.match(/y-key/g) || []).length === 1,
    `expected exactly one key on this line:\n  ${html}`
  );
});

test('flow mappings colour their inner keys', () => {
  kind('  pump: { type: digital_output, pin: GPIO25 }\n', 'type', 'key');
  kind('  pump: { type: digital_output, pin: GPIO25 }\n', 'pin', 'key');
  kind('  range: [10.0, 90.0]\n', '10.0', 'number');
});

test('list dashes are punctuation, and the entry is still parsed', () => {
  kind('  - from: idle\n', 'from', 'key');
  kind('  - Adafruit_BME280\n', '-', 'punct');
});

test('a block scalar body is text, not tokens', () => {
  const source = [
    '  description: |',
    '    key: not really a key',
    '    # not a comment either',
    '  next: 1',
  ].join('\n');

  const html = highlight(source);
  const lines = html.split('\n');

  assert(lines[1].includes('y-string'), `block body should be one string:\n  ${lines[1]}`);
  assert(!lines[1].includes('y-key'), `block body must not contain keys:\n  ${lines[1]}`);
  assert(!lines[2].includes('y-comment'), `block body must not contain comments:\n  ${lines[2]}`);

  // And the block has to end when the indentation returns.
  assert(lines[3].includes('y-key'), `"next" should be a key again:\n  ${lines[3]}`);
});

test('HTML in the source is escaped, not rendered', () => {
  const html = highlight('  description: <script>alert(1)</script>\n');
  assert(!html.includes('<script>'), `unescaped markup reached the output:\n  ${html}`);
  assert(html.includes('&lt;script&gt;'), `expected escaped markup:\n  ${html}`);
});

test('an unterminated quote does not swallow the rest of the document', () => {
  // Happens constantly while typing, so it has to degrade gracefully.
  const html = highlight('  name: "half typed\n  other: 2\n');
  const lines = html.split('\n');
  assert(lines.length === 3, `line count changed: ${lines.length}`);
  assert(lines[1].includes('y-key'), `the next line should still parse:\n  ${lines[1]}`);
});

// ============================================================================
// The property that makes the overlay safe.
// ============================================================================

test('highlighting never changes the text - every model in the repo', () => {
  const models = everyModel();
  assert(models.length >= 8, `expected to find the shipped models, found ${models.length}`);

  for (const model of models) {
    const source = fs.readFileSync(model, 'utf8');
    const recovered = stripTags(highlight(source));

    if (recovered !== source) {
      // Point at the first difference rather than dumping the whole file.
      let at = 0;
      while (at < source.length && source[at] === recovered[at]) at++;
      throw new Error(
        `${path.relative(repoRoot, model)} changed at offset ${at}\n` +
        `  expected: ${JSON.stringify(source.slice(at, at + 40))}\n` +
        `  actual:   ${JSON.stringify(recovered.slice(at, at + 40))}`
      );
    }
  }
});

test('highlighting never changes the text - awkward input', () => {
  const cases = [
    '',
    '\n',
    '\n\n\n',
    '   ',
    'a: 1',
    'a: 1\n',
    '  # comment with <html> & "quotes"\n',
    'weird: "a \\" b"\n',
    "single: 'it''s escaped'\n",
    'trailing_space: 1   \n',
    '\ttab: 1\n',
    'unicode: héllo → °C\n',
    'anchors: &base { a: 1 }\nuse: *base\n',
    'tagged: !!str 5\n',
    'empty_flow: {}\nempty_list: []\n',
    'deep:\n  - - nested\n',
    'no_newline_at_end: true',
  ];

  for (const source of cases) {
    const recovered = stripTags(highlight(source));
    assert(
      recovered === source,
      `round trip failed for ${JSON.stringify(source)}\n  got ${JSON.stringify(recovered)}`
    );
  }
});

test('line count is preserved exactly', () => {
  // The overlay is positioned by line, so one extra or missing newline shifts
  // everything below it.
  for (const source of ['a\nb\nc', 'a\nb\nc\n', '\n\na\n\n', '']) {
    const lines = (s: string) => s.split('\n').length;
    assert(
      lines(stripTags(highlight(source))) === lines(source),
      `line count changed for ${JSON.stringify(source)}`
    );
  }
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} highlight test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Highlight tests passed!');
