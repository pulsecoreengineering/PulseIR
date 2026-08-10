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

test('rejects an expression guard with no expression', () => {
  expectReject(
    model(`${STATES}  transitions:
    - source: idle
      event: GO
      target: heating
      guard: {type: expression}`),
    'requires an "expression"',
    'empty expression guard'
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

test('accepts the contract\'s `guard: <name>` string form', () => {
  const project = expectAccept(
    model(`${STATES}  transitions:
    - {source: idle, event: GO, target: heating, guard: temp_ready}`),
    'named guard'
  );

  const guard = project.system.transitions[0].guard;
  if (guard?.evaluator !== 'temp_ready') {
    throw new Error(`expected evaluator "temp_ready", got ${JSON.stringify(guard)}`);
  }
  if (String(guard.type) !== 'custom') {
    throw new Error(`expected guard type "custom", got "${guard.type}"`);
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

if (failures > 0) {
  console.error(`\n❌ ${failures} validation test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Validation tests passed!');
