/**
 * Domain-schema tests.
 *
 * Covers the surface introduced in Phase 0: top-level domains, name-keyed
 * sections, `from`/`on`/`to`/`do`, the action catalogue, and device types.
 *
 * The IR behind it is unchanged, so these are about what the model is allowed
 * to say and what it is stopped from saying.
 */

import { Parser, ParseError } from '../src/parser/index.js';

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

const parse = (yaml: string) => new Parser().parse(yaml);

function expectReject(yaml: string, needle: string, label: string): void {
  let raised: Error | undefined;
  try {
    parse(yaml);
  } catch (error) {
    raised = error as Error;
  }

  if (!raised) throw new Error(`${label}: expected a ParseError, but parsing succeeded`);
  if (!(raised instanceof ParseError)) throw new Error(`${label}: got ${raised.name}: ${raised.message}`);
  if (!raised.message.includes(needle)) {
    throw new Error(`${label}: expected message containing "${needle}", got "${raised.message}"`);
  }
}

const HEAD = `project: {name: t, version: "1.0"}
events: {GO: {source: external}, STOP: {source: external}}
`;

// ============================================================================

console.log('🧩 Testing the domain schema...\n');

test('target board is carried through', () => {
  const project = parse(`${HEAD}
target: {board: esp32}
machine: {states: {idle: {}}, transitions: []}
`);
  equal(project.target?.board, 'esp32', 'board');
});

test('states nest by containment, and type is inferred', () => {
  const project = parse(`${HEAD}
machine:
  states:
    idle:
    running:
      initial: heating
      states:
        heating:
        cooling:
  transitions: []
`);
  const running = project.system.states.find(s => s.name === 'running')!;

  equal(project.system.states.map(s => s.name), ['idle', 'running'], 'top level');
  equal(String(project.system.states[0].type), 'simple', 'a childless state is simple');
  equal(String(running.type), 'composite', 'a state with children is composite');
  equal(running.regions?.[0].states.map(s => s.name), ['heating', 'cooling'], 'children');
});

test('initial defaults to the first child, and must name one', () => {
  const project = parse(`${HEAD}
machine:
  states:
    running:
      states: {first: {}, second: {}}
  transitions: []
`);
  equal(project.system.states[0].initial, 'first', 'defaulted initial');

  expectReject(`${HEAD}
machine:
  states:
    running:
      initial: nowhere
      states: {first: {}}
  transitions: []
`, 'which is not one of its states', 'initial naming a non-child');

  expectReject(`${HEAD}
machine:
  states:
    idle:
      initial: something
  transitions: []
`, 'has no nested states', 'initial on a leaf');
});

test('from/on/to/do build a transition', () => {
  const project = parse(`${HEAD}
machine:
  states: {idle: {}, running: {}}
  transitions:
    - from: idle
      on: GO
      to: running
      do: start
`);
  const t = project.system.transitions[0];

  equal(t.source, 'idle', 'from');
  equal(t.event, 'GO', 'on');
  equal(t.target, 'running', 'to');
  equal(t.actions?.map(a => a.name), ['start'], 'do');
});

test('do takes one name or several', () => {
  const project = parse(`${HEAD}
machine:
  states: {idle: {}, running: {}}
  transitions:
    - {from: idle, on: GO, to: running, do: [first, second]}
`);
  equal(project.system.transitions[0].actions?.map(a => a.name), ['first', 'second'], 'action order');
});

test('the action catalogue supplies driver and params', () => {
  // Before the catalogue was wired up these params never reached the stub.
  const project = parse(`${HEAD}
actions:
  start_pump:
    driver: gpio_control
    params: {device: pump, value: HIGH}
machine:
  states: {idle: {}, running: {}}
  transitions:
    - {from: idle, on: GO, to: running, do: start_pump}
`);
  const action = project.system.transitions[0].actions![0];

  equal(action.name, 'start_pump', 'identity is the catalogue key');
  equal(action.driver, 'gpio_control', 'driver');
  equal(action.params, { device: 'pump', value: 'HIGH' }, 'params');
});

test('actions sharing a driver keep separate identities', () => {
  // Naming stubs after the driver would collide these into one function.
  const project = parse(`${HEAD}
actions:
  start_pump: {driver: gpio_control, params: {value: HIGH}}
  stop_pump:  {driver: gpio_control, params: {value: LOW}}
machine:
  states: {idle: {}, running: {}}
  transitions:
    - {from: idle, on: GO, to: running, do: start_pump}
    - {from: running, on: STOP, to: idle, do: stop_pump}
`);
  const names = project.system.transitions.flatMap(t => t.actions!).map(a => a.name);
  equal(names, ['start_pump', 'stop_pump'], 'distinct action identities');
});

test('with a catalogue present, an unknown action is a typo, not a new stub', () => {
  expectReject(`${HEAD}
actions:
  start_pump: {driver: gpio_control}
machine:
  states: {idle: {}, running: {}}
  transitions:
    - {from: idle, on: GO, to: running, do: strat_pump}
`, 'not in the actions catalogue', 'typo caught');
});

test('without a catalogue, any action name is accepted', () => {
  const project = parse(`${HEAD}
machine:
  states: {idle: {}, running: {}}
  transitions:
    - {from: idle, on: GO, to: running, do: whatever}
`);
  equal(project.system.transitions[0].actions?.map(a => a.name), ['whatever'], 'free-form action');
});

test('built-in device types imply a class and a driver', () => {
  const project = parse(`${HEAD}
hardware:
  devices:
    pump: {type: digital_output, pin: GPIO25}
    probe: {type: ds18b20, unit: degC}
machine: {states: {idle: {}}, transitions: []}
`);
  const byName = new Map(project.system.components!.map(c => [c.name, c]));

  equal(String(byName.get('pump')!.class), 'actuator', 'digital_output is an actuator');
  equal(byName.get('pump')!.driver, 'gpio_control', 'implied driver');
  equal(String(byName.get('probe')!.class), 'sensor', 'ds18b20 is a sensor');
  equal(byName.get('pump')!.config, { pin: 'GPIO25' }, 'remaining keys become config');
});

test('an unknown device type must state its class rather than be guessed', () => {
  // Guessing wrong would publish an actuator as if it were a reading.
  expectReject(`${HEAD}
hardware:
  devices:
    mystery: {type: some_new_part, pin: GPIO5}
machine: {states: {idle: {}}, transitions: []}
`, 'needs an explicit "class"', 'unknown device type');

  const project = parse(`${HEAD}
hardware:
  devices:
    mystery: {type: some_new_part, class: sensor, pin: GPIO5}
machine: {states: {idle: {}}, transitions: []}
`);
  equal(String(project.system.components![0].class), 'sensor', 'explicit class accepted');
});

test('a device may only sit on a declared bus', () => {
  expectReject(`${HEAD}
hardware:
  devices:
    probe: {type: ds18b20, bus: nonexistent}
machine: {states: {idle: {}}, transitions: []}
`, 'which is not declared', 'dangling bus reference');
});

test('bus settings sit directly on the bus', () => {
  const project = parse(`${HEAD}
hardware:
  buses:
    sensor_bus: {interface: i2c, sda: GPIO21, scl: GPIO22, frequency: 400000}
machine: {states: {idle: {}}, transitions: []}
`);
  const bus = project.system.resources![0];

  equal(bus.interface as unknown as string, 'i2c', 'interface');
  equal(bus.binding, { sda: 'GPIO21', scl: 'GPIO22', frequency: 400000 }, 'binding');
});

test('parameters accept range as a pair', () => {
  const project = parse(`${HEAD}
parameters:
  setpoint: {type: float, default: 60.0, range: [10.0, 90.0], unit: degC}
machine: {states: {idle: {}}, transitions: []}
`);
  const p = project.system.parameters![0];

  equal(p.min, 10.0, 'min from range');
  equal(p.max, 90.0, 'max from range');

  expectReject(`${HEAD}
parameters:
  setpoint: {type: float, default: 1.0, range: 5}
machine: {states: {idle: {}}, transitions: []}
`, 'not [min, max]', 'malformed range');
});

test('a name-keyed section written as a list says so', () => {
  expectReject(`${HEAD}
parameters:
  - name: setpoint
    type: float
machine: {states: {idle: {}}, transitions: []}
`, 'keys it by name', 'list where a map is expected');
});

test('the retired system: block still parses, with a warning', () => {
  const parser = new Parser();
  const project = parser.parse(`
project: {name: legacy, version: "1.0"}
system:
  name: legacy
  events: [{name: GO, source: external}]
  states: [{name: idle, type: simple}]
  transitions: []
`);

  equal(project.system.events.map(e => e.name), ['GO'], 'legacy model still parses');
  assert(
    parser.warnings.some(w => w.includes('retired "system:" block')),
    `expected a deprecation warning, got ${JSON.stringify(parser.warnings)}`
  );
});

test('warnings do not accumulate across parses', () => {
  const parser = new Parser();
  // Legacy schema with no target board → two warnings (retired schema + no board).
  const legacy = `project: {name: l, version: "1.0"}
system: {name: l, events: [], states: [{name: idle, type: simple}], transitions: []}`;

  parser.parse(legacy);
  parser.parse(legacy);
  equal(parser.warnings.length, 2, 'two warnings per parse (retired schema + no board), not four accumulated');

  // A clean model with a board declared → no warnings.
  parser.parse(`${HEAD}target: {board: esp32}\nmachine: {states: {idle: {}}, transitions: []}`);
  equal(parser.warnings.length, 0, 'a clean model with a board reports nothing');
});

// ============================================================================
// Multi-channel sensor devices
// ============================================================================

test('"no type" error message lists built-in types and shows a fix hint', () => {
  let caught = '';
  try {
    parse(`${HEAD}
hardware:
  devices:
    air_temp:
      bus: some_bus
machine: {states: {idle: {}}, transitions: []}
`);
  } catch (e) {
    caught = e instanceof Error ? e.message : String(e);
  }
  assert(caught.includes('has no "type"'), 'mentions missing type');
  assert(caught.includes('dht22'), 'lists at least one built-in type');
  assert(caught.includes('class: sensor'), 'hints at explicit class');
});

test('channels: list form — dht22 with two channels parses correctly', () => {
  const project = parse(`${HEAD}
hardware:
  devices:
    weather:
      type: dht22
      pin: 4
      channels:
        - temperature
        - humidity
machine: {states: {idle: {}}, transitions: []}
`);
  const c = project.system.components!.find(x => x.name === 'weather')!;
  equal(c.channels?.length, 2, 'two channels');
  equal(c.channels![0].name, 'temperature', 'first channel name');
  equal(c.channels![1].name, 'humidity', 'second channel name');
});

test('channels: map form — bme280 with three channels parses correctly', () => {
  const project = parse(`${HEAD}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    env:
      type: bme280
      bus: i2c_bus
      channels:
        temperature:
          description: Celsius
        humidity:
        pressure:
          measure: pressure
machine: {states: {idle: {}}, transitions: []}
`);
  const c = project.system.components!.find(x => x.name === 'env')!;
  equal(c.channels?.length, 3, 'three channels');
  equal(c.channels![0].name, 'temperature', 'temperature channel');
  equal(c.channels![0].description, 'Celsius', 'channel description preserved');
  equal(c.channels![2].measure, 'pressure', 'explicit measure preserved');
});

test('channels on a non-sensor device is rejected', () => {
  expectReject(`${HEAD}
hardware:
  devices:
    led: {type: digital_output, pin: GPIO2, channels: [value]}
machine: {states: {idle: {}}, transitions: []}
`, 'not a sensor', 'channels rejected on actuator');
});

test('channel names must be valid C identifiers', () => {
  expectReject(`${HEAD}
hardware:
  devices:
    weather: {type: dht22, pin: 4, channels: ["bad-name"]}
machine: {states: {idle: {}}, transitions: []}
`, 'valid C identifier', 'hyphenated channel name rejected');
});

test('log templates accept channel names from multi-channel devices', () => {
  const project = parse(`${HEAD}
hardware:
  devices:
    weather:
      type: dht22
      pin: 4
      channels: [temperature, humidity]
tasks:
  read_weather:
    every: 5000
    do: read_sensor
    log: "T={temperature}C H={humidity}%"
actions:
  read_sensor: {driver: dht22}
machine: {states: {idle: {}}, transitions: []}
`);
  equal(project.system.tasks![0].log, 'T={temperature}C H={humidity}%', 'log template accepted');
});

test('log templates reject device name when channels are declared', () => {
  expectReject(`${HEAD}
hardware:
  devices:
    weather:
      type: dht22
      pin: 4
      channels: [temperature, humidity]
tasks:
  read_weather:
    every: 5000
    do: read_sensor
    log: "W={weather}"
actions:
  read_sensor: {driver: dht22}
machine: {states: {idle: {}}, transitions: []}
`, 'not a declared parameter or sensor', 'device name rejected in log when channels exist');
});

// ============================================================================
// RTC + LCD integration schema tests
// ============================================================================

test('ds3231 auto-populates hour/minute/second channels when none declared', () => {
  const project = parse(`${HEAD}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    clock: {type: ds3231, bus: i2c_bus}
machine: {states: {idle: {}}, transitions: []}
`);
  const clock = project.system.components!.find(c => c.name === 'clock')!;
  equal(String(clock.class), 'sensor', 'ds3231 is a sensor');
  equal(clock.driver, 'rtc_read', 'driver is rtc_read');
  equal(clock.channels?.map(c => c.name), ['hour', 'minute', 'second'], 'default channels auto-populated');
});

test('ds3231 accepts explicit channel override (e.g. adding day/month/year)', () => {
  const project = parse(`${HEAD}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    clock:
      type: ds3231
      bus: i2c_bus
      channels: [hour, minute, second, day, month, year]
machine: {states: {idle: {}}, transitions: []}
`);
  const clock = project.system.components!.find(c => c.name === 'clock')!;
  equal(clock.channels?.length, 6, 'six explicit channels');
  equal(clock.channels?.map(c => c.name), ['hour', 'minute', 'second', 'day', 'month', 'year'], 'all six names');
});

test('lcd_display format refs are validated against sensors and parameters', () => {
  // Valid: references declared RTC channels
  const project = parse(`${HEAD}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    clock: {type: ds3231, bus: i2c_bus}
    screen: {type: lcd_i2c, bus: i2c_bus, address: 0x27, cols: 16, rows: 2}
actions:
  read_clock: {driver: rtc_read, params: {device: clock}}
  show_time:  {driver: lcd_display, params: {device: screen, row: 0, format: "{hour}:{minute}:{second}"}}
machine: {states: {idle: {}}, transitions: []}
`);
  equal(project.system.components!.find(c => c.name === 'clock')!.channels!.length, 3, 'clock has channels');
});

test('lcd_display format with unknown ref is rejected', () => {
  expectReject(`${HEAD}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    clock: {type: ds3231, bus: i2c_bus}
    screen: {type: lcd_i2c, bus: i2c_bus, address: 0x27, cols: 16, rows: 2}
actions:
  show_time: {driver: lcd_display, params: {device: screen, row: 0, format: "{typo}"}}
machine: {states: {idle: {}}, transitions: []}
`, 'not a declared parameter or sensor', 'typo in lcd format rejected');
});

test('lcd_display multi-line form validates each line format string', () => {
  expectReject(`${HEAD}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    clock: {type: ds3231, bus: i2c_bus}
    screen: {type: lcd_i2c, bus: i2c_bus, address: 0x27, cols: 16, rows: 2}
actions:
  show_all:
    driver: lcd_display
    params:
      device: screen
      lines:
        - "{hour}:{minute}:{second}"
        - {row: 1, col: 0, format: "{bad_ref}"}
machine: {states: {idle: {}}, transitions: []}
`, 'not a declared parameter or sensor', 'bad ref in multi-line lcd format rejected');
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} schema test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Schema tests passed!');
