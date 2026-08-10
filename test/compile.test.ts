/**
 * Compile + behaviour test.
 *
 * Generating a string that *looks* like C++ proves nothing, so this test feeds
 * the generated sketch to a real compiler, links it, runs it, and asserts on
 * the dispatch trace it prints.
 *
 * Skips itself (rather than failing) when no g++ is available, so the suite
 * still runs on machines without a host compiler.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Parser } from '../src/parser/index.js';
import { Codegen } from '../src/codegen/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const harnessDir = path.join(repoRoot, 'test/harness');
const depsDir = path.join(repoRoot, 'deps');
const buildDir = path.join(repoRoot, 'dist/compile-test');

function hasCompiler(): boolean {
  const probe = spawnSync('g++', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

if (!hasCompiler()) {
  console.log('⚠️  g++ not found - skipping compile test');
  process.exit(0);
}

fs.mkdirSync(buildDir, { recursive: true });

function generate(yamlPath: string): string {
  const yamlContent = fs.readFileSync(yamlPath, 'utf8');
  const project = new Parser().parse(yamlContent);
  return new Codegen().generate(project);
}

/**
 * Compile the generated sketch with a driver appended to the same translation
 * unit, so the driver can see the generated enums and state globals.
 */
function buildAndRun(name: string, sketch: string, driver: string): string {
  const sourcePath = path.join(buildDir, `${name}.cpp`);
  const binaryPath = path.join(buildDir, name);

  fs.writeFileSync(sourcePath, `${sketch}\n${driver}\n`);

  execFileSync(
    'g++',
    [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      sourcePath,
      path.join(harnessDir, 'serial.cpp'),
      path.join(depsDir, 'PulseHSM.cpp'),
      `-I${harnessDir}`,
      `-I${depsDir}`,
      '-o',
      binaryPath,
    ],
    { stdio: 'pipe' }
  );

  return execFileSync(binaryPath, { encoding: 'utf8' });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Assert the recorded states, in order, ignoring the surrounding chatter. */
function assertTrace(output: string, expected: string[], label: string): void {
  const actual = output
    .split('\n')
    .filter(line => line.startsWith('STATE:'))
    .map(line => line.slice('STATE:'.length).trim());

  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`
  );
}

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`✗ ${name}`);
    const message = error instanceof Error ? error.message : String(error);
    // g++ writes diagnostics to stderr, which execFileSync attaches separately.
    const stderr = (error as { stderr?: Buffer }).stderr?.toString();
    console.error(`  ${message.split('\n').join('\n  ')}`);
    if (stderr) console.error(`  ${stderr.split('\n').join('\n  ')}`);
  }
}

// ============================================================================

console.log('🔧 Compiling generated code with g++...\n');

/** Drives the generated machine the way real firmware does. */
const DRIVER_PRELUDE = `
static void report() {
  Serial.print("STATE: ");
  Serial.println(fsm.getCurrentName());
}

// sendEvent() only queues; update() drains the queue and applies the
// transition, exactly as loop() would.
static void step(SystemEvent e) {
  fsm.sendEvent(e);
  fsm.update();
  report();
}
`;

test('boiler example compiles, links and runs on the PulseHSM runtime', () => {
  const sketch = generate(path.join(repoRoot, 'examples/boiler.yaml'));

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();
  report();

  // Entering the composite "running" state must land on its initial child.
  step(EVENT_START);

  // The generated guard stub returns false, so this must stay blocked - and
  // because a blocked guard does not consume the event, nothing else fires.
  step(EVENT_TEMP_REACHED);

  // "running" is an ancestor of the current leaf, so STOP reaches it by
  // bubbling out of running/heating.
  step(EVENT_STOP);

  // Wildcard source: handled by the synthetic root, so it fires from anywhere.
  step(EVENT_EMERGENCY_STOP);
  return 0;
}`;

  const output = buildAndRun('boiler', sketch, driver);

  assertTrace(
    output,
    [
      'idle',
      'running/heating',
      'running/heating',
      'idle',
      'fault',
    ],
    'boiler dispatch trace mismatch'
  );
});

test('hierarchy fixture honours nesting, specificity and guards', () => {
  const sketch = generate(path.join(repoRoot, 'test/fixtures/hierarchy.yaml'));

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();
  report();

  // Composite target descends to its initial child.
  step(EVENT_GO);

  // Named guard stub returns false: no transition, and the event is not
  // consumed either.
  step(EVENT_BLOCKED);

  // Inner transition (phase_one) outranks the enclosing one (active),
  // because the leaf handler consumes the event before it can bubble.
  step(EVENT_ABORT);

  step(EVENT_GO);

  // Nested composite target descends two levels.
  step(EVENT_NEXT);

  // phase_one is no longer active, so ABORT bubbles up to "active".
  step(EVENT_ABORT);
  return 0;
}`;

  const output = buildAndRun('hierarchy', sketch, driver);

  assertTrace(
    output,
    [
      'off',
      'active/phase_one',
      'active/phase_one',
      'off',
      'active/phase_one',
      'active/phase_two/deep',
      'halted',
    ],
    'hierarchy dispatch trace mismatch'
  );

  // A transition with several actions must run all of them, in order.
  const startIdx = output.indexOf('Action: log_start');
  const armIdx = output.indexOf('Action: arm_system');
  assert(startIdx !== -1, 'first action of a multi-action transition never ran');
  assert(armIdx !== -1, 'second action of a multi-action transition never ran');
  assert(startIdx < armIdx, 'multi-action transition ran actions out of order');
});

test('generated guards and actions match the FUNCTION_CONTRACT signatures', () => {
  const sketch = generate(path.join(repoRoot, 'examples/boiler.yaml'));

  assert(
    sketch.includes('bool guard_running_heating_temp_reached(const SystemContext* ctx)'),
    'guard stub does not use the contract signature'
  );
  assert(
    sketch.includes('void action_start_pump(SystemContext* ctx)'),
    'action stub does not use the contract signature'
  );
  assert(
    /struct SystemContext \{/.test(sketch),
    'SystemContext struct was not generated'
  );
  assert(
    /struct SystemParameters \{[\s\S]*?float setpoint;/.test(sketch),
    'SystemParameters was not generated from the model parameters'
  );
  assert(
    sketch.includes('guard_running_heating_temp_reached(&systemContext)'),
    'guards are not called with the system context'
  );
  assert(
    sketch.includes('action_start_pump(&systemContext)'),
    'actions are not called with the system context'
  );

  // The contract forbids the generator from evaluating YAML expressions: the
  // expression may only appear as a comment, never as executable code.
  const expressionLines = sketch
    .split('\n')
    .filter(line => line.includes('temperature >= setpoint'));
  assert(expressionLines.length > 0, 'guard expression was dropped entirely');
  assert(
    expressionLines.every(line => line.trimStart().startsWith('//')),
    'guard expression leaked into generated code instead of staying a comment'
  );
});

test('generated sketch drives the PulseHSM runtime correctly', () => {
  const sketch = generate(path.join(repoRoot, 'examples/boiler.yaml'));

  // The sizing macros are inert unless they precede the include.
  const includeAt = sketch.indexOf('#include "PulseHSM.h"');
  const statesAt = sketch.indexOf('#define PULSEHSM_MAX_STATES');
  const eventsAt = sketch.indexOf('#define PULSEHSM_MAX_EVENTS');
  const depthAt = sketch.indexOf('#define PULSEHSM_MAX_DEPTH');

  assert(statesAt !== -1 && eventsAt !== -1 && depthAt !== -1, 'sizing macros were not emitted');
  assert(
    statesAt < includeAt && eventsAt < includeAt && depthAt < includeAt,
    'sizing macros must appear before #include "PulseHSM.h" to take effect'
  );

  const ringSize = Number(/#define PULSEHSM_MAX_EVENTS\s+(\d+)/.exec(sketch)?.[1]);
  assert(
    Number.isInteger(ringSize) && ringSize > 0 && (ringSize & (ringSize - 1)) === 0,
    `PULSEHSM_MAX_EVENTS must be a power of two, got ${ringSize}`
  );

  assert(sketch.includes('PulseHSM fsm;'), 'no PulseHSM instance was declared');
  assert(sketch.includes('fsm.update();'), 'loop() does not drive fsm.update()');
  // Only executable lines count - the sketch mentions delay() in a warning comment.
  const codeLines = sketch
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'));
  assert(
    !codeLines.some(line => /\bdelay\s*\(/.test(line)),
    'generated sketch calls delay(), which starves fsm.update()'
  );

  // addState() indices must land in globals, and parents must be registered
  // before the children that reference them.
  assert(/^int S_\w+ = -1;/m.test(sketch), 'state indices are not stored in globals');
  const runningAt = sketch.indexOf('S_RUNNING = fsm.addState(');
  const heatingAt = sketch.indexOf('S_HEATING = fsm.addState(');
  assert(runningAt !== -1 && heatingAt !== -1, 'expected states were not registered');
  assert(runningAt < heatingAt, 'child state was registered before its parent');

  // begin() takes a leaf; "running" is composite and must never be passed.
  assert(!sketch.includes('fsm.begin(S_RUNNING)'), 'begin() was given a composite state');
  assert(/fsm\.begin\(S_\w+\);/.test(sketch), 'begin() was not called');

  // Composite targets must be resolved to a leaf before transitionTo().
  assert(
    sketch.includes('fsm.transitionTo(S_HEATING);'),
    'transition into composite "running" was not resolved to its initial leaf'
  );
  assert(
    !sketch.includes('fsm.transitionTo(S_RUNNING);'),
    'transitionTo() was given a composite state'
  );
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} compile test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Compile tests passed!');
