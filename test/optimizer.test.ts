/**
 * Optimizer tests — DCE pass and Task Merging pass.
 *
 * Each test uses the smallest possible model that exercises the behaviour
 * under test; unrelated sections are omitted.
 */

import { Parser } from '../src/parser/index.js';
import { optimize } from '../src/optimizer/index.js';
import { eliminateDeadCode } from '../src/optimizer/dce.js';
import { mergeTasks } from '../src/optimizer/merge-tasks.js';
import type { PulseProject } from '../src/model/types.js';

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

const parse = (yaml: string): PulseProject => new Parser().parse(yaml);

// ── Helpers ──────────────────────────────────────────────────────────────────

function componentNames(p: PulseProject): string[] {
  return (p.system.components ?? []).map(c => c.name).sort();
}

function paramNames(p: PulseProject): string[] {
  return (p.system.parameters ?? []).map(p => p.name).sort();
}

function eventNames(p: PulseProject): string[] {
  return (p.system.events ?? []).map(e => e.name).sort();
}

function taskNames(p: PulseProject): string[] {
  return (p.system.tasks ?? []).map(t => t.name).sort();
}

// ============================================================================
// DCE — Dead Code Elimination
// ============================================================================

console.log('🗑  Testing DCE pass...\n');

test('DCE: removes a device whose pin is never referenced by any action', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    led:    {type: digital_output, pin: GPIO2}
    buzzer: {type: digital_output, pin: GPIO4}
actions:
  toggle_led: {driver: gpio_control, params: {device: led, value: toggle}}
tasks:
  blink: {every: 500, do: toggle_led}
`);
  const { project: opt, warnings } = eliminateDeadCode(project);
  assert(!componentNames(opt).includes('buzzer'), 'buzzer should be removed');
  assert(componentNames(opt).includes('led'), 'led is live and must stay');
  assert(warnings.some(w => w.includes('buzzer')), 'warning should mention buzzer');
});

test('DCE: keeps a device referenced in an action param', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    pump: {type: digital_output, pin: GPIO25}
actions:
  start_pump: {driver: gpio_control, params: {device: pump, value: HIGH}}
tasks:
  run: {every: 1000, do: start_pump}
`);
  const { project: opt } = eliminateDeadCode(project);
  assert(componentNames(opt).includes('pump'), 'pump is referenced and must stay');
});

test('DCE: removes a parameter not referenced in any action param or log string', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
parameters:
  poll_ms:       {type: int, default: 500}
  unused_gain:   {type: float, default: 1.0}
hardware:
  devices:
    temp: {type: analog_input, pin: GPIO34}
actions:
  read_temp: {driver: adc_read, params: {device: temp}}
tasks:
  poll: {every: poll_ms, do: read_temp}
`);
  const { project: opt, warnings } = eliminateDeadCode(project);
  assert(!paramNames(opt).includes('unused_gain'), 'unused_gain should be removed');
  assert(paramNames(opt).includes('poll_ms'),      'poll_ms is live (used in every:)');
  assert(warnings.some(w => w.includes('unused_gain')), 'warning should mention unused_gain');
});

test('DCE: keeps a parameter referenced in a log string placeholder', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
parameters:
  setpoint: {type: float, default: 60.0}
hardware:
  buses:
    console: {interface: uart, port: 0, baud: 115200}
  devices:
    temp: {type: analog_input, pin: GPIO34}
actions:
  read_temp: {driver: adc_read, params: {device: temp}}
tasks:
  poll:
    every: 1000
    do: read_temp
    log: "setpoint={setpoint}"
`);
  const { project: opt } = eliminateDeadCode(project);
  assert(paramNames(opt).includes('setpoint'), 'setpoint appears in log and must stay');
});

test('DCE: removes an event never used in any transition', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
events:
  BOOT:   {source: external}
  UNUSED: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
`);
  const { project: opt } = eliminateDeadCode(project);
  assert(!eventNames(opt).includes('UNUSED'), 'UNUSED event should be removed');
  assert(eventNames(opt).includes('BOOT'),    'BOOT is live and must stay');
  // DCE removes unused events silently (validator already emits UNUSED_EVENT before the optimizer runs)
});

test('DCE: keeps an event used in a transition', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
events:
  START: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: START, to: running}
`);
  const { project: opt } = eliminateDeadCode(project);
  assert(eventNames(opt).includes('START'), 'START is referenced and must stay');
});

test('DCE: does not mutate the original project', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
events:
  BOOT:   {source: external}
  UNUSED: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
`);
  const before = eventNames(project);
  eliminateDeadCode(project);
  equal(eventNames(project), before, 'original project must not be mutated');
});

test('DCE: removes multiple dead symbols in one pass', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
events:
  BOOT:          {source: external}
  LEGACY_EVENT:  {source: external}
  OBSOLETE_RESET: {source: external}
parameters:
  poll_ms:       {type: int, default: 500}
  unused_gain:   {type: float, default: 1.0}
  old_threshold: {type: float, default: 10.0}
hardware:
  devices:
    temp:    {type: analog_input, pin: GPIO34}
    buzzer:  {type: digital_output, pin: GPIO23}
    pressure: {type: analog_input, pin: GPIO33}
actions:
  read_temp: {driver: adc_read, params: {device: temp}}
tasks:
  poll: {every: poll_ms, do: read_temp}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
`);
  const { project: opt, warnings } = eliminateDeadCode(project);
  assert(!eventNames(opt).includes('LEGACY_EVENT'),  'LEGACY_EVENT removed');
  assert(!eventNames(opt).includes('OBSOLETE_RESET'),'OBSOLETE_RESET removed');
  assert(!paramNames(opt).includes('unused_gain'),   'unused_gain removed');
  assert(!paramNames(opt).includes('old_threshold'), 'old_threshold removed');
  assert(!componentNames(opt).includes('buzzer'),    'buzzer removed');
  assert(!componentNames(opt).includes('pressure'),  'pressure removed');
  // Events are removed silently (validator already warned); only params + components produce warnings.
  assert(warnings.length >= 4, `expected ≥4 warnings (2 params + 2 components), got ${warnings.length}`);
});

test('DCE: emits no warnings when nothing is dead', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
events:
  BOOT: {source: external}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2}
actions:
  toggle: {driver: gpio_control, params: {device: led, value: toggle}}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running, do: toggle}
`);
  const { warnings } = eliminateDeadCode(project);
  equal(warnings.length, 0, 'no warnings expected when all symbols are live');
});

// ============================================================================
// Task Merging
// ============================================================================

console.log('\n🔀 Testing Task Merging pass...\n');

test('merge-tasks: fuses two tasks sharing the same interval', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    led:  {type: digital_output, pin: GPIO2}
    temp: {type: analog_input,   pin: GPIO34}
actions:
  toggle_led: {driver: gpio_control, params: {device: led,  value: toggle}}
  read_temp:  {driver: adc_read,     params: {device: temp}}
tasks:
  blink:    {every: 200, do: toggle_led}
  readTemp: {every: 200, do: read_temp}
`);
  const { project: opt, warnings } = mergeTasks(project);
  const names = taskNames(opt);
  assert(!names.includes('blink'),    'blink should be merged away');
  assert(!names.includes('readTemp'), 'readTemp should be merged away');
  assert(names.some(n => n.includes('200')), 'merged task name should include the interval');
  assert(warnings.length > 0, 'a warning should be emitted for the merge');
});

test('merge-tasks: merged task contains all actions from both source tasks in order', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    led:  {type: digital_output, pin: GPIO2}
    temp: {type: analog_input,   pin: GPIO34}
actions:
  toggle_led: {driver: gpio_control, params: {device: led,  value: toggle}}
  read_temp:  {driver: adc_read,     params: {device: temp}}
tasks:
  blink:    {every: 200, do: toggle_led}
  readTemp: {every: 200, do: read_temp}
`);
  const { project: opt } = mergeTasks(project);
  const merged = (opt.system.tasks ?? []).find(t => String(t.every) === '200')!;
  assert(merged !== undefined, 'merged task must exist');
  const actionNames = (merged.actions ?? []).map(a => a.name);
  assert(actionNames.includes('toggle_led'), 'toggle_led must be in merged task');
  assert(actionNames.includes('read_temp'),  'read_temp must be in merged task');
  assert(
    actionNames.indexOf('toggle_led') < actionNames.indexOf('read_temp'),
    'declaration order must be preserved (blink declared before readTemp)',
  );
});

test('merge-tasks: tasks with different intervals are kept separate', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    led:  {type: digital_output, pin: GPIO2}
    temp: {type: analog_input,   pin: GPIO34}
actions:
  toggle_led: {driver: gpio_control, params: {device: led,  value: toggle}}
  read_temp:  {driver: adc_read,     params: {device: temp}}
tasks:
  blink:    {every: 500, do: toggle_led}
  readTemp: {every: 200, do: read_temp}
`);
  const { project: opt, warnings } = mergeTasks(project);
  const names = taskNames(opt);
  assert(names.includes('blink'),    'blink at 500ms must stay separate');
  assert(names.includes('readTemp'), 'readTemp at 200ms must stay separate');
  equal(warnings.length, 0, 'no merge warnings when intervals differ');
});

test('merge-tasks: a single task is left unchanged', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2}
actions:
  toggle: {driver: gpio_control, params: {device: led, value: toggle}}
tasks:
  blink: {every: 500, do: toggle}
`);
  const { project: opt, warnings } = mergeTasks(project);
  assert(taskNames(opt).includes('blink'), 'single task must be kept');
  equal(warnings.length, 0, 'no warning for a single task');
});

test('merge-tasks: three tasks at the same interval merge into one', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    a: {type: digital_output, pin: GPIO2}
    b: {type: digital_output, pin: GPIO4}
    c: {type: digital_output, pin: GPIO5}
actions:
  act_a: {driver: gpio_control, params: {device: a, value: HIGH}}
  act_b: {driver: gpio_control, params: {device: b, value: HIGH}}
  act_c: {driver: gpio_control, params: {device: c, value: HIGH}}
tasks:
  ta: {every: 100, do: act_a}
  tb: {every: 100, do: act_b}
  tc: {every: 100, do: act_c}
`);
  const { project: opt } = mergeTasks(project);
  const tasks = opt.system.tasks ?? [];
  equal(tasks.length, 1, 'three same-interval tasks should merge to one');
});

test('merge-tasks: does not mutate the original project', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    led:  {type: digital_output, pin: GPIO2}
    temp: {type: analog_input,   pin: GPIO34}
actions:
  toggle: {driver: gpio_control, params: {device: led,  value: toggle}}
  read:   {driver: adc_read,     params: {device: temp}}
tasks:
  blink:  {every: 200, do: toggle}
  sample: {every: 200, do: read}
`);
  const before = taskNames(project);
  mergeTasks(project);
  equal(taskNames(project), before, 'original project must not be mutated');
});

// ============================================================================
// Full pipeline — optimize()
// ============================================================================

console.log('\n⚡ Testing full optimize() pipeline...\n');

test('optimize: chains DCE then merge — dead symbol removed, same-interval tasks merged', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
events:
  BOOT:   {source: external}
  UNUSED: {source: external}
hardware:
  devices:
    led:    {type: digital_output, pin: GPIO2}
    buzzer: {type: digital_output, pin: GPIO4}
    temp:   {type: analog_input,   pin: GPIO34}
actions:
  toggle:    {driver: gpio_control, params: {device: led, value: toggle}}
  read_temp: {driver: adc_read,     params: {device: temp}}
tasks:
  blink:    {every: 200, do: toggle}
  readTemp: {every: 200, do: read_temp}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
`);
  const { project: opt, warnings } = optimize(project);

  assert(!eventNames(opt).includes('UNUSED'),        'UNUSED event must be removed by DCE');
  assert(!componentNames(opt).includes('buzzer'),     'dead buzzer must be removed by DCE');
  assert(!taskNames(opt).includes('blink'),           'blink must be merged away');
  assert(!taskNames(opt).includes('readTemp'),        'readTemp must be merged away');
  assert((opt.system.tasks ?? []).length === 1,       'only one merged task should remain');
  assert(warnings.length > 0,                        'warnings should be accumulated from both passes');
});

test('optimize: dce:false skips dead code elimination', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
events:
  BOOT:   {source: external}
  UNUSED: {source: external}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
`);
  const { project: opt } = optimize(project, { dce: false });
  assert(eventNames(opt).includes('UNUSED'), 'UNUSED must survive when DCE is disabled');
});

test('optimize: mergeTasks:false skips task merging', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
hardware:
  devices:
    led:  {type: digital_output, pin: GPIO2}
    temp: {type: analog_input,   pin: GPIO34}
actions:
  toggle: {driver: gpio_control, params: {device: led, value: toggle}}
  read:   {driver: adc_read,     params: {device: temp}}
tasks:
  blink:  {every: 200, do: toggle}
  sample: {every: 200, do: read}
`);
  const { project: opt } = optimize(project, { mergeTasks: false });
  assert(taskNames(opt).includes('blink'),  'blink must stay when merging is disabled');
  assert(taskNames(opt).includes('sample'), 'sample must stay when merging is disabled');
});

test('optimize: both passes disabled returns the project unchanged', () => {
  const project = parse(`
project: {name: t, version: "1.0"}
events:
  BOOT:   {source: external}
  UNUSED: {source: external}
hardware:
  devices:
    led:    {type: digital_output, pin: GPIO2}
    buzzer: {type: digital_output, pin: GPIO4}
actions:
  toggle: {driver: gpio_control, params: {device: led, value: toggle}}
tasks:
  blink: {every: 500, do: toggle}
machine:
  states:
    idle:
    running:
  transitions:
    - {from: idle, on: BOOT, to: running}
`);
  const { project: opt, warnings } = optimize(project, { dce: false, mergeTasks: false });
  equal(componentNames(opt), componentNames(project), 'components unchanged');
  equal(eventNames(opt),     eventNames(project),     'events unchanged');
  equal(taskNames(opt),      taskNames(project),       'tasks unchanged');
  equal(warnings.length, 0, 'no warnings when both passes are disabled');
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} optimizer test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Optimizer tests passed!');
