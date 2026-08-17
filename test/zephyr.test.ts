/**
 * Zephyr backend compile test (Path A).
 *
 * Generates Zephyr C++ from model fixtures and feeds it to the host g++
 * compiler against the test/harness/zephyr stubs with -std=c++17 -Werror.
 * No Zephyr SDK, no west, no cross-compiler needed — the stubs replace the
 * Zephyr headers for host compilation.
 *
 * The produced binary is NOT run: the generated int main(void) loops forever
 * (k_uptime_get() is a stub, not a real clock).  Behavioural verification is
 * Path B: west build -b native_sim with the full Zephyr RTOS.
 *
 * What this catches that the pattern tests (backends.test.ts) miss:
 *   - Type mismatches between generated casts and the stub API signatures
 *   - Missing includes / forward declarations
 *   - Struct field accesses on wrong types
 *   - Any -Wall / -Wextra warning turned fatal by -Werror
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Parser } from '../src/parser/index.js';
import { FileResolver } from '../src/parser/fs-resolver.js';
import { Codegen } from '../src/codegen/index.js';
import { ZephyrBackend } from '../src/codegen/zephyr.js';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const repoRoot       = path.resolve(__dirname, '../..');
const harnessDir     = path.join(repoRoot, 'test/harness');
const zephyrCompatDir = path.join(harnessDir, 'zephyr-compat');
const depsDir        = path.join(repoRoot, 'deps');
const buildDir       = path.join(repoRoot, 'dist/zephyr-compile-test');

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function hasCompiler(): boolean {
  return spawnSync('g++', ['--version'], { stdio: 'ignore' }).status === 0;
}

if (!hasCompiler()) {
  console.log('⚠️  g++ not found — skipping Zephyr compile test');
  process.exit(0);
}

fs.mkdirSync(buildDir, { recursive: true });

// ---------------------------------------------------------------------------
// Generation helpers
// ---------------------------------------------------------------------------

function generateFrom(yamlPath: string): string {
  return new Codegen(new ZephyrBackend()).generate(
    new Parser().parseFrom(yamlPath, new FileResolver())
  );
}

function generateInline(yaml: string): string {
  return new Codegen(new ZephyrBackend()).generate(new Parser().parse(yaml));
}

/** Extract the PulseHSM sizing macros and return them as a config header. */
function sizingHeader(code: string): string {
  const macros = ['PULSEHSM_MAX_STATES', 'PULSEHSM_MAX_EVENTS', 'PULSEHSM_MAX_DEPTH'];
  const defs = macros.map(m => {
    const v = new RegExp(`#define\\s+${m}\\s+(\\d+)`).exec(code)?.[1];
    if (!v) throw new Error(`generated code is missing sizing macro ${m}`);
    return `#define ${m} ${v}`;
  });
  return `#ifndef PULSEHSM_CONFIG_H\n#define PULSEHSM_CONFIG_H\n${defs.join('\n')}\n#endif\n`;
}

// ---------------------------------------------------------------------------
// Compile helper
// ---------------------------------------------------------------------------

/**
 * Compile the generated Zephyr C++ against the harness stubs.
 *
 * -I test/harness makes <zephyr/kernel.h> resolve to
 *   test/harness/zephyr/kernel.h, and so on for gpio.h / uart.h.
 *
 * Throws (with stderr attached) on any compiler error, so the test runner
 * prints the exact diagnostic.
 */
function compile(name: string, code: string): void {
  const hasMachine = code.includes('#include "PulseHSM.h"');
  const sourcePath = path.join(buildDir, `${name}.cpp`);
  const binaryPath = path.join(buildDir, name);
  const configDir  = path.join(buildDir, `${name}-cfg`);

  fs.writeFileSync(sourcePath, code);
  fs.mkdirSync(configDir, { recursive: true });

  if (hasMachine) {
    fs.writeFileSync(path.join(configDir, 'PulseHSM_config.h'), sizingHeader(code));
  }

  execFileSync('g++', [
    '-std=c++17',
    '-Wall',
    '-Wextra',
    '-Werror',
    // Suppress unused-variable warnings on stub guard/action bodies the
    // compiler sees as empty (they intentionally do nothing in the test build).
    '-Wno-unused-parameter',
    sourcePath,
    ...(hasMachine ? [path.join(depsDir, 'PulseHSM.cpp')] : []),
    `-I${configDir}`,
    // zephyr-compat BEFORE harness so its Arduino.h wins over harness/Arduino.h
    // (PulseHSM.h includes <Arduino.h>; the compat shim defines millis() without
    // pulseTestClockMs, which lives in serial.cpp and is not linked here).
    `-I${zephyrCompatDir}`,
    `-I${harnessDir}`,   // resolves <zephyr/kernel.h> → harness/zephyr/kernel.h
    `-I${depsDir}`,
    '-o', binaryPath,
  ], { stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// Test runner (same minimal harness as compile.test.ts)
// ---------------------------------------------------------------------------

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}`);
    const msg    = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: Buffer }).stderr?.toString();
    console.error(`  ${msg.split('\n').join('\n  ')}`);
    if (stderr) console.error(`  [compiler]\n  ${stderr.split('\n').join('\n  ')}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

console.log('⚡ Zephyr compile tests (host g++ + harness stubs)\n');

// ── Tasks-only (no state machine) ───────────────────────────────────────────

test('blink: tasks-only model compiles without errors or warnings', () => {
  const code = generateFrom(path.join(repoRoot, 'examples/blink.yaml'));
  compile('blink', code);
  // Sanity: no PulseHSM linked means these must be absent from the source.
  assert(!code.includes('#include "PulseHSM.h"'), 'blink should not include PulseHSM');
  assert(code.includes('k_uptime_get()'),        'blink must use k_uptime_get() for timing');
  assert(code.includes('int main(void)'),         'blink must have int main(void)');
});

test('serial_console: UART console model compiles without errors', () => {
  compile('serial_console', generateFrom(path.join(repoRoot, 'examples/serial_console.yaml')));
});

// ── State machine models ─────────────────────────────────────────────────────

test('boiler: HSM with hierarchy and GPIO devices compiles without errors', () => {
  const code = generateFrom(path.join(repoRoot, 'examples/boiler/pulse.yaml'));
  compile('boiler', code);
  assert(code.includes('#include "PulseHSM.h"'), 'boiler must include PulseHSM');
  assert(code.includes('PULSEHSM_MAX_STATES'),    'boiler must declare sizing macros');
});

test('traffic_light: timed transitions compile without errors', () => {
  compile('traffic_light', generateFrom(path.join(repoRoot, 'examples/traffic_light.yaml')));
});

test('motor_controller: multi-phase machine compiles without errors', () => {
  compile('motor_controller', generateFrom(path.join(repoRoot, 'examples/motor_controller.yaml')));
});

test('pump_tank: composite timers compile without errors', () => {
  compile('pump_tank', generateFrom(path.join(repoRoot, 'examples/pump_tank.yaml')));
});

// ── GPIO bus interface ────────────────────────────────────────────────────────

test('gpio bus interface: gpio_pin_configure_dt call compiles with correct types', () => {
  const code = generateInline(`
pulseir: "1"
project:
  name: gpio_bus
  version: "1.0"
hardware:
  buses:
    btn:  { interface: gpio, pin: GPIO4,  mode: input }
    led2: { interface: gpio, pin: GPIO12, mode: output }
tasks:
  poll: { every: 100, do: noop }
actions:
  noop: { driver: logger }
`);
  compile('gpio_bus', code);
  assert(code.includes('gpio_pin_configure_dt(&BTN_GPIO,'),
    'gpio bus must emit gpio_pin_configure_dt with dt_spec ref');
  assert(code.includes('GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), btn_gpios)'),
    'gpio bus must declare gpio_dt_spec with DT_PATH(zephyr_user)');
});

// ── Multi-bus model ──────────────────────────────────────────────────────────

test('multi-bus model with I2C + GPIO compiles without errors', () => {
  compile('multi_bus', generateInline(`
pulseir: "1"
project:
  name: multi_bus
  version: "1.0"
hardware:
  buses:
    sensor_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    relay: { type: digital_output, pin: GPIO5 }
tasks:
  sample: { every: 500, do: noop }
actions:
  noop: { driver: logger }
`));
});

// ── Multi-file model ─────────────────────────────────────────────────────────

test('greenhouse: multi-file model with four buses compiles without errors', () => {
  compile('greenhouse',
    generateFrom(path.join(repoRoot, 'examples/greenhouse/greenhouse.yaml')));
});

// ── Fixture tests ─────────────────────────────────────────────────────────────

test('hierarchy fixture: nested states with guards compile without errors', () => {
  compile('hierarchy',
    generateFrom(path.join(repoRoot, 'test/fixtures/hierarchy.yaml')));
});

test('timers fixture: composite timers compile without errors', () => {
  compile('timers',
    generateFrom(path.join(repoRoot, 'test/fixtures/timers.yaml')));
});

// ── Key API assertions ────────────────────────────────────────────────────────

test('generated GPIO write uses correct Zephyr Phase 2 API signature', () => {
  // gpio_pin_set_dt(const struct gpio_dt_spec*, int) — the _dt variant avoids
  // raw DEVICE_DT_GET and (gpio_pin_t) casts, which Phase 2 removes.
  const code = generateFrom(path.join(repoRoot, 'examples/boiler/pulse.yaml'));
  compile('gpio_api_check', code);
  assert(
    code.includes('gpio_pin_set_dt(&'),
    'GPIO write must use gpio_pin_set_dt with a gpio_dt_spec reference'
  );
  assert(
    code.includes('GPIO_DT_SPEC_GET(DT_PATH(zephyr_user),'),
    'GPIO spec must be declared with GPIO_DT_SPEC_GET'
  );
});

test('sizing macros precede <zephyr/kernel.h> so they take effect', () => {
  const code = generateFrom(path.join(repoRoot, 'examples/boiler/pulse.yaml'));
  const sizingPos = code.indexOf('PULSEHSM_MAX_STATES');
  const kernelPos = code.indexOf('#include <zephyr/kernel.h>');
  assert(sizingPos !== -1, 'sizing macro is missing');
  assert(kernelPos !== -1, '<zephyr/kernel.h> include is missing');
  assert(sizingPos < kernelPos, 'sizing macros must come before <zephyr/kernel.h>');
});

// ── Phase 3: PWM via pwm_dt_spec ─────────────────────────────────────────────

test('pwm_output: pwm_dt_spec global and pwm_set_dt() action compile without errors', () => {
  const code = generateInline(`
pulseir: "1"
project:
  name: pwm_motor
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
`);
  compile('pwm_motor', code);
  assert(code.includes('pwm_dt_spec MOTOR_PWM'),  'must declare pwm_dt_spec for motor');
  assert(code.includes('pwm_set_dt(&MOTOR_PWM,'), 'must call pwm_set_dt in action body');
  assert(code.includes('PWM_HZ(MOTOR_FREQUENCY)'), 'must use PWM_HZ macro for period');
  assert(code.includes('#include <zephyr/drivers/pwm.h>'), 'must include pwm driver header');
});

test('boiler: pwm_control on pwm_output device uses pwm_set_dt in Phase 3', () => {
  const code = generateFrom(path.join(repoRoot, 'examples/boiler/pulse.yaml'));
  compile('boiler_pwm3', code);
  assert(code.includes('pwm_dt_spec HEATER_PWM'),  'boiler heater must declare pwm_dt_spec');
  assert(code.includes('pwm_set_dt(&HEATER_PWM,'), 'reduce_heat must use pwm_set_dt');
  // gpio_dt_spec fallback must still exist so gpio_control (shutdown_all) can target heater.
  assert(code.includes('gpio_dt_spec HEATER_GPIO'), 'heater must retain gpio_dt_spec for gpio_control');
});

// ── Phase 4: WiFi, MQTT, HTTP ─────────────────────────────────────────────────

test('wifi interface: net_mgmt connect call compiles without errors', () => {
  const code = generateInline(`
pulseir: "1"
project:
  name: wifi_connect
  version: "1.0"
hardware:
  buses:
    uplink: { interface: wifi, ssid: "TestNet" }
tasks:
  heartbeat: { every: 1000, do: noop }
actions:
  noop: { driver: logger }
`);
  compile('wifi_connect', code);
  assert(code.includes('struct net_if *uplink_iface'),
    'WiFi must declare struct net_if pointer');
  assert(code.includes('NET_REQUEST_WIFI_CONNECT'),
    'WiFi init must call net_mgmt with NET_REQUEST_WIFI_CONNECT');
});

test('mqtt interface: ZephyrMqttClient shim compiles without errors', () => {
  const code = generateInline(`
pulseir: "1"
project:
  name: mqtt_shim
  version: "1.0"
hardware:
  buses:
    uplink: { interface: wifi, ssid: "TestNet" }
    broker: { interface: mqtt, host: "192.168.1.100", port: 1883 }
  devices:
    temp: { type: analog_input, pin: GPIO34, class: sensor, unit: celsius }
tasks:
  heartbeat: { every: 1000, do: noop }
actions:
  noop: { driver: logger }
`);
  compile('mqtt_shim', code);
  assert(code.includes('class ZephyrMqttClient'),
    'MQTT interface must emit ZephyrMqttClient shim class');
  assert(code.includes('mqtt_client_init(&_client)'),
    'ZephyrMqttClient::begin must call mqtt_client_init');
});

test('http_get: Zephyr http_client struct-based request compiles without errors', () => {
  const code = generateInline(`
pulseir: "1"
project:
  name: http_get_zephyr
  version: "1.0"
hardware:
  buses:
    uplink: { interface: wifi, ssid: "TestNet" }
tasks:
  poll: { every: 5000, do: fetch }
actions:
  fetch:
    driver: http_get
    params:
      url: "http://api.example.com/data"
`);
  compile('http_get_zephyr', code);
  assert(code.includes('struct http_request _http_req'),
    'http_get must emit struct http_request');
  assert(code.includes('_http_req.method       = HTTP_GET'),
    'http_get must set HTTP_GET method');
});

test('http_post: Zephyr http_client struct-based POST compiles without errors', () => {
  const code = generateInline(`
pulseir: "1"
project:
  name: http_post_zephyr
  version: "1.0"
hardware:
  buses:
    uplink: { interface: wifi, ssid: "TestNet" }
tasks:
  upload: { every: 10000, do: send }
actions:
  send:
    driver: http_post
    params:
      url: "http://api.example.com/readings"
      body: '{"v":42}'
      content_type: "application/json"
`);
  compile('http_post_zephyr', code);
  assert(code.includes('_http_req.method             = HTTP_POST'),
    'http_post must set HTTP_POST method');
  assert(code.includes('_http_req.content_type_value = "application/json"'),
    'http_post must set content_type_value');
});

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n❌ ${failures} Zephyr compile test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Zephyr compile tests passed!');
