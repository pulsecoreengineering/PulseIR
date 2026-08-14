/**
 * Semantic validator tests.
 *
 * The parser handles hard errors (undefined refs, schema constraints).
 * The Validator handles soft warnings over a fully-parsed project:
 * unreachable states, unused events, and partially-declared pin groups.
 */

import { Parser } from '../src/parser/index.js';
import { Validator, type Diagnostic } from '../src/analysis/validate.js';

function parse(yaml: string) {
  return new Parser().parse(yaml);
}

function validate(yaml: string, parserWarnings: string[] = []) {
  return new Validator().validate(parse(yaml), parserWarnings);
}

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

function codes(diags: Diagnostic[]): string[] {
  return diags.map(d => d.code);
}

function hasCode(diags: Diagnostic[], code: string): boolean {
  return diags.some(d => d.code === code);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MACHINE = `
project: {name: test, version: "1.0"}
events:
  BOOT: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
`;

// ── Parser warnings ───────────────────────────────────────────────────────────

test('lifts parser warnings into diagnostics with code PARSER', () => {
  const result = new Validator().validate(parse(MACHINE), ['No board declared.', 'Legacy schema.']);
  const parserDiags = result.diagnostics.filter(d => d.code === 'PARSER');
  if (parserDiags.length !== 2) throw new Error(`expected 2 PARSER diags, got ${parserDiags.length}`);
  if (result.warningCount !== 2) throw new Error(`warningCount should be 2, got ${result.warningCount}`);
  if (result.errorCount !== 0) throw new Error(`errorCount should be 0, got ${result.errorCount}`);
});

// ── Unreachable states ────────────────────────────────────────────────────────

test('no warning when all leaves are reachable', () => {
  const result = validate(MACHINE);
  if (hasCode(result.diagnostics, 'UNREACHABLE_STATE')) {
    throw new Error('false positive: running is reachable via BOOT transition');
  }
});

test('warns when a leaf has no inbound transitions', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  BOOT: {source: external}
machine:
  states:
    idle:
    running:
    orphan:
  transitions:
    - {from: idle, on: BOOT, to: running}
`;
  const result = validate(yaml);
  if (!hasCode(result.diagnostics, 'UNREACHABLE_STATE')) {
    throw new Error('expected UNREACHABLE_STATE for "orphan"');
  }
  const msg = result.diagnostics.find(d => d.code === 'UNREACHABLE_STATE')!.message;
  if (!msg.includes('orphan')) throw new Error(`message should mention "orphan": ${msg}`);
});

test('initial state is not flagged as unreachable', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  BOOT: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: running, on: BOOT, to: running}
`;
  // idle is the initial state; running is the only target
  // idle itself has no inbound transitions from others but is still reachable as initial
  const result = validate(yaml);
  const unreachable = result.diagnostics.filter(d => d.code === 'UNREACHABLE_STATE');
  // idle = initial → not flagged. running → target of BOOT → not flagged.
  if (unreachable.length > 0) {
    throw new Error(`unexpected UNREACHABLE_STATE: ${unreachable.map(d => d.message).join('; ')}`);
  }
});

test('composite state target reaches its initial child', () => {
  // Transition to "running" (composite) implicitly reaches "running/heating".
  const yaml = `
project: {name: test, version: "1.0"}
events:
  BOOT: {source: external}
  COOL: {source: external}
machine:
  states:
    idle:
    running:
      initial: heating
      states:
        heating:
        cooling:
  transitions:
    - {from: idle, on: BOOT, to: running}
    - {from: "running/heating", on: COOL, to: "running/cooling"}
`;
  const result = validate(yaml);
  const unreachable = result.diagnostics.filter(d => d.code === 'UNREACHABLE_STATE');
  if (unreachable.length > 0) {
    throw new Error(`unexpected UNREACHABLE_STATE: ${unreachable.map(d => d.message).join('; ')}`);
  }
});

// ── Unused events ─────────────────────────────────────────────────────────────

test('no warning when every declared event is used', () => {
  const result = validate(MACHINE);
  if (hasCode(result.diagnostics, 'UNUSED_EVENT')) {
    throw new Error('false positive: BOOT is used in the transition');
  }
});

test('warns when a declared event is never referenced', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  BOOT: {source: external}
  UNUSED: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
`;
  const result = validate(yaml);
  if (!hasCode(result.diagnostics, 'UNUSED_EVENT')) {
    throw new Error('expected UNUSED_EVENT for "UNUSED"');
  }
  const msg = result.diagnostics.find(d => d.code === 'UNUSED_EVENT')!.message;
  if (!msg.includes('UNUSED')) throw new Error(`message should mention "UNUSED": ${msg}`);
});

test('event used only in a command is not flagged', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  BOOT: {source: external}
  CMD_BOOT: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
commands:
  map:
    start: {event: CMD_BOOT}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'UNUSED_EVENT')) {
    throw new Error('CMD_BOOT is used in a command and should not be flagged');
  }
});

// ── Partial bindings ──────────────────────────────────────────────────────────

test('no warning when all required pins are declared', () => {
  const yaml = `
project: {name: test, version: "1.0"}
hardware:
  buses:
    wire0: {interface: i2c, sda: 21, scl: 22}
tasks:
  blink: {every: 500, do: toggle}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'PARTIAL_BINDING')) {
    throw new Error('false positive: all i2c pins declared');
  }
});

test('no warning when no pins are declared at all (using defaults)', () => {
  const yaml = `
project: {name: test, version: "1.0"}
hardware:
  buses:
    wire0: {interface: i2c}
tasks:
  blink: {every: 500, do: toggle}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'PARTIAL_BINDING')) {
    throw new Error('declaring no pins is intentional; should not warn');
  }
});

test('warns when some but not all of a required group are declared', () => {
  const yaml = `
project: {name: test, version: "1.0"}
hardware:
  buses:
    wire0: {interface: i2c, sda: 21}
tasks:
  blink: {every: 500, do: toggle}
`;
  const result = validate(yaml);
  if (!hasCode(result.diagnostics, 'PARTIAL_BINDING')) {
    throw new Error('expected PARTIAL_BINDING: sda declared but scl is missing');
  }
  const msg = result.diagnostics.find(d => d.code === 'PARTIAL_BINDING')!.message;
  if (!msg.includes('scl')) throw new Error(`message should mention missing key "scl": ${msg}`);
});

// ── Error / warning counts ────────────────────────────────────────────────────

test('errorCount and warningCount return correct values', () => {
  const result = new Validator().validate(parse(MACHINE), ['a warning']);
  if (result.warningCount !== 1) throw new Error(`warningCount: expected 1, got ${result.warningCount}`);
  if (result.errorCount !== 0) throw new Error(`errorCount: expected 0, got ${result.errorCount}`);
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} validator test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Validator tests passed!');
