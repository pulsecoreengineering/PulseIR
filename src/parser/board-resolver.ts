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

  return {
    name:        obj['name'] as string,
    mcu:         obj['mcu'] as string,
    frameworks:  obj['frameworks'] as string[],
    description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
    pins,
    defaults:    obj['defaults'] as Record<string, string | number> | undefined,
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
