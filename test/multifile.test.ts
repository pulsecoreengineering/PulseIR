/**
 * Multi-file model tests.
 *
 * Splitting a model across files is a maintenance win, but it introduces ways
 * to be wrong that a single file cannot be: duplicate names contributed by two
 * files, include cycles, and merge order that silently drops a section. Those
 * are what these cover.
 *
 * The parser never touches a filesystem, so these drive it through the
 * in-memory resolver - the same seam the CLI fills with the real one.
 */

import { Parser, ParseError } from '../src/parser/index.js';
import { MemoryResolver, normalize } from '../src/parser/resolver.js';

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

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

function load(files: Record<string, string>, entry = 'main.yaml') {
  return new Parser().parseFrom(entry, new MemoryResolver(files));
}

function expectReject(files: Record<string, string>, needle: string, label: string, entry = 'main.yaml') {
  let raised: Error | undefined;
  try {
    load(files, entry);
  } catch (error) {
    raised = error as Error;
  }

  if (!raised) throw new Error(`${label}: expected a ParseError, but parsing succeeded`);
  if (!(raised instanceof ParseError)) throw new Error(`${label}: got ${raised.name}: ${raised.message}`);
  if (!raised.message.includes(needle)) {
    throw new Error(`${label}: expected message containing "${needle}", got "${raised.message}"`);
  }
}

const ROOT = `
project: {name: split, version: "1.0"}
include:
  - events.yaml
  - states.yaml
system:
  name: split_system
`;

const EVENTS = `
system:
  events:
    - {name: GO, source: external}
`;

const STATES = `
system:
  states:
    - {name: idle, type: simple}
    - {name: running, type: simple}
  transitions:
    - {source: idle, event: GO, target: running}
`;

// ============================================================================

console.log('🗂️  Testing multi-file models...\n');

test('sections from several files combine into one model', () => {
  const project = load({ 'main.yaml': ROOT, 'events.yaml': EVENTS, 'states.yaml': STATES });

  equal(project.name, 'split', 'project name comes from the root file');
  equal(project.system.name, 'split_system', 'system name comes from the root file');
  equal(project.system.events.map(e => e.name), ['GO'], 'events');
  equal(project.system.states.map(s => s.name), ['idle', 'running'], 'states');
  equal(project.system.transitions.length, 1, 'transitions');
});

test('lists concatenate in include order, with the root last', () => {
  const project = load({
    'main.yaml': `
project: {name: order, version: "1.0"}
include: [a.yaml, b.yaml]
system:
  name: order
  events:
    - {name: FROM_ROOT, source: external}
  states: [{name: idle, type: simple}]
  transitions: []
`,
    'a.yaml': `system: {events: [{name: FROM_A, source: external}]}`,
    'b.yaml': `system: {events: [{name: FROM_B, source: external}]}`,
  });

  // Predictable order matters: it decides which transition shadows which.
  equal(
    project.system.events.map(e => e.name),
    ['FROM_A', 'FROM_B', 'FROM_ROOT'],
    'event order'
  );
});

test('a file overrides scalars from the files it includes', () => {
  const project = load({
    'main.yaml': `
project: {name: override, version: "1.0"}
include: [base.yaml]
system:
  name: chosen
  states: [{name: idle, type: simple}]
  events: [{name: GO, source: external}]
  transitions: []
`,
    'base.yaml': `system: {name: overridden, description: from base}`,
  });

  equal(project.system.name, 'chosen', 'including file wins');
  equal(project.system.description, 'from base', 'unset keys still come from the include');
});

test('includes resolve relative to the file that lists them', () => {
  const project = load({
    'models/main.yaml': `
project: {name: nested, version: "1.0"}
include: [parts/hardware.yaml]
system: {name: nested}
`,
    // Listed as "shared.yaml" from inside parts/, so it must resolve there.
    'models/parts/hardware.yaml': `
include: [shared.yaml]
system:
  events: [{name: GO, source: external}]
  states: [{name: idle, type: simple}]
  transitions: []
`,
    'models/parts/shared.yaml': `system: {parameters: [{name: gain, type: float, default: 1.0}]}`,
  }, 'models/main.yaml');

  equal(project.system.parameters?.map(p => p.name), ['gain'], 'deep relative include');
});

test('an include cycle is reported, not followed', () => {
  expectReject(
    {
      'main.yaml': `project: {name: cyclic, version: "1.0"}\ninclude: [a.yaml]\nsystem: {name: c}`,
      'a.yaml': `include: [b.yaml]\nsystem: {}`,
      'b.yaml': `include: [a.yaml]\nsystem: {}`,
    },
    'Include cycle',
    'cycle'
  );
});

test('a missing include names the file that asked for it', () => {
  expectReject(
    { 'main.yaml': `project: {name: x, version: "1.0"}\ninclude: [gone.yaml]\nsystem: {name: x}` },
    'gone.yaml',
    'missing include'
  );
});

test('only the root file may declare the project', () => {
  expectReject(
    {
      'main.yaml': `project: {name: x, version: "1.0"}\ninclude: [other.yaml]\nsystem: {name: x}`,
      'other.yaml': `project: {name: sneaky, version: "2.0"}\nsystem: {}`,
    },
    'Only the top-level model',
    'project in an include'
  );
});

test('duplicate names contributed by two files are rejected', () => {
  // The whole hazard of splitting a model: neither file looks wrong alone.
  expectReject(
    {
      'main.yaml': `project: {name: dup, version: "1.0"}\ninclude: [a.yaml, b.yaml]\nsystem: {name: dup, states: [{name: idle, type: simple}], transitions: []}`,
      'a.yaml': `system: {events: [{name: GO, source: external}]}`,
      'b.yaml': `system: {events: [{name: GO, source: timer}]}`,
    },
    'Duplicate event "GO"',
    'duplicate across files'
  );
});

test('include without a resolver fails with an actionable message', () => {
  let raised: Error | undefined;
  try {
    // parse() with no resolver is how the browser editor calls in.
    new Parser().parse(`project: {name: x, version: "1.0"}\ninclude: [a.yaml]\nsystem: {name: x}`);
  } catch (error) {
    raised = error as Error;
  }

  assert(raised !== undefined, 'expected an error');
  assert(
    raised!.message.includes('no way to read other files'),
    `unhelpful message: ${raised!.message}`
  );
});

test('"includes" is caught as the near-miss it is', () => {
  expectReject(
    { 'main.yaml': `project: {name: x, version: "1.0"}\nincludes: [a.yaml]\nsystem: {name: x}` },
    'the key is "include"',
    'wrong key'
  );
});

test('a resource may only name a library that exists', () => {
  expectReject(
    {
      'main.yaml': `
project: {name: libs, version: "1.0"}
system:
  name: libs
  events: [{name: GO, source: external}]
  states: [{name: idle, type: simple}]
  transitions: []
  resources:
    - {name: bus, interface: i2c, library: NotDeclared}
`,
    },
    'which is not declared',
    'dangling library reference'
  );
});

test('an unknown interface is rejected with the valid set', () => {
  expectReject(
    {
      'main.yaml': `
project: {name: iface, version: "1.0"}
system:
  name: iface
  events: [{name: GO, source: external}]
  states: [{name: idle, type: simple}]
  transitions: []
  resources:
    - {name: bus, interface: telepathy}
`,
    },
    'unknown interface "telepathy"',
    'bad interface'
  );
});

test('path normalisation collapses . and .. without Node', () => {
  equal(normalize('a/./b/../c.yaml'), 'a/c.yaml', 'relative');
  equal(normalize('/root/../etc/x.yaml'), '/etc/x.yaml', 'absolute');
  equal(normalize('../up.yaml'), '../up.yaml', 'leading parent is kept');
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} multi-file test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Multi-file tests passed!');
