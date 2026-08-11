/**
 * Library manifest emitter (IR → JSON).
 *
 * Answers "what do I have to install before this sketch builds", for both a
 * human and a build system. Two sources feed it:
 *
 *   - libraries the model declares (third-party drivers)
 *   - libraries an interface implies (Wire for I2C, PubSubClient for MQTT)
 *
 * The second is the point: declaring `interface: i2c` should not also require
 * remembering that it means `Wire.h`.
 */

import type { PulseProject } from '../model/index.js';
import { InterfaceBackend } from '../codegen/interfaces.js';

export interface LibraryEntry {
  name: string;
  include: string;
  /** "builtin" ships with the board core; "registry" must be installed. */
  source: 'builtin' | 'registry' | 'git' | 'local';
  version?: string;
  url?: string;
  /** Why this library is needed - an interface name, or the model's description. */
  reason: string;
  /** True when an interface pulled it in rather than the model declaring it. */
  implied: boolean;
}

export interface LibraryManifest {
  schema: 'pulseir/libraries@1';
  project: string;
  version: string;
  /** Everything needed, implied and declared, sorted by name. */
  libraries: LibraryEntry[];
  /** PlatformIO `lib_deps` lines for the entries that need installing. */
  platformio: string[];
}

export class LibraryEmitter {
  private backend = new InterfaceBackend();

  emit(project: PulseProject): LibraryManifest {
    const entries = new Map<string, LibraryEntry>();

    // Implied first, so an explicit declaration can override with a version.
    for (const resource of project.system.resources || []) {
      const emission = this.backend.emit(resource, resource.name.toUpperCase());
      for (const library of emission.libraries) {
        if (entries.has(library.name)) continue;
        entries.set(library.name, {
          name: library.name,
          include: library.include,
          source: library.source,
          reason: `required by ${resource.name} (${resource.interface})`,
          implied: true,
        });
      }
    }

    for (const library of project.system.libraries || []) {
      entries.set(library.name, {
        name: library.name,
        include: library.include || `${library.name}.h`,
        source: library.source || 'registry',
        ...(library.version ? { version: library.version } : {}),
        ...(library.url ? { url: library.url } : {}),
        reason: library.description || 'declared in the model',
        implied: false,
      });
    }

    const libraries = Array.from(entries.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      schema: 'pulseir/libraries@1',
      project: project.name,
      version: String(project.version),
      libraries,
      platformio: libraries.filter(needsInstalling).map(toLibDep),
    };
  }

  toJSON(project: PulseProject): string {
    return JSON.stringify(this.emit(project), null, 2) + '\n';
  }
}

/** Core-bundled libraries are already present; listing them would break a build. */
function needsInstalling(entry: LibraryEntry): boolean {
  return entry.source !== 'builtin';
}

function toLibDep(entry: LibraryEntry): string {
  if (entry.source === 'git' && entry.url) return entry.url;
  if (entry.source === 'local' && entry.url) return `file://${entry.url}`;
  return entry.version ? `${entry.name}@${entry.version}` : entry.name;
}

export { LibraryEmitter as default };
