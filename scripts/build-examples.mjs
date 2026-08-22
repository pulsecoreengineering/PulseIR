/**
 * Bakes the on-disk example models into web/examples.ts.
 *
 * The editor has no server and cannot read the repo at runtime, so the YAML
 * has to be embedded. Generating it means the examples a student opens in the
 * browser are byte-identical to the ones the CLI and tests run against.
 *
 * Every example is a file map, even single-file ones, so the editor has one
 * shape to handle and multi-file models load the same way as any other.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { writeIfChanged, readText } from './write-if-changed.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STARTER = `# A minimal model. Edit anything and the panes update as you type.
project:
  name: blinker
  version: "1.0"

target:
  board: esp32

hardware:
  devices:
    led:
      type: digital_output
      pin: GPIO2

parameters:
  blink_ms:
    type: int
    default: 500
    range: [50, 5000]
    unit: ms

events:
  PRESS:
    source: external

machine:
  states:
    off:
    on:

  transitions:
    - from: off
      on: PRESS
      to: on
      do: led_on

    - from: on
      on: PRESS
      to: off
      do: led_off
`;

const SOURCES = [
  {
    label: 'starter — a two-state blinker',
    entry: 'blinker.yaml',
    files: { 'blinker.yaml': STARTER },
  },
  {
    label: 'blink — no state machine at all, just a task',
    file: 'examples/blink.yaml',
  },
  {
    label: 'serial console — commands over the serial monitor, no state machine',
    file: 'examples/serial_console.yaml',
  },
  {
    label: 'boiler — multi-file, hierarchical states, guards',
    dir: 'examples/boiler',
    entry: 'pulse.yaml',
  },
  {
    label: 'hierarchy — nesting and inner-vs-outer precedence',
    file: 'test/fixtures/hierarchy.yaml',
  },
  {
    // Loaded as several buffers so `include` resolves between them, exactly
    // as it does on disk.
    label: 'greenhouse — interfaces, libraries and MQTT',
    dir: 'examples/greenhouse',
    entry: 'greenhouse.yaml',
  },
  {
    label: 'traffic light — phases, a pedestrian request and a night mode',
    file: 'examples/traffic_light.yaml',
  },
  {
    label: 'vending machine — internal transitions for credit accumulation',
    file: 'examples/vending_machine.yaml',
  },
  {
    label: 'motor controller — speed phases and an overcurrent trip',
    file: 'examples/motor_controller.yaml',
  },
  {
    label: 'pump & tank — float switches, dry-run and overfill',
    file: 'examples/pump_tank.yaml',
  },
  {
    label: 'sensor gateway — a field bus, an uplink and degraded operation',
    dir: 'examples/sensor_gateway',
    entry: 'pulse.yaml',
  },
  {
    label: 'RTC clock — DS3231 time on an I2C LCD, no C required',
    file: 'examples/rtc_clock.yaml',
  },
];

const examples = {};

for (const source of SOURCES) {
  if (source.files) {
    examples[source.label] = { entry: source.entry, files: source.files };
    continue;
  }

  if (source.file) {
    const name = path.basename(source.file);
    examples[source.label] = {
      entry: name,
      files: { [name]: readText(path.join(repoRoot, source.file)) },
    };
    continue;
  }

  const dir = path.join(repoRoot, source.dir);
  const files = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    files[name] = readText(path.join(dir, name));
  }

  if (!files[source.entry]) {
    throw new Error(`${source.dir} has no entry file "${source.entry}"`);
  }
  examples[source.label] = { entry: source.entry, files };
}

const body = Object.entries(examples)
  .map(([label, model]) => {
    const files = Object.entries(model.files)
      .map(([name, text]) => `      ${JSON.stringify(name)}: ${JSON.stringify(text)},`)
      .join('\n');
    return `  ${JSON.stringify(label)}: {\n` +
      `    entry: ${JSON.stringify(model.entry)},\n` +
      `    files: {\n${files}\n    },\n  },`;
  })
  .join('\n');

const output = `/**
 * GENERATED FILE - do not edit.
 * Produced by scripts/build-examples.mjs from the models on disk.
 */

export interface ExampleModel {
  /** File the parser starts from; the only one that declares \`project\`. */
  entry: string;
  /** Every file in the model, keyed by the path an include would use. */
  files: Record<string, string>;
}

export const EXAMPLES: Record<string, ExampleModel> = {
${body}
};
`;

const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'web/examples.ts');

const changed = writeIfChanged(target, output);

const count = Object.keys(examples).length;
const fileCount = Object.values(examples).reduce((n, m) => n + Object.keys(m.files).length, 0);
const where = path.relative(repoRoot, target);
console.log(changed
  ? `✓ Baked ${count} examples (${fileCount} files) into ${where}`
  : `· ${where} already current (${count} examples, ${fileCount} files)`);
