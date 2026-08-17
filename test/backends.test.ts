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
import { ZephyrBackend } from '../src/codegen/zephyr.js';
import { ZephyrProjectEmitter } from '../src/emit/zephyr_project.js';
import { CmakeEmitter } from '../src/emit/cmake.js';

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
// Multi-channel sensor devices
// ---------------------------------------------------------------------------

const DHT22_CHANNELS_YAML = `
pulseir: "1"
project:
  name: dht22_channels_test
  version: "1.0"

hardware:
  devices:
    weather:
      type: dht22
      pin: GPIO4
      channels:
        - temperature
        - humidity

actions:
  read_weather: { driver: dht22, params: { device: weather } }

tasks:
  poll: { every: 2000, do: read_weather }
`;

const BME280_CHANNELS_YAML = `
pulseir: "1"
project:
  name: bme280_channels_test
  version: "1.0"

hardware:
  buses:
    sensor_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    env:
      type: bme280
      bus: sensor_bus
      address: 0x76
      channels:
        temperature:
        humidity:
        pressure:

actions:
  read_env: { driver: bme280, params: { device: env } }

tasks:
  poll: { every: 5000, do: read_env }
`;

test('dht22 channels: generates one DHT object (not two)', () => {
  const code = new Codegen().generate(parse(DHT22_CHANNELS_YAML));
  const matches = [...code.matchAll(/DHT weather\(/g)];
  assert(matches.length === 1, `expected exactly one DHT weather object, got ${matches.length}`);
});

test('dht22 channels: sensor struct has temperature and humidity fields, not device name', () => {
  const code = new Codegen().generate(parse(DHT22_CHANNELS_YAML));
  has(code, 'float temperature;');
  has(code, 'float humidity;');
  hasNot(code, 'float weather;');
});

test('dht22 channels: action reads both channels in one call', () => {
  const code = new Codegen().generate(parse(DHT22_CHANNELS_YAML));
  has(code, 'systemSensors.temperature = weather.readTemperature();');
  has(code, 'systemSensors.humidity = weather.readHumidity();');
});

test('bme280 channels: sensor struct has three fields, not device name', () => {
  const code = new Codegen().generate(parse(BME280_CHANNELS_YAML));
  has(code, 'float temperature;');
  has(code, 'float humidity;');
  has(code, 'float pressure;');
  hasNot(code, 'float env;');
});

test('bme280 channels: action reads all three channels', () => {
  const code = new Codegen().generate(parse(BME280_CHANNELS_YAML));
  has(code, 'systemSensors.temperature = env.readTemperature();');
  has(code, 'systemSensors.humidity = env.readHumidity();');
  has(code, 'systemSensors.pressure = env.readPressure() / 100.0F;');
});

// ---------------------------------------------------------------------------
// RTC + LCD display pipeline
// ---------------------------------------------------------------------------

const RTC_LCD_YAML = `
pulseir: "1"
project: {name: clock_display, version: "1.0"}
target: {board: esp32}
events: {TICK: {source: timer}}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    clock: {type: ds3231, bus: i2c_bus}
    screen: {type: lcd_i2c, bus: i2c_bus, address: 0x27, cols: 16, rows: 2}
actions:
  read_clock: {driver: rtc_read, params: {device: clock}}
  show_time:
    driver: lcd_display
    params:
      device: screen
      row: 0
      col: 0
      format: "{hour}:{minute}:{second}"
tasks:
  clock_task:
    every: 1000
    do: [read_clock, show_time]
machine: {states: {idle: {}}, transitions: []}
`;

const RTC_LCD_MULTILINE_YAML = `
pulseir: "1"
project: {name: clock_temp, version: "1.0"}
target: {board: esp32}
events: {TICK: {source: timer}}
hardware:
  buses:
    i2c_bus: {interface: i2c, sda: GPIO21, scl: GPIO22}
  devices:
    clock: {type: ds3231, bus: i2c_bus}
    env:
      type: bme280
      bus: i2c_bus
      channels: [temperature]
    screen: {type: lcd_i2c, bus: i2c_bus, address: 0x27, cols: 16, rows: 2}
actions:
  read_clock: {driver: rtc_read, params: {device: clock}}
  read_env:   {driver: bme280,   params: {device: env}}
  show_all:
    driver: lcd_display
    params:
      device: screen
      clear: true
      lines:
        - "{hour}:{minute}:{second}"
        - {row: 1, col: 0, format: "T={temperature}C"}
tasks:
  display_task:
    every: 1000
    do: [read_clock, read_env, show_all]
machine: {states: {idle: {}}, transitions: []}
`;

test('RTC: ds3231 auto-populates hour/minute/second channels', () => {
  const project = parse(RTC_LCD_YAML);
  const clock = project.system.components!.find(c => c.name === 'clock')!;
  const code  = new Codegen().generate(project);
  has(code, 'float hour;');
  has(code, 'float minute;');
  has(code, 'float second;');
  hasNot(code, 'float clock;');
});

test('RTC: rtc_read action generates real RTClib code', () => {
  const code = new Codegen().generate(parse(RTC_LCD_YAML));
  has(code, 'DateTime _now = clock.now();');
  has(code, 'systemSensors.hour = (float)_now.hour();');
  has(code, 'systemSensors.minute = (float)_now.minute();');
  has(code, 'systemSensors.second = (float)_now.second();');
});

test('LCD display: single-line format emits display.print() chain with zero-padding', () => {
  const code = new Codegen().generate(parse(RTC_LCD_YAML));
  // RTC channels use zero-padded integer display.print — no snprintf needed
  has(code, "if ((int)systemSensors.hour < 10) screen.print('0');");
  has(code, 'screen.print((int)systemSensors.hour);');
  has(code, 'screen.print((int)systemSensors.minute);');
  has(code, 'screen.print((int)systemSensors.second);');
  has(code, 'screen.setCursor(0, 0);');
});

test('LCD display: multi-line with clear: true emits lcd.clear() + two writes', () => {
  const code = new Codegen().generate(parse(RTC_LCD_MULTILINE_YAML));
  has(code, 'screen.clear();');
  // Row 0: RTC time — zero-padded integer prints
  has(code, 'screen.print((int)systemSensors.hour);');
  // Row 1: temperature — display.print(float, decimals) works on AVR and ESP32
  has(code, 'screen.print(systemSensors.temperature, 1);');
  has(code, 'screen.setCursor(0, 0);');
  has(code, 'screen.setCursor(0, 1);');
});

test('LCD display: RTC channels zero-pad, float sensors use display.print(v, 1)', () => {
  const code = new Codegen().generate(parse(RTC_LCD_MULTILINE_YAML));
  // RTC values are integer-cast with leading-zero guard
  has(code, '(int)systemSensors.hour');
  // Sensor values use display.print(float, 1) — not (int) cast
  has(code, 'screen.print(systemSensors.temperature, 1);');
  hasNot(code, '(int)systemSensors.temperature');
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

test('ds3231: rtc_read action generates real RTClib code for auto-populated channels', () => {
  const code = new Codegen().generate(parse(DS3231_YAML));
  has(code, 'DateTime _now = clock.now();');
  has(code, 'systemSensors.hour = (float)_now.hour();');
  has(code, 'systemSensors.minute = (float)_now.minute();');
  has(code, 'systemSensors.second = (float)_now.second();');
});

// ---------------------------------------------------------------------------
// Gap 4 tests: Power management (sleep / wake)
// ---------------------------------------------------------------------------

const SLEEP_YAML = `
pulseir: "1"
project:
  name: sleep_test
  version: "1.0"

hardware:
  devices:
    btn: { type: digital_input, pin: GPIO0 }

events:
  wake_up: { source: external }

actions:
  go_to_sleep:
    driver: sleep_control
    params:
      mode: deep_sleep
      duration_ms: 10000
      wake_pin: GPIO0
      wake_level: 0

machine:
  states:
    sleeping:
      entry: go_to_sleep
    awake:
  transitions:
    - { from: sleeping, on: wake_up, to: awake }
    - { from: awake,    on: wake_up, to: sleeping }
`;

const LIGHT_SLEEP_YAML = `
pulseir: "1"
project:
  name: light_sleep_test
  version: "1.0"

hardware:
  devices:
    led: { type: digital_output, pin: GPIO2 }

actions:
  nap:
    driver: sleep_control
    params:
      mode: light_sleep
      duration_ms: 500

tasks:
  tick: { every: 1000, do: nap }
`;

console.log('\n⚡ Testing Gap 4: Power management (sleep / wake)...\n');

test('sleep_control: deep sleep emits esp_deep_sleep_start', () => {
  const code = new Codegen().generate(parse(SLEEP_YAML));
  has(code, 'esp_deep_sleep_start();');
});

test('sleep_control: timer wakeup uses duration_ms converted to microseconds', () => {
  const code = new Codegen().generate(parse(SLEEP_YAML));
  has(code, 'esp_sleep_enable_timer_wakeup(10000ULL * 1000ULL);');
});

test('sleep_control: GPIO wakeup emits esp_sleep_enable_ext0_wakeup', () => {
  const code = new Codegen().generate(parse(SLEEP_YAML));
  has(code, 'esp_sleep_enable_ext0_wakeup((gpio_num_t)GPIO0, 0);');
});

test('sleep_control: wrapped in #ifdef ARDUINO_ARCH_ESP32 guard', () => {
  const code = new Codegen().generate(parse(SLEEP_YAML));
  has(code, '#ifdef ARDUINO_ARCH_ESP32');
});

test('sleep_control: has fallback TODO for non-ESP32', () => {
  const code = new Codegen().generate(parse(SLEEP_YAML));
  has(code, "// TODO: sleep_control is ESP32-only");
});

test('sleep_control: light sleep emits esp_light_sleep_start', () => {
  const code = new Codegen().generate(parse(LIGHT_SLEEP_YAML));
  has(code, 'esp_light_sleep_start();');
});

test('sleep_control: light sleep does NOT emit deep sleep start', () => {
  const code = new Codegen().generate(parse(LIGHT_SLEEP_YAML));
  hasNot(code, 'esp_deep_sleep_start();');
});

// ---------------------------------------------------------------------------
// Gap 5 tests: HTTP client & OTA updates
// ---------------------------------------------------------------------------

const OTA_YAML = `
pulseir: "1"
project:
  name: ota_test
  version: "1.0"

hardware:
  buses:
    net: { interface: wifi, ssid: "MyNetwork" }
    updater: { interface: ota, hostname: "esp32-device", port: 3232 }
  devices:
    led: { type: digital_output, pin: GPIO2 }

tasks:
  heartbeat: { every: 1000, do: toggle_led }

actions:
  toggle_led: { driver: gpio_control, params: { device: led } }
`;

const HTTP_YAML = `
pulseir: "1"
project:
  name: http_test
  version: "1.0"

hardware:
  buses:
    net: { interface: wifi, ssid: "MyNetwork" }
  devices:
    led: { type: digital_output, pin: GPIO2 }

events:
  data_ready: { source: external }

actions:
  fetch_data:
    driver: http_get
    params:
      url: "http://api.example.com/sensor"
  send_data:
    driver: http_post
    params:
      url: "http://api.example.com/readings"
      body: '{"value":42}'
      content_type: "application/json"

tasks:
  poll: { every: 5000, do: fetch_data }

machine:
  states:
    idle:
    posting:
      entry: send_data
  transitions:
    - { from: idle,    on: data_ready, to: posting }
    - { from: posting, on: data_ready, to: idle }
`;

console.log('\n⚡ Testing Gap 5: HTTP client & OTA updates...\n');

test('ota: includes ArduinoOTA header', () => {
  const code = new Codegen().generate(parse(OTA_YAML));
  has(code, '#include <ArduinoOTA.h>');
});

test('ota: calls ArduinoOTA.setHostname in setupInterfaces', () => {
  const code = new Codegen().generate(parse(OTA_YAML));
  has(code, 'ArduinoOTA.setHostname("esp32-device");');
});

test('ota: calls ArduinoOTA.setPort in setupInterfaces', () => {
  const code = new Codegen().generate(parse(OTA_YAML));
  has(code, 'ArduinoOTA.setPort(3232);');
});

test('ota: calls ArduinoOTA.begin in setupInterfaces', () => {
  const code = new Codegen().generate(parse(OTA_YAML));
  has(code, 'ArduinoOTA.begin();');
});

test('ota: wraps init in ESP32/ESP8266 guard', () => {
  const code = new Codegen().generate(parse(OTA_YAML));
  has(code, '#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)');
});

test('ota: emits ArduinoOTA.handle() in loop()', () => {
  const code = new Codegen().generate(parse(OTA_YAML));
  has(code, 'ArduinoOTA.handle();');
});

test('ota: todo reminds user WiFi must be connected first', () => {
  const code = new Codegen().generate(parse(OTA_YAML));
  has(code, 'WiFi must be connected before ArduinoOTA.begin()');
});

test('http_get: emits HTTPClient.begin with url', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, 'http.begin("http://api.example.com/sensor");');
});

test('http_get: emits http.GET() call', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, 'int httpCode = http.GET();');
});

test('http_get: checks HTTP_CODE_OK', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, 'if (httpCode == HTTP_CODE_OK)');
});

test('http_get: calls http.end()', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, 'http.end();');
});

test('http_post: emits HTTPClient.begin with url', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, 'http.begin("http://api.example.com/readings");');
});

test('http_post: emits http.POST with body', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, `http.POST("{\\\"value\\\":42}");`);
});

test('http_post: sets Content-Type header', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, 'http.addHeader("Content-Type", "application/json");');
});

test('http_get/post: includes HTTPClient library header', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, '#include <HTTPClient.h>');
});

test('http_get: wrapped in ESP32/ESP8266 guard', () => {
  const code = new Codegen().generate(parse(HTTP_YAML));
  has(code, '#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)');
});

// ---------------------------------------------------------------------------
// Zephyr backend — tasks-only model
// ---------------------------------------------------------------------------

console.log('\n⚡ Testing Zephyr backend...\n');

test('Zephyr: entry point is int main(void) with while(1) + k_msleep(1)', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(BLINK_YAML));
  has(code, 'int main(void)');
  has(code, 'while (1) {');
  has(code, 'k_msleep(1)');
  hasNot(code, 'void setup()');
  hasNot(code, 'void loop()');
  hasNot(code, 'app_main');
  hasNot(code, 'for (;;)');
});

test('Zephyr: setup is a static helper called once from main', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(BLINK_YAML));
  has(code, 'static void _setup()');
  has(code, '_setup()');
});

test('Zephyr: timing uses k_uptime_get(), not millis() or esp_timer_get_time()', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(BLINK_YAML));
  has(code, 'k_uptime_get()');
  // millis() may appear in platform-agnostic comments — check executable lines only
  const execLines = code.split('\n')
    .filter(l => { const t = l.trimStart(); return !t.startsWith('//') && !t.startsWith('*'); })
    .join('\n');
  assert(!execLines.includes('millis()'), 'expected no millis() call in Zephyr generated code');
  hasNot(code, 'esp_timer_get_time()');
});

test('Zephyr: timestamp variable is typed int64_t, not unsigned long', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(BLINK_YAML));
  has(code, 'int64_t');
});

test('Zephyr: includes Zephyr kernel, GPIO and UART headers', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(BLINK_YAML));
  has(code, '#include <zephyr/kernel.h>');
  has(code, '#include <zephyr/drivers/gpio.h>');
  has(code, '#include <zephyr/drivers/uart.h>');
  hasNot(code, '#include "freertos/FreeRTOS.h"');
  hasNot(code, '#include <Arduino.h>');
});

test('Zephyr: provides pulseIrPrint helpers routing through printk', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(BLINK_YAML));
  has(code, 'static inline void pulseIrPrint(const char *s)');
  has(code, 'static inline void pulseIrPrintln(');
  has(code, 'printk(');
  hasNot(code, 'Serial.print');
  hasNot(code, 'printf(');
});

test('Zephyr: tasks-only model does not include PulseHSM', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(BLINK_YAML));
  hasNot(code, '#include "PulseHSM.h"');
  hasNot(code, 'PULSEHSM_MAX_STATES');
});

// ---------------------------------------------------------------------------
// Zephyr backend — state machine model
// ---------------------------------------------------------------------------

test('Zephyr: state machine model includes PulseHSM and sizing macros', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(SIGNAL_YAML));
  has(code, '#include "PulseHSM.h"');
  has(code, 'PULSEHSM_MAX_STATES');
  has(code, 'PULSEHSM_MAX_EVENTS');
  has(code, 'PULSEHSM_MAX_DEPTH');
});

test('Zephyr: sizing macros appear before the Zephyr kernel header', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(SIGNAL_YAML));
  const sizingPos = code.indexOf('PULSEHSM_MAX_STATES');
  const kernelPos = code.indexOf('#include <zephyr/kernel.h>');
  assert(sizingPos < kernelPos, 'PULSEHSM_MAX_STATES must appear before <zephyr/kernel.h>');
});

test('Zephyr: GPIO write uses gpio_pin_set_dt with gpio_dt_spec', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(SIGNAL_YAML));
  has(code, 'gpio_pin_set_dt(&LAMP_GREEN_GPIO,');
  has(code, 'gpio_pin_set_dt(&LAMP_RED_GPIO,');
});

test('Zephyr: GPIO read uses gpio_pin_get_dt with gpio_dt_spec', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(SIGNAL_YAML));
  has(code, 'gpio_pin_get_dt(&LAMP_RED_GPIO)');
});

test('Zephyr: GPIO device declares gpio_dt_spec using DT_PATH(zephyr_user)', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(SIGNAL_YAML));
  has(code, 'struct gpio_dt_spec LAMP_GREEN_GPIO = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), lamp_green_gpios)');
  has(code, 'struct gpio_dt_spec LAMP_RED_GPIO = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), lamp_red_gpios)');
});

test('Zephyr: state machine model still uses while(1) + k_msleep', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(SIGNAL_YAML));
  has(code, 'int main(void)');
  has(code, 'while (1) {');
  has(code, 'k_msleep(1)');
});

// ---------------------------------------------------------------------------
// Zephyr backend — GPIO interface init
// ---------------------------------------------------------------------------

const GPIO_IFACE_YAML = `
pulseir: "1"
project:
  name: gpio_init_test
  version: "1.0"

hardware:
  buses:
    btn: { interface: gpio, pin: GPIO2, mode: input }

tasks:
  poll: { every: 100, do: noop }

actions:
  noop: { driver: logger }
`;

test('Zephyr: GPIO bus resource generates gpio_pin_configure_dt in setupInterfaces', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(GPIO_IFACE_YAML));
  has(code, 'gpio_pin_configure_dt(&BTN_GPIO,');
  has(code, 'GPIO_INPUT');
});

test('Zephyr: GPIO bus resource declares gpio_dt_spec using DT_PATH(zephyr_user)', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(GPIO_IFACE_YAML));
  has(code, 'struct gpio_dt_spec BTN_GPIO = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), btn_gpios)');
});

test('Zephyr: GPIO output mode uses GPIO_OUTPUT_INACTIVE flag', () => {
  const outputYaml = GPIO_IFACE_YAML.replace('mode: input', 'mode: output');
  const code = new Codegen(new ZephyrBackend()).generate(parse(outputYaml));
  has(code, 'GPIO_OUTPUT_INACTIVE');
});

// ---------------------------------------------------------------------------
// ZephyrProjectEmitter — CMakeLists.txt and prj.conf
// ---------------------------------------------------------------------------

console.log('\n⚡ Testing ZephyrProjectEmitter...\n');

test('ZephyrProjectEmitter: cmake starts with cmake_minimum_required and find_package(Zephyr)', () => {
  const project = parse(BLINK_YAML);
  const files = new ZephyrProjectEmitter().generate(project);
  has(files.cmake, 'cmake_minimum_required(');
  has(files.cmake, 'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})');
  has(files.cmake, 'project(blink)');
});

test('ZephyrProjectEmitter: cmake uses target_sources(app PRIVATE src/main.cpp)', () => {
  const project = parse(BLINK_YAML);
  const files = new ZephyrProjectEmitter().generate(project);
  has(files.cmake, 'target_sources(app PRIVATE');
  has(files.cmake, 'src/main.cpp');
});

test('ZephyrProjectEmitter: cmake adds PulseHSM.cpp when machine is declared', () => {
  const project = parse(SIGNAL_YAML);
  const files = new ZephyrProjectEmitter().generate(project);
  has(files.cmake, 'PulseHSM.cpp');
});

test('ZephyrProjectEmitter: cmake omits PulseHSM.cpp for machine-less models', () => {
  const project = parse(BLINK_YAML);
  const files = new ZephyrProjectEmitter().generate(project);
  hasNot(files.cmake, 'PulseHSM.cpp');
});

test('ZephyrProjectEmitter: prj.conf always includes C++ support flags', () => {
  const project = parse(BLINK_YAML);
  const files = new ZephyrProjectEmitter().generate(project);
  has(files.prjConf, 'CONFIG_CPP=y');
  has(files.prjConf, 'CONFIG_STD_CPP17=y');
  has(files.prjConf, 'CONFIG_NEWLIB_LIBC=y');
});

test('ZephyrProjectEmitter: prj.conf adds CONFIG_GPIO=y for digital_output devices', () => {
  // BLINK_YAML has a digital_output device.
  const project = parse(BLINK_YAML);
  const files = new ZephyrProjectEmitter().generate(project);
  has(files.prjConf, 'CONFIG_GPIO=y');
});

test('ZephyrProjectEmitter: prj.conf adds CONFIG_I2C=y for i2c bus resources', () => {
  const i2cYaml = `
pulseir: "1"
project:
  name: i2c_test
  version: "1.0"
hardware:
  buses:
    sensor_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
tasks:
  poll: { every: 1000, do: noop }
actions:
  noop: { driver: logger }
`;
  const project = parse(i2cYaml);
  const files = new ZephyrProjectEmitter().generate(project);
  has(files.prjConf, 'CONFIG_I2C=y');
});

test('ZephyrProjectEmitter: prj.conf does NOT add GPIO for a model with no gpio/devices', () => {
  const noGpioYaml = `
pulseir: "1"
project:
  name: no_gpio
  version: "1.0"
hardware:
  buses:
    serial: { interface: uart, port: 0, baud: 115200 }
tasks:
  poll: { every: 1000, do: noop }
actions:
  noop: { driver: logger }
`;
  const project = parse(noGpioYaml);
  const files = new ZephyrProjectEmitter().generate(project);
  hasNot(files.prjConf, 'CONFIG_GPIO=y');
  has(files.prjConf, 'CONFIG_SERIAL=y');
});

test('ZephyrProjectEmitter: overlay is generated for GPIO bus resources', () => {
  const project = parse(GPIO_IFACE_YAML);
  const files = new ZephyrProjectEmitter().generate(project);
  assert(files.overlay !== undefined, 'overlay must be defined for GPIO hardware');
  has(files.overlay!, 'zephyr,user');
  has(files.overlay!, 'btn-gpios');
  has(files.overlay!, '<&gpio0 2 GPIO_ACTIVE_HIGH>');
});

test('ZephyrProjectEmitter: overlay is generated for GPIO device components', () => {
  const project = parse(BLINK_YAML);
  const files = new ZephyrProjectEmitter().generate(project);
  assert(files.overlay !== undefined, 'overlay must be defined for digital_output devices');
  has(files.overlay!, 'led-gpios');
  has(files.overlay!, '<&gpio0 2 GPIO_ACTIVE_HIGH>');
});

test('ZephyrProjectEmitter: overlay is undefined for non-GPIO models', () => {
  const noGpioYaml = `
pulseir: "1"
project:
  name: no_gpio
  version: "1.0"
hardware:
  buses:
    serial: { interface: uart, port: 0, baud: 115200 }
tasks:
  poll: { every: 1000, do: noop }
actions:
  noop: { driver: logger }
`;
  const files = new ZephyrProjectEmitter().generate(parse(noGpioYaml));
  assert(files.overlay === undefined, 'overlay must be absent when no GPIO is declared');
});

// ---------------------------------------------------------------------------
// Zephyr Phase 3: PWM via pwm_dt_spec
// ---------------------------------------------------------------------------

const PWM_YAML = `
pulseir: "1"
project:
  name: pwm_test
  version: "1.0"

hardware:
  devices:
    motor: { type: pwm_output, pin: GPIO18, channel: 0, frequency: 1000, resolution: 8 }

events:
  RUN:  { source: external }
  STOP: { source: external }

actions:
  spin:  { driver: pwm_control, params: { device: motor, duty: 128 } }
  brake: { driver: pwm_control, params: { device: motor, duty: 0   } }

machine:
  states:
    idle:
    running:
  transitions:
    - from: idle
      on: RUN
      to: running
      do: spin
    - from: running
      on: STOP
      to: idle
      do: brake
`;

test('Zephyr: pwm_output device emits pwm_dt_spec global', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(PWM_YAML));
  has(code, 'struct pwm_dt_spec MOTOR_PWM = PWM_DT_SPEC_GET(DT_PATH(zephyr_user), motor_pwms)');
});

test('Zephyr: pwm_control action body emits pwm_set_dt()', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(PWM_YAML));
  has(code, 'pwm_set_dt(&MOTOR_PWM, PWM_HZ(MOTOR_FREQUENCY),');
});

test('Zephyr: pwm_control duty uses resolution macro for scale', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(PWM_YAML));
  has(code, '(1u << MOTOR_RESOLUTION) - 1u');
});

test('Zephyr: pwm_output device also emits gpio_dt_spec fallback for gpio_control', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(PWM_YAML));
  has(code, 'struct gpio_dt_spec MOTOR_GPIO = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), motor_gpios)');
});

test('Zephyr: generated code includes <zephyr/drivers/pwm.h>', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(PWM_YAML));
  has(code, '#include <zephyr/drivers/pwm.h>');
});

test('ZephyrProjectEmitter: prj.conf adds CONFIG_PWM=y for pwm_output devices', () => {
  const files = new ZephyrProjectEmitter().generate(parse(PWM_YAML));
  has(files.prjConf, 'CONFIG_PWM=y');
});

test('ZephyrProjectEmitter: overlay includes gpio entry for pwm_output device', () => {
  const files = new ZephyrProjectEmitter().generate(parse(PWM_YAML));
  assert(files.overlay !== undefined, 'overlay must be defined for pwm_output');
  has(files.overlay!, 'motor-gpios = <&gpio0 18 GPIO_ACTIVE_HIGH>');
});

test('ZephyrProjectEmitter: overlay includes pwms entry for pwm_output device', () => {
  const files = new ZephyrProjectEmitter().generate(parse(PWM_YAML));
  assert(files.overlay !== undefined, 'overlay must be defined for pwm_output');
  // frequency 1000 Hz → period_ns = 1_000_000 ns; channel 0.
  has(files.overlay!, 'motor-pwms = <&pwm0 0 1000000 PWM_POLARITY_NORMAL>');
});

test('Zephyr: FREQUENCY and RESOLUTION macros are emitted for pwm_output', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(PWM_YAML));
  has(code, '#define MOTOR_FREQUENCY 1000');
  has(code, '#define MOTOR_RESOLUTION 8');
});

test('Zephyr: pwm_output without resolution defaults to 8-bit macro', () => {
  const noResYaml = PWM_YAML.replace('frequency: 1000, resolution: 8', 'frequency: 1000');
  const code = new Codegen(new ZephyrBackend()).generate(parse(noResYaml));
  has(code, '#define MOTOR_RESOLUTION 8');
});

test('Zephyr: pwm_output without frequency defaults to 5000 Hz macro', () => {
  const noFreqYaml = PWM_YAML.replace('frequency: 1000, resolution: 8', 'resolution: 8');
  const code = new Codegen(new ZephyrBackend()).generate(parse(noFreqYaml));
  has(code, '#define MOTOR_FREQUENCY 5000');
});

// ---------------------------------------------------------------------------
// Phase 4: WiFi, MQTT, HTTP (Zephyr)
// ---------------------------------------------------------------------------

const WIFI_YAML = `
pulseir: "1"
project:
  name: wifi_test
  version: "1.0"
hardware:
  buses:
    uplink: { interface: wifi, ssid: "MyNetwork" }
tasks:
  heartbeat: { every: 1000, do: noop }
actions:
  noop: { driver: logger }
`;

const WIFI_MQTT_YAML = `
pulseir: "1"
project:
  name: mqtt_test
  version: "1.0"
hardware:
  buses:
    uplink: { interface: wifi, ssid: "MyNetwork" }
    broker: { interface: mqtt, host: "192.168.1.100", port: 1883 }
tasks:
  heartbeat: { every: 1000, do: noop }
actions:
  noop: { driver: logger }
`;

const HTTP_ZEPHYR_YAML = `
pulseir: "1"
project:
  name: http_zephyr
  version: "1.0"
hardware:
  buses:
    uplink: { interface: wifi, ssid: "MyNetwork" }
tasks:
  poll: { every: 5000, do: fetch }
actions:
  fetch:
    driver: http_get
    params:
      url: "http://api.example.com/data"
`;

const HTTP_POST_ZEPHYR_YAML = `
pulseir: "1"
project:
  name: http_post_zephyr
  version: "1.0"
hardware:
  buses:
    uplink: { interface: wifi, ssid: "MyNetwork" }
tasks:
  upload: { every: 10000, do: send }
actions:
  send:
    driver: http_post
    params:
      url: "http://api.example.com/data"
      body: '{"v":1}'
      content_type: "application/json"
`;

console.log('\n⚡ Testing Phase 4: WiFi, MQTT, HTTP (Zephyr)...\n');

// ── WiFi ─────────────────────────────────────────────────────────────────────

test('Zephyr: WiFi interface emits net_if pointer global', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_YAML));
  has(code, 'struct net_if *uplink_iface');
});

test('Zephyr: WiFi interface emits wifi_connect_req_params struct', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_YAML));
  has(code, 'struct wifi_connect_req_params uplink_params');
});

test('Zephyr: WiFi init calls net_mgmt with NET_REQUEST_WIFI_CONNECT', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_YAML));
  has(code, 'net_mgmt(NET_REQUEST_WIFI_CONNECT');
});

test('Zephyr: WiFi params reference SSID_STR macro for ssid field', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_YAML));
  has(code, '.ssid        = (const uint8_t *)UPLINK_SSID_STR');
});

test('Zephyr: WiFi params set WIFI_SECURITY_TYPE_PSK', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_YAML));
  has(code, '.security    = WIFI_SECURITY_TYPE_PSK');
});

test('Zephyr: WiFi generated code includes <zephyr/net/wifi_mgmt.h>', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_YAML));
  has(code, '#include <zephyr/net/wifi_mgmt.h>');
});

test('Zephyr: WiFi generated code includes <zephyr/net/net_if.h>', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_YAML));
  has(code, '#include <zephyr/net/net_if.h>');
});

// ── MQTT ─────────────────────────────────────────────────────────────────────

test('Zephyr: MQTT interface emits ZephyrMqttClient shim class', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_MQTT_YAML));
  has(code, 'class ZephyrMqttClient');
});

test('Zephyr: MQTT interface emits static ZephyrMqttClient instance', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_MQTT_YAML));
  has(code, 'static ZephyrMqttClient broker');
});

test('Zephyr: MQTT shim wraps struct mqtt_client', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_MQTT_YAML));
  has(code, 'struct mqtt_client  _client');
});

test('Zephyr: MQTT shim begin() calls mqtt_client_init', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_MQTT_YAML));
  has(code, 'mqtt_client_init(&_client)');
});

test('Zephyr: MQTT shim begin() calls mqtt_connect in connect()', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_MQTT_YAML));
  has(code, 'mqtt_connect(&_client)');
});

test('Zephyr: MQTT init calls broker.begin() with HOST and PORT macros', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_MQTT_YAML));
  has(code, 'broker.begin(BROKER_HOST');
  has(code, 'BROKER_PORT');
});

test('Zephyr: MQTT generated code includes <zephyr/net/mqtt.h>', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(WIFI_MQTT_YAML));
  has(code, '#include <zephyr/net/mqtt.h>');
});

// ── HTTP ─────────────────────────────────────────────────────────────────────

test('Zephyr: http_get action emits struct http_request', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_ZEPHYR_YAML));
  has(code, 'struct http_request _http_req');
});

test('Zephyr: http_get action sets HTTP_GET method', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_ZEPHYR_YAML));
  has(code, '_http_req.method       = HTTP_GET');
});

test('Zephyr: http_get action sets url from model params', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_ZEPHYR_YAML));
  has(code, '_http_req.url          = "http://api.example.com/data"');
});

test('Zephyr: http_get action provides recv_buf', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_ZEPHYR_YAML));
  has(code, '_http_req.recv_buf     = _http_recv');
});

test('Zephyr: http_get generated code includes <zephyr/net/http/client.h>', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_ZEPHYR_YAML));
  has(code, '#include <zephyr/net/http/client.h>');
});

test('Zephyr: http_post action sets HTTP_POST method', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_POST_ZEPHYR_YAML));
  has(code, '_http_req.method             = HTTP_POST');
});

test('Zephyr: http_post action sets body from model params', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_POST_ZEPHYR_YAML));
  has(code, `static const char _http_body[] = `);
});

test('Zephyr: http_post action sets content_type_value', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_POST_ZEPHYR_YAML));
  has(code, '_http_req.content_type_value = "application/json"');
});

test('Zephyr: http_post action sets payload and payload_len', () => {
  const code = new Codegen(new ZephyrBackend()).generate(parse(HTTP_POST_ZEPHYR_YAML));
  has(code, '_http_req.payload            = _http_body');
  has(code, '_http_req.payload_len        = sizeof(_http_body) - 1');
});

// ── prj.conf: CONFIG_HTTP_CLIENT ─────────────────────────────────────────────

test('ZephyrProjectEmitter: prj.conf adds CONFIG_HTTP_CLIENT=y when http_get is declared', () => {
  const files = new ZephyrProjectEmitter().generate(parse(HTTP_ZEPHYR_YAML));
  has(files.prjConf, 'CONFIG_HTTP_CLIENT=y');
});

test('ZephyrProjectEmitter: prj.conf adds CONFIG_HTTP_CLIENT=y when http_post is declared', () => {
  const files = new ZephyrProjectEmitter().generate(parse(HTTP_POST_ZEPHYR_YAML));
  has(files.prjConf, 'CONFIG_HTTP_CLIENT=y');
});

test('ZephyrProjectEmitter: prj.conf does NOT add CONFIG_HTTP_CLIENT when no HTTP actions', () => {
  const files = new ZephyrProjectEmitter().generate(parse(WIFI_YAML));
  hasNot(files.prjConf, 'CONFIG_HTTP_CLIENT=y');
});

// ---------------------------------------------------------------------------
// CmakeEmitter — ESP-IDF CMakeLists.txt generation
// ---------------------------------------------------------------------------

console.log('\n⚡ Testing CmakeEmitter...\n');

test('CmakeEmitter: top-level cmake_minimum_required and project() use safe project name', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project);
  has(files.topLevel, 'cmake_minimum_required(VERSION 3.16)');
  has(files.topLevel, 'project(blink)');
});

test('CmakeEmitter: top-level includes IDF_PATH project.cmake', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project);
  has(files.topLevel, 'include($ENV{IDF_PATH}/tools/cmake/project.cmake)');
});

test('CmakeEmitter: top-level declares minimum IDF version (default 5.0)', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project);
  has(files.topLevel, 'idf_build_set_property(MINIMUM_IDF_VERSION 5.0)');
});

test('CmakeEmitter: top-level respects custom idfVersion argument', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project, '4.4');
  has(files.topLevel, 'idf_build_set_property(MINIMUM_IDF_VERSION 4.4)');
  hasNot(files.topLevel, '5.0');
});

test('CmakeEmitter: project name with special chars is sanitized to underscores', () => {
  const yaml = BLINK_YAML.replace('name: blink', 'name: my-cool project!');
  const project = parse(yaml);
  const files = new CmakeEmitter().generate(project);
  has(files.topLevel, 'project(my_cool_project_)');
});

test('CmakeEmitter: main component registers main.cpp when no extra sources', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project);
  has(files.mainComponent, 'idf_component_register(');
  has(files.mainComponent, 'SRCS "main.cpp"');
});

test('CmakeEmitter: main component REQUIRES includes driver and esp_timer', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project);
  has(files.mainComponent, 'REQUIRES driver esp_timer');
});

test('CmakeEmitter: main component does NOT require PulseHSM when no state machine', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project);
  hasNot(files.mainComponent, 'PulseHSM');
});

test('CmakeEmitter: main component REQUIRES PulseHSM when state machine is declared', () => {
  const project = parse(SIGNAL_YAML);
  const files = new CmakeEmitter().generate(project);
  has(files.mainComponent, 'REQUIRES driver esp_timer PulseHSM');
});

test('CmakeEmitter: extra sources appear in SRCS list', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project, '5.0', ['actions.cpp']);
  has(files.mainComponent, '"main.cpp"');
  has(files.mainComponent, '"actions.cpp"');
});

test('CmakeEmitter: multiple extra sources are each quoted', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project, '5.0', ['actions.cpp', 'guards.cpp']);
  has(files.mainComponent, '"actions.cpp"');
  has(files.mainComponent, '"guards.cpp"');
});

test('CmakeEmitter: main component sets INCLUDE_DIRS to "."', () => {
  const project = parse(BLINK_YAML);
  const files = new CmakeEmitter().generate(project);
  has(files.mainComponent, 'INCLUDE_DIRS "."');
});

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n❌ ${failures} backend test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Backend tests passed!');
