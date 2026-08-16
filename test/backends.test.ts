/**
 * Backend codegen tests: ESP-IDF and MicroPython.
 *
 * These tests parse inline YAML models, run the appropriate code generator,
 * and assert that key structural patterns appear (or don't appear) in the
 * output. No compilation is attempted — correctness of the generated syntax is
 * covered by the compile.test.ts harness; here we care about which constructs
 * each backend emits.
 */

import { Parser } from '../src/parser/index.js';
import { Codegen } from '../src/codegen/index.js';
import { EspIdfBackend } from '../src/codegen/espidf.js';
import { MicroPythonCodegen } from '../src/codegen/micropython.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function has(code: string, pattern: string): void {
  assert(code.includes(pattern), `expected to find: ${JSON.stringify(pattern)}`);
}

function hasNot(code: string, pattern: string): void {
  assert(!code.includes(pattern), `expected NOT to find: ${JSON.stringify(pattern)}`);
}

// ---------------------------------------------------------------------------
// Inline YAML fixtures
// ---------------------------------------------------------------------------

const BLINK_YAML = `
pulseir: "1"
project:
  name: blink
  version: "1.0"

hardware:
  devices:
    led: { type: digital_output, pin: GPIO2 }

parameters:
  blink_ms: { type: int, default: 500, range: [50, 10000], unit: ms }

tasks:
  blink:
    every: blink_ms
    do: toggle_led
`;

// A two-state signal model with a timed cycle plus an external event.
const SIGNAL_YAML = `
pulseir: "1"
project:
  name: signal
  version: "1.0"

hardware:
  devices:
    lamp_red:   { type: digital_output, pin: GPIO25 }
    lamp_green: { type: digital_output, pin: GPIO27 }

parameters:
  green_ms: { type: int, default: 20000, range: [5000, 120000], unit: ms }
  red_ms:   { type: int, default: 15000, range: [5000, 120000], unit: ms }

events:
  FLASH: { source: external }

actions:
  show_green: { driver: gpio_control, params: {device: lamp_green, value: HIGH} }
  show_red:   { driver: gpio_control, params: {device: lamp_red,   value: HIGH} }
  all_off:    { driver: gpio_control, params: {devices: [lamp_red, lamp_green], value: LOW} }
  toggle_red: { driver: gpio_control, params: {device: lamp_red, value: TOGGLE} }

machine:
  states:
    green:
    red:
  transitions:
    - from: green
      after: green_ms
      to: red
      do: [all_off, show_red]
    - from: red
      after: red_ms
      to: green
      do: [all_off, show_green]
    - from: red
      on: FLASH
      to: red
      do: toggle_red
`;

// A model with composite states to exercise hierarchical dispatch.
const HIERARCHICAL_YAML = `
pulseir: "1"
project:
  name: hier
  version: "1.0"

hardware:
  devices:
    led: { type: digital_output, pin: GPIO2 }

events:
  GO:   { source: external }
  STOP: { source: external }

machine:
  states:
    idle:
    running:
      initial: active
      states:
        active:
        paused:
  transitions:
    - from: idle
      on: GO
      to: running
    - from: running
      on: STOP
      to: idle
    - from: running/active
      on: GO
      to: running/paused
`;

const parse = (yaml: string) => new Parser().parse(yaml);

// ---------------------------------------------------------------------------
// ESP-IDF backend — tasks-only model
// ---------------------------------------------------------------------------

console.log('\n⚡ Testing ESP-IDF backend...\n');

test('ESP-IDF: entry point is app_main, not setup/loop', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(BLINK_YAML));
  has(code, 'void app_main(void)');
  hasNot(code, 'void setup()');
  hasNot(code, 'void loop()');
});

test('ESP-IDF: app_main contains a FreeRTOS for(;;) loop', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(BLINK_YAML));
  has(code, 'for (;;)');
  has(code, 'vTaskDelay(pdMS_TO_TICKS(1))');
});

test('ESP-IDF: setup is a static helper called once from app_main', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(BLINK_YAML));
  has(code, 'static void _setup()');
  has(code, '_setup()');
});

test('ESP-IDF: timing uses esp_timer_get_time() divided to milliseconds', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(BLINK_YAML));
  has(code, 'esp_timer_get_time() / 1000LL');
});

test('ESP-IDF: includes FreeRTOS and ESP-IDF driver headers', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(BLINK_YAML));
  has(code, '#include "freertos/FreeRTOS.h"');
  has(code, '#include "esp_timer.h"');
  has(code, '#include "driver/gpio.h"');
});

test('ESP-IDF: GPIO write uses gpio_set_level with gpio_num_t cast', () => {
  // gpio_set_level is only emitted for gpio_control actions; use the signal
  // model which has show_green / show_red / all_off actions.
  const code = new Codegen(new EspIdfBackend()).generate(parse(SIGNAL_YAML));
  has(code, 'gpio_set_level((gpio_num_t)');
});

test('ESP-IDF: tasks-only model does not include PulseHSM', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(BLINK_YAML));
  hasNot(code, '#include "PulseHSM.h"');
  hasNot(code, 'PULSEHSM_MAX_STATES');
});

test('ESP-IDF: provides pulseIrPrint helper for console output', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(BLINK_YAML));
  has(code, 'static inline void pulseIrPrint(');
  has(code, 'static inline void pulseIrPrintln(');
});

// ---------------------------------------------------------------------------
// ESP-IDF backend — state machine model
// ---------------------------------------------------------------------------

test('ESP-IDF: state machine model includes PulseHSM and sizing macros', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(SIGNAL_YAML));
  has(code, '#include "PulseHSM.h"');
  has(code, 'PULSEHSM_MAX_STATES');
  has(code, 'PULSEHSM_MAX_EVENTS');
  has(code, 'PULSEHSM_MAX_DEPTH');
});

test('ESP-IDF: sizing macros appear before IDF headers', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(SIGNAL_YAML));
  const sizingPos = code.indexOf('PULSEHSM_MAX_STATES');
  const idfPos    = code.indexOf('#include "freertos/FreeRTOS.h"');
  assert(sizingPos < idfPos, 'PULSEHSM_MAX_STATES must appear before the IDF headers');
});

test('ESP-IDF: GPIO read uses gpio_get_level with gpio_num_t cast', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(SIGNAL_YAML));
  has(code, 'gpio_get_level((gpio_num_t)');
});

test('ESP-IDF: state machine model still has app_main + for(;;)', () => {
  const code = new Codegen(new EspIdfBackend()).generate(parse(SIGNAL_YAML));
  has(code, 'void app_main(void)');
  has(code, 'for (;;)');
  has(code, 'vTaskDelay(pdMS_TO_TICKS(1))');
});

// ---------------------------------------------------------------------------
// MicroPython backend — tasks-only model
// ---------------------------------------------------------------------------

console.log('\n🐍 Testing MicroPython backend...\n');

test('MicroPython blink: imports machine and utime', () => {
  const code = new MicroPythonCodegen().generate(parse(BLINK_YAML));
  has(code, 'import machine');
  has(code, 'import utime');
});

test('MicroPython blink: LED pin is configured as output', () => {
  const code = new MicroPythonCodegen().generate(parse(BLINK_YAML));
  has(code, 'machine.Pin(2, machine.Pin.OUT)');
});

test('MicroPython blink: parameter constant uses UPPER_SNAKE_CASE', () => {
  const code = new MicroPythonCodegen().generate(parse(BLINK_YAML));
  has(code, 'BLINK_MS = 500');
});

test('MicroPython blink: main loop is while True', () => {
  const code = new MicroPythonCodegen().generate(parse(BLINK_YAML));
  has(code, 'while True:');
});

test('MicroPython blink: task action stub is present', () => {
  // Actions are generated as action_<name>() functions; the task invokes it.
  const code = new MicroPythonCodegen().generate(parse(BLINK_YAML));
  has(code, 'def action_toggle_led(');
});

test('MicroPython blink: no _HSM class (no state machine)', () => {
  const code = new MicroPythonCodegen().generate(parse(BLINK_YAML));
  hasNot(code, 'class _HSM');
  hasNot(code, '_ENTRY');
  hasNot(code, '_dispatch');
});

test('MicroPython blink: task timing uses utime.ticks functions', () => {
  const code = new MicroPythonCodegen().generate(parse(BLINK_YAML));
  has(code, 'utime.ticks_ms()');
  has(code, 'utime.ticks_diff(');
});

// ---------------------------------------------------------------------------
// MicroPython backend — state machine model
// ---------------------------------------------------------------------------

test('MicroPython signal: emits _HSM class', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, 'class _HSM:');
  has(code, 'def post(self, event)');
  has(code, 'def transition(self, next_state');
  has(code, 'def elapsed(self)');
  has(code, 'def step(self)');
});

test('MicroPython signal: emits _ENTRY dict for composite-state initial resolution', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  // signal has only leaf states, so _ENTRY should be empty or absent for leaf-only
  // (leaf states need no entry in the map; the dict still gets emitted)
  has(code, '_ENTRY = {');
});

test('MicroPython signal: emits _resolve_leaf function', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, 'def _resolve_leaf(');
});

test('MicroPython signal: emits _dispatch and _check_timers', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, 'def _dispatch(');
  has(code, 'def _check_timers(');
});

test('MicroPython signal: parameter constants in UPPER_SNAKE_CASE', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, 'GREEN_MS = 20000');
  has(code, 'RED_MS = 15000');
});

test('MicroPython signal: GPIO HIGH action emits .value(1)', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, '.value(1)');
});

test('MicroPython signal: GPIO LOW action emits .value(0)', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, '.value(0)');
});

test('MicroPython signal: GPIO TOGGLE action emits .value(not .value())', () => {
  // The codegen uses the named pin variable directly, not a _pins[] lookup.
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, '.value(not ');
});

test('MicroPython signal: HSM initialised on the first leaf state', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, "_hsm = _HSM('green')");
});

test('MicroPython signal: timed transitions use _check_timers', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  // After GREEN_MS ms in green → transition to red
  has(code, 'GREEN_MS');
  has(code, '_hsm.transition(');
});

test('MicroPython signal: event names are string literals in _dispatch', () => {
  const code = new MicroPythonCodegen().generate(parse(SIGNAL_YAML));
  has(code, "'FLASH'");
});

// ---------------------------------------------------------------------------
// MicroPython backend — hierarchical state machine
// ---------------------------------------------------------------------------

test('MicroPython hierarchical: _ENTRY maps composite state to its initial leaf', () => {
  const code = new MicroPythonCodegen().generate(parse(HIERARCHICAL_YAML));
  has(code, "'running': 'running/active'");
});

test('MicroPython hierarchical: composite ancestor handled with in_state()', () => {
  const code = new MicroPythonCodegen().generate(parse(HIERARCHICAL_YAML));
  has(code, "_hsm.in_state('running')");
});

test('MicroPython hierarchical: HSM initialised on idle (first leaf in declaration order)', () => {
  const code = new MicroPythonCodegen().generate(parse(HIERARCHICAL_YAML));
  has(code, "_hsm = _HSM('idle')");
});

// ---------------------------------------------------------------------------
// MicroPython generateFiles()
// ---------------------------------------------------------------------------

test('MicroPython generateFiles: needsRuntime is false', () => {
  const result = new MicroPythonCodegen().generateFiles(parse(BLINK_YAML));
  assert(result.needsRuntime === false, 'needsRuntime should be false');
});

test('MicroPython generateFiles: generates exactly one file named main.py', () => {
  const result = new MicroPythonCodegen().generateFiles(parse(BLINK_YAML));
  assert(result.generated.length === 1, `expected 1 generated file, got ${result.generated.length}`);
  assert(result.generated[0].path === 'main.py', `expected path main.py, got ${result.generated[0].path}`);
});

test('MicroPython generateFiles: no scaffold files', () => {
  const result = new MicroPythonCodegen().generateFiles(parse(BLINK_YAML));
  assert(result.scaffolds.length === 0, `expected 0 scaffold files, got ${result.scaffolds.length}`);
});

test('MicroPython generateFiles: generated main.py contents match generate()', () => {
  const project = parse(BLINK_YAML);
  const mp = new MicroPythonCodegen();
  const single = mp.generate(project);
  const files  = mp.generateFiles(project);
  assert(files.generated[0].contents === single, 'generateFiles contents differ from generate()');
});

// ---------------------------------------------------------------------------
// ENTRY AND EXIT ACTIONS
// ---------------------------------------------------------------------------

const ENTRY_EXIT_YAML = `
pulseir: "1"
project:
  name: entry_exit
  version: "1.0"
events:
  GO:   {source: external}
  STOP: {source: external}
actions:
  turn_on:  {driver: gpio_control}
  turn_off: {driver: gpio_control}
machine:
  states:
    idle:
      exit: turn_off
    running:
      entry: turn_on
  transitions:
    - {from: idle,    on: GO,   to: running}
    - {from: running, on: STOP, to: idle}
`;

const TIMED_WITH_ENTRY_YAML = `
pulseir: "1"
project:
  name: timed_entry
  version: "1.0"
events:
  RESET: {source: external}
actions:
  start_motor: {driver: gpio_control}
machine:
  states:
    warming:
      entry: start_motor
    ready:
  transitions:
    - {from: warming, after: 3000, to: ready}
    - {from: ready, on: RESET, to: warming}
`;

test('entry action generates on_enter_<state> function', () => {
  const code = new Codegen().generate(parse(ENTRY_EXIT_YAML));
  has(code, 'static void on_enter_running()');
  has(code, 'action_turn_on(&systemContext)');
});

test('exit action generates on_exit_<state> function', () => {
  const code = new Codegen().generate(parse(ENTRY_EXIT_YAML));
  has(code, 'static void on_exit_idle()');
  has(code, 'action_turn_off(&systemContext)');
});

test('entry callback is passed to addState()', () => {
  const code = new Codegen().generate(parse(ENTRY_EXIT_YAML));
  has(code, 'on_enter_running');
  // The addState registration should wire it in, not nullptr
  const setupRegion = code.slice(code.indexOf('fsm.addState'));
  has(setupRegion, 'on_enter_running');
});

test('exit callback is passed to addState()', () => {
  const code = new Codegen().generate(parse(ENTRY_EXIT_YAML));
  const setupRegion = code.slice(code.indexOf('fsm.addState'));
  has(setupRegion, 'on_exit_idle');
});

test('state with no entry/exit uses nullptr for both slots', () => {
  const code = new Codegen().generate(parse(ENTRY_EXIT_YAML));
  // "running" has no exit, "idle" has no entry — each addState should still
  // compile; we verify the callbacks are not invented for the wrong state.
  hasNot(code, 'on_enter_idle');
  hasNot(code, 'on_exit_running');
});

test('entry callback calls syncContext() first', () => {
  const code = new Codegen().generate(parse(ENTRY_EXIT_YAML));
  const fnStart = code.indexOf('static void on_enter_running()');
  const fnEnd   = code.indexOf('}', fnStart);
  const body    = code.slice(fnStart, fnEnd);
  const syncPos  = body.indexOf('syncContext()');
  const actionPos = body.indexOf('action_turn_on');
  assert(syncPos !== -1,   'syncContext() not found in entry callback');
  assert(actionPos !== -1, 'action not found in entry callback');
  assert(syncPos < actionPos, 'syncContext() must precede the action call');
});

test('timed state with entry action: single combined on_enter function', () => {
  const code = new Codegen().generate(parse(TIMED_WITH_ENTRY_YAML));
  // Must have one on_enter that stamps the clock AND calls the action.
  has(code, 'static void on_enter_warming()');
  has(code, 'action_start_motor(&systemContext)');
  has(code, 'enteredAt_warming');
  // The old separate enter_<base> naming must not appear.
  hasNot(code, 'static void enter_warming()');
});

test('timed state with entry action: clock stamp appears after actions', () => {
  const code = new Codegen().generate(parse(TIMED_WITH_ENTRY_YAML));
  const fnStart  = code.indexOf('static void on_enter_warming()');
  const fnEnd    = code.indexOf('}', fnStart);
  const body     = code.slice(fnStart, fnEnd);
  const actionPos = body.indexOf('action_start_motor');
  const stampPos  = body.indexOf('enteredAt_warming');
  assert(actionPos !== -1, 'action not found');
  assert(stampPos  !== -1, 'timer stamp not found');
  assert(actionPos < stampPos, 'entry action must run before the timer stamp');
});

test('state without entry/exit: no spurious on_enter or on_exit generated', () => {
  const code = new Codegen().generate(parse(BLINK_YAML));
  hasNot(code, 'on_enter_');
  hasNot(code, 'on_exit_');
});

// ---------------------------------------------------------------------------
// SENSOR CONVERSION EXPRESSIONS
// ---------------------------------------------------------------------------

const CONVERSION_YAML = `
pulseir: "1"
project:
  name: lm35_test
  version: "1.0"
actions:
  noop: {driver: logger}
hardware:
  devices:
    temp:
      type: analog_input
      pin: GPIO34
      unit: degC
      conversion: "analogRead({pin}) * (3.3 / 4095.0) * 100.0"
    raw_soil:
      type: analog_input
      pin: GPIO35
tasks:
  heartbeat: { every: 500, do: noop }
`;

// Same model but with explicit adc_read actions so the action stubs are generated.
const CONVERSION_ACTION_YAML = `
pulseir: "1"
project:
  name: lm35_action_test
  version: "1.0"
actions:
  read_temp:     { driver: adc_read,  params: { device: temp } }
  read_raw_soil: { driver: adc_read,  params: { device: raw_soil } }
hardware:
  devices:
    temp:
      type: analog_input
      pin: GPIO34
      unit: degC
      conversion: "analogRead({pin}) * (3.3 / 4095.0) * 100.0"
    raw_soil:
      type: analog_input
      pin: GPIO35
tasks:
  heartbeat:  { every: 500,  do: read_temp }
  soil_check: { every: 1000, do: read_raw_soil }
`;

test('conversion: substitutes {pin} with the pin macro', () => {
  const code = new Codegen().generate(parse(CONVERSION_YAML));
  has(code, 'analogRead(TEMP_PIN) * (3.3 / 4095.0) * 100.0');
  hasNot(code, 'analogRead({pin})');
});

test('conversion: wraps expression in (float)(...) cast', () => {
  const code = new Codegen().generate(parse(CONVERSION_YAML));
  has(code, 'systemSensors.temp = (float)(analogRead(TEMP_PIN) * (3.3 / 4095.0) * 100.0)');
});

test('conversion: appends unit as a comment on the read line', () => {
  const code = new Codegen().generate(parse(CONVERSION_YAML));
  has(code, '// degC');
});

test('sensor without conversion: still uses analogRead(PIN) directly', () => {
  const code = new Codegen().generate(parse(CONVERSION_YAML));
  has(code, 'systemSensors.raw_soil = analogRead(RAW_SOIL_PIN)');
});

test('unit in sensor struct shows as a comment', () => {
  const code = new Codegen().generate(parse(CONVERSION_YAML));
  has(code, 'float temp;  // driver: adc_read, unit: degC');
});

test('sensor without unit has no unit comment in struct', () => {
  const code = new Codegen().generate(parse(CONVERSION_YAML));
  has(code, 'float raw_soil;  // driver: adc_read\n');
});

test('conversion: adc_read action stub uses formula, not raw analogRead', () => {
  const code = new Codegen().generate(parse(CONVERSION_ACTION_YAML));
  // The action stub body must apply the same conversion as readSensors()
  has(code, 'systemSensors.temp = (float)(analogRead(TEMP_PIN) * (3.3 / 4095.0) * 100.0);\n  (void)ctx;');
});

test('adc_read action stub without conversion uses plain analogRead', () => {
  const code = new Codegen().generate(parse(CONVERSION_ACTION_YAML));
  has(code, 'systemSensors.raw_soil = analogRead(RAW_SOIL_PIN);\n  (void)ctx;');
});

// ---------------------------------------------------------------------------
// Bus sensor tests: DS18B20, DHT22, BME280
// ---------------------------------------------------------------------------

const DS18B20_YAML = `
pulseir: "1"
project:
  name: ds18b20_test
  version: "1.0"

hardware:
  buses:
    probe_bus: { interface: onewire, pin: GPIO4 }
  devices:
    water_temp:
      type: ds18b20
      bus: probe_bus
      unit: degC

actions:
  read_temp: { driver: ds18b20, params: { device: water_temp } }

tasks:
  poll: { every: 2000, do: read_temp }
`;

const DHT22_YAML = `
pulseir: "1"
project:
  name: dht22_test
  version: "1.0"

hardware:
  devices:
    air_temp:
      type: dht22
      pin: GPIO4
      measure: temperature
      unit: degC
    air_rh:
      type: dht22
      pin: GPIO5
      measure: humidity
      unit: percent

actions:
  read_temp: { driver: dht22, params: { device: air_temp } }
  read_rh:   { driver: dht22, params: { device: air_rh } }

tasks:
  poll: { every: 2000, do: [read_temp, read_rh] }
`;

const BME280_YAML = `
pulseir: "1"
project:
  name: bme280_test
  version: "1.0"

hardware:
  buses:
    sensor_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    air_temp:
      type: bme280
      bus: sensor_bus
      address: 0x76
      measure: temperature
      unit: degC
    air_pressure:
      type: bme280
      bus: sensor_bus
      address: 0x76
      measure: pressure
      unit: hPa

actions:
  read_temp:     { driver: bme280, params: { device: air_temp } }
  read_pressure: { driver: bme280, params: { device: air_pressure } }

tasks:
  poll: { every: 2000, do: [read_temp, read_pressure] }
`;

test('ds18b20: includes DallasTemperature library', () => {
  const code = new Codegen().generate(parse(DS18B20_YAML));
  has(code, '#include <DallasTemperature.h>');
});

test('ds18b20: includes OneWire library (from bus)', () => {
  const code = new Codegen().generate(parse(DS18B20_YAML));
  has(code, '#include <OneWire.h>');
});

test('ds18b20: declares object using bus reference', () => {
  const code = new Codegen().generate(parse(DS18B20_YAML));
  has(code, 'DallasTemperature water_temp(&probeBus);');
});

test('ds18b20: calls begin() in setupInterfaces()', () => {
  const code = new Codegen().generate(parse(DS18B20_YAML));
  has(code, 'water_temp.begin();');
});

test('ds18b20: action stub calls requestTemperatures and getTempCByIndex', () => {
  const code = new Codegen().generate(parse(DS18B20_YAML));
  has(code, 'water_temp.requestTemperatures();');
  has(code, 'systemSensors.water_temp = water_temp.getTempCByIndex(0);');
});

test('ds18b20: has Requires comment', () => {
  const code = new Codegen().generate(parse(DS18B20_YAML));
  has(code, 'Requires: DallasTemperature');
});

test('dht22: includes DHT library', () => {
  const code = new Codegen().generate(parse(DHT22_YAML));
  has(code, '#include <DHT.h>');
});

test('dht22: declares object with pin macro and DHT22 type', () => {
  const code = new Codegen().generate(parse(DHT22_YAML));
  has(code, 'DHT air_temp(AIR_TEMP_PIN, DHT22);');
  has(code, '#define AIR_TEMP_PIN');
});

test('dht22: temperature action calls readTemperature', () => {
  const code = new Codegen().generate(parse(DHT22_YAML));
  has(code, 'systemSensors.air_temp = air_temp.readTemperature();');
});

test('dht22: humidity action calls readHumidity', () => {
  const code = new Codegen().generate(parse(DHT22_YAML));
  has(code, 'systemSensors.air_rh = air_rh.readHumidity();');
});

test('bme280: includes Adafruit_BME280 library', () => {
  const code = new Codegen().generate(parse(BME280_YAML));
  has(code, '#include <Adafruit_BME280.h>');
});

test('bme280: declares object and calls begin with address', () => {
  const code = new Codegen().generate(parse(BME280_YAML));
  has(code, 'Adafruit_BME280 air_temp;');
  has(code, 'air_temp.begin(0x76);');
});

test('bme280: temperature action calls readTemperature', () => {
  const code = new Codegen().generate(parse(BME280_YAML));
  has(code, 'systemSensors.air_temp = air_temp.readTemperature();');
});

test('bme280: pressure action calls readPressure and converts to hPa', () => {
  const code = new Codegen().generate(parse(BME280_YAML));
  has(code, 'systemSensors.air_pressure = air_pressure.readPressure() / 100.0F;');
});

// ---------------------------------------------------------------------------
// Gap 2: Interrupt / ISR wiring
// ---------------------------------------------------------------------------

const INTERRUPT_YAML = `
pulseir: "1"
project:
  name: interrupt_test
  version: "1.0"

hardware:
  devices:
    button:
      type: digital_input
      pin: GPIO2
      interrupt: FALLING
      raises: button_pressed

events:
  button_pressed: { source: external }

actions:
  on_press: { driver: gpio_control, params: { device: button, value: LOW } }

machine:
  states:
    idle:
    active:
  transitions:
    - from: idle
      on: button_pressed
      to: active
    - from: active
      on: button_pressed
      to: idle
`;

console.log('\n⚡ Testing Gap 2: Interrupt / ISR wiring...\n');

test('interrupt: generates IRAM_ATTR ISR function', () => {
  const code = new Codegen().generate(parse(INTERRUPT_YAML));
  has(code, 'void IRAM_ATTR isr_button()');
});

test('interrupt: ISR dispatches the declared event to the FSM', () => {
  const code = new Codegen().generate(parse(INTERRUPT_YAML));
  has(code, 'fsm.sendEvent(EVENT_BUTTON_PRESSED)');
});

test('interrupt: generates attachInterrupt call with mode FALLING', () => {
  const code = new Codegen().generate(parse(INTERRUPT_YAML));
  has(code, 'attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), isr_button, FALLING)');
});

test('interrupt: IRAM_ATTR guard is emitted once (non-ESP32 compat)', () => {
  const code = new Codegen().generate(parse(INTERRUPT_YAML));
  has(code, '#ifndef IRAM_ATTR');
});

test('interrupt: interrupt and raises keys are not emitted as #define macros', () => {
  const code = new Codegen().generate(parse(INTERRUPT_YAML));
  hasNot(code, '#define BUTTON_INTERRUPT');
  hasNot(code, '#define BUTTON_RAISES');
});

// ---------------------------------------------------------------------------
// Gap 3: Display support — LCD I2C, OLED I2C, DS3231 RTC
// ---------------------------------------------------------------------------

const LCD_YAML = `
pulseir: "1"
project:
  name: lcd_test
  version: "1.0"

hardware:
  buses:
    i2c_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    display:
      type: lcd_i2c
      bus: i2c_bus
      address: 0x27
      cols: 16
      rows: 2

actions:
  show_status: { driver: lcd_print, params: { device: display, row: 0, col: 0 } }
  clear_screen: { driver: lcd_clear, params: { device: display } }

tasks:
  update_display: { every: 1000, do: [clear_screen, show_status] }
`;

const OLED_YAML = `
pulseir: "1"
project:
  name: oled_test
  version: "1.0"

hardware:
  buses:
    i2c_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    screen:
      type: oled_i2c
      bus: i2c_bus
      address: 0x3C
      width: 128
      height: 64

actions:
  draw_status: { driver: oled_print, params: { device: screen, x: 0, y: 0, size: 1 } }

tasks:
  refresh: { every: 500, do: draw_status }
`;

const DS3231_YAML = `
pulseir: "1"
project:
  name: rtc_test
  version: "1.0"

hardware:
  buses:
    i2c_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    clock:
      type: ds3231
      bus: i2c_bus

actions:
  read_time: { driver: rtc_read, params: { device: clock } }

tasks:
  tick: { every: 1000, do: read_time }
`;

console.log('\n⚡ Testing Gap 3: Display support + RTC...\n');

test('lcd_i2c: includes LiquidCrystal_I2C library', () => {
  const code = new Codegen().generate(parse(LCD_YAML));
  has(code, '#include <LiquidCrystal_I2C.h>');
});

test('lcd_i2c: declares object with address, cols and rows in constructor', () => {
  const code = new Codegen().generate(parse(LCD_YAML));
  has(code, 'LiquidCrystal_I2C display(0x27, 16, 2);');
});

test('lcd_i2c: calls init() and backlight() in setupInterfaces()', () => {
  const code = new Codegen().generate(parse(LCD_YAML));
  has(code, 'display.init();');
  has(code, 'display.backlight();');
});

test('lcd_i2c: lcd_print action stub calls setCursor', () => {
  const code = new Codegen().generate(parse(LCD_YAML));
  has(code, 'display.setCursor(0, 0);');
});

test('lcd_i2c: lcd_clear action stub calls clear()', () => {
  const code = new Codegen().generate(parse(LCD_YAML));
  has(code, 'display.clear();');
});

test('lcd_i2c: has Requires comment', () => {
  const code = new Codegen().generate(parse(LCD_YAML));
  has(code, 'Requires: LiquidCrystal_I2C');
});

test('oled_i2c: includes Adafruit_SSD1306 library', () => {
  const code = new Codegen().generate(parse(OLED_YAML));
  has(code, '#include <Adafruit_SSD1306.h>');
});

test('oled_i2c: declares object with width, height, Wire and reset in constructor', () => {
  const code = new Codegen().generate(parse(OLED_YAML));
  has(code, 'Adafruit_SSD1306 screen(128, 64, &Wire, -1);');
});

test('oled_i2c: calls begin with SSD1306_SWITCHCAPVCC and address', () => {
  const code = new Codegen().generate(parse(OLED_YAML));
  has(code, 'screen.begin(SSD1306_SWITCHCAPVCC, 0x3C);');
});

test('oled_i2c: oled_print action stub emits clearDisplay, setCursor and display()', () => {
  const code = new Codegen().generate(parse(OLED_YAML));
  has(code, 'screen.clearDisplay();');
  has(code, 'screen.setCursor(0, 0);');
  has(code, 'screen.display();');
});

test('ds3231: includes RTClib library', () => {
  const code = new Codegen().generate(parse(DS3231_YAML));
  has(code, '#include <RTClib.h>');
});

test('ds3231: declares RTC_DS3231 object with no constructor args', () => {
  const code = new Codegen().generate(parse(DS3231_YAML));
  has(code, 'RTC_DS3231 clock;');
});

test('ds3231: calls begin() in setupInterfaces()', () => {
  const code = new Codegen().generate(parse(DS3231_YAML));
  has(code, 'clock.begin();');
});

test('ds3231: rtc_read action stub generates commented DateTime example', () => {
  const code = new Codegen().generate(parse(DS3231_YAML));
  has(code, '// DateTime now = clock.now();');
});

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n❌ ${failures} backend test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Backend tests passed!');
