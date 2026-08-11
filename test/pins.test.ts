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

  for (const example of ['examples/boiler/pulse.yaml', 'examples/greenhouse/greenhouse.yaml']) {
    const project = new Parser().parseFrom(path.join(repoRoot, example), new FileResolver());
    const conflicts = findPinConflicts(project);
    assert(conflicts.length === 0, `${example} has a pin conflict: ${JSON.stringify(conflicts)}`);

    // And they really do claim pins, so this is not passing vacuously.
    assert(collectPinClaims(project).length > 0, `${example} claims no pins at all`);
  }
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} pin test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Pin tests passed!');
