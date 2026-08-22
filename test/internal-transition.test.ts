/**
 * Tests for `in:` internal transition syntax.
 *
 * An internal transition handles an event and runs actions without exiting the
 * source state — no transitionTo(), no exit/entry hooks, no timer reset.
 *
 * Tests cover:
 *   - Parser accepts valid `in:` usage and sets internal: true
 *   - Parser rejects `in:` + `to:` together
 *   - Parser rejects `in:` + `on:` together
 *   - Parser rejects `in:` from "*" (wildcard)
 *   - Parser rejects `in:` for an unknown event
 *   - Codegen emits action call but NO transitionTo() for internal transitions
 *   - Codegen still emits transitionTo() for a regular on: on the same event
 */

import { Parser } from '../src/parser/index.js';
import { Codegen } from '../src/codegen/index.js';

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parse(yaml: string) {
  return new Parser().parse(yaml);
}

function generate(yaml: string): string {
  return new Codegen().generate(parse(yaml));
}

function expectParseError(yaml: string, fragment: string): void {
  try {
    parse(yaml);
    throw new Error(`expected ParseError containing "${fragment}", but parse succeeded`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(fragment)) {
      throw new Error(`expected error containing "${fragment}", got: ${msg}`);
    }
  }
}

// ── Base YAML reused across tests ────────────────────────────────────────────

const BASE = `
project: {name: test, version: "1.0"}
events:
  TICK:  {source: external}
  RESET: {source: external}
actions:
  log_tick: {driver: log, params: {level: INFO, message: "tick"}}
machine:
  initial: idle
  states:
    idle:
    done:
  transitions:
    - {from: idle, on: RESET, to: done}
`;

// ── Parser: happy path ────────────────────────────────────────────────────────

test('parser sets internal:true and no target for in: transition', () => {
  const yaml = BASE + `    - {from: idle, in: TICK, do: [log_tick]}\n`;
  const project = parse(yaml);
  const t = project.system.transitions.find(x => x.internal);
  if (!t) throw new Error('no internal transition found');
  if (t.event !== 'TICK')   throw new Error(`event: expected TICK, got ${t.event}`);
  if (t.target !== undefined) throw new Error('internal transition must have no target');
  if (t.source !== 'idle')  throw new Error(`source: expected idle, got ${t.source}`);
  if (!t.actions?.length)   throw new Error('actions should be non-empty');
});

test('parser preserves guard on in: transition', () => {
  const yaml = BASE + `    - {from: idle, in: TICK, guard: cond_a, do: [log_tick]}\n`;
  const project = parse(yaml);
  const t = project.system.transitions.find(x => x.internal);
  if (!t?.guard) throw new Error('guard should be set on internal transition');
});

test('in: transition without do is valid (no-op consume)', () => {
  const yaml = BASE + `    - {from: idle, in: TICK}\n`;
  const project = parse(yaml);
  const t = project.system.transitions.find(x => x.internal);
  if (!t) throw new Error('no internal transition found');
  if (t.actions?.length) throw new Error('no actions expected');
});

// ── Parser: error cases ───────────────────────────────────────────────────────

test('parser rejects in: + to: together', () => {
  expectParseError(
    BASE + `    - {from: idle, in: TICK, to: done}\n`,
    '"in" and "to"',
  );
});

test('parser rejects in: + on: together', () => {
  expectParseError(
    BASE + `    - {from: idle, in: TICK, on: RESET, to: done}\n`,
    'more than one trigger',
  );
});

test('parser rejects in: from wildcard "*"', () => {
  expectParseError(
    BASE + `    - {from: "*", in: TICK}\n`,
    '"in" from "*"',
  );
});

test('parser rejects in: with unknown event', () => {
  expectParseError(
    BASE + `    - {from: idle, in: UNKNOWN_EVT}\n`,
    'unknown event "UNKNOWN_EVT"',
  );
});

test('parser rejects in: without a from field', () => {
  expectParseError(
    BASE + `    - {in: TICK}\n`,
    'missing "from"',
  );
});

// ── Codegen ───────────────────────────────────────────────────────────────────

test('codegen omits transitionTo() for in: transition', () => {
  const yaml = BASE + `    - {from: idle, in: TICK, do: [log_tick]}\n`;
  const code = generate(yaml);
  // Must call the action
  if (!code.includes('action_log_tick')) {
    throw new Error('expected action_log_tick call in generated code');
  }
  // Find the case block in the switch statement (not the enum definition).
  const caseIdx = code.indexOf('case EVENT_TICK:');
  if (caseIdx === -1) throw new Error('case EVENT_TICK: not found in generated code');
  const breakIdx = code.indexOf('break;', caseIdx);
  const block = code.slice(caseIdx, breakIdx);
  if (block.includes('transitionTo')) {
    throw new Error('internal transition should NOT emit transitionTo()');
  }
});

test('codegen emits transitionTo() for regular on: transition', () => {
  const yaml = BASE; // RESET → done is a regular transition
  const code = generate(yaml);
  if (!code.includes('transitionTo')) {
    throw new Error('regular transition must emit transitionTo()');
  }
});

test('codegen returns true (consumes event) for internal transition', () => {
  const yaml = BASE + `    - {from: idle, in: TICK, do: [log_tick]}\n`;
  const code = generate(yaml);
  const caseIdx = code.indexOf('case EVENT_TICK:');
  if (caseIdx === -1) throw new Error('case EVENT_TICK: not found in generated code');
  const breakIdx = code.indexOf('break;', caseIdx);
  const block = code.slice(caseIdx, breakIdx);
  if (!block.includes('return true')) {
    throw new Error('internal transition must still return true to consume the event');
  }
});

test('codegen: in: and on: on different events both appear in handler', () => {
  const yaml = BASE + `    - {from: idle, in: TICK, do: [log_tick]}\n`;
  const code = generate(yaml);
  if (!code.includes('case EVENT_TICK:'))  throw new Error('case EVENT_TICK: missing from handler');
  if (!code.includes('case EVENT_RESET:')) throw new Error('case EVENT_RESET: missing from handler');
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} internal-transition test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Internal-transition tests passed!');
