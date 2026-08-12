/**
 * Project storage and folder round-trip tests.
 *
 * The point of exporting is that a project leaves the browser as a *directory
 * the CLI can read*. So the test that matters is the round trip: take a real
 * shipped model, zip it, unzip it, and check the files come back identical and
 * still parse. If that holds, the editor and the CLI are looking at the same
 * thing, which is the whole reason not to invent a bespoke save format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { zip, unzip, crc32, ZipError } from '../web/zip.js';
import { ProjectStore, foldImport, findEntry, importedName, nameFromModel } from '../web/projects.js';
import type { Storage } from '../web/projects.js';
import { Parser } from '../src/parser/index.js';
import { MemoryResolver } from '../src/parser/resolver.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✓ ${name}`))
    .catch(error => {
      failures++;
      console.error(`✗ ${name}`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

/** localStorage, near enough, and inspectable. */
function memoryStorage(seed: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

const decoder = new TextDecoder();
const text = (files: Record<string, Uint8Array>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([k, v]) => [k, decoder.decode(v)]));

// ============================================================================

console.log('📁 Testing projects and folder round-trip...\n');

async function main(): Promise<void> {
await test('crc32 matches the known value for "123456789"', () => {
  // The standard check value for CRC-32, so a broken table is caught outright
  // rather than producing a zip that only fails in someone else's unzipper.
  equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'crc32 check value');
});

await test('a zip round-trips a real multi-file model, byte for byte', async () => {
  const dir = path.join(repoRoot, 'examples/sensor_gateway');
  const original: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.yaml'))) {
    original[name] = fs.readFileSync(path.join(dir, name), 'utf8');
  }
  assert(Object.keys(original).length === 3, 'expected the three-file gateway model');

  const recovered = text(await unzip(zip(original)));
  equal(Object.keys(recovered).sort(), Object.keys(original).sort(), 'file names');

  for (const name of Object.keys(original)) {
    assert(recovered[name] === original[name], `${name} changed through the round trip`);
  }
});

await test('a round-tripped model still parses', async () => {
  // The real claim: what comes out of the zip is a model, not just bytes.
  const dir = path.join(repoRoot, 'examples/sensor_gateway');
  const original: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.yaml'))) {
    original[name] = fs.readFileSync(path.join(dir, name), 'utf8');
  }

  const recovered = text(await unzip(zip(original)));
  const project = new Parser().parseFrom('pulse.yaml', new MemoryResolver(recovered));
  equal(project.name, 'sensor_gateway', 'parsed project name');
});

await test('a zip survives awkward content', async () => {
  const files = {
    'empty.yaml': '',
    'unicode.yaml': '# héllo → °C\nname: "ünïcode"\n',
    'nested/deep/model.yaml': 'a: 1\n',
    'long.yaml': `# ${'x'.repeat(5000)}\n`,
    'crlf-inside.yaml': 'a: 1\r\nb: 2\r\n',
  };
  const recovered = text(await unzip(zip(files)));
  for (const [name, contents] of Object.entries(files)) {
    assert(recovered[name] === contents, `${name} did not survive`);
  }
});

await test('a deflated zip can be read back', async () => {
  // A student who re-zips a folder with Windows Explorer or macOS Finder gets
  // deflated entries, not stored ones. Importing that has to work.
  const body = `project:\n  name: deflated\n${'# padding to make it worth compressing\n'.repeat(50)}`;
  const raw = new TextEncoder().encode(body);

  const compressed = new Uint8Array(await new Response(
    new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  ).arrayBuffer());
  assert(compressed.length < raw.length, 'the fixture did not actually compress');

  // Hand-build a zip whose single entry is deflated (method 8).
  const stored = zip({ 'model.yaml': body });
  const patched = rebuildAsDeflated(stored, raw, compressed);

  const recovered = text(await unzip(patched));
  assert(recovered['model.yaml'] === body, 'a deflated entry did not decompress correctly');
});

await test('a damaged zip is rejected with a real message, not a crash', async () => {
  let raised: Error | undefined;
  try {
    await unzip(new TextEncoder().encode('this is definitely not a zip file'));
  } catch (error) {
    raised = error as Error;
  }
  assert(raised instanceof ZipError, `expected a ZipError, got ${raised?.name}`);
  assert(/not a zip/i.test(raised!.message), `unhelpful message: ${raised!.message}`);
});

// ---------------------------------------------------------------------------

await test('importing a zipped folder strips the wrapping directory', () => {
  // Zipping `sensor_gateway/` gives entries called `sensor_gateway/pulse.yaml`.
  // Keeping that prefix would break every relative import inside the model.
  const { files, folder } = foldImport({
    'sensor_gateway/pulse.yaml': 'project:\n',
    'sensor_gateway/hardware.yaml': 'hardware:\n',
    'sensor_gateway/machine.yaml': 'machine:\n',
  });

  equal(folder, 'sensor_gateway', 'detected folder');
  equal(Object.keys(files).sort(), ['hardware.yaml', 'machine.yaml', 'pulse.yaml'], 'flattened names');
});

await test('importing keeps a real subdirectory', () => {
  // Only a *common* wrapper is stripped. Structure below it is the model's.
  const { files } = foldImport({
    'model/pulse.yaml': 'project:\n',
    'model/parts/sensors.yaml': 'hardware:\n',
  });
  equal(Object.keys(files).sort(), ['parts/sensors.yaml', 'pulse.yaml'], 'kept the subdirectory');
});

await test('importing ignores everything that is not a model file', () => {
  // A generated sketch folder has C++, a vendored runtime and desktop junk in
  // it. None of that belongs in the editor.
  const { files } = foldImport({
    'boiler/pulse.yaml': 'project:\n',
    'boiler/src/guards.cpp': 'bool guard_x() { return false; }',
    'boiler/PulseHSM.h': '#ifndef X',
    'boiler/README.md': '# notes',
    '__MACOSX/._pulse.yaml': 'junk',
    'boiler/.git/config': '[core]',
  });
  equal(Object.keys(files), ['pulse.yaml'], 'only the model file');
});

await test('importing a flat set of files needs no folder', () => {
  const { files, folder } = foldImport({ 'a.yaml': 'project:\n', 'b.yaml': 'x: 1\n' });
  equal(folder, null, 'no wrapper');
  equal(Object.keys(files).sort(), ['a.yaml', 'b.yaml'], 'names unchanged');
});

await test('the entry file is the one declaring project:, not the one named nicely', () => {
  equal(
    findEntry({ 'aaa.yaml': 'hardware:\n', 'zzz.yaml': 'project:\n  name: x\n' }),
    'zzz.yaml',
    'found by content'
  );

  // Two candidates: prefer the conventional name rather than guessing.
  equal(
    findEntry({ 'other.yaml': 'project:\n', 'pulse.yaml': 'project:\n' }),
    'pulse.yaml',
    'convention breaks the tie'
  );

  // None declares one - the model is broken, but the editor still has to open
  // it so it can be fixed.
  equal(findEntry({ 'b.yaml': 'x: 1\n', 'a.yaml': 'y: 2\n' }), 'a.yaml', 'falls back to the first');
  equal(findEntry({}), null, 'nothing to open');
});

await test('export then import gives back the project you had', () => {
  // Export names the folder after the project, so the folder is what carries
  // the user's choice. Preferring the model's own `name:` would silently
  // rename "Exercise 3" to "pump_tank" on every round trip.
  const files = { 'pulse.yaml': 'project:\n  name: pump_tank\n' };

  equal(importedName(files, 'pulse.yaml', 'Exercise 3', 'x'), 'Exercise 3', 'folder wins');
  equal(importedName(files, 'pulse.yaml', null, 'x'), 'pump_tank', 'no folder: the model names it');
  equal(importedName({ 'a.yaml': 'x: 1\n' }, 'a.yaml', null, 'dropped'), 'dropped', 'neither');
});

await test('a project name is taken from the model itself', () => {
  equal(nameFromModel('project:\n  name: boiler_control\n  version: "1.0"\n', 'x'), 'boiler_control', 'plain');
  equal(nameFromModel('project:\n  name: "quoted name"\n', 'x'), 'quoted name', 'quoted');
  equal(nameFromModel('# comment\nhardware:\n  devices:\n', 'fallback'), 'fallback', 'no project block');
  // A `name:` belonging to something else must not be picked up.
  equal(nameFromModel('hardware:\n  buses:\n    name: nope\n', 'fallback'), 'fallback', 'unrelated name');
});

// ---------------------------------------------------------------------------

await test('projects are created, listed most-recent-first, and reopened', () => {
  const store = new ProjectStore(memoryStorage());

  const first = store.create('alpha', { 'a.yaml': 'project:\n' }, 'a.yaml');
  const second = store.create('beta', { 'b.yaml': 'project:\n' }, 'b.yaml');

  equal(store.list().map(p => p.name), ['beta', 'alpha'], 'newest first');
  equal(store.current()?.id, second.id, 'the new one is current');

  store.setCurrent(first.id);
  equal(store.current()?.name, 'alpha', 'reopened');
});

await test('a duplicate project name gets a suffix instead of colliding', () => {
  const store = new ProjectStore(memoryStorage());
  store.create('boiler', {}, 'a.yaml');
  store.create('boiler', {}, 'a.yaml');
  const third = store.create('boiler', {}, 'a.yaml');

  equal(third.name, 'boiler 3', 'third gets a suffix');
  equal(store.list().map(p => p.name).sort(), ['boiler', 'boiler 2', 'boiler 3'], 'all distinct');
});

await test('renaming to its own name is not treated as a collision', () => {
  // Naive uniquing would see the project's own name as taken and make it
  // "boiler 2" on every save.
  const store = new ProjectStore(memoryStorage());
  const project = store.create('boiler', {}, 'a.yaml');

  equal(store.rename(project.id, 'boiler')?.name, 'boiler', 'unchanged');
  equal(store.rename(project.id, 'kettle')?.name, 'kettle', 'renamed');
});

await test('deleting returns what to open next, and the last one leaves nothing', () => {
  const store = new ProjectStore(memoryStorage());
  const first = store.create('alpha', {}, 'a.yaml');
  const second = store.create('beta', {}, 'b.yaml');

  equal(store.remove(second.id)?.name, 'alpha', 'falls back to the other');
  equal(store.remove(first.id), null, 'nothing left');
  equal(store.current(), null, 'and no current project');
});

await test('the pre-projects workspace is migrated, once, keeping its name', () => {
  const storage = memoryStorage({
    'pulseir.workspace': JSON.stringify({
      files: { 'model.yaml': 'project:\n  name: my_boiler\n' },
      entry: 'model.yaml',
      active: 'model.yaml',
    }),
  });
  const store = new ProjectStore(storage);

  const migrated = store.migrateLegacy();
  equal(migrated?.name, 'my_boiler', 'named from the model');
  equal(migrated?.files['model.yaml'], 'project:\n  name: my_boiler\n', 'contents kept');

  // The old key is gone, so it cannot be migrated a second time into a
  // duplicate project on the next load.
  equal(storage.data['pulseir.workspace'], undefined, 'legacy key removed');
  equal(store.migrateLegacy(), null, 'nothing left to migrate');
});

await test('corrupt storage reads as empty rather than throwing', () => {
  // A half-written localStorage value must not brick the editor on load.
  for (const junk of ['{oh no', '[]', 'null', '"a string"']) {
    const store = new ProjectStore(memoryStorage({ 'pulseir.projects': junk }));
    equal(store.list(), [], `list() for ${junk}`);
    equal(store.current(), null, `current() for ${junk}`);
  }

  const bad = new ProjectStore(memoryStorage({ 'pulseir.workspace': '{oh no' }));
  equal(bad.migrateLegacy(), null, 'corrupt legacy workspace');
});

}

// ============================================================================

/**
 * Rewrite a single-entry stored zip so its entry is deflated.
 *
 * Only used by the test above, to build the kind of zip a desktop tool
 * produces without depending on one being installed.
 */
function rebuildAsDeflated(stored: Uint8Array, raw: Uint8Array, compressed: Uint8Array): Uint8Array {
  const view = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
  const nameLength = view.getUint16(26, true);
  const name = stored.subarray(30, 30 + nameLength);
  const crc = view.getUint32(14, true);

  const parts: number[] = [];
  const u16 = (v: number) => parts.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => parts.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);

  u32(0x04034b50); u16(20); u16(0x0800); u16(8); u16(0); u16(0);
  u32(crc); u32(compressed.length); u32(raw.length); u16(nameLength); u16(0);
  parts.push(...name, ...compressed);

  const centralStart = parts.length;
  u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(8); u16(0); u16(0);
  u32(crc); u32(compressed.length); u32(raw.length);
  u16(nameLength); u16(0); u16(0); u16(0); u16(0); u32(0); u32(0);
  parts.push(...name);

  const cdSize = parts.length - centralStart;
  u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(cdSize); u32(centralStart); u16(0);

  return new Uint8Array(parts);
}

// Not top-level await: this project's tsc target does not allow it.
main().then(() => {
  if (failures > 0) {
    console.error(`\n❌ ${failures} project test(s) failed`);
    process.exit(1);
  }
  console.log('\n✨ Project tests passed!');
});
