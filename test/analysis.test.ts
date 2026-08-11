/**
 * State-hierarchy analysis tests.
 *
 * Both the topic emitter and the web editor's structure view depend on these,
 * so a wrong answer here shows up as a blank chart or a diagram that teaches
 * the wrong rule.
 */

import { flattenStates, leafPaths, resolveEntryLeaf, resolvePath, childrenOf } from '../src/analysis/states.js';
import { Parser } from '../src/parser/index.js';

const MODEL = `
project: {name: analysis, version: "1.0"}
system:
  name: analysis
  events:
    - {name: GO, source: external}
  states:
    - name: off
      type: simple
    - name: active
      type: composite
      initial: phase_one
      regions:
        - initial: phase_one
          states:
            - {name: phase_one, type: simple}
            - name: phase_two
              type: composite
              initial: deep
              regions:
                - initial: deep
                  states:
                    - {name: deep, type: simple}
  transitions: []
`;

const states = new Parser().parse(MODEL).system.states;

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

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

// ============================================================================

console.log('🌳 Testing state analysis...\n');

test('flattens in pre-order, so parents precede their children', () => {
  // This is the order PulseHSM requires for registration.
  equal(
    flattenStates(states).map(s => s.path),
    ['off', 'active', 'active/phase_one', 'active/phase_two', 'active/phase_two/deep'],
    'flatten order'
  );
});

test('records parent, depth and leafness', () => {
  const byPath = new Map(flattenStates(states).map(s => [s.path, s]));

  equal(byPath.get('off')!.parentPath, null, 'top-level parent');
  equal(byPath.get('off')!.depth, 0, 'top-level depth');
  equal(byPath.get('off')!.isLeaf, true, 'simple state is a leaf');

  equal(byPath.get('active')!.isLeaf, false, 'composite is not a leaf');
  equal(byPath.get('active/phase_two')!.parentPath, 'active', 'nested parent');
  equal(byPath.get('active/phase_two/deep')!.depth, 2, 'nested depth');
});

test('qualifies the initial child relative to its parent', () => {
  const byPath = new Map(flattenStates(states).map(s => [s.path, s]));

  // The model says `initial: phase_one`, which names a child, not a root state.
  equal(byPath.get('active')!.initialChildPath, 'active/phase_one', 'initial child');
  equal(byPath.get('active/phase_two')!.initialChildPath, 'active/phase_two/deep', 'nested initial');
  equal(byPath.get('off')!.initialChildPath, null, 'leaves have no initial child');
});

test('leafPaths lists only states the machine can rest in', () => {
  equal(
    leafPaths(states),
    ['off', 'active/phase_one', 'active/phase_two/deep'],
    'leaf paths'
  );
});

test('resolveEntryLeaf descends through nested composites', () => {
  equal(resolveEntryLeaf(states, 'active'), 'active/phase_one', 'one level');
  equal(resolveEntryLeaf(states, 'active/phase_two'), 'active/phase_two/deep', 'two levels');
  equal(resolveEntryLeaf(states, 'off'), 'off', 'a leaf resolves to itself');
  equal(resolveEntryLeaf(states, 'nope'), null, 'unknown path');
});

test('resolveEntryLeaf refuses a broken initial chain instead of guessing', () => {
  const broken = new Parser().parse(`
project: {name: broken, version: "1.0"}
system:
  name: broken
  events: [{name: GO, source: external}]
  states:
    - name: outer
      type: composite
      regions:
        - initial: missing
          states:
            - {name: inner, type: simple}
  transitions: []
`).system.states;

  equal(resolveEntryLeaf(broken, 'outer'), null, 'unresolvable initial child');
});

test('resolvePath accepts full paths and unambiguous bare names', () => {
  equal(resolvePath(states, 'active/phase_two'), 'active/phase_two', 'full path');
  equal(resolvePath(states, 'deep'), 'active/phase_two/deep', 'unique bare name');
  equal(resolvePath(states, 'nope'), null, 'unknown name');
});

test('resolvePath refuses an ambiguous bare name', () => {
  const ambiguous = new Parser().parse(`
project: {name: ambiguous, version: "1.0"}
system:
  name: ambiguous
  events: [{name: GO, source: external}]
  states:
    - name: first
      type: composite
      initial: shared
      regions:
        - initial: shared
          states: [{name: shared, type: simple}]
    - name: second
      type: composite
      initial: shared
      regions:
        - initial: shared
          states: [{name: shared, type: simple}]
  transitions: []
`).system.states;

  equal(resolvePath(ambiguous, 'shared'), null, 'ambiguous bare name');
  equal(resolvePath(ambiguous, 'first/shared'), 'first/shared', 'disambiguated by path');
});

test('childrenOf flattens across regions', () => {
  const active = states.find(s => s.name === 'active')!;
  equal(childrenOf(active).map(s => s.name), ['phase_one', 'phase_two'], 'children');
  equal(childrenOf(states.find(s => s.name === 'off')!).length, 0, 'leaf has no children');
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} analysis test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Analysis tests passed!');
