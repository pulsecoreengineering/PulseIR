/**
 * Board resolver — loads a board definition from boards/<id>.yaml and
 * rewrites logical pin names in a parsed PulseProject to their physical
 * equivalents before the project reaches the code generator.
 *
 * Resolution is intentionally non-destructive: any value that does not appear
 * as a key in the board's pin map is passed through unchanged.  This lets
 * models that already use physical GPIO names (GPIO2, 21, …) work with or
 * without a board file, and lets users mix logical and physical names in the
 * same model if they choose.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import type { BoardDefinition } from '../model/board.js';
import type { PulseProject, Component, Resource } from '../model/index.js';

// Pin fields examined on a Resource.binding.
// Every interface that carries wiring info is covered here.
const BUS_PIN_FIELDS = new Set([
  'sda', 'scl',            // I2C
  'mosi', 'miso', 'sck', 'cs',  // SPI
  'tx', 'rx',              // UART
  'pin',                   // GPIO / PWM / ADC single-pin buses
]);

/**
 * Locate the boards/ directory bundled with this package.
 *
 * The caller may also supply an absolute path to a custom board file,
 * in which case no lookup is performed.
 */
function builtinBoardsDir(): string {
  // __dirname equivalent in ESM: resolve from this file's URL.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/parser/ → src/ → project root → boards/
  return path.resolve(here, '../../..', 'boards');
}

/**
 * Load a board definition by id (e.g. "esp32_devkit_v4") or by absolute path.
 *
 * Throws a descriptive Error when the file is missing or invalid.
 */
export function loadBoard(idOrPath: string): BoardDefinition {
  let filePath: string;

  if (path.isAbsolute(idOrPath) || idOrPath.includes(path.sep)) {
    filePath = idOrPath;
  } else {
    // Strip any .yaml extension the user may have included.
    const bare = idOrPath.replace(/\.ya?ml$/i, '');
    filePath = path.join(builtinBoardsDir(), `${bare}.yaml`);
  }

  if (!fs.existsSync(filePath)) {
    const dir = builtinBoardsDir();
    let hint = `Board "${idOrPath}" not found at ${filePath}.`;
    try {
      const available = fs.readdirSync(dir)
        .filter(f => /\.ya?ml$/i.test(f))
        .map(f => f.replace(/\.ya?ml$/i, ''))
        .join(', ');
      if (available) hint += ` Available boards: ${available}.`;
    } catch {
      // boards/ directory itself may be missing in a custom install; stay silent.
    }
    throw new Error(hint);
  }

  const raw = yaml.load(fs.readFileSync(filePath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Board file ${filePath} is not a YAML mapping.`);
  }

  const obj = raw as Record<string, unknown>;

  // Follow a one-level alias (cross-platform alternative to symlinks).
  if (typeof obj['alias'] === 'string') {
    return loadBoard(obj['alias']);
  }

  if (typeof obj['name'] !== 'string') {
    throw new Error(`Board file ${filePath} is missing a "name" field.`);
  }
  if (typeof obj['mcu'] !== 'string') {
    throw new Error(`Board file ${filePath} is missing an "mcu" field.`);
  }
  if (!Array.isArray(obj['frameworks'])) {
    throw new Error(`Board file ${filePath} is missing a "frameworks" list.`);
  }
  if (!obj['pins'] || typeof obj['pins'] !== 'object' || Array.isArray(obj['pins'])) {
    throw new Error(`Board file ${filePath} is missing a "pins" mapping.`);
  }

  // Normalise every pin value to string.
  const pins: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj['pins'] as Record<string, unknown>)) {
    pins[k] = String(v);
  }

  // Optional per-pin capability map.  Each value may be a single tag string or
  // an array of tag strings; both are normalised to string[].
  const pinCaps: Record<string, string[]> = {};
  const rawCaps = obj['pin_caps'];
  if (rawCaps && typeof rawCaps === 'object' && !Array.isArray(rawCaps)) {
    for (const [k, v] of Object.entries(rawCaps as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        pinCaps[k] = v.map(String);
      } else if (typeof v === 'string') {
        pinCaps[k] = [v];
      }
    }
  }

  // Optional list of physical GPIO identifiers that share ADC unit 2.
  const adc2Pins: string[] = Array.isArray(obj['adc2_pins'])
    ? (obj['adc2_pins'] as unknown[]).map(String)
    : [];

  return {
    name:        obj['name'] as string,
    mcu:         obj['mcu'] as string,
    frameworks:  obj['frameworks'] as string[],
    description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
    pins,
    pinCaps:  Object.keys(pinCaps).length > 0 ? pinCaps : undefined,
    adc2Pins: adc2Pins.length > 0 ? adc2Pins : undefined,
    defaults: obj['defaults'] as Record<string, string | number> | undefined,
  };
}

/** Resolve a single pin value against the board map; pass through if not found. */
function resolvePin(value: unknown, pins: Record<string, string>): unknown {
  if (typeof value !== 'string') return value;
  return pins[value] ?? value;
}

/** Rewrite the pin field inside a Component's config record. */
function resolveComponent(comp: Component, pins: Record<string, string>): Component {
  if (!comp.config) return comp;
  const config = { ...comp.config };
  if ('pin' in config) {
    config['pin'] = resolvePin(config['pin'], pins);
  }
  return { ...comp, config };
}

/** Rewrite pin fields inside a Resource's binding record. */
function resolveResource(res: Resource, pins: Record<string, string>): Resource {
  if (!res.binding) return res;
  const binding = { ...res.binding };
  for (const field of BUS_PIN_FIELDS) {
    if (field in binding) {
      binding[field] = resolvePin(binding[field], pins);
    }
  }
  return { ...res, binding };
}

/**
 * Walk a PulseProject and replace every logical pin name with the physical
 * pin the board definition maps it to.
 *
 * Returns a new PulseProject with the resolved values; the original is not
 * modified.
 */
export function resolveBoard(project: PulseProject, board: BoardDefinition): PulseProject {
  const { pins } = board;
  const sys = project.system;

  const components = sys.components?.map(c => resolveComponent(c, pins));
  const resources  = sys.resources?.map(r => resolveResource(r, pins));

  return {
    ...project,
    system: {
      ...sys,
      ...(components && { components }),
      ...(resources  && { resources }),
    },
  };
}

// Bus fields that carry a physical pin identifier and can therefore violate
// reserved / input-only constraints.
const BUS_PIN_FIELDS_LIST = ['sda', 'scl', 'mosi', 'miso', 'sck', 'cs', 'tx', 'rx', 'pin'];

export interface PinViolation {
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Check that every device pin and bus pin used in the project is compatible
 * with the board's declared capabilities.
 *
 * Called after resolveBoard() so all logical names have already been converted
 * to their physical GPIO identifiers.
 *
 * Returns an array of violations; the caller decides how to report them.
 * An empty array means no problems were found.
 */
export function checkPinCapabilities(
  project: PulseProject,
  board: BoardDefinition,
): PinViolation[] {
  const violations: PinViolation[] = [];
  const caps     = board.pinCaps ?? {};
  const adc2Pins = new Set(board.adc2Pins ?? []);

  const OUTPUT_TYPES = new Set(['digital_output', 'pwm_output']);
  const INPUT_TYPES  = new Set(['digital_input',  'analog_input']);

  for (const device of project.system.components ?? []) {
    const pin  = String(device.config?.pin ?? '');
    if (!pin) continue;

    const tags     = caps[pin] ?? [];
    const isOutput = OUTPUT_TYPES.has(device.type ?? '');

    if (tags.includes('input_only') && isOutput) {
      violations.push({
        severity: 'error',
        message:
          `Device "${device.name}" uses ${pin} as an output, but ${pin} is ` +
          `input-only on ${board.name}. Choose a bidirectional GPIO.`,
      });
    }

    if (tags.includes('reserved')) {
      violations.push({
        severity: 'error',
        message:
          `Device "${device.name}" uses ${pin}, which is reserved ` +
          `(internal flash/PSRAM) on ${board.name} — do not use this pin.`,
      });
    }

    if (tags.includes('strapping') && isOutput) {
      violations.push({
        severity: 'warning',
        message:
          `Device "${device.name}" uses ${pin}, a strapping pin on ${board.name}. ` +
          `Driving it LOW at reset may prevent the board from booting.`,
      });
    }
  }

  // Check bus bindings for reserved / input-only pins.
  for (const resource of project.system.resources ?? []) {
    if (!resource.binding) continue;
    for (const field of BUS_PIN_FIELDS_LIST) {
      const pin = String((resource.binding as Record<string, unknown>)[field] ?? '');
      if (!pin) continue;
      const tags = caps[pin] ?? [];

      if (tags.includes('reserved')) {
        violations.push({
          severity: 'error',
          message:
            `Bus "${resource.name}" uses ${pin} (field: ${field}), which is ` +
            `reserved on ${board.name} — do not use this pin.`,
        });
      }
      if (tags.includes('input_only')) {
        // Only output directions (MOSI, TX, SDA when writing) matter; MISO/RX are
        // inputs from the CPU's perspective.  Flag conservatively for any non-input field.
        const isOutputDirection = !['miso', 'rx'].includes(field);
        if (isOutputDirection) {
          violations.push({
            severity: 'error',
            message:
              `Bus "${resource.name}" uses ${pin} (field: ${field}), which is ` +
              `input-only on ${board.name}.`,
          });
        }
      }
    }
  }

  // ADC2 vs Wi-Fi conflict (ESP32 family).
  if (adc2Pins.size > 0) {
    const hasWifi = (project.system.resources ?? []).some(r =>
      ['mqtt', 'wifi'].includes(String(r.interface).toLowerCase())
    );
    if (hasWifi) {
      for (const device of project.system.components ?? []) {
        if (device.type !== 'analog_input') continue;
        const pin = String(device.config?.pin ?? '');
        if (adc2Pins.has(pin)) {
          violations.push({
            severity: 'warning',
            message:
              `Device "${device.name}" uses ${pin} (ADC2) on ${board.name}. ` +
              `ADC2 is unavailable while Wi-Fi is active — use an ADC1 pin instead ` +
              `(GPIO32–GPIO39 for ESP32).`,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Validate that the chosen --target is compatible with the board's declared
 * frameworks.  Emits a warning string rather than throwing so the CLI can
 * decide whether to abort or continue.
 */
export function checkFrameworkCompatibility(
  board: BoardDefinition,
  target: string,
): string | null {
  const normalized = target.toLowerCase().replace(/[-_]/g, '');
  const supported  = board.frameworks.map(f => f.toLowerCase().replace(/[-_]/g, ''));

  if (supported.includes(normalized)) return null;

  return (
    `Board "${board.name}" lists supported frameworks [${board.frameworks.join(', ')}] ` +
    `but --target ${target} was requested. Code may not compile on this board.`
  );
}
