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

// ── Unused actions ────────────────────────────────────────────────────────────

const ACTION_BASE = `
project: {name: test, version: "1.0"}
events:
  BOOT: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running, do: start}
`;

test('no warning when every declared action is invoked', () => {
  const yaml = `${ACTION_BASE}
actions:
  start: {driver: gpio_control, params: {device: led, value: HIGH}}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'UNUSED_ACTION')) {
    throw new Error('false positive: start is invoked by the BOOT transition');
  }
});

test('warns when a declared action is never invoked', () => {
  const yaml = `${ACTION_BASE}
actions:
  start:      {driver: gpio_control, params: {device: led, value: HIGH}}
  old_handler: {driver: gpio_control, params: {device: led, value: LOW}}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2}
`;
  const result = validate(yaml);
  if (!hasCode(result.diagnostics, 'UNUSED_ACTION')) {
    throw new Error('expected UNUSED_ACTION for old_handler');
  }
  const msg = result.diagnostics.find(d => d.code === 'UNUSED_ACTION')!.message;
  if (!msg.includes('old_handler')) throw new Error(`message should mention "old_handler": ${msg}`);
  if (hasCode(result.diagnostics.filter(d => d.message.includes('start')), 'UNUSED_ACTION')) {
    throw new Error('"start" is invoked and should not be flagged');
  }
});

test('action invoked in state entry is not flagged', () => {
  const yaml = `
project: {name: test, version: "1.0"}
actions:
  init_led: {driver: gpio_control, params: {device: led, value: HIGH}}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2}
machine:
  states:
    idle:
      entry: init_led
  transitions: []
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'UNUSED_ACTION')) {
    throw new Error('action used in state entry should not be flagged');
  }
});

test('action invoked in state exit is not flagged', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  GO: {source: external}
actions:
  cleanup: {driver: gpio_control, params: {device: led, value: LOW}}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2}
machine:
  states:
    idle:
      exit: cleanup
    running:
  transitions:
    - {from: idle, on: GO, to: running}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'UNUSED_ACTION')) {
    throw new Error('action used in state exit should not be flagged');
  }
});

test('action invoked in a task is not flagged', () => {
  const yaml = `
project: {name: test, version: "1.0"}
actions:
  read_sensor: {driver: adc_read, params: {device: temp}}
hardware:
  devices:
    temp: {type: analog_input, pin: GPIO34}
tasks:
  poll: {every: 500, do: read_sensor}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'UNUSED_ACTION')) {
    throw new Error('action used in a task should not be flagged');
  }
});

test('action invoked in a command is not flagged', () => {
  const yaml = `
project: {name: test, version: "1.0"}
actions:
  do_reset: {driver: gpio_control, params: {device: led, value: LOW}}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2}
  buses:
    console: {interface: uart, port: 0, baud: 115200}
commands:
  source: console
  map:
    reset: do_reset
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'UNUSED_ACTION')) {
    throw new Error('action used in a command should not be flagged');
  }
});

test('no UNUSED_ACTION check when actions block is absent', () => {
  // Models with no actions: at all should never trigger the check.
  const result = validate(MACHINE);
  if (hasCode(result.diagnostics, 'UNUSED_ACTION')) {
    throw new Error('UNUSED_ACTION fired with no actions block');
  }
});

// ── Duplicate transitions ─────────────────────────────────────────────────────

test('no warning when transitions are on different events', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  A: {source: external}
  B: {source: external}
machine:
  states:
    idle:
    running:
    stopped:
  transitions:
    - {from: idle, on: A, to: running}
    - {from: idle, on: B, to: stopped}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'DUPLICATE_TRANSITION')) {
    throw new Error('different events should not be flagged');
  }
});

test('no warning when transitions are on different source states', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  A: {source: external}
machine:
  states:
    idle:
    running:
    done:
  transitions:
    - {from: idle,    on: A, to: running}
    - {from: running, on: A, to: done}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'DUPLICATE_TRANSITION')) {
    throw new Error('different sources should not be flagged');
  }
});

test('warns when two unguarded transitions share source and event', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  GO: {source: external}
machine:
  states:
    idle:
    a:
    b:
  transitions:
    - {from: idle, on: GO, to: a}
    - {from: idle, on: GO, to: b}
`;
  const result = validate(yaml);
  if (!hasCode(result.diagnostics, 'DUPLICATE_TRANSITION')) {
    throw new Error('expected DUPLICATE_TRANSITION for second idle→GO');
  }
  const msg = result.diagnostics.find(d => d.code === 'DUPLICATE_TRANSITION')!.message;
  if (!msg.includes('idle')) throw new Error(`message should mention "idle": ${msg}`);
  if (!msg.includes('GO'))   throw new Error(`message should mention "GO": ${msg}`);
});

test('guarded duplicate does not warn (guard differentiates them)', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  GO: {source: external}
machine:
  states:
    idle:
    a:
    b:
  transitions:
    - {from: idle, on: GO, to: a, guard: cond_a}
    - {from: idle, on: GO, to: b, guard: cond_b}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'DUPLICATE_TRANSITION')) {
    throw new Error('guarded transitions should not be flagged as duplicates');
  }
});

test('wildcard source does not warn even with the same event', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  RESET: {source: external}
machine:
  states:
    idle:
    fault:
  transitions:
    - {from: "*", on: RESET, to: idle}
    - {from: "*", on: RESET, to: fault}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'DUPLICATE_TRANSITION')) {
    throw new Error('wildcard sources should not be flagged');
  }
});

test('only the second (and later) duplicate is reported, not the first', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  GO: {source: external}
machine:
  states:
    idle:
    a:
    b:
  transitions:
    - {from: idle, on: GO, to: a}
    - {from: idle, on: GO, to: b}
`;
  const result = validate(yaml);
  const dups = result.diagnostics.filter(d => d.code === 'DUPLICATE_TRANSITION');
  // The second transition (index 1, number 2) is reported; the first is not.
  if (dups.length !== 1) throw new Error(`expected 1 DUPLICATE_TRANSITION, got ${dups.length}`);
  if (!dups[0].message.includes('Transition 2')) {
    throw new Error(`expected "Transition 2" in message: ${dups[0].message}`);
  }
});

// ── Internal transitions (in:) ───────────────────────────────────────────────

test('in: transition on same source+event as on: transition is a duplicate', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  TICK: {source: external}
actions:
  log_tick: {driver: log, params: {level: INFO, message: tick}}
machine:
  states:
    idle:
    done:
  transitions:
    - {from: idle, on: TICK, to: done}
    - {from: idle, in: TICK, do: [log_tick]}
`;
  const result = validate(yaml);
  if (!hasCode(result.diagnostics, 'DUPLICATE_TRANSITION')) {
    throw new Error('in: + on: on same source/event should warn DUPLICATE_TRANSITION');
  }
});

test('in: transition on a different event from on: is not a duplicate', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  TICK:  {source: external}
  RESET: {source: external}
actions:
  log_tick: {driver: log, params: {level: INFO, message: tick}}
machine:
  states:
    idle:
    done:
  transitions:
    - {from: idle, on: RESET, to: done}
    - {from: idle, in: TICK, do: [log_tick]}
`;
  const result = validate(yaml);
  if (hasCode(result.diagnostics, 'DUPLICATE_TRANSITION')) {
    throw new Error('in: on different event than on: should not be flagged');
  }
});

test('in: transition parses with internal: true and no target', () => {
  const yaml = `
project: {name: test, version: "1.0"}
events:
  TICK: {source: external}
actions:
  log_tick: {driver: log, params: {level: INFO, message: tick}}
machine:
  states:
    idle:
    done:
  transitions:
    - {from: idle, on: TICK, to: done}
    - {from: idle, in: TICK, do: [log_tick]}
`;
  const project = parse(yaml);
  const internal = project.system.transitions.find(t => t.internal);
  if (!internal) throw new Error('expected a transition with internal: true');
  if (internal.event !== 'TICK') throw new Error(`expected event TICK, got ${internal.event}`);
  if (internal.target !== undefined) throw new Error('internal transition must have no target');
  if (internal.source !== 'idle') throw new Error(`expected source idle, got ${internal.source}`);
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
