/**
 * Parser validation tests.
 *
 * These cover the reference checks that used to be a TODO: before, any ref
 * whose first path segment existed was accepted, so "running/typo" sailed
 * through the parser and produced silently wrong C++.
 */

import { Parser, ParseError } from '../src/parser/index.js';

function model(body: string): string {
  return `
project:
  name: validation_test
  version: "1.0"
system:
  name: validation_system
  events:
    - {name: GO, source: external}
${body}
`;
}

const STATES = `  states:
    - name: idle
      type: simple
    - name: running
      type: composite
      initial: heating
      regions:
        - initial: heating
          states:
            - {name: heating, type: simple}
`;

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

function expectReject(yaml: string, needle: string, label: string): void {
  let raised: Error | undefined;
  try {
    new Parser().parse(yaml);
  } catch (error) {
    raised = error as Error;
  }

  if (!raised) {
    throw new Error(`${label}: expected a ParseError, but parsing succeeded`);
  }
  if (!(raised instanceof ParseError)) {
    throw new Error(`${label}: expected ParseError, got ${raised.name}: ${raised.message}`);
  }
  if (!raised.message.includes(needle)) {
    throw new Error(`${label}: expected message containing "${needle}", got "${raised.message}"`);
  }
}

function expectAccept(yaml: string, label: string) {
  try {
    return new Parser().parse(yaml);
  } catch (error) {
    throw new Error(
      `${label}: expected parsing to succeed, got ${error instanceof Error ? error.message : error}`
    );
  }
}

// ============================================================================

console.log('🔍 Testing parser validation...\n');

test('rejects a nested path whose leaf does not exist', () => {
  expectReject(
    model(`${STATES}  transitions:
    - {source: idle, event: GO, target: "running/nope"}`),
    'running/nope',
    'bad nested path'
  );
});

test('rejects an unknown event', () => {
  expectReject(
    model(`${STATES}  transitions:
    - {source: idle, event: NOPE, target: running}`),
    'NOPE',
    'unknown event'
  );
});

test('rejects a wildcard target', () => {
  expectReject(
    model(`${STATES}  transitions:
    - {source: idle, event: GO, target: "*"}`),
    'wildcard',
    'wildcard target'
  );
});

test('rejects an ambiguous bare state name', () => {
  // "shared" exists under two different parents, so a bare reference to it
  // cannot be resolved to one state.
  const ambiguous = `  states:
    - name: first
      type: composite
      initial: shared
      regions:
        - initial: shared
          states:
            - {name: shared, type: simple}
    - name: second
      type: composite
      initial: shared
      regions:
        - initial: shared
          states:
            - {name: shared, type: simple}
  transitions:
    - {source: "first/shared", event: GO, target: shared}
`;
  expectReject(model(ambiguous), 'ambiguous', 'ambiguous bare name');
});

test('rejects a duplicate state path', () => {
  const duplicate = `  states:
    - {name: idle, type: simple}
    - {name: idle, type: simple}
  transitions: []
`;
  expectReject(model(duplicate), 'Duplicate state path', 'duplicate state');
});

test('rejects a guard mapping with no name', () => {
  expectReject(
    model(`${STATES}  transitions:
    - source: idle
      event: GO
      target: heating
      guard: {description: something}`),
    'requires a "name"',
    'nameless guard'
  );
});

test('rejects the retired expression guard form with migration guidance', () => {
  // Silently ignoring an expression would drop the condition and change
  // behaviour with no visible error, so this must fail loudly.
  expectReject(
    model(`${STATES}  transitions:
    - source: idle
      event: GO
      target: heating
      guard:
        type: expression
        expression: "temperature >= setpoint"`),
    'guard: my_guard_name',
    'retired expression guard'
  );
});

test('accepts a full hierarchical path', () => {
  expectAccept(
    model(`${STATES}  transitions:
    - {source: idle, event: GO, target: "running/heating"}`),
    'full path'
  );
});

test('accepts an unambiguous bare leaf name', () => {
  expectAccept(
    model(`${STATES}  transitions:
    - {source: idle, event: GO, target: heating}`),
    'bare leaf name'
  );
});

test('accepts the `guard: <name>` shorthand', () => {
  const project = expectAccept(
    model(`${STATES}  transitions:
    - {source: idle, event: GO, target: heating, guard: temp_ready}`),
    'named guard'
  );

  const guard = project.system.transitions[0].guard;
  if (guard?.name !== 'temp_ready') {
    throw new Error(`expected name "temp_ready", got ${JSON.stringify(guard)}`);
  }
});

test('accepts the guard mapping form with a description', () => {
  const project = expectAccept(
    model(`${STATES}  transitions:
    - source: idle
      event: GO
      target: heating
      guard:
        name: temp_ready
        description: temperature has reached the setpoint`),
    'documented guard'
  );

  const guard = project.system.transitions[0].guard;
  if (guard?.name !== 'temp_ready') {
    throw new Error(`expected name "temp_ready", got ${JSON.stringify(guard)}`);
  }
  if (guard.description !== 'temperature has reached the setpoint') {
    throw new Error(`description was not preserved: ${JSON.stringify(guard)}`);
  }
});

test('accepts a wildcard source', () => {
  expectAccept(
    model(`${STATES}  transitions:
    - {source: "*", event: GO, target: idle}`),
    'wildcard source'
  );
});

// ============================================================================
// TIMED TRANSITIONS
//
// A duration is data, so getting it wrong has to fail here, in the model, and
// not later inside generated C++ the student never wrote.
// ============================================================================

/** The domain schema, where `after:` lives. */
function timed(transitions: string, parameters = 'hold_ms: {type: int, default: 1000}'): string {
  return `
project: {name: timing, version: "1.0"}
parameters:
  ${parameters}
events:
  GO: {source: external}
machine:
  states:
    idle:
    busy:
      initial: one
      states:
        one:
        two:
  transitions:
${transitions}
`;
}

test('accepts a literal duration', () => {
  const project = new Parser().parse(timed('    - {from: idle, after: 500, to: busy}'));
  const t = project.system.transitions[0];
  if (t.after !== 500) throw new Error(`after was not kept: ${JSON.stringify(t)}`);
  if (t.event !== undefined) throw new Error('a timed transition must not invent an event');
});

test('accepts a duration that names an int parameter', () => {
  const project = new Parser().parse(timed('    - {from: idle, after: hold_ms, to: busy}'));
  if (project.system.transitions[0].after !== 'hold_ms') {
    throw new Error('the parameter name was not kept');
  }
});

test('accepts a timer on a composite state', () => {
  // The whole point of generating timers rather than using addState()'s.
  expectAccept(timed('    - {from: busy, after: hold_ms, to: idle}'), 'composite timer');
});

test('rejects a transition with both "on" and "after"', () => {
  expectReject(
    timed('    - {from: idle, on: GO, after: 500, to: busy}'),
    'both "on" and "after"',
    'two triggers'
  );
});

test('rejects a transition with neither "on" nor "after"', () => {
  expectReject(
    timed('    - {from: idle, to: busy}'),
    'neither "on" nor "after"',
    'no trigger'
  );
});

test('rejects a duration naming a parameter that does not exist', () => {
  expectReject(
    timed('    - {from: idle, after: nope_ms, to: busy}'),
    'not a declared parameter',
    'unknown parameter'
  );
});

test('rejects a duration naming a non-integer parameter', () => {
  // A float millisecond count would not compile against `unsigned long`.
  expectReject(
    timed('    - {from: idle, after: setpoint, to: busy}', 'setpoint: {type: float, default: 1.5}'),
    'must be an int',
    'float parameter'
  );
});

test('rejects a timer that re-enters its own state', () => {
  // The clock is stamped on entry, and a self-transition never leaves the
  // state - so it would fire every pass rather than repeat every 500ms. The
  // message has to say that, and point at the shape that does work.
  expectReject(
    timed('    - {from: idle, after: 500, to: idle}'),
    'would fire on every pass',
    'self timer'
  );
  expectReject(
    timed('    - {from: idle, after: 500, to: idle}'),
    'alternate between two states',
    'self timer names the fix'
  );
});

test('rejects a timer from the wildcard', () => {
  expectReject(
    timed('    - {from: "*", after: 500, to: busy}'),
    'needs a real "from"',
    'wildcard timer'
  );
});

test('rejects a duration that is zero, negative or fractional', () => {
  for (const value of ['0', '-1', '1.5']) {
    expectReject(
      timed(`    - {from: idle, after: ${value}, to: busy}`),
      'positive whole number',
      `after: ${value}`
    );
  }
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} validation test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Validation tests passed!');
