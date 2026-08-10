/**
 * Bakes the on-disk example models into web/examples.ts.
 *
 * The editor has no server and cannot read the repo at runtime, so the YAML
 * has to be embedded. Generating it means the examples a student opens in the
 * browser are byte-identical to the ones the CLI and tests run against.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCES = [
  ['boiler — hierarchical states, guards, wildcard stop', 'examples/boiler.yaml'],
  ['hierarchy — nesting and inner-vs-outer precedence', 'test/fixtures/hierarchy.yaml'],
];

const STARTER = `# A minimal model. Edit anything and the panes update as you type.
project:
  name: blinker
  version: "1.0"

system:
  name: blinker

  events:
    - name: PRESS
      source: external

  states:
    - name: off
      type: simple
    - name: on
      type: simple

  transitions:
    - source: off
      event: PRESS
      target: on
      actions:
        - led_on

    - source: on
      event: PRESS
      target: off
      actions:
        - led_off

  components:
    - name: led
      class: actuator
      driver: gpio_control
      config:
        pin: GPIO2

  parameters:
    - name: blink_ms
      type: int
      default: 500
      unit: ms
      min: 50
      max: 5000
`;

const entries = [['starter — a two-state blinker', STARTER]];
for (const [label, relative] of SOURCES) {
  entries.push([label, fs.readFileSync(path.join(repoRoot, relative), 'utf8')]);
}

const body = entries
  .map(([label, yaml]) => `  ${JSON.stringify(label)}: ${JSON.stringify(yaml)},`)
  .join('\n');

const output = `/**
 * GENERATED FILE - do not edit.
 * Produced by scripts/build-examples.mjs from the models on disk.
 */

export const EXAMPLES: Record<string, string> = {
${body}
};
`;

// An explicit target lets the test regenerate into a temp file rather than
// overwriting the tracked one just to compare against it.
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'web/examples.ts');

fs.writeFileSync(target, output);
console.log(`✓ Baked ${entries.length} examples into ${path.relative(repoRoot, target)}`);
