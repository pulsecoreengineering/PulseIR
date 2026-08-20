/**
 * Pin allocation tests.
 *
 * Two things wired to one pin compiles perfectly well in C and fails on the
 * bench, so catching it is the cheapest thing the compiler does that
 * hand-written firmware cannot.
 *
 * The interesting cases are the ones that must NOT be reported: devices
 * sharing a bus are sharing pins on purpose.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { Parser, ParseError } from '../src/parser/index.js';
import { FileResolver } from '../src/parser/fs-resolver.js';
import { normalizePin, collectPinClaims, findPinConflicts } from '../src/analysis/pins.js';
import { loadBoard, resolveBoard, checkPinCapabilities, checkPinBoundaries } from '../src/parser/board-resolver.js';

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

const HEAD = `project: {name: pins, version: "1.0"}
events: {GO: {source: external}}
machine: {states: {idle: {}}, transitions: []}
`;

const parse = (yaml: string) => new Parser().parse(yaml);

function expectConflict(yaml: string, needle: string, label: string): void {
  let raised: Error | undefined;
  try {
    parse(yaml);
  } catch (error) {
    raised = error as Error;
  }

  if (!raised) throw new Error(`${label}: expected a conflict, but parsing succeeded`);
  if (!(raised instanceof ParseError)) throw new Error(`${label}: got ${raised.name}`);
  if (!raised.message.includes(needle)) {
    throw new Error(`${label}: expected "${needle}", got "${raised.message}"`);
  }
}

// ============================================================================

console.log('📌 Testing pin allocation...\n');

test('pin spellings normalise to one identity', () => {
  // GPIO25, gpio_25 and 25 are the same physical pin.
  equal(normalizePin('GPIO25'), '25', 'GPIO25');
  equal(normalizePin('gpio_25'), '25', 'gpio_25');
  equal(normalizePin('IO25'), '25', 'IO25');
  equal(normalizePin(25), '25', 'numeric');
  equal(normalizePin('25'), '25', 'string digits');

  // A0 and D4 are real board macros, not a GPIO number - left alone.
  equal(normalizePin('A0'), 'A0', 'analog macro');
  equal(normalizePin('D4'), 'D4', 'digital macro');
  equal(normalizePin(undefined), null, 'absent');
});

test('two devices on one pin is reported, whatever the spelling', () => {
  expectConflict(`${HEAD}
hardware:
  devices:
    pump: {type: digital_output, pin: GPIO25}
    fan:  {type: digital_output, pin: 25}
`, 'Pin 25 is claimed by', 'same pin, different spellings');
});

test('a bus and an unrelated device clashing is reported', () => {
  expectConflict(`${HEAD}
hardware:
  buses:
    probe_bus: {interface: onewire, pin: GPIO4}
  devices:
    led: {type: digital_output, pin: GPIO4}
`, 'Pin 4 is claimed by', 'bus vs device');
});

test('bus pins clashing with each other is reported', () => {
  expectConflict(`${HEAD}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
    spi_bus: {interface: spi, sck: GPIO21, miso: GPIO19, mosi: GPIO23}
`, 'Pin 21 is claimed by', 'two buses');
});

test('devices sharing a bus are NOT a conflict', () => {
  // Two sensors on one I2C bus is the entire point of a bus.
  const project = parse(`${HEAD}
hardware:
  buses:
    sensor_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    air_temp: {type: bme280, bus: sensor_bus, address: 0x76}
    humidity: {type: bme280, bus: sensor_bus, address: 0x77}
`);
  equal(findPinConflicts(project).length, 0, 'shared bus is legitimate');
});

test('a device restating its bus pin is NOT a conflict', () => {
  const project = parse(`${HEAD}
hardware:
  buses:
    probe_bus: {interface: onewire, pin: GPIO4}
  devices:
    probe: {type: ds18b20, bus: probe_bus, pin: GPIO4}
`);
  equal(findPinConflicts(project).length, 0, 'device declares the bus it sits on');
});

test('one owner naming a pin twice is NOT a conflict', () => {
  // A UART with rx and tx on distinct pins, and nothing else - no clash.
  const project = parse(`${HEAD}
hardware:
  buses:
    gps: {interface: uart, rx: GPIO16, tx: GPIO17}
`);
  equal(findPinConflicts(project).length, 0, 'distinct roles on one owner');
});

test('claims record where they came from, for a usable message', () => {
  const project = parse(`${HEAD}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    pump: {type: digital_output, pin: GPIO25}
`);
  const claims = collectPinClaims(project);
  const sda = claims.find(c => c.role === 'sda')!;

  equal(sda.owner, 'i2c_bus', 'owner');
  equal(sda.kind, 'bus', 'kind');
  equal(sda.written, 'GPIO21', 'original spelling is kept for the message');
  equal(claims.find(c => c.owner === 'pump')!.kind, 'device', 'device claims too');
});

test('a name used for both a bus and a device is rejected', () => {
  // They share a namespace when generating macros, so one would shadow the other.
  expectConflict(`${HEAD}
hardware:
  buses:
    vent: {interface: pwm, pin: GPIO25}
  devices:
    vent: {type: digital_output, pin: GPIO26}
`, 'declared as both a bus and a device', 'name collision');
});

test('a legacy model gets a warning, not an error, for the ambiguous case', () => {
  // The retired schema had no `bus:` field, so a probe sharing its bus's pin
  // is indistinguishable from a genuine clash. Refusing to build every such
  // model would break the deprecation promise, so it is downgraded.
  const parser = new Parser();
  const project = parser.parse(`
project: {name: legacy, version: "1.0"}
system:
  name: legacy
  events: [{name: GO, source: external}]
  states: [{name: idle, type: simple}]
  transitions: []
  components:
    - {name: probe, class: sensor, driver: ds18b20, config: {interface: onewire, pin: GPIO4}}
  resources:
    - {name: onewire_bus, interface: onewire, binding: {pin: GPIO4}}
`);

  assert(project.system.components!.length === 1, 'the model still parses');
  assert(
    parser.warnings.some(w => w.includes('Pin 4 is claimed by')),
    `expected a pin warning, got ${JSON.stringify(parser.warnings)}`
  );
});

test('a legacy model still fails hard on an unambiguous clash', () => {
  // Two devices on one pin is wrong in any schema - no downgrade.
  expectConflict(`
project: {name: legacy, version: "1.0"}
system:
  name: legacy
  events: [{name: GO, source: external}]
  states: [{name: idle, type: simple}]
  transitions: []
  components:
    - {name: pump, class: actuator, driver: gpio_control, config: {pin: GPIO25}}
    - {name: fan, class: actuator, driver: gpio_control, config: {pin: GPIO25}}
`, 'Pin 25 is claimed by', 'legacy device-vs-device');
});

test('the message says how to resolve a bus/device clash', () => {
  let message = '';
  try {
    parse(`${HEAD}
hardware:
  buses:
    probe_bus: {interface: onewire, pin: GPIO4}
  devices:
    led: {type: digital_output, pin: GPIO4}
`);
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes('bus: probe_bus'), `no actionable hint: ${message}`);
});

test('the shipped examples allocate pins cleanly', () => {
  // These are the models students copy from, so a clash in one teaches the
  // mistake. Parsing throws on a conflict, so this really does check them.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  const shipped = [
    'examples/boiler/pulse.yaml',
    'examples/greenhouse/greenhouse.yaml',
    'examples/traffic_light.yaml',
    'examples/motor_controller.yaml',
    'examples/pump_tank.yaml',
    'examples/sensor_gateway/pulse.yaml',
  ];

  for (const example of shipped) {
    const project = new Parser().parseFrom(path.join(repoRoot, example), new FileResolver());
    const conflicts = findPinConflicts(project);
    assert(conflicts.length === 0, `${example} has a pin conflict: ${JSON.stringify(conflicts)}`);

    // And they really do claim pins, so this is not passing vacuously.
    assert(collectPinClaims(project).length > 0, `${example} claims no pins at all`);
  }
});

// ============================================================================
// Board resolver — loadBoard / resolveBoard / checkPinCapabilities
// ============================================================================

console.log('\n📋 Testing board-resolver (loadBoard / resolveBoard / checkPinCapabilities)...\n');

const repoRoot2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- loadBoard ---

test('loadBoard: loads esp32_devkit_v4 by id', () => {
  const board = loadBoard('esp32_devkit_v4');
  equal(board.name, 'ESP32 DevKit V4', 'name');
  equal(board.mcu, 'esp32', 'mcu');
  assert(board.frameworks.includes('arduino'), 'supports arduino');
  assert(board.pins['LED_BUILTIN'] === 'GPIO2', 'LED_BUILTIN → GPIO2');
});

test('loadBoard: resolves alias (esp32 → esp32_devkit_v4)', () => {
  const board = loadBoard('esp32');
  equal(board.name, 'ESP32 DevKit V4', 'alias resolves');
});

test('loadBoard: loads rp2040_pico by id', () => {
  const board = loadBoard('rp2040_pico');
  equal(board.mcu, 'rp2040', 'mcu');
  assert(board.pins['LED_BUILTIN'] === 'GPIO25', 'LED_BUILTIN → GPIO25');
});

test('loadBoard: throws a descriptive error for an unknown board', () => {
  let msg = '';
  try { loadBoard('nonexistent_board_xyz'); } catch (e) { msg = (e as Error).message; }
  assert(msg.includes('nonexistent_board_xyz'), 'names the missing board');
  assert(msg.includes('Available boards'), 'lists what is available');
});

test('loadBoard: accepts an absolute path to a custom board file', () => {
  const p = path.join(repoRoot2, 'boards', 'arduino_uno.yaml');
  const board = loadBoard(p);
  equal(board.mcu, 'atmega328p', 'loaded by path');
});

// --- resolveBoard (logical → physical pin rewrite) ---

const BASE_YAML = `project: {name: t, version: "1.0"}
events: {GO: {source: external}}
machine: {states: {idle: {}}, transitions: []}
`;

test('resolveBoard: translates logical pin names to physical GPIO identifiers', () => {
  const project = parse(`${BASE_YAML}
hardware:
  buses:
    sensor_bus: {interface: i2c, sda: I2C_SDA, scl: I2C_SCL}
  devices:
    led: {type: digital_output, pin: LED_BUILTIN}
`);
  const board   = loadBoard('esp32_devkit_v4');
  const resolved = resolveBoard(project, board);

  const bus = resolved.system.resources?.find(r => r.name === 'sensor_bus');
  equal((bus?.binding as Record<string, unknown>)?.sda, 'GPIO21', 'I2C_SDA → GPIO21');
  equal((bus?.binding as Record<string, unknown>)?.scl, 'GPIO22', 'I2C_SCL → GPIO22');

  const led = resolved.system.components?.find(c => c.name === 'led');
  equal((led?.config as Record<string, unknown>)?.pin, 'GPIO2', 'LED_BUILTIN → GPIO2');
});

test('resolveBoard: passes through physical GPIO names unchanged', () => {
  // Models that already use GPIO25 don't need a board file and should not change.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    pump: {type: digital_output, pin: GPIO25}
`);
  const board   = loadBoard('esp32_devkit_v4');
  const resolved = resolveBoard(project, board);
  const pump = resolved.system.components?.find(c => c.name === 'pump');
  equal((pump?.config as Record<string, unknown>)?.pin, 'GPIO25', 'GPIO25 passes through');
});

test('resolveBoard: does not modify the original project', () => {
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    led: {type: digital_output, pin: LED_BUILTIN}
`);
  const board   = loadBoard('esp32_devkit_v4');
  resolveBoard(project, board);
  const led = project.system.components?.find(c => c.name === 'led');
  equal((led?.config as Record<string, unknown>)?.pin, 'LED_BUILTIN', 'original unchanged');
});

// --- checkPinCapabilities ---

test('checkPinCapabilities: output device on an input-only pin is an error', () => {
  // GPIO34 is input_only on ESP32 — no output driver exists (ESP32 TRM §4.2).
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    status_led: {type: digital_output, pin: GPIO34}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  assert(
    violations.some(v => v.severity === 'error' && v.message.includes('input-only')),
    `expected input-only error, got ${JSON.stringify(violations)}`,
  );
});

test('checkPinCapabilities: input device on an input-only pin is fine', () => {
  // GPIO34 and GPIO35 are intentionally used as inputs in motor_controller.yaml.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    current_sense: {type: analog_input, pin: GPIO34}
    estop:         {type: digital_input, pin: GPIO35}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  const inputOnly  = violations.filter(v => v.message.includes('input-only'));
  equal(inputOnly.length, 0, 'no input-only errors for input devices');
});

test('checkPinCapabilities: reserved flash pin on a device is an error', () => {
  // GPIO7 is wired to the integrated SPI flash controller.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO7}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  assert(
    violations.some(v => v.severity === 'error' && v.message.includes('reserved')),
    `expected reserved error, got ${JSON.stringify(violations)}`,
  );
});

test('checkPinCapabilities: reserved pin in a bus binding is an error', () => {
  const project = parse(`${BASE_YAML}
hardware:
  buses:
    serial: {interface: uart, rx: GPIO16, tx: GPIO6}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  assert(
    violations.some(v => v.severity === 'error' && v.message.includes('reserved')),
    `expected reserved error on bus, got ${JSON.stringify(violations)}`,
  );
});

test('checkPinCapabilities: strapping pin used as output is a warning', () => {
  // GPIO0 is a boot-mode strapping pin; driving it LOW at reset blocks startup.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    relay: {type: digital_output, pin: GPIO0}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  assert(
    violations.some(v => v.severity === 'warning' && v.message.includes('strapping')),
    `expected strapping warning, got ${JSON.stringify(violations)}`,
  );
});

test('checkPinCapabilities: SPI MISO on input-only pin is NOT an error', () => {
  // MISO is master-in/slave-out — the CPU only receives on this pin.
  const project = parse(`${BASE_YAML}
hardware:
  buses:
    spi_bus: {interface: spi, sck: GPIO18, miso: GPIO36, mosi: GPIO23}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  const inputOnly  = violations.filter(v => v.message.includes('input-only'));
  equal(inputOnly.length, 0, 'MISO on input-only pin not flagged');
});

test('checkPinCapabilities: analog_input on ADC2 pin with Wi-Fi is a warning', () => {
  // GPIO25 is ADC2_CH8; ADC2 is disabled by the Wi-Fi driver on ESP32.
  const project = parse(`${BASE_YAML}
hardware:
  buses:
    wlan: {interface: wifi}
  devices:
    pressure: {type: analog_input, pin: GPIO25}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  assert(
    violations.some(v => v.severity === 'warning' && v.message.includes('ADC2')),
    `expected ADC2 warning, got ${JSON.stringify(violations)}`,
  );
});

test('checkPinCapabilities: digital_output on ADC2 pin with Wi-Fi is fine', () => {
  // ADC2/Wi-Fi only affects analog reads; digital I/O is unaffected.
  const project = parse(`${BASE_YAML}
hardware:
  buses:
    wlan: {interface: wifi}
  devices:
    relay: {type: digital_output, pin: GPIO26}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  const adc2 = violations.filter(v => v.message.includes('ADC2'));
  equal(adc2.length, 0, 'digital output on ADC2 pin not flagged');
});

test('checkPinCapabilities: RP2040 Pico — all standard GPIOs are fully bidirectional', () => {
  // The RP2040 has no input-only pins on the user-accessible header.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    pump:  {type: digital_output, pin: GPIO0}
    valve: {type: pwm_output,     pin: GPIO15, channel: 0, frequency: 1000, resolution: 8}
    sense: {type: analog_input,   pin: GPIO26}
`);
  const board      = loadBoard('rp2040_pico');
  const violations = checkPinCapabilities(project, board);
  const errors = violations.filter(v => v.severity === 'error');
  equal(errors.length, 0, `no errors on Pico, got ${JSON.stringify(errors)}`);
});

test('checkPinCapabilities: no violations for a valid ESP32 device assignment', () => {
  // GPIO25/27/32 are ordinary bidirectional output-capable pins on ESP32.
  const project = parse(`${BASE_YAML}
hardware:
  buses:
    one_wire: {interface: onewire, pin: GPIO4}
  devices:
    pump:   {type: digital_output, pin: GPIO25}
    heater: {type: pwm_output,     pin: GPIO27, channel: 0, frequency: 5000, resolution: 8}
    level:  {type: analog_input,   pin: GPIO32}
`);
  const board      = loadBoard('esp32_devkit_v4');
  const violations = checkPinCapabilities(project, board);
  equal(violations.length, 0, `expected clean, got ${JSON.stringify(violations)}`);
});

// ============================================================================
// Board resolver — checkPinBoundaries (HAL boundary check)
// ============================================================================

console.log('\n🔲 Testing board-resolver (checkPinBoundaries)...\n');

test('checkPinBoundaries: a valid GPIO on the Uno produces no violation', () => {
  // Arduino Uno has GPIO0–GPIO19 (14 digital + 6 analog).
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO13}
`);
  const board = loadBoard('arduino_uno');
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  equal(violations.length, 0, `expected no violations, got ${JSON.stringify(violations)}`);
});

test('checkPinBoundaries: a GPIO beyond Uno range is a hard error', () => {
  // GPIO20 does not exist on the ATmega328P — only GPIO0–GPIO19.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    motor: {type: digital_output, pin: GPIO20}
`);
  const board = loadBoard('arduino_uno');
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  assert(
    violations.some(v => v.severity === 'error' && v.message.includes('[HAL]')),
    `expected [HAL] error for GPIO20, got ${JSON.stringify(violations)}`,
  );
  const msg = violations.find(v => v.severity === 'error')!.message;
  assert(msg.includes('GPIO20'), `message should mention GPIO20: ${msg}`);
  assert(msg.includes('Arduino Uno'), `message should name the board: ${msg}`);
});

test('checkPinBoundaries: Mega GPIO60 is valid (Mega has GPIO0–GPIO69)', () => {
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    relay: {type: digital_output, pin: GPIO60}
`);
  const board = loadBoard('arduino_mega');
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  equal(violations.length, 0, 'GPIO60 is valid on Mega');
});

test('checkPinBoundaries: a Mega pin (GPIO60) is an error on Uno', () => {
  // Same model, different board — catches cross-board copy-paste mistakes.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    relay: {type: digital_output, pin: GPIO60}
`);
  const board = loadBoard('arduino_uno');
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  assert(
    violations.some(v => v.severity === 'error'),
    `GPIO60 should be an error on Uno, got ${JSON.stringify(violations)}`,
  );
});

test('checkPinBoundaries: bare numeric pin is normalised to GPIOnn before lookup', () => {
  // "13" and "GPIO13" refer to the same physical pin; both should pass on Uno.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    led: {type: digital_output, pin: "13"}
`);
  const board = loadBoard('arduino_uno');
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  equal(violations.length, 0, '"13" normalised to GPIO13 and accepted on Uno');
});

test('checkPinBoundaries: bare numeric out of range is also flagged', () => {
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    motor: {type: digital_output, pin: "70"}
`);
  const board = loadBoard('arduino_uno');
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  assert(
    violations.some(v => v.severity === 'error'),
    '"70" → GPIO70 should be an error on Uno',
  );
});

test('checkPinBoundaries: bus pins are also checked', () => {
  // I2C pins on an Uno: SDA=GPIO18 (A4), SCL=GPIO19 (A5) — both valid.
  const project = parse(`${BASE_YAML}
hardware:
  buses:
    sensor_bus: {interface: i2c, sda: GPIO18, scl: GPIO19}
`);
  const board = loadBoard('arduino_uno');
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  equal(violations.length, 0, 'standard Uno I2C pins are valid');
});

test('checkPinBoundaries: bus pin outside board range is flagged', () => {
  const project = parse(`${BASE_YAML}
hardware:
  buses:
    spi_bus: {interface: spi, sck: GPIO52, miso: GPIO50, mosi: GPIO51}
`);
  const board = loadBoard('arduino_uno');
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  assert(
    violations.some(v => v.severity === 'error' && v.message.includes('[HAL]')),
    `expected [HAL] errors for GPIO50/51/52 on Uno, got ${JSON.stringify(violations)}`,
  );
});

test('checkPinBoundaries: returns empty array when board has no pin data', () => {
  // A board YAML with an empty pins: {} and no pin_caps should skip the check
  // silently rather than false-alarming on every pin in the model.
  // Simulate this with a board whose pins map maps nothing to nothing.
  // We test indirectly: the function accepts such a board and returns [].
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2}
`);
  const sparseBoard = {
    name: 'custom',
    mcu: 'unknown',
    frameworks: ['arduino'],
    pins: {},       // empty — no data to derive valid set from
    pinCaps: {},
  };
  const violations = checkPinBoundaries(project, sparseBoard);
  equal(violations.length, 0, 'sparse board skips the check rather than false-alarming');
});

test('checkPinBoundaries: non-GPIO labels (A0, D4) are silently skipped', () => {
  // Logical names that survived resolution (or Arduino-style A0/D4 labels)
  // don't start with "GPIO" after normalisation and should not produce false positives.
  const project = parse(`${BASE_YAML}
hardware:
  devices:
    analog_in: {type: analog_input, pin: A0}
`);
  const board = loadBoard('arduino_uno');
  // A0 is a logical label; resolveBoard leaves it unchanged if not in the pin map.
  // checkPinBoundaries should skip non-GPIO labels silently.
  const violations = checkPinBoundaries(resolveBoard(project, board), board);
  const halErrors = violations.filter(v => v.message.includes('[HAL]'));
  equal(halErrors.length, 0, 'non-GPIO labels should not produce [HAL] errors');
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} pin test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Pin tests passed!');
