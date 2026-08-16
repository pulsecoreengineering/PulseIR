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
// Board profile checks (ESP32)
// ============================================================================

console.log('\n📋 Testing ESP32 board profile checks...\n');

// Shared header that declares target: esp32 — must be included in every profile
// test fixture so the parser loads the ESP32 profile.
const ESP32_HEAD = `project: {name: test, version: "1.0"}
target: {board: esp32}
events: {GO: {source: external}}
machine: {states: {idle: {}}, transitions: []}
`;

function expectProfileError(yaml: string, needle: string, label: string): void {
  let raised: Error | undefined;
  try {
    parse(yaml);
  } catch (error) {
    raised = error as Error;
  }
  if (!raised) throw new Error(`${label}: expected a profile error, but parsing succeeded`);
  if (!(raised instanceof ParseError)) throw new Error(`${label}: unexpected error type: ${raised.name}`);
  if (!raised.message.includes(needle)) {
    throw new Error(`${label}: expected "${needle}" in message, got:\n${raised.message}`);
  }
}

function expectProfileWarning(yaml: string, needle: string, label: string): void {
  const parser = new Parser();
  parser.parse(yaml);
  const found = parser.warnings.some(w => w.includes(needle));
  if (!found) {
    throw new Error(`${label}: expected warning containing "${needle}", got:\n${parser.warnings.join('\n')}`);
  }
}

function expectNoProfileDiagnostic(yaml: string, label: string): void {
  let raised: Error | undefined;
  try {
    const parser = new Parser();
    const project = parser.parse(yaml);
    // Confirm no profile-related warnings either (collision warnings share the
    // parse path, so any warning from the profile check would show up here).
    const profileWarnings = parser.warnings.filter(
      w => w.includes('input-only') || w.includes('SPI flash') || w.includes('ADC2'),
    );
    if (profileWarnings.length > 0) {
      throw new Error(`unexpected profile warnings: ${profileWarnings.join('; ')}`);
    }
    void project;
  } catch (error) {
    raised = error as Error;
  }
  if (raised) throw new Error(`${label}: expected no diagnostic, got: ${raised.message}`);
}

// --- Flash-reserved (GPIO6–11) ---

test('flash-reserved pin on a device is rejected', () => {
  // GPIO7 is SD0 (SPI flash data line) on ESP32 — cannot be used by the app.
  expectProfileError(`${ESP32_HEAD}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO7}
`, 'integrated SPI flash', 'GPIO7 flash pin on device');
});

test('flash-reserved pin in a bus binding is rejected', () => {
  expectProfileError(`${ESP32_HEAD}
hardware:
  buses:
    serial: {interface: uart, rx: GPIO16, tx: GPIO6}
`, 'integrated SPI flash', 'GPIO6 flash pin on bus tx');
});

// --- Input-only (GPIO34, 35, 36, 39) ---

test('output device on an input-only pin is rejected', () => {
  // GPIO34 has no output driver on ESP32 — wiring a digital_output to it is wrong.
  expectProfileError(`${ESP32_HEAD}
hardware:
  devices:
    status_led: {type: digital_output, pin: GPIO34}
`, 'input-only', 'digital_output on GPIO34');
});

test('pwm_output on an input-only pin is rejected', () => {
  expectProfileError(`${ESP32_HEAD}
hardware:
  devices:
    motor: {type: pwm_output, pin: GPIO35, channel: 0, frequency: 1000, resolution: 8}
`, 'input-only', 'pwm_output on GPIO35');
});

test('input device on an input-only pin is accepted', () => {
  // GPIO34 and GPIO35 are intentionally input-only — use them for ADC or digital input.
  // motor_controller.yaml already uses GPIO34 for analog_input and GPIO35 for digital_input.
  expectNoProfileDiagnostic(`${ESP32_HEAD}
hardware:
  devices:
    current_sense: {type: analog_input, pin: GPIO34, unit: A}
    estop:         {type: digital_input, pin: GPIO35}
`, 'input devices on input-only pins');
});

test('I2C SDA on an input-only pin is rejected', () => {
  // SDA must drive the bus (open-drain output) — input-only GPIO cannot do this.
  expectProfileError(`${ESP32_HEAD}
hardware:
  buses:
    sensor_bus: {interface: i2c, sda: GPIO39, scl: GPIO22}
`, 'input-only', 'I2C sda on GPIO39');
});

test('SPI MISO on an input-only pin is accepted', () => {
  // MISO is master-in/slave-out — the ESP32 only receives on this pin.
  expectNoProfileDiagnostic(`${ESP32_HEAD}
hardware:
  buses:
    spi_bus: {interface: spi, sck: GPIO18, miso: GPIO36, mosi: GPIO23}
`, 'SPI miso on input-only GPIO36');
});

test('UART TX on an input-only pin is rejected', () => {
  expectProfileError(`${ESP32_HEAD}
hardware:
  buses:
    gps: {interface: uart, rx: GPIO16, tx: GPIO39}
`, 'input-only', 'UART tx on GPIO39');
});

test('OneWire bus on an input-only pin is rejected', () => {
  // OneWire is bidirectional — needs output capability.
  expectProfileError(`${ESP32_HEAD}
hardware:
  buses:
    one_wire: {interface: onewire, pin: GPIO36}
`, 'input-only', 'onewire bus on GPIO36');
});

// --- ADC2 + Wi-Fi ---

test('analog_input on ADC2 pin with Wi-Fi declared is a warning', () => {
  // GPIO25 is ADC2_CH8 — ADC2 is borrowed by the Wi-Fi driver at runtime.
  expectProfileWarning(`${ESP32_HEAD}
hardware:
  buses:
    wlan: {interface: wifi}
  devices:
    pressure: {type: analog_input, pin: GPIO25}
`, 'ADC2', 'analog_input on ADC2 GPIO25 with WiFi');
});

test('analog_input on ADC2 pin without Wi-Fi is accepted', () => {
  // Without a wifi resource the ADC2 conflict cannot arise.
  expectNoProfileDiagnostic(`${ESP32_HEAD}
hardware:
  devices:
    pressure: {type: analog_input, pin: GPIO25}
`, 'ADC2 pin without WiFi');
});

test('digital_output on an ADC2 pin with Wi-Fi is accepted', () => {
  // The ADC2/Wi-Fi restriction only affects analog reads, not digital I/O.
  // GPIO26 is ADC2_CH9 but sensor_gateway.yaml uses it as a digital_output.
  expectNoProfileDiagnostic(`${ESP32_HEAD}
hardware:
  buses:
    wlan: {interface: wifi}
  devices:
    relay: {type: digital_output, pin: GPIO26}
`, 'digital_output on ADC2 pin with WiFi is fine');
});

test('analog_input on an ADC1 pin with Wi-Fi is accepted', () => {
  // GPIO32 is ADC1_CH4 — ADC1 is unaffected by Wi-Fi.
  expectNoProfileDiagnostic(`${ESP32_HEAD}
hardware:
  buses:
    wlan: {interface: wifi}
  devices:
    temperature: {type: analog_input, pin: GPIO32}
`, 'ADC1 pin with WiFi is fine');
});

// --- Profile scope ---

test('profile checks are skipped when no board is declared', () => {
  // Without target.board the profile is never loaded, so invalid GPIO numbers
  // are not caught — but input-only violations pass silently too.
  expectNoProfileDiagnostic(`
project: {name: test, version: "1.0"}
events: {GO: {source: external}}
machine: {states: {idle: {}}, transitions: []}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO34}
`, 'no board — profile not loaded');
});

test('profile checks are skipped for an unrecognised board', () => {
  // "esp32s3" is NOT in the profile registry yet.
  expectNoProfileDiagnostic(`
project: {name: test, version: "1.0"}
target: {board: esp32s3}
events: {GO: {source: external}}
machine: {states: {idle: {}}, transitions: []}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO34}
`, 'unknown board — no profile match');
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} pin test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Pin tests passed!');
