/**
 * MQTT topic manifest tests.
 *
 * The point of deriving topics from the IR is that the device side and the
 * dashboard side cannot drift apart. These tests pin the parts that would
 * cause silent drift if they changed: topic shape, and the parameter metadata
 * a dashboard needs to render a bounded control.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Parser } from '../src/parser/index.js';
import { TopicEmitter } from '../src/emit/topics.js';
import { LibraryEmitter } from '../src/emit/libraries.js';
import { FileResolver } from '../src/parser/fs-resolver.js';
import type { TopicManifest } from '../src/emit/topics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

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

function manifestFor(yamlPath: string, namespace?: string): TopicManifest {
  const project = new Parser().parseFrom(yamlPath, new FileResolver());
  return new TopicEmitter().emit(project, namespace);
}

const boiler = () => manifestFor(path.join(repoRoot, 'examples/boiler/pulse.yaml'));

// ============================================================================

console.log('📡 Testing MQTT topic manifest...\n');

test('every sensor component becomes a publish topic', () => {
  const m = boiler();
  const sensors = m.publish.filter(t => t.kind === 'sensor');

  assert(sensors.length === 1, `expected 1 sensor topic, got ${sensors.length}`);
  assert(
    sensors[0].topic === 'boiler_control/{device}/water_temp',
    `unexpected sensor topic: ${sensors[0].topic}`
  );
  assert(sensors[0].driver === 'ds18b20', 'sensor driver was not carried through');
  assert(sensors[0].unit === 'degC', 'declared unit was not carried through');

  // Actuators are not readings and must not be published as data.
  assert(
    !m.publish.some(t => t.topic.includes('pump') || t.topic.includes('heater')),
    'an actuator was published as if it were a sensor reading'
  );
});

test('state is published, and only leaf states can appear', () => {
  const m = boiler();
  const state = m.publish.find(t => t.kind === 'state');

  assert(state !== undefined, 'no state topic was emitted');
  assert(state!.topic === 'boiler_control/{device}/state', `unexpected: ${state!.topic}`);

  // The machine rests only in leaves, so "running" must not be listed.
  assert(
    JSON.stringify(state!.values) ===
      JSON.stringify(['idle', 'running/heating', 'running/maintaining', 'running/cooling', 'fault']),
    `unexpected state values: ${JSON.stringify(state!.values)}`
  );
});

test('parameters become setpoints carrying the metadata a dashboard needs', () => {
  const m = boiler();
  const setpoint = m.subscribe.find(t => t.parameter === 'setpoint');

  assert(setpoint !== undefined, 'setpoint parameter produced no topic');
  assert(
    setpoint!.topic === 'boiler_control/{device}/setpoint/setpoint',
    `unexpected: ${setpoint!.topic}`
  );

  // This is the part hand-written firmware throws away: a bare
  // `float spTemp = 30.0;` cannot tell a dashboard how to bound the control.
  assert(setpoint!.valueType === 'float', 'value type missing');
  assert(setpoint!.unit === 'degC', 'unit missing');
  assert(setpoint!.default === 60.0, `default missing, got ${setpoint!.default}`);
  assert(setpoint!.min === 10.0, `min missing, got ${setpoint!.min}`);
  assert(setpoint!.max === 90.0, `max missing, got ${setpoint!.max}`);

});

test('a parameter with no declared range does not get one invented', () => {
  // Checked on its own model: every boiler parameter declares a range, and a
  // test should not depend on an example happening to omit one.
  const project = new Parser().parse(`
project: {name: unbounded, version: "1.0"}
events: {GO: {source: external}}
machine:
  states: {idle: {}}
  transitions: []
parameters:
  gain: {type: float, default: 1.0, unit: ratio}
`);
  const topic = new TopicEmitter().emit(project).subscribe.find(t => t.parameter === 'gain');

  assert(topic !== undefined, 'gain produced no topic');
  assert(topic!.unit === 'ratio', 'unit was dropped');
  assert(
    topic!.min === undefined && topic!.max === undefined,
    `a range was fabricated: ${JSON.stringify(topic)}`
  );
});

test('only events marked source: mqtt are remotely triggerable', () => {
  // The boiler's events are external/sensor, so none may be exposed.
  assert(
    boiler().subscribe.every(t => t.kind !== 'command'),
    'a non-mqtt event was exposed as a remote command'
  );

  const yaml = `
project: {name: remote, version: "1.0"}
events:
  LOCAL_BUTTON: {source: external}
  REMOTE_START: {source: mqtt, description: start from the dashboard}
machine:
  states: {idle: {}, running: {}}
  transitions:
    - {from: idle, on: REMOTE_START, to: running}
`;
  const project = new Parser().parse(yaml);
  const commands = new TopicEmitter().emit(project).subscribe.filter(t => t.kind === 'command');

  assert(commands.length === 1, `expected 1 command, got ${commands.length}`);
  assert(commands[0].topic === 'remote/{device}/event/REMOTE_START', `unexpected: ${commands[0].topic}`);
  assert(commands[0].description === 'start from the dashboard', 'description was dropped');
});

test('namespace is overridable to match an existing deployment', () => {
  const m = manifestFor(path.join(repoRoot, 'examples/boiler/pulse.yaml'), 'pulsecompiler');

  assert(m.prefix === 'pulsecompiler/{device}', `unexpected prefix: ${m.prefix}`);
  assert(
    m.publish.every(t => t.topic.startsWith('pulsecompiler/{device}/')),
    'a topic ignored the namespace override'
  );
});

test('no topic segment can break the MQTT topic tree', () => {
  // `+` and `#` are wildcards and `/` is the separator, so a name carrying
  // them would silently reshape the tree rather than fail.
  const yaml = `
project: {name: "odd name/v2", version: "1.0"}
events:
  GO: {source: external}
machine:
  states: {idle: {}}
  transitions: []
hardware:
  devices:
    "temp +sensor#1": {type: ds18b20}
parameters:
  "set/point": {type: float, default: 1.0}
`;
  const project = new Parser().parse(yaml);
  const m = new TopicEmitter().emit(project);

  const all = [...m.publish, ...m.subscribe].map(t => t.topic);
  for (const topic of all) {
    const body = topic.replace('{device}', 'dev');
    assert(!body.includes('+'), `wildcard '+' survived into ${topic}`);
    assert(!body.includes('#'), `wildcard '#' survived into ${topic}`);
    assert(!body.includes(' '), `space survived into ${topic}`);
    assert(!body.includes('//'), `empty segment in ${topic}`);
  }

  // The original names stay intact in the metadata, so a consumer can still
  // map a topic back to the thing it came from.
  const sensor = m.publish.find(t => t.kind === 'sensor');
  assert(sensor!.source === 'temp +sensor#1', 'original component name was lost');
});

test('manifest round-trips as JSON', () => {
  const json = new TopicEmitter().toJSON(
    new Parser().parseFrom(path.join(repoRoot, 'examples/boiler/pulse.yaml'), new FileResolver())
  );
  const parsed = JSON.parse(json) as TopicManifest;

  assert(parsed.schema === 'pulseir/topics@1', 'schema tag missing');
  assert(parsed.perspective === 'device', 'perspective must be stated - it is ambiguous otherwise');
  assert(parsed.payloadFormat === 'plain-text-scalar', 'payload format missing');
});

test('library manifest lists implied and declared libraries', () => {
  const project = new Parser().parseFrom(
    path.join(repoRoot, 'examples/greenhouse/greenhouse.yaml'),
    new FileResolver()
  );
  const manifest = new LibraryEmitter().emit(project);
  const byName = new Map(manifest.libraries.map(l => [l.name, l]));

  // Declaring `interface: i2c` should not also mean remembering "Wire.h".
  assert(byName.get('Wire')?.implied === true, 'Wire was not implied by the I2C bus');
  assert(byName.get('Wire')?.source === 'builtin', 'Wire should be core-bundled');
  assert(byName.get('PubSubClient')?.implied === true, 'PubSubClient was not implied by MQTT');

  const bme = byName.get('Adafruit_BME280');
  assert(bme?.implied === false, 'a declared library was marked implied');
  assert(bme?.version === '^2.2', 'declared version was dropped');

  // lib_deps must not list libraries the core already ships.
  assert(
    manifest.platformio.includes('Adafruit_BME280@^2.2'),
    `expected a pinned lib_dep, got ${JSON.stringify(manifest.platformio)}`
  );
  assert(
    !manifest.platformio.some(dep => dep.startsWith('Wire')),
    'a core-bundled library leaked into lib_deps'
  );
});

// ============================================================================

if (failures > 0) {
  console.error(`\n❌ ${failures} topic test(s) failed`);
  process.exit(1);
}

console.log('\n✨ Topic tests passed!');
