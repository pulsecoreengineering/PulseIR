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
  const header = files.generated.find(f => f.path.endsWith('.h'))!.contents;
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

if (failures > 0) {
  console.error(`\n❌ ${failures} compile test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Compile tests passed!');
