/**
 * Named projects, stored in the browser.
 *
 * The editor used to hold exactly one workspace in one localStorage key, which
 * made it a demo rather than somewhere to work: starting a second model
 * destroyed the first. A student working through exercises needs to keep them.
 *
 * Storage is deliberately dumb - a map of projects and a pointer at the current
 * one - because the durable copy is the exported folder, not this. localStorage
 * is a cache that one "clear browsing data" wipes, so nothing here is treated
 * as the record.
 */

export interface Project {
  id: string;
  name: string;
  /** Open buffers, keyed by the path an import would use. */
  files: Record<string, string>;
  /** File the parser starts from; the only one that declares `project`. */
  entry: string;
  /** File shown in the editor. */
  active: string;
  /** Epoch ms, so the list can be ordered by most recently touched. */
  updatedAt: number;
}

/** The slice of localStorage this needs, so tests can supply their own. */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROJECTS_KEY = 'pulseir.projects';
const CURRENT_KEY = 'pulseir.currentProject';
/** The single-workspace key this replaced. Migrated once, then removed. */
const LEGACY_KEY = 'pulseir.workspace';

/**
 * Best-effort name for a model, from its own `project: name:`.
 *
 * A regex rather than the parser: this runs on a half-typed model that may not
 * parse at all, and a project still needs something to be called.
 */
export function nameFromModel(yaml: string, fallback: string): string {
  const block = /^project:[^\S\n]*\n(?:[^\S\n]+.*\n?)*/m.exec(yaml)?.[0];
  const name = block ? /^[^\S\n]+name:[^\S\n]*(?:"([^"]*)"|'([^']*)'|(\S+))/m.exec(block) : null;
  const found = name?.[1] ?? name?.[2] ?? name?.[3];
  return found?.trim() || fallback;
}

let counter = 0;

function newId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}`;
}

let lastStamp = 0;

/**
 * A timestamp that never repeats.
 *
 * The project list is ordered by `updatedAt`, and two projects created in the
 * same millisecond - which "New" twice in quick succession, or a bulk import,
 * really does produce - would otherwise tie and fall back to whatever order the
 * object happened to have. Nudging forward keeps "most recent first" true.
 */
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

export class ProjectStore {
  constructor(private storage: Storage) {}

  private readAll(): Record<string, Project> {
    const raw = this.storage.getItem(PROJECTS_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, Project>;
      // Corrupt state must not brick the editor; an unusable shape reads as
      // "no projects" and the caller starts fresh.
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeAll(projects: Record<string, Project>): void {
    this.storage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  }

  /** Every project, most recently updated first. */
  list(): Project[] {
    return Object.values(this.readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Project | null {
    return this.readAll()[id] ?? null;
  }

  /** The project last opened, or the most recent one, or null when empty. */
  current(): Project | null {
    const id = this.storage.getItem(CURRENT_KEY);
    if (id) {
      const found = this.get(id);
      if (found) return found;
    }
    return this.list()[0] ?? null;
  }

  setCurrent(id: string): void {
    this.storage.setItem(CURRENT_KEY, id);
  }

  /** A name not already taken, by appending a number. */
  uniqueName(wanted: string): string {
    const taken = new Set(this.list().map(p => p.name));
    if (!taken.has(wanted)) return wanted;

    for (let n = 2; ; n++) {
      const candidate = `${wanted} ${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  create(name: string, files: Record<string, string>, entry: string): Project {
    const project: Project = {
      id: newId(),
      name: this.uniqueName(name),
      files: { ...files },
      entry,
      active: entry,
      updatedAt: stamp(),
    };

    const all = this.readAll();
    all[project.id] = project;
    this.writeAll(all);
    this.setCurrent(project.id);
    return project;
  }

  /** Store the current contents of a project. Touches updatedAt. */
  save(project: Project): void {
    const all = this.readAll();
    all[project.id] = { ...project, updatedAt: stamp() };
    this.writeAll(all);
  }

  rename(id: string, name: string): Project | null {
    const all = this.readAll();
    const project = all[id];
    if (!project) return null;

    // uniqueName would otherwise reject the project's own current name.
    const others = new Set(Object.values(all).filter(p => p.id !== id).map(p => p.name));
    let unique = name;
    for (let n = 2; others.has(unique); n++) unique = `${name} ${n}`;

    project.name = unique;
    project.updatedAt = stamp();
    this.writeAll(all);
    return project;
  }

  duplicate(id: string): Project | null {
    const source = this.get(id);
    if (!source) return null;
    return this.create(`${source.name} copy`, source.files, source.entry);
  }

  /** Removes it, and returns whatever should be opened next. */
  remove(id: string): Project | null {
    const all = this.readAll();
    delete all[id];
    this.writeAll(all);

    const next = this.list()[0] ?? null;
    if (next) this.setCurrent(next.id);
    else this.storage.removeItem(CURRENT_KEY);
    return next;
  }

  /**
   * Bring the pre-projects single workspace across, once.
   *
   * Someone with work in the old key must not lose it just because the editor
   * grew projects. Returns the migrated project, or null when there was none.
   */
  migrateLegacy(): Project | null {
    const raw = this.storage.getItem(LEGACY_KEY);
    if (!raw) return null;

    try {
      const old = JSON.parse(raw) as { files?: Record<string, string>; entry?: string };
      if (!old?.files || !old.entry || old.files[old.entry] === undefined) {
        this.storage.removeItem(LEGACY_KEY);
        return null;
      }

      const project = this.create(
        nameFromModel(old.files[old.entry], 'My model'),
        old.files,
        old.entry
      );
      this.storage.removeItem(LEGACY_KEY);
      return project;
    } catch {
      this.storage.removeItem(LEGACY_KEY);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const MODEL_FILE = /\.ya?ml$/i;

/**
 * Turn a set of imported paths into a project's files.
 *
 * Handles the two things a real folder brings with it:
 *
 *  - a wrapping directory, because zipping `boiler/` gives you entries called
 *    `boiler/pulse.yaml`, and importing those as-is would break every relative
 *    import inside the model
 *  - everything that is not a model file: a `src/` of C++, a README, the junk a
 *    desktop drops in. Those are not the editor's to hold.
 */
export function foldImport(paths: Record<string, string>): {
  files: Record<string, string>;
  folder: string | null;
} {
  const names = Object.keys(paths).filter(p => MODEL_FILE.test(p) && !p.split('/').some(isJunk));
  if (names.length === 0) return { files: {}, folder: null };

  const folder = commonFolder(names);
  const files: Record<string, string> = {};
  for (const name of names) {
    files[folder ? name.slice(folder.length + 1) : name] = paths[name];
  }
  return { files, folder };
}

function isJunk(segment: string): boolean {
  return segment === '__MACOSX' || segment === '.git' || segment.startsWith('._');
}

/** The single directory every path sits under, or null if they differ. */
function commonFolder(names: string[]): string | null {
  const first = names[0].split('/');
  if (first.length < 2) return null;

  const candidate = first[0];
  return names.every(n => n.startsWith(`${candidate}/`)) ? candidate : null;
}

/**
 * What to call an imported project.
 *
 * The folder wins when there is one. Export writes the project's own name as
 * the folder, so this is what makes export-then-import give back the project
 * you had rather than renaming it to whatever the model declares - and a folder
 * someone named by hand is a deliberate choice too. Only a loose set of files,
 * which has no folder, falls back to the model's `project: name:`.
 */
export function importedName(
  files: Record<string, string>,
  entry: string,
  folder: string | null,
  fallback: string
): string {
  if (folder) return folder;
  return nameFromModel(files[entry] ?? '', fallback);
}

/**
 * Which file the parser should start from.
 *
 * The entry file is the only one that declares `project:`, so that is what
 * identifies it - not its name. `pulse.yaml` is only a convention, and a model
 * exported from a single-file example is called anything at all.
 */
export function findEntry(files: Record<string, string>): string | null {
  const names = Object.keys(files).sort();
  const declares = names.filter(n => /^project:/m.test(files[n]));

  if (declares.length === 1) return declares[0];
  if (declares.length > 1) {
    // Ambiguous, so fall back to the conventional name if it is one of them.
    return declares.find(n => /^pulse\.ya?ml$/i.test(n)) ?? declares[0];
  }
  return names[0] ?? null;
}
