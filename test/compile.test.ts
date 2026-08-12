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
import { FileResolver } from '../src/parser/fs-resolver.js';
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
  // parseFrom follows `include`, so multi-file models work here too.
  const project = new Parser().parseFrom(yamlPath, new FileResolver());
  return new Codegen().generate(project);
}

/**
 * Compile the generated sketch with a driver appended to the same translation
 * unit, so the driver can see the generated enums and state globals.
 */
function buildAndRun(name: string, sketch: string, driver: string): string {
  return build(name, sketch, driver, true);
}

/** Same, for a sketch that declares no state machine and must not need one. */
function buildAndRunPlain(name: string, sketch: string, driver: string): string {
  return build(name, sketch, driver, false);
}

function build(name: string, sketch: string, driver: string, withRuntime: boolean): string {
  const sourcePath = path.join(buildDir, `${name}.cpp`);
  const binaryPath = path.join(buildDir, name);

  fs.writeFileSync(sourcePath, `${sketch}\n${driver}\n`);

  // PulseHSM.cpp is a separate translation unit and never sees the sketch's
  // #defines, so it has to get the sizes the way a real build does: from
  // PulseHSM_config.h, which PulseHSM.h picks up. Writing it per test keeps one
  // model's sizes out of another's.
  const configDir = path.join(buildDir, `${name}-config`);
  fs.mkdirSync(configDir, { recursive: true });
  if (withRuntime) {
    fs.writeFileSync(path.join(configDir, 'PulseHSM_config.h'), sizingFrom(sketch));
  }

  execFileSync(
    'g++',
    [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      sourcePath,
      path.join(harnessDir, 'serial.cpp'),
      // Deliberately omitted for a machine-less project: if the sketch still
      // referenced the runtime, this would fail to link, which is the point.
      ...(withRuntime ? [path.join(depsDir, 'PulseHSM.cpp')] : []),
      `-I${configDir}`,
      `-I${harnessDir}`,
      `-I${depsDir}`,
      '-o',
      binaryPath,
    ],
    { stdio: 'pipe' }
  );

  return execFileSync(binaryPath, { encoding: 'utf8' });
}

/** The sizing macros the sketch declares, as a standalone config header. */
function sizingFrom(sketch: string): string {
  const defines = ['PULSEHSM_MAX_STATES', 'PULSEHSM_MAX_EVENTS', 'PULSEHSM_MAX_DEPTH'].map(macro => {
    const value = new RegExp(`#define\\s+${macro}\\s+(\\d+)`).exec(sketch)?.[1];
    if (!value) throw new Error(`generated sketch does not size ${macro}`);
    return `#define ${macro} ${value}`;
  });

  return `#ifndef PULSEHSM_CONFIG_H\n#define PULSEHSM_CONFIG_H\n${defines.join('\n')}\n#endif\n`;
}

/**
 * Make every action stub announce itself.
 *
 * The generator only emits a trace print when the model declares a console -
 * writing to a serial port nobody asked for is exactly the thing it must not
 * do. A test that wants to watch actions therefore adds the observation
 * itself, which is where it belongs.
 */
function withActionTrace(sketch: string): string {
  const traced = sketch.replace(
    /^void (action_\w+)\(SystemContext\* ctx\) \{$/gm,
    (line, fn) => `${line}\n  Serial.println("  -> Action: ${String(fn).slice('action_'.length)}");`
  );
  if (traced === sketch) throw new Error('no action stubs found to instrument');
  return traced;
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
//
// Marked used because a driver may reach the machine only through commands,
// and the suite builds with -Werror.
__attribute__((unused)) static void step(SystemEvent e) {
  fsm.sendEvent(e);
  fsm.update();
  report();
}

// Move the virtual clock forward and let the machine notice. Timed transitions
// are checked in update(), so time only "passes" when the loop runs.
//
// Marked used because most drivers here have no timers to wait on, and the
// suite builds with -Werror.
__attribute__((unused)) static void wait(unsigned long ms) {
  pulseTestAdvance(ms);
  fsm.update();
  report();
}
`;

test('boiler example compiles, links and runs on the PulseHSM runtime', () => {
  const sketch = generate(path.join(repoRoot, 'examples/boiler/pulse.yaml'));

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
  const sketch = withActionTrace(generate(path.join(repoRoot, 'test/fixtures/hierarchy.yaml')));

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

test('multi-file greenhouse model compiles with its interfaces wired up', () => {
  const sketch = generate(path.join(repoRoot, 'examples/greenhouse/greenhouse.yaml'));

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();          // runs setupInterfaces()
  report();

  step(EVENT_START);          // idle -> running, descends to sampling
  step(EVENT_TOO_HOT);        // guard stub returns false, so nothing moves
  step(EVENT_SENSOR_FAULT);   // wildcard, handled by the synthetic root
  return 0;
}`;

  const output = buildAndRun('greenhouse', sketch, driver);

  assertTrace(
    output,
    ['idle', 'running/sampling', 'running/sampling', 'fault'],
    'greenhouse dispatch trace mismatch'
  );
});

test('interfaces generate real init code, and never leak a credential', () => {
  const sketch = generate(path.join(repoRoot, 'examples/greenhouse/greenhouse.yaml'));

  // Buses are initialised from their declared pins.
  assert(sketch.includes('Wire.begin(SENSOR_BUS_SDA, SENSOR_BUS_SCL);'), 'I2C not initialised from bindings');
  assert(sketch.includes('Wire.setClock(SENSOR_BUS_FREQUENCY);'), 'I2C clock not set');
  assert(sketch.includes('SPI.begin(CARD_SLOT_SCK'), 'SPI not initialised from bindings');
  assert(sketch.includes('Serial2.begin(GPS_BAUD'), 'UART port not honoured');
  assert(sketch.includes('setupInterfaces();'), 'setup() never calls setupInterfaces()');

  // "GPIO21" is not a macro any core defines, so it must be normalised.
  assert(sketch.includes('#define SENSOR_BUS_SDA 21'), 'GPIO pin was not normalised to a number');

  // Implied libraries appear without being declared.
  for (const include of ['<Wire.h>', '<SPI.h>', '<PubSubClient.h>', '<Adafruit_BME280.h>']) {
    assert(sketch.includes(`#include ${include}`), `missing include ${include}`);
  }

  // TLS needs its own header; a plain WiFi resource must not dedupe it away.
  assert(sketch.includes('WiFiClientSecure brokerTransport;'), 'secure transport not declared');
  assert(sketch.includes('#include <WiFiClientSecure.h>'), 'secure transport header missing');

  // Every credential macro the code references must exist, and be blank.
  assert(
    sketch.includes('#define UPLINK_PASSWORD ""'),
    'Wi-Fi password macro is referenced but never defined'
  );
  // Every credential macro must be defined as an empty string. Checking the
  // captured value, not just "quote followed by something" - the closing quote
  // of "" is itself non-whitespace.
  const credentials = [...sketch.matchAll(/#define\s+\w*(?:PASSWORD|SECRET|TOKEN|APIKEY)\s+"([^"]*)"/g)];
  assert(credentials.length > 0, 'expected at least one credential placeholder');
  for (const match of credentials) {
    assert(match[1] === '', `a credential value was baked into generated code: ${match[0]}`);
  }
});

test('a generated sketch folder compiles, links and runs', () => {
  // --outdir splits generated code from yours. It has to build as a whole.
  const project = new Parser().parseFrom(
    path.join(repoRoot, 'examples/boiler/pulse.yaml'),
    new FileResolver()
  );
  const files = new Codegen().generateFiles(project);
  const dir = path.join(buildDir, 'sketch-folder');

  fs.rmSync(dir, { recursive: true, force: true });
  for (const file of [...files.generated, ...files.scaffolds]) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.contents);
  }

  fs.writeFileSync(path.join(dir, 'driver.cpp'), `
#include "boiler_control_generated.h"
int main() {
  setup();
  Serial.print("STATE: ");
  Serial.println(fsm.getCurrentName());
  fsm.sendEvent(EVENT_START);
  fsm.update();
  Serial.print("STATE: ");
  Serial.println(fsm.getCurrentName());
  return 0;
}
`);

  const binary = path.join(buildDir, 'sketch-folder-app');
  execFileSync('g++', [
    '-std=c++17', '-Wall', '-Wextra', '-Werror', '-x', 'c++',
    path.join(dir, 'boiler_control.ino'),
    path.join(dir, 'src/guards.cpp'),
    path.join(dir, 'src/actions.cpp'),
    path.join(dir, 'driver.cpp'),
    path.join(harnessDir, 'serial.cpp'),
    path.join(depsDir, 'PulseHSM.cpp'),
    `-I${dir}`, `-I${harnessDir}`, `-I${depsDir}`,
    '-o', binary,
  ], { stdio: 'pipe' });

  assertTrace(
    execFileSync(binary, { encoding: 'utf8' }),
    ['idle', 'running/heating'],
    'sketch folder dispatch trace mismatch'
  );

  // The header must carry declarations, and the sketch the definitions - or
  // linking two translation units against it would double-define.
  const header = files.generated.find(f => f.path.endsWith('_generated.h'))!.contents;
  assert(header.includes('extern PulseHSM fsm;'), 'header does not declare fsm');
  assert(!/^PulseHSM fsm;/m.test(header), 'header defines fsm instead of declaring it');
  assert(header.includes('bool guard_temp_at_setpoint(const SystemContext* ctx);'),
    'header does not declare the guards');

  // Stub bodies must live only in the scaffolds, or filling one in would
  // clash with a definition the sketch keeps regenerating.
  const sketch = files.generated.find(f => f.path.endsWith('.ino'))!.contents;
  assert(!sketch.includes('bool guard_temp_at_setpoint(const SystemContext* ctx) {'),
    'the regenerated sketch contains a guard body, which would clobber your code');
  assert(
    files.scaffolds.some(f => f.contents.includes('bool guard_temp_at_setpoint(const SystemContext* ctx) {')),
    'the guard body is not in a scaffold file'
  );
});

test('devices generate their own initialisation', () => {
  // Declaring `pump: {type: digital_output, pin: GPIO25}` should be enough;
  // needing a separate gpio bus for the pinMode was pure boilerplate.
  const sketch = generate(path.join(repoRoot, 'examples/boiler/pulse.yaml'));

  assert(sketch.includes('pinMode(PUMP_PIN, OUTPUT);'), 'digital_output got no pinMode');
  assert(sketch.includes('ledcAttachPin(HEATER_PIN, HEATER_CHANNEL);'), 'pwm_output got no ledc setup');
  assert(sketch.includes('#define PUMP_PIN 25'), 'device pin macro missing');
});

test('generated guards and actions match the FUNCTION_CONTRACT signatures', () => {
  const sketch = generate(path.join(repoRoot, 'examples/boiler/pulse.yaml'));

  assert(
    sketch.includes('bool guard_temp_at_setpoint(const SystemContext* ctx)'),
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
    sketch.includes('guard_temp_at_setpoint(&systemContext)'),
    'guards are not called with the system context'
  );
  assert(
    sketch.includes('action_start_pump(&systemContext)'),
    'actions are not called with the system context'
  );

  // A guard's description is prose for the implementer. It must survive into
  // the stub, and it must never become code.
  const intentLines = sketch
    .split('\n')
    .filter(line => line.includes('water temperature has reached the setpoint'));
  assert(intentLines.length > 0, 'guard description was dropped entirely');
  assert(
    intentLines.every(line => line.trimStart().startsWith('//')),
    'guard description leaked into generated code instead of staying a comment'
  );

  // The guard name comes from the model verbatim, so hand-written guards port
  // between targets unchanged.
  assert(
    !/guard_running_heating/.test(sketch),
    'guard name was derived from source/event instead of taken from the model'
  );
});

test('generated sketch drives the PulseHSM runtime correctly', () => {
  const sketch = generate(path.join(repoRoot, 'examples/boiler/pulse.yaml'));

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
// THE FIVE-PROJECT GATE (PLAN.md §4)
//
// Four projects from different corners of embedded work, modelled without
// touching the schema, held to the same bar as boiler and greenhouse:
// generated, compiled with -Werror, linked against the real runtime, run, and
// checked against the dispatch trace they are supposed to produce.
//
// The point is not that they pass. It is what modelling them exposed - see the
// GATE FINDING comments in each model, and PLAN.md §4.
// ============================================================================

test('gate: traffic light — self-transitions, a pedestrian latch and a night mode', () => {
  const sketch = withActionTrace(generate(path.join(repoRoot, 'examples/traffic_light.yaml')));

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();
  report();

  // A self-transition on the current leaf: the latch runs, the phase holds.
  step(EVENT_WALK_REQUEST);

  // Timing comes from the model now - no TIMER_EXPIRED event exists. One
  // millisecond short of green_ms must not move; the machine holds its phase.
  wait(19999);
  wait(1);                     // go -> prepare_stop, at exactly green_ms

  wait(3000);                  // prepare_stop -> stop, at amber_ms

  // Two transitions share the red_ms timer. The guarded one is listed first;
  // its stub returns false, so the unguarded fallback fires instead.
  wait(15000);

  // GO_NIGHT is declared on the composite parent, so it fires from any phase.
  step(EVENT_GO_NIGHT);

  // Nothing in "night" is timed, so the clock running on must not move it.
  wait(600000);

  step(EVENT_GO_DAY);          // back to operating, landing on its initial child
  return 0;
}`;

  const output = buildAndRun('traffic_light', sketch, driver);

  assertTrace(
    output,
    [
      'operating/go',
      'operating/go',
      'operating/go',
      'operating/prepare_stop',
      'operating/stop',
      'operating/go',
      'night',
      'night',
      'operating/go',
    ],
    'traffic light dispatch trace mismatch'
  );

  // The clock must restart on entry, or the second phase would fire instantly
  // with the elapsed time carried over from the first.
  assert(
    sketch.includes('enteredAt_operating_prepare_stop = millis();'),
    'entering a timed state does not restart its clock'
  );
  // Read every tick, so retuning a parameter at runtime takes effect.
  assert(
    sketch.includes('(unsigned long)systemParameters.green_ms'),
    'a duration named by a parameter was baked in instead of read live'
  );

  // A multi-action transition must run every action, in written order.
  const clearAt = output.indexOf('Action: all_lamps_off');
  const amberAt = output.indexOf('Action: show_amber');
  assert(clearAt !== -1 && amberAt !== -1, 'a multi-action transition dropped an action');
  assert(clearAt < amberAt, 'lamps were driven before being cleared');
});

test('gate: motor controller — a ramp in C, a trip from anywhere', () => {
  const sketch = generate(path.join(repoRoot, 'examples/motor_controller.yaml'));

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();
  report();

  step(EVENT_START);      // stopped -> running, descends to accelerating
  step(EVENT_AT_SPEED);   // accelerating -> cruising
  step(EVENT_REVERSE);    // cruising -> decelerating
  step(EVENT_AT_SPEED);   // decelerating -> stopped

  // Wildcard: an e-stop has to work from every state, including stopped.
  step(EVENT_ESTOP);

  // The restart delay is a state now, so RESET is simply not wired up yet.
  step(EVENT_RESET);

  // Once restart_delay has passed, the same event is accepted.
  wait(5000);
  step(EVENT_RESET);
  return 0;
}`;

  const output = buildAndRun('motor_controller', sketch, driver);

  assertTrace(
    output,
    [
      'stopped',
      'running/accelerating',
      'running/cruising',
      'running/decelerating',
      'stopped',
      'tripped/locked',
      'tripped/locked',
      'tripped/resettable',
      'stopped',
    ],
    'motor controller dispatch trace mismatch'
  );

  // The ramp is arithmetic over time, so it must stay a named action the
  // implementer writes - never something the generator tries to synthesise.
  assert(sketch.includes('void action_begin_ramp(SystemContext* ctx)'), 'ramp action stub missing');
  assert(!/ramp_rate\s*\*/.test(sketch), 'the generator invented ramp arithmetic');

  // Input-only pins are fine as inputs; the checker must not object.
  assert(sketch.includes('pinMode(ESTOP_PIN, INPUT);'), 'digital_input got no pinMode');
  assert(sketch.includes('ledcSetup(DRIVE_PWM_CHANNEL'), 'pwm_output got no channel setup');
});

test('gate: pump/tank — hysteresis, dry-run and a blocked guard bubbling out', () => {
  const sketch = generate(path.join(repoRoot, 'examples/pump_tank.yaml'));

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();
  report();

  step(EVENT_LEVEL_LOW);    // idle -> filling, descends to priming
  step(EVENT_NO_FLOW);      // priming -> fault/dry_run
  step(EVENT_FAULT_RESET);  // declared on the composite "fault"
  step(EVENT_LEVEL_LOW);    // filling again

  // Priming carries two timers. Past settle_ms the guarded one gets a chance
  // every pass, and its stub returns false, so nothing moves...
  wait(settle_and_a_bit);

  // ...until dry_run_ms, when the unguarded one trips. An earlier unguarded
  // candidate must not shadow a later shorter one, and a later one must not
  // pre-empt an earlier longer one.
  wait(dry_run_remainder);

  step(EVENT_FAULT_RESET);
  return 0;
}`
    .replace('settle_and_a_bit', '3000')      // settle_ms is 2000
    .replace('dry_run_remainder', '5000');    // 3000 + 5000 = dry_run_ms

  const output = buildAndRun('pump_tank', sketch, driver);

  assertTrace(
    output,
    [
      'idle',
      'filling/priming',
      'fault/dry_run',
      'idle',
      'filling/priming',
      'filling/priming',
      'fault/dry_run',
      'idle',
    ],
    'pump/tank dispatch trace mismatch'
  );

  // The overfill timer is on the composite, which is the case PulseHSM's own
  // timeoutMs cannot express: it only ever checks the current *leaf*.
  assert(
    sketch.includes('enteredAt_filling = millis();') &&
    sketch.includes('static void tick_filling()'),
    'the composite "filling" got no timer of its own'
  );

  // start_pump and stop_pump share a driver but are distinct actions; if
  // identity ever collapses back onto the driver, one of these disappears.
  assert(sketch.includes('void action_start_pump(SystemContext* ctx)'), 'start_pump stub missing');
  assert(sketch.includes('void action_stop_pump(SystemContext* ctx)'), 'stop_pump stub missing');
});

test('gate: sensor gateway — multi-file, four buses, degraded operation', () => {
  const sketch = generate(path.join(repoRoot, 'examples/sensor_gateway/pulse.yaml'));

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();
  report();

  wait(250);                  // starting -> connecting/joining_wifi

  // The retry loop: an attempt that stalls for retry_backoff drops into
  // backoff, which starts the next one. Two states, because a timer restarts
  // on entry and so cannot usefully point at its own state.
  wait(5000);                 // joining_wifi -> backoff
  wait(250);                  // backoff -> joining_wifi, retrying

  step(EVENT_LINK_UP);        // -> joining_broker
  step(EVENT_BROKER_UP);      // -> online/polling
  step(EVENT_POLL_DUE);       // self-transition on the leaf
  step(EVENT_PUBLISH_DUE);    // declared on "online", so it bubbles one level
  step(EVENT_BROKER_DOWN);    // -> degraded, where sampling continues
  step(EVENT_RESET);          // wildcard, from anywhere
  return 0;
}`;

  const output = buildAndRun('sensor_gateway', sketch, driver);

  assertTrace(
    output,
    [
      'starting',
      'connecting/joining_wifi',
      'connecting/backoff',
      'connecting/joining_wifi',
      'connecting/joining_broker',
      'online/polling',
      'online/polling',
      'online/publishing',
      'degraded',
      'starting',
    ],
    'sensor gateway dispatch trace mismatch'
  );

  // Four buses of three different kinds, all wired from the model.
  assert(sketch.includes('Serial2.begin(FIELD_BUS_BAUD'), 'RS-485 UART not initialised');
  assert(sketch.includes('Wire.begin(LOCAL_BUS_SDA, LOCAL_BUS_SCL);'), 'I2C not initialised');
  assert(sketch.includes('WiFi.begin(UPLINK_SSID'), 'Wi-Fi not initialised');
  assert(sketch.includes('broker.setServer(BROKER_HOST, BROKER_PORT);'), 'MQTT broker not configured');

  // A declared third-party library reaches the sketch.
  assert(sketch.includes('#include <ModbusMaster.h>'), 'declared library was not included');

  // TLS was asked for, so the transport must be the secure one and the model
  // must not have talked anyone into skipping verification.
  assert(sketch.includes('WiFiClientSecure brokerTransport;'), 'tls: true did not select a secure transport');
  assert(!sketch.includes('setInsecure()'), 'generated code disables certificate verification');

  // Devices on a bus have no pin of their own, and must not invent one.
  assert(!/#define LINE_PRESSURE_PIN/.test(sketch), 'a bus-attached device was given a pin');
});

test('gate: the runtime is sized from the model, in every translation unit', () => {
  // Found by the gate. PulseHSM's table sizes are macros, and the sketch used
  // to be the only place they were defined - but PulseHSM.cpp is compiled
  // separately and kept the default of 8. The first model with more than eight
  // states had its ninth silently refused: addState() returned -1, and the
  // transitions targeting it did nothing. sensor_gateway has ten.
  const project = new Parser().parseFrom(
    path.join(repoRoot, 'examples/sensor_gateway/pulse.yaml'),
    new FileResolver()
  );
  const files = new Codegen().generateFiles(project);

  const config = files.generated.find(f => f.path === 'PulseHSM_config.h');
  assert(!!config, 'no PulseHSM_config.h was generated');
  assert(
    /#define PULSEHSM_MAX_STATES\s+(1[2-9]|[2-9]\d)/.test(config!.contents),
    `config header does not size the table for ten states:\n${config!.contents}`
  );

  const dir = path.join(buildDir, 'sizing');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const file of [...files.generated, ...files.scaffolds]) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.contents);
  }

  // Every state index must be real. -1 means the runtime refused it.
  fs.writeFileSync(path.join(dir, 'driver.cpp'), `
#include "sensor_gateway_generated.h"
int main() {
  setup();
  const int indices[] = {
    S_ROOT, S_STARTING, S_CONNECTING, S_JOINING_WIFI, S_JOINING_BROKER,
    S_ONLINE, S_POLLING, S_PUBLISHING, S_DEGRADED, S_FAULTED,
  };
  for (unsigned i = 0; i < sizeof(indices) / sizeof(indices[0]); ++i) {
    if (indices[i] < 0) {
      Serial.print("REFUSED: ");
      Serial.println((int)i);
    }
  }
  Serial.println("CHECKED");
  return 0;
}
`);

  const binary = path.join(buildDir, 'sizing-app');
  execFileSync('g++', [
    '-std=c++17', '-Wall', '-Wextra', '-Werror', '-x', 'c++',
    path.join(dir, 'sensor_gateway.ino'),
    path.join(dir, 'src/guards.cpp'),
    path.join(dir, 'src/actions.cpp'),
    path.join(dir, 'driver.cpp'),
    path.join(harnessDir, 'serial.cpp'),
    // Compiled with -I<dir> and nothing else from the model, exactly as the
    // Arduino IDE would: PulseHSM.h finds PulseHSM_config.h on its own.
    path.join(depsDir, 'PulseHSM.cpp'),
    `-I${dir}`, `-I${harnessDir}`, `-I${depsDir}`,
    '-o', binary,
  ], { stdio: 'pipe' });

  const output = execFileSync(binary, { encoding: 'utf8' });
  assert(output.includes('CHECKED'), 'the sizing check never ran');
  assert(!output.includes('REFUSED'), `the runtime refused a state:\n${output}`);

  // Belt and braces: if the config header is ever lost, moved, or stale, the
  // sketch should say so rather than run a machine missing two states. That
  // needs somewhere to say it, and this model declares no console - so here it
  // has to be a comment that names the symptom instead.
  const sketch = files.generated.find(f => f.path.endsWith('.ino'))!.contents;
  assert(
    /No console is declared, so this cannot be reported/.test(sketch),
    'setup() neither checks the registration nor explains why it cannot'
  );

  // With a console, it is a real runtime check.
  const talkative = new Codegen().generate(new Parser().parse(`
project: {name: talkative, version: "1.0"}
hardware:
  buses:
    console: {interface: uart, port: 0, baud: 115200}
events: {GO: {source: external}}
machine:
  states: {idle:, busy:}
  transitions:
    - {from: idle, on: GO, to: busy}
`));
  assert(
    talkative.includes('FATAL: PulseHSM refused a state'),
    'a model with a console does not check that every state was registered'
  );
  assert(
    talkative.includes('S_BUSY < 0'),
    'the registration check does not cover the last state, which is the first to be dropped'
  );

  // The single-file path links against the same separately-compiled runtime,
  // so it needs the same config header - `generate()` alone cannot be safe.
  const codegen = new Codegen();
  const single = codegen.generate(project);
  const standalone = codegen.generateConfigHeader();
  for (const macro of ['PULSEHSM_MAX_STATES', 'PULSEHSM_MAX_EVENTS', 'PULSEHSM_MAX_DEPTH']) {
    const inSketch = new RegExp(`#define\\s+${macro}\\s+(\\d+)`).exec(single)?.[1];
    const inConfig = new RegExp(`#define\\s+${macro}\\s+(\\d+)`).exec(standalone)?.[1];
    assert(
      !!inSketch && inSketch === inConfig,
      `${macro} disagrees between the sketch (${inSketch}) and the config header (${inConfig})`
    );
  }
});

test('a timer on a composite is not restarted by moving between its children', () => {
  // This is the case PulseHSM's own timeoutMs cannot express - it only ever
  // checks the current leaf - and it is the reason "after" is generated rather
  // than passed to addState().
  const sketch = generate(path.join(repoRoot, 'test/fixtures/timers.yaml'));

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();
  report();

  step(EVENT_BEGIN);   // idle -> work, descends to first

  wait(600);           // 600ms into "work"
  step(EVENT_SWAP);    // work/first -> work/second, still inside "work"
  wait(300);           // 900ms total - not yet
  wait(100);           // 1000ms total - fires, because the swap did not reset it

  wait(250);           // the literal 250ms timer on "done"
  return 0;
}`;

  const output = buildAndRun('timers', sketch, driver);

  assertTrace(
    output,
    [
      'idle',
      'work/first',
      'work/first',
      'work/second',
      'work/second',
      'done',
      'quick',
    ],
    'composite timer trace mismatch - a child transition restarted the parent clock'
  );

  // Re-entering the composite must restart it, though: only entry stamps it.
  const restart = `${DRIVER_PRELUDE}
int main() {
  setup();

  // Retuning the parameter at runtime has to take effect on the next pass,
  // which only works because the tick reads it instead of capturing it.
  systemParameters.hold_ms = 5000;

  step(EVENT_BEGIN);
  wait(4999);          // the old 1000ms default would have fired long ago
  wait(1);
  return 0;
}`;

  assertTrace(
    buildAndRun('timers_retuned', sketch, restart),
    ['work/first', 'work/first', 'done'],
    'a duration named by a parameter did not follow the parameter'
  );
});

// ============================================================================
// PROJECTS WITH NO STATE MACHINE
//
// PulseHSM is one tenant of this IR, not its foundation. These link *without*
// PulseHSM.cpp, so any leftover reference to the runtime fails at link time
// rather than merely being untidy.
// ============================================================================

test('a blink is a task, and generates no state machine at all', () => {
  const plain = generate(path.join(repoRoot, 'examples/blink.yaml'));

  for (const trace of ['PulseHSM', 'fsm.', 'SystemEvent', 'addState']) {
    assert(!plain.includes(trace), `a machine-less sketch still mentions "${trace}"`);
  }

  // The model declares no console, so the sketch must not touch one. This is
  // the whole declarative contract in one assertion: nothing appears in the
  // output that the model did not ask for.
  assert(!plain.includes('Serial'), 'a model that declares no console still produced Serial calls');

  const sketch = withActionTrace(plain);
  assert(plain.includes('void action_toggle_led(SystemContext* ctx)'), 'no stub for the task action');

  const driver = `
int main() {
  setup();

  // blink_ms is 500, so four passes at 499ms apart cross it twice.
  Serial.println("-- 4 x 499ms");
  for (int i = 0; i < 4; i++) { pulseTestAdvance(499); loop(); }

  // Retuning at runtime must take effect on the next pass, not at reboot.
  Serial.println("-- retuned to 100ms");
  systemParameters.blink_ms = 100;
  pulseTestAdvance(100); loop();
  return 0;
}`;

  const output = buildAndRunPlain('blink', sketch, driver);
  const runs = output.split('\n').filter(line => line.includes('Action: toggle_led')).length;

  // Three before the retune, one after. The deadline advances by whole
  // intervals, so a loop that arrives 499ms at a time still keeps up with a
  // 500ms period instead of slipping a beat every other cycle.
  assert(runs === 4, `expected 4 toggles (3 before the retune, 1 after), got ${runs}\n${output}`);
  assert(
    output.indexOf('-- retuned') < output.lastIndexOf('Action: toggle_led'),
    'the retuned interval never fired'
  );
});

test('a task keeps its average rate, and does not burst after a stall', () => {
  // The first version restarted the deadline from millis() on every run, so
  // each period picked up however long the loop took to come round, and the
  // error accumulated. Advancing the deadline by whole intervals instead keeps
  // the average exact.
  const sketch = generate(path.join(repoRoot, 'examples/blink.yaml'));

  // Stamp each run, so the output carries the timing rather than a count.
  const instrumented = sketch.replace(
    'void action_toggle_led(SystemContext* ctx) {',
    'void action_toggle_led(SystemContext* ctx) {\n  Serial.print("AT "); Serial.println(millis());'
  );
  assert(instrumented !== sketch, 'could not instrument the action stub');

  const driver = `
int main() {
  setup();

  // A real loop does not come round on a tidy boundary. Stepping by 7ms means
  // every 100ms deadline is missed by a few milliseconds.
  for (int i = 0; i < 3000; i++) { pulseTestAdvance(7); loop(); }

  Serial.println("STALL");
  // A long blocking call, or a Wi-Fi reconnect: 50 periods go by at once.
  pulseTestAdvance(5000);
  for (int i = 0; i < 3; i++) { loop(); pulseTestAdvance(1); }
  return 0;
}`;

  const output = buildAndRunPlain('blink_drift', instrumented, driver);
  const [before, after] = output.split('STALL');
  const stamps = (text: string) =>
    [...text.matchAll(/AT (\d+)/g)].map(m => Number(m[1]));

  const runs = stamps(before);
  // 3000 x 7ms is 21000ms of virtual time, and blink_ms defaults to 500.
  assert(runs.length >= 40 && runs.length <= 43, `expected ~42 runs over 21s at 500ms, got ${runs.length}`);

  // The measure that matters. Restarting the deadline each time absorbed the
  // few milliseconds the loop overshot by into every period, so the average
  // crept above 500 and kept climbing.
  const average = (runs[runs.length - 1] - runs[0]) / (runs.length - 1);
  assert(
    Math.abs(average - 500) < 0.5,
    `average period drifted to ${average.toFixed(2)}ms; it should hold at 500ms`
  );

  // Individual periods still jitter by the loop step, but no further.
  const gaps = runs.slice(1).map((t, i) => t - runs[i]);
  assert(
    Math.max(...gaps) <= 507 && Math.min(...gaps) >= 493,
    `periods ranged ${Math.min(...gaps)}..${Math.max(...gaps)}ms; the loop only steps by 7`
  );

  // And a stall resyncs rather than firing once per missed period.
  assert(
    stamps(after).length === 1,
    `a 5s stall should give one catch-up run, not one per missed period (got ${stamps(after).length})`
  );
});

test('a serial console sets its own baud rate and dispatches commands', () => {
  const sketch = generate(path.join(repoRoot, 'examples/serial_console.yaml'));

  // The whole point of declaring the console as a bus: no hardcoded rate.
  assert(sketch.includes('#define CONSOLE_BAUD 9600'), 'the declared baud rate is missing');
  assert(!sketch.includes('Serial.begin(115200)'), 'setup() still opens the console at a hardcoded rate');
  assert(
    (sketch.match(/Serial\.begin\(/g) || []).length === 1,
    'the console is opened more than once, so one baud rate silently wins'
  );
  assert(!sketch.includes('PulseHSM'), 'a machine-less sketch still references the runtime');

  const driver = `
int main() {
  setup();

  Serial.println("-- three lines at once, one of them unknown");
  Serial.feed("on\\nstatus\\nnope\\n");
  loop();

  // A serial monitor delivers bytes when it feels like it; a command split
  // across two passes of loop() has to be reassembled, not dropped.
  Serial.println("-- one command split across two passes");
  Serial.feed("of");
  loop();
  Serial.feed("f\\n");
  loop();

  // Too long to fit: refusing is right, truncating would run "on" instead.
  Serial.println("-- an over-long line, then a good one");
  for (int i = 0; i < 200; i++) Serial.feed("x");
  Serial.feed("\\non\\n");
  loop();
  return 0;
}`;

  const output = buildAndRunPlain('serial_console', sketch, driver);
  const said = (needle: string) => output.includes(needle);

  assert(said('Action: led_on'), '"on" did not run its action');
  assert(said('Action: read_temp'), '"status" did not run its action');
  // `log:` prints text and values straight from the model.
  assert(/temp=[\d.]+ degC  fan_duty=128/.test(output), `the log template did not print: ${output}`);
  assert(said('Unknown command: nope'), 'an unrecognised command was silently swallowed');
  assert(said('Action: led_off'), 'a command split across two loop() passes was lost');
  assert(said('Command too long'), 'an over-long line was not reported');

  // And the reader recovered: the command after the over-long line still ran.
  const afterOverflow = output.slice(output.indexOf('Command too long'));
  assert(
    afterOverflow.includes('Action: led_on'),
    `the reader did not recover after an over-long line:\n${afterOverflow}`
  );
});

test('a machine, tasks and commands work together', () => {
  // Each of the three was tested alone. Together is where the seams are, and
  // one of them was real: loop() ran tasks and commands *before* syncContext(),
  // so an action fired by either saw whatever the last event dispatch left.
  const sketch = generate(path.join(repoRoot, 'test/fixtures/combined.yaml'));

  assert(sketch.includes('#define CONSOLE_BAUD 19200'), 'the console baud rate was lost among the buses');
  assert(
    /void loop\(\) \{\s*\n\s*syncContext\(\);/.test(sketch),
    'loop() runs tasks and commands before refreshing the context they are handed'
  );

  const driver = `${DRIVER_PRELUDE}
int main() {
  setup();
  report();

  // A command that raises an event has to reach the machine.
  Serial.feed("start\\n");
  loop();
  report();

  // A task keeps running whatever state the machine is in, and a command that
  // runs actions directly works alongside it.
  Serial.println("-- 250ms later, plus a direct command");
  pulseTestAdvance(250);
  Serial.feed("report\\n");
  loop();
  report();

  // The timed transition out of running/warming is a separate clock from the
  // task, and reaching it must not depend on the task having fired.
  Serial.println("-- past hold_ms");
  pulseTestAdvance(1000);
  loop();
  report();

  Serial.println("-- stop");
  Serial.feed("stop\\n");
  loop();
  report();
  return 0;
}`;

  const output = buildAndRun('combined', sketch, driver);

  assertTrace(
    output,
    [
      'idle',
      'running/warming',   // "start" raised START and the machine moved
      'running/warming',
      'running/steady',    // the after: timer fired, independently of the task
      'idle',              // "stop" raised STOP from the inner state
    ],
    'combined dispatch trace mismatch'
  );

  // The task ran on its own clock throughout, and the multi-action command ran
  // both of its actions.
  const samples = output.split('\n').filter(l => l.includes('Action: sample')).length;
  assert(samples >= 2, `the task and the command should both have sampled, saw ${samples}`);
  assert(output.includes('Action: announce'), 'the second action of a multi-action command never ran');
});

test('a project with no machine gets no runtime vendored beside it', () => {
  // Shipping a copy of PulseHSM with a blink would claim a dependency that is
  // not there, and leave a PulseHSM_config.h sizing a table nothing allocates.
  const project = new Parser().parseFrom(
    path.join(repoRoot, 'examples/blink.yaml'),
    new FileResolver()
  );
  const files = new Codegen().generateFiles(project);

  assert(!files.needsRuntime, 'a machine-less project asked for the runtime');
  assert(
    !files.generated.some(f => f.path === 'PulseHSM_config.h'),
    'a machine-less project was given a runtime sizing header'
  );
  assert(
    !files.scaffolds.some(f => f.path.includes('guards')),
    'a machine-less project was given a guards file; guards live on transitions'
  );
  for (const file of [...files.generated, ...files.scaffolds]) {
    assert(!file.contents.includes('PulseHSM'), `${file.path} still references the runtime`);
  }

  // And the same model with a machine does still get all of it.
  const withMachine = new Codegen().generateFiles(
    new Parser().parseFrom(path.join(repoRoot, 'examples/boiler/pulse.yaml'), new FileResolver())
  );
  assert(withMachine.needsRuntime, 'a project with a machine no longer asks for the runtime');
  assert(
    withMachine.generated.some(f => f.path === 'PulseHSM_config.h'),
    'a project with a machine lost its sizing header'
  );
});

test('nothing appears in the output that the model did not ask for', () => {
  // The declarative contract, checked against every shipped model: every
  // serial port the sketch touches must be one the model declared. It used to
  // emit Serial.begin(115200), a boot banner, an "initial state" line and a
  // FATAL diagnostic regardless - and writing to a Serial that was never begun
  // is not merely untidy: on an AVR it fills the TX buffer and blocks forever.
  const models = [
    'examples/blink.yaml',
    'examples/traffic_light.yaml',
    'examples/motor_controller.yaml',
    'examples/pump_tank.yaml',
    'examples/boiler/pulse.yaml',
    'examples/greenhouse/greenhouse.yaml',
    'examples/sensor_gateway/pulse.yaml',
    'examples/serial_console.yaml',
    'test/fixtures/combined.yaml',
  ];

  for (const model of models) {
    const project = new Parser().parseFrom(path.join(repoRoot, model), new FileResolver());
    const sketch = new Codegen().generate(project);

    // Which ports the model actually declared. Port defaults to 1 in the
    // backend, matching the interface emitter.
    const declared = new Set(
      (project.system.resources || [])
        .filter(r => String(r.interface) === 'uart')
        .map(r => Number(r.binding?.port ?? 1))
    );

    // Which ports the sketch touches. `Serial` is port 0.
    const used = new Set(
      [...sketch.matchAll(/\bSerial(\d?)\.\w+\(/g)].map(m => Number(m[1] || 0))
    );

    for (const port of used) {
      assert(
        declared.has(port),
        `${model} touches Serial${port === 0 ? '' : port}, which the model never declared`
      );
    }

    // And a declared console must actually be reachable, or declaring it did
    // nothing - the case that started this.
    if (declared.has(0)) {
      assert(used.has(0), `${model} declares a console the generated sketch never uses`);
    }
  }
});

test('commands need a console, and say how to declare one', () => {
  // Rather than quietly reading from a Serial the model never mentioned.
  const project = new Parser().parse(`
project: {name: nope, version: "1.0"}
commands:
  map:
    ping: pong
`);

  let raised: Error | undefined;
  try {
    new Codegen().generate(project);
  } catch (error) {
    raised = error as Error;
  }

  assert(!!raised, 'commands with no console were accepted');
  assert(/needs a console/.test(raised!.message), `unhelpful message: ${raised!.message}`);
  assert(
    /interface: uart, port: 0/.test(raised!.message),
    'the error does not show what to add'
  );
});

test('an action stub says where its data comes from', () => {
  // "My action needs a sensor reading - where does it come from?" The answer
  // is ctx, and the stub names every field rather than leaving it to be found
  // in a header.
  const sketch = generate(path.join(repoRoot, 'examples/serial_console.yaml'));
  const stub = /void action_read_temp\(SystemContext\* ctx\) \{[\s\S]*?\n\}/.exec(sketch)?.[0] ?? '';

  assert(stub.length > 0, 'no stub found for action_read_temp');
  assert(stub.includes('ctx->sensors->temp'), 'the stub does not name the declared sensor');
  assert(stub.includes('degC'), 'the sensor unit from the model is not shown');
  assert(stub.includes('ctx->parameters->report_ms'), 'the stub does not name the declared parameters');

  // And the sensor really is a field on the struct, not just a comment.
  assert(
    /struct SystemSensors \{[^}]*float temp;/.test(sketch),
    'the declared sensor has no field on SystemSensors'
  );
});

test('the vendored runtime still reads PulseHSM_config.h', () => {
  // deps/ is a hand-copied snapshot of PulseHSM. Everything above depends on
  // PulseHSM.h including the generated config, so re-vendoring a copy without
  // that hook would silently reinstate the dropped-state bug - the config file
  // would be written, ignored, and nothing would look wrong.
  //
  // Until the hook is upstream in PulseHSM itself, this is what notices.
  const header = fs.readFileSync(path.join(depsDir, 'PulseHSM.h'), 'utf8');

  assert(
    header.includes('__has_include("PulseHSM_config.h")'),
    'deps/PulseHSM.h no longer includes PulseHSM_config.h - re-apply the hook ' +
    'above the PULSEHSM_MAX_* defaults, or the generated sizes are ignored'
  );

  // It has to come before the defaults, or #ifndef sees them already set.
  const hookAt = header.indexOf('PulseHSM_config.h');
  const defaultAt = header.indexOf('#ifndef PULSEHSM_MAX_STATES');
  assert(
    hookAt !== -1 && defaultAt !== -1 && hookAt < defaultAt,
    'the config hook must precede the PULSEHSM_MAX_* defaults'
  );
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} compile test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Compile tests passed!');
