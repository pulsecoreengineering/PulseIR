/**
 * PulseIR Parser
 * 
 * Converts YAML → PulseModel
 * Validates references and schema
 */

import * as yaml from 'js-yaml';
import type {
  PulseProject,
  PulseSystem,
  State,
  Event,
  Transition,
  Component,
  Resource,
  Parameter,
  Library,
  Guard,
  Action,
  Region,
  StateRef,
  Task,
  Command,
  CommandSet,
} from '../model/index.js';
import type { SourceResolver } from './resolver.js';
import { findPinConflicts, describePinConflict } from '../analysis/pins.js';
import { parseTemplate, templateRefs, TemplateError } from '../analysis/template.js';

export interface ParseOptions {
  /** Id of the document being parsed, used to resolve relative includes. */
  origin?: string;
  /** Supplies included files. Without one, `include` is an error. */
  resolver?: SourceResolver;
}

/** Sections of `system` that concatenate across included files. */
const MERGED_LISTS = [
  'events',
  'states',
  'transitions',
  'components',
  'resources',
  'parameters',
  'libraries',
] as const;

/** Guards against a runaway include graph even if cycle detection is bypassed. */
const MAX_INCLUDE_DEPTH = 32;

/**
 * The schema version this build of the toolchain understands.
 *
 * Models may declare `pulseir: "1"` at the top level. A model that declares a
 * higher version than this was written for a newer toolchain; the parser warns
 * rather than errors so existing models keep compiling while the author
 * investigates.  A model that declares a *lower* version is from an older
 * schema; a parser migration note is emitted as a warning, not an error.
 * Omitting `pulseir:` entirely is accepted silently for backward compatibility.
 */
export const SCHEMA_VERSION = 1;

export class ParseError extends Error {
  /** Distinguishes semantic "nothing to generate" from a real syntax fault. */
  kind?: 'empty-model';

  constructor(
    message: string,
    public line?: number,
    public column?: number
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Device types the model understands without further declaration. Each implies
 * a class (so the topic emitter knows a reading from a control) and a driver.
 * Anything else must state its class explicitly.
 */
const BUILTIN_DEVICE_TYPES: Record<string, { class: string; driver: string }> = {
  digital_output: { class: 'actuator', driver: 'gpio_control' },
  digital_input:  { class: 'sensor',   driver: 'gpio_read' },
  pwm_output:     { class: 'actuator', driver: 'pwm_control' },
  analog_input:   { class: 'sensor',   driver: 'adc_read' },
  // Common parts, listed so `type: ds18b20` needs no `class:`.
  ds18b20:        { class: 'sensor',   driver: 'ds18b20' },
  dht22:          { class: 'sensor',   driver: 'dht22' },
  bme280:         { class: 'sensor',   driver: 'bme280' },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Name a document in an error message, whether or not it came from a file. */
function describe(origin: string | null): string {
  return origin ? `"${origin}"` : 'The model';
}

export class Parser {
  /** Non-fatal notes from the last parse, e.g. use of a retired schema. */
  readonly warnings: string[] = [];

  private eventNames: Set<string> = new Set();
  private stateNames: Set<string> = new Set();
  private actionNames: Set<string> = new Set();

  /** Full state paths, e.g. "running/heating" */
  private statePaths: Set<string> = new Set();
  /** Leaf name → every full path carrying that name */
  private statesByLeafName: Map<string, string[]> = new Map();

  /**
   * Parse YAML string into PulseModel
   * Throws ParseError if invalid
   *
   * Pass a resolver in `options` to allow the document to `include` others.
   */
  parse(yamlContent: string, options: ParseOptions = {}): PulseProject {
    this.warnings.length = 0;
    try {
      const raw = this.loadDocument(
        yamlContent,
        options.origin ?? null,
        options,
        new Set(options.origin ? [options.origin] : []),
        0
      );
      return this.parseProject(raw);
    } catch (error) {
      if (error instanceof yaml.YAMLException) {
        throw new ParseError(
          error.message,
          error.mark?.line,
          error.mark?.column
        );
      }
      if (error instanceof ParseError) {
        throw error;
      }
      throw new ParseError(`Unknown error: ${error}`);
    }
  }

  /**
   * Read a model from a resolver, following includes.
   * `entry` is resolved the same way an include would be.
   */
  parseFrom(entry: string, resolver: SourceResolver): PulseProject {
    const origin = resolver.resolve(entry, null);
    let content: string;
    try {
      content = resolver.read(origin);
    } catch (error) {
      throw new ParseError(
        `Cannot read model "${entry}": ${error instanceof Error ? error.message : error}`
      );
    }
    return this.parse(content, { origin, resolver });
  }

  // =========================================================================
  // MULTI-FILE LOADING
  // =========================================================================

  /**
   * Load one document and splice in anything it includes.
   *
   * Includes are merged first, in the order listed, and the including file is
   * layered on top - so a file always overrides what it pulls in, and list
   * sections read in a predictable order.
   */
  private loadDocument(
    content: string,
    origin: string | null,
    options: ParseOptions,
    seen: Set<string>,
    depth: number
  ): Record<string, unknown> {
    if (depth > MAX_INCLUDE_DEPTH) {
      throw new ParseError(`Include nesting deeper than ${MAX_INCLUDE_DEPTH} levels`);
    }

    const doc = (yaml.load(content) ?? {}) as Record<string, unknown>;
    if (typeof doc !== 'object' || Array.isArray(doc)) {
      throw new ParseError(`${describe(origin)} must contain a YAML mapping`);
    }

    if (doc.include !== undefined && doc.imports === undefined) {
      this.warnings.push(
        `${describe(origin)} uses "include"; the key is now "imports". ` +
        'Support will be removed in the next release.'
      );
    }
    if (doc.includes !== undefined && doc.imports === undefined && doc.include === undefined) {
      throw new ParseError(`${describe(origin)} uses "includes"; the key is "imports"`);
    }

    const refs = this.includeRefs(doc.imports ?? doc.include, origin);
    if (refs.length === 0) return doc;

    const resolver = options.resolver;
    if (!resolver) {
      throw new ParseError(
        `${describe(origin)} uses "imports", but this parser was given no way to ` +
        'read other files. Load the model from a path (the CLI does this) or ' +
        'supply a resolver.'
      );
    }

    let merged: Record<string, unknown> = {};

    for (const ref of refs) {
      const id = resolver.resolve(ref, origin);

      if (seen.has(id)) {
        throw new ParseError(
          `Include cycle: "${ref}" is already being loaded (${id})`
        );
      }

      let included: string;
      try {
        included = resolver.read(id);
      } catch (error) {
        throw new ParseError(
          `${describe(origin)} includes "${ref}", which cannot be read: ` +
          `${error instanceof Error ? error.message : error}`
        );
      }

      seen.add(id);
      const loaded = this.loadDocument(included, id, options, seen, depth + 1);
      seen.delete(id);

      if (loaded.project !== undefined) {
        throw new ParseError(
          `Included file "${ref}" declares "project". Only the top-level model ` +
          'may declare it, so the project has one identity.'
        );
      }

      merged = this.mergeDocuments(merged, loaded);
    }

    // The including file wins over everything it pulled in.
    return this.mergeDocuments(merged, doc);
  }

  private includeRefs(value: unknown, origin: string | null): string[] {
    if (value === undefined || value === null) return [];

    const list = Array.isArray(value) ? value : [value];
    return list.map(entry => {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new ParseError(`${describe(origin)} has an include entry that is not a file path`);
      }
      return entry;
    });
  }

  /**
   * Combine two raw documents. List sections concatenate so several files can
   * each contribute states or events; everything else is overridden by the
   * later document.
   */
  private mergeDocuments(
    base: Record<string, unknown>,
    overlay: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base, ...overlay };
    delete result.imports;
    delete result.include;

    // Domains keyed by name: hardware.yaml and machine.yaml each contribute
    // entries, and a name declared in both is an error rather than a silent
    // override - neither file looks wrong on its own.
    for (const key of ['events', 'parameters', 'actions'] as const) {
      const merged = this.mergeMaps(base[key], overlay[key], key);
      if (merged !== undefined) result[key] = merged;
    }

    for (const [parent, children] of [
      ['hardware', ['buses', 'devices']],
      ['machine', ['states']],
    ] as const) {
      const left = base[parent] as Record<string, unknown> | undefined;
      const right = overlay[parent] as Record<string, unknown> | undefined;
      if (!left || !right) continue;

      const section: Record<string, unknown> = { ...left, ...right };
      for (const child of children) {
        const merged = this.mergeMaps(left[child], right[child], `${parent}.${child}`);
        if (merged !== undefined) section[child] = merged;
      }
      // Transitions are ordered rules, so they concatenate rather than merge.
      if (parent === 'machine' && Array.isArray(left.transitions) && Array.isArray(right.transitions)) {
        section.transitions = [...left.transitions, ...right.transitions];
      }
      result[parent] = section;
    }

    if (Array.isArray(base.libraries) && Array.isArray(overlay.libraries)) {
      result.libraries = [...base.libraries, ...overlay.libraries];
    }

    // Retired shape: everything under `system:`, all sections lists.
    const baseSystem = base.system as Record<string, unknown> | undefined;
    const overlaySystem = overlay.system as Record<string, unknown> | undefined;
    if (baseSystem && overlaySystem) {
      const system: Record<string, unknown> = { ...baseSystem, ...overlaySystem };
      for (const key of MERGED_LISTS) {
        const left = baseSystem[key];
        const right = overlaySystem[key];
        if (Array.isArray(left) && Array.isArray(right)) {
          system[key] = [...left, ...right];
        }
      }
      result.system = system;
    }

    return result;
  }

  /** Union two name-keyed sections, refusing a name that appears in both. */
  private mergeMaps(left: unknown, right: unknown, label: string): unknown {
    if (!isPlainObject(left) || !isPlainObject(right)) return undefined;

    for (const name of Object.keys(right)) {
      if (name in left) {
        throw new ParseError(
          `"${label}.${name}" is declared in two different files. ` +
          'Each name may only be defined once across the whole model.'
        );
      }
    }
    return { ...left, ...right };
  }

  // =========================================================================
  // PARSING
  // =========================================================================

  private parseProject(raw: Record<string, unknown>): PulseProject {
    const projectRaw = raw.project as Record<string, unknown>;
    if (!projectRaw) {
      throw new ParseError('Missing "project" section');
    }

    // The retired shape put everything under `system:`. It still parses for
    // one release so existing models keep working, but it is announced rather
    // than silently translated.
    const legacy = raw.system !== undefined;
    if (legacy) {
      this.warnings.push(
        'This model uses the retired "system:" block. Split it into the ' +
        'top-level domains (target, hardware, parameters, events, machine, ' +
        'actions) - see PLAN.md. Support will be removed in the next release.'
      );
    }

    const system = legacy
      ? this.parseSystem(raw.system as Record<string, unknown>)
      : this.parseDomains(raw);

    const schemaVersion = this.parseSchemaVersion(raw.pulseir);

    const project: PulseProject = {
      name: projectRaw.name as string || 'unnamed',
      version: projectRaw.version as string || '0.1.0',
      description: projectRaw.description as string | undefined,
      schemaVersion,
      target: this.parseTarget(raw.target),
      system,
    };

    // A missing board declaration is not an error - the generator falls back to
    // generic code - but the fallbacks are lossy enough that the user should be
    // told explicitly rather than left to wonder why their PWM hint lists three
    // options or why pin validation did not catch an impossible GPIO number.
    if (!project.target?.board) {
      this.warnings.push(
        'No target board declared. Pin validation is disabled and board-specific ' +
        'code hints will show all options rather than just yours. Add one:\n' +
        '  target:\n' +
        '    board: esp32   # or uno, mega, nano, rp2040, esp8266 ...'
      );
    }

    // Two things wired to one pin is wrong on every board, so this needs no
    // board profile. Reported here rather than at codegen so the editor and
    // every emitter get it for free.
    //
    // A bus-versus-device clash is the one ambiguous case, and the retired
    // schema had no `bus:` field to resolve it - so for those models it is a
    // warning. Device-versus-device and bus-versus-bus stay errors everywhere.
    const conflicts = findPinConflicts(project);
    const fatal = conflicts.filter(c => !(legacy && c.busDeviceOnly));
    const ambiguous = conflicts.filter(c => legacy && c.busDeviceOnly);

    for (const conflict of ambiguous) {
      this.warnings.push(
        `${describePinConflict(conflict)}\n  Reported as a warning because this ` +
        'model uses the retired schema, which cannot declare that a device sits on a bus.'
      );
    }

    if (fatal.length > 0) {
      throw new ParseError(fatal.map(describePinConflict).join('\n\n'));
    }

    return project;
  }

  private parseSchemaVersion(raw: unknown): number | undefined {
    if (raw === undefined || raw === null) return undefined;

    const ver = typeof raw === 'number'
      ? Math.floor(raw)
      : typeof raw === 'string'
        ? parseInt(raw, 10)
        : NaN;

    if (isNaN(ver) || ver < 1) {
      throw new ParseError(
        `"pulseir" must be a positive schema version number (e.g. pulseir: "1"), ` +
        `got ${JSON.stringify(raw)}`
      );
    }

    if (ver > SCHEMA_VERSION) {
      this.warnings.push(
        `This model declares pulseir: "${ver}" but this toolchain only understands ` +
        `schema version ${SCHEMA_VERSION}. Some fields may be ignored. ` +
        `Update the toolchain, or remove the version declaration to silence this warning.`
      );
    }

    return ver;
  }

  private parseTarget(raw: unknown): PulseProject['target'] {
    if (raw === undefined || raw === null) return undefined;

    if (typeof raw === 'string') return { board: raw };

    const obj = raw as Record<string, unknown>;
    return {
      board: obj.board as string | undefined,
      verbose: obj.verbose === undefined ? undefined : Boolean(obj.verbose),
      description: obj.description as string | undefined,
    };
  }

  // =========================================================================
  // DOMAIN SCHEMA (current)
  // =========================================================================

  /**
   * Read the domain-per-section shape:
   *
   *   target:      what it is built for
   *   hardware:    buses and devices
   *   parameters:  tunable configuration
   *   events:      what the system reacts to
   *   machine:     states and transitions
   *   actions:     catalogue of named side effects
   *   libraries:   third-party code
   *
   * Sections carrying identity (devices, parameters, events, actions, states)
   * are maps keyed by name, so a duplicate is impossible to write. Ordered
   * rules - transitions - stay lists, because order decides which one shadows
   * another.
   */
  private parseDomains(raw: Record<string, unknown>): PulseSystem {
    this.resetValidationState();

    const machine = (raw.machine ?? {}) as Record<string, unknown>;
    const hardware = (raw.hardware ?? {}) as Record<string, unknown>;

    const events = this.parseEventMap(raw.events);
    events.forEach(e => this.eventNames.add(e.name));

    const states = this.parseStateMap(machine.states);
    this.indexStateNames(states);

    const actionCatalogue = this.parseActionCatalogue(raw.actions);
    actionCatalogue.forEach((_, name) => this.actionNames.add(name));

    const transitions = this.parseTransitionList(machine.transitions, actionCatalogue);
    const tasks = this.parseTaskMap(raw.tasks, actionCatalogue);
    const commands = this.parseCommands(raw.commands, actionCatalogue);

    const resources = this.parseBusMap(hardware.buses);
    const components = this.parseDeviceMap(hardware.devices);
    const parameters = this.parseParameterMap(raw.parameters);
    const libraries = this.parseLibraries(this.asList(raw.libraries, 'library'));

    this.assertUniqueNames(events, 'event');
    this.assertUniqueNames(components, 'component');
    this.assertUniqueNames(resources, 'resource');
    this.assertUniqueNames(parameters, 'parameter');
    this.assertUniqueNames(libraries, 'library');

    this.assertLibraryRefs(resources, libraries);
    this.assertBusRefs(components, resources);
    this.assertTimedTransitions(transitions, parameters || []);
    this.assertTaskIntervals(tasks, parameters || []);
    this.assertLogRefs(tasks, commands, parameters || [], components || []);
    this.assertUsable(states, tasks, commands);

    // Buses and devices generate macros from the same name, so a collision
    // between the two would silently produce one set of defines.
    const busNames = new Set((resources || []).map(r => r.name));
    for (const device of components || []) {
      if (busNames.has(device.name)) {
        throw new ParseError(
          `"${device.name}" is declared as both a bus and a device. ` +
          'Names are shared between them, so pick one.'
        );
      }
    }

    return {
      name: (raw.name as string) || ((raw.project as Record<string, unknown>)?.name as string) || 'unnamed',
      description: machine.description as string | undefined,
      events,
      states,
      transitions,
      tasks,
      commands,
      components,
      resources,
      parameters,
      libraries,
    };
  }

  /** Accept `{ name: {...} }` and turn it into `[{ name, ... }]`. */
  private mapEntries(raw: unknown, section: string): Array<[string, Record<string, unknown>]> {
    if (raw === undefined || raw === null) return [];

    if (Array.isArray(raw)) {
      throw new ParseError(
        `"${section}" is a list, but this schema keys it by name:\n` +
        `  ${section}:\n    my_${section.replace(/s$/, '')}:\n      ...`
      );
    }
    if (typeof raw !== 'object') {
      throw new ParseError(`"${section}" must be a mapping of name to definition`);
    }

    return Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
      if (!name.trim()) throw new ParseError(`"${section}" has an entry with an empty name`);
      // `my_state:` with nothing under it is a valid, empty definition.
      if (value === null || value === undefined) return [name, {}];
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new ParseError(`"${section}.${name}" must be a mapping`);
      }
      return [name, value as Record<string, unknown>];
    });
  }

  private asList(raw: unknown, section: string): Record<string, unknown>[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!Array.isArray(raw)) throw new ParseError(`"${section}" must be a list`);
    return raw as Record<string, unknown>[];
  }

  private parseEventMap(raw: unknown): Event[] {
    return this.mapEntries(raw, 'events').map(([name, def]) => ({
      name,
      source: ((def.source as string) || 'external') as any,
      description: def.description as string | undefined,
      payload: def.payload as Record<string, unknown> | undefined,
    }));
  }

  private parseParameterMap(raw: unknown): Parameter[] | undefined {
    const entries = this.mapEntries(raw, 'parameters');
    if (entries.length === 0) return undefined;

    return entries.map(([name, def]) => {
      // `range: [10, 90]` reads better than separate min/max keys.
      const range = def.range as [number, number] | undefined;
      if (range !== undefined && (!Array.isArray(range) || range.length !== 2)) {
        throw new ParseError(`Parameter "${name}" has a "range" that is not [min, max]`);
      }

      return {
        name,
        type: (def.type as string) as any,
        default: def.default,
        min: range ? range[0] : (def.min as number | undefined),
        max: range ? range[1] : (def.max as number | undefined),
        unit: def.unit as string | undefined,
        description: def.description as string | undefined,
      };
    });
  }

  /**
   * States nest by containment, so a composite is just a state that has
   * `states:` under it. The type is inferred from that; declaring it is
   * optional and only useful for future kinds.
   */
  private parseStateMap(raw: unknown): State[] {
    return this.mapEntries(raw, 'states').map(([name, def]) => {
      const children = this.parseStateMap(def.states);
      const declared = def.type as string | undefined;

      if (children.length === 0) {
        if (def.initial !== undefined) {
          throw new ParseError(`State "${name}" declares "initial" but has no nested states`);
        }
        return { name, type: (declared || 'simple') as any, description: def.description as string | undefined };
      }

      const initial = (def.initial as StateRef | undefined) ?? children[0].name;
      if (!children.some(c => c.name === initial)) {
        throw new ParseError(
          `State "${name}" declares initial "${initial}", which is not one of its ` +
          `states (${children.map(c => c.name).join(', ')})`
        );
      }

      return {
        name,
        type: (declared || 'composite') as any,
        description: def.description as string | undefined,
        initial,
        regions: [{ initial, states: children }],
      };
    });
  }


  /** Catalogue of named actions, so a transition's `do:` can carry params. */
  private parseActionCatalogue(raw: unknown): Map<string, Action> {
    const catalogue = new Map<string, Action>();

    for (const [name, def] of this.mapEntries(raw, 'actions')) {
      catalogue.set(name, {
        name,
        type: ((def.type as string) || 'driver') as any,
        driver: (def.driver as string) || name,
        params: def.params as Record<string, unknown> | undefined,
      });
    }

    return catalogue;
  }

  private parseTransitionList(raw: unknown, catalogue: Map<string, Action>): Transition[] {
    const list = this.asList(raw, 'machine.transitions');
    if (!list) return [];

    return list.map((entry, index) => {
      const from = entry.from as StateRef;
      const on = entry.on as string | undefined;
      const to = entry.to as StateRef;
      const after = this.parseAfter(entry.after, index);

      // A transition fires on an event or after a duration - never both, and
      // never neither, or there is nothing to make it happen.
      if (on !== undefined && after !== undefined) {
        throw new ParseError(
          `Transition ${index + 1} has both "on" and "after". A transition fires ` +
          'either when an event arrives or when a duration elapses, not both.'
        );
      }
      if (on === undefined && after === undefined) {
        throw new ParseError(
          `Transition ${index + 1} has neither "on" nor "after", so nothing would ` +
          'ever make it fire. Use "on: SOME_EVENT" or "after: 5000".'
        );
      }

      const trigger: Array<readonly [string, unknown]> = on !== undefined
        ? [['from', from], ['on', on], ['to', to]]
        : [['from', from], ['to', to]];

      for (const [key, value] of trigger) {
        if (typeof value !== 'string' || !value.trim()) {
          throw new ParseError(`Transition ${index + 1} is missing "${key}"`);
        }
      }

      if (on !== undefined && on !== '*' && !this.eventNames.has(on)) {
        throw new ParseError(`Transition ${index + 1} reacts to unknown event "${on}"`);
      }
      if (from !== '*' && !this.hasState(from)) {
        throw new ParseError(`Transition "from" state "${from}" ${this.describeBadRef(from)}`);
      }
      if (to === '*') {
        throw new ParseError('Transition "to" cannot be the wildcard "*"');
      }
      if (!this.hasState(to)) {
        throw new ParseError(`Transition "to" state "${to}" ${this.describeBadRef(to)}`);
      }

      // A timed transition needs a state to have been entered before its clock
      // means anything, and "*" is every state at once.
      if (after !== undefined && from === '*') {
        throw new ParseError(
          `Transition ${index + 1} uses "after" from "*". A duration is measured from ` +
          'entering one state, so a timed transition needs a real "from".'
        );
      }
      // A timer is stamped on *entry*, and a self-transition never leaves the
      // state, so the clock would not restart and the transition would fire on
      // every pass from then on - a busy loop, not a repeat. Rejected rather
      // than quietly misbehaving; a genuine repeat needs two states.
      if (after !== undefined && from === to) {
        throw new ParseError(
          `Transition ${index + 1} uses "after" to re-enter "${to}". A timer starts when ` +
          'a state is entered, and this never leaves it, so the timer would not restart ' +
          'and the transition would fire on every pass.\n' +
          'For a repeating cycle, alternate between two states.'
        );
      }

      return {
        source: from,
        target: to,
        event: on,
        after,
        guard: entry.guard !== undefined && entry.guard !== null
          ? this.parseGuard(entry.guard)
          : undefined,
        actions: this.resolveActions(entry.do, catalogue, index),
        description: entry.description as string | undefined,
      };
    });
  }

  /**
   * `tasks:` - work that repeats on an interval.
   *
   *   tasks:
   *     blink: { every: blink_ms, do: toggle_led }
   *
   * Not every board is a state machine. A blink or a heartbeat is scheduling,
   * which is configuration, so it belongs in the model rather than being
   * dressed up as a two-state HSM.
   */
  private parseTaskMap(raw: unknown, catalogue: Map<string, Action>): Task[] {
    return this.mapEntries(raw, 'tasks').map(([name, def], index) => {
      if (def.every === undefined) {
        throw new ParseError(
          `Task "${name}" has no "every". A task runs on an interval:\n` +
          `  tasks:\n    ${name}: { every: 500, do: some_action }`
        );
      }

      const actions = this.resolveActions(def.do, catalogue, index);
      const log = this.parseLog(def.log, `Task "${name}"`);

      if (!actions?.length && log === undefined) {
        throw new ParseError(
          `Task "${name}" has neither "do" nor "log", so it would do nothing every ${def.every}ms`
        );
      }

      return {
        name,
        every: this.parseInterval(def.every, `Task "${name}"`),
        actions: actions ?? [],
        log,
        description: def.description as string | undefined,
      };
    });
  }

  /**
   * `commands:` - a line of text in, a named action out.
   *
   *   commands:
   *     source: console
   *     map:
   *       on:  led_on
   *       off: led_off
   *
   * A dispatch table is data. Pulling arguments out of a command line is not,
   * and stays in the action you write.
   */
  private parseCommands(raw: unknown, catalogue: Map<string, Action>): CommandSet | undefined {
    if (raw === undefined || raw === null) return undefined;

    if (!isPlainObject(raw)) {
      throw new ParseError(
        'commands: must be a mapping:\n' +
        '  commands:\n    source: console\n    map:\n      on: led_on'
      );
    }

    if (!isPlainObject(raw.map)) {
      throw new ParseError('commands: declares no "map", so no command would ever be recognised');
    }

    const seen = new Set<string>();
    const commands: Command[] = Object.entries(raw.map).map(([match, def], index) => {
      const text = match.trim();
      if (!text) throw new ParseError('A command cannot be an empty string');
      if (seen.has(text)) throw new ParseError(`Command "${text}" is declared twice`);
      seen.add(text);

      // `on: led_on` and `on: [a, b]` are the short forms; the long form is a
      // mapping, and is the only one that can raise an event.
      const long = isPlainObject(def) ? def : null;
      const event = long?.event as string | undefined;
      if (event !== undefined && !this.eventNames.has(event)) {
        throw new ParseError(`Command "${text}" raises unknown event "${event}"`);
      }

      const actions = this.resolveActions(long ? long.do : def, catalogue, index);
      const log = this.parseLog(long?.log, `Command "${text}"`);

      if (!actions?.length && event === undefined && log === undefined) {
        throw new ParseError(
          `Command "${text}" has no "do", "event" or "log", so receiving it would do nothing`
        );
      }

      return { match: text, actions, event, log, description: long?.description as string | undefined };
    });

    return {
      source: raw.source as string | undefined,
      commands,
      reportUnknown: raw.report_unknown === undefined ? true : Boolean(raw.report_unknown),
    };
  }

  /** `log: "temp={temp}C"` - checked for shape here, for names later. */
  private parseLog(raw: unknown, where: string): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') {
      throw new ParseError(`${where} has a "log" of type ${typeof raw}; it must be a string`);
    }

    try {
      parseTemplate(raw);
    } catch (error) {
      throw new ParseError(
        `${where}: ${error instanceof TemplateError ? error.message : String(error)}`
      );
    }
    return raw;
  }

  /** Milliseconds: a positive literal, or the name of an int parameter. */
  private parseInterval(raw: unknown, where: string): number | string {
    if (typeof raw === 'number') {
      if (!Number.isInteger(raw) || raw <= 0) {
        throw new ParseError(
          `${where} has an interval of ${raw}. It must be a positive whole number of ` +
          'milliseconds, or the name of an int parameter.'
        );
      }
      return raw;
    }
    if (typeof raw === 'string' && raw.trim()) return raw.trim();

    throw new ParseError(
      `${where} has an interval of type ${typeof raw}. Use a number of milliseconds, ` +
      'or the name of an int parameter.'
    );
  }

  /**
   * `after: 5000` or `after: green_ms`.
   *
   * Naming a parameter keeps the duration tunable at runtime; the generated
   * code reads it every tick rather than capturing it at boot. The parameter
   * itself is checked once they have all been parsed.
   */
  private parseAfter(raw: unknown, index: number): number | string | undefined {
    if (raw === undefined || raw === null) return undefined;

    if (typeof raw === 'number') {
      if (!Number.isInteger(raw) || raw <= 0) {
        throw new ParseError(
          `Transition ${index + 1} has after: ${raw}. It must be a positive whole ` +
          'number of milliseconds, or the name of an int parameter.'
        );
      }
      return raw;
    }

    if (typeof raw === 'string' && raw.trim()) return raw.trim();

    throw new ParseError(
      `Transition ${index + 1} has an "after" of type ${typeof raw}. Use a number of ` +
      'milliseconds, or the name of an int parameter.'
    );
  }

  /**
   * `do:` takes one name or a list of them. When an `actions:` catalogue
   * exists it is authoritative, so a typo is an error rather than a silently
   * generated stub for a function nobody will implement.
   */
  private resolveActions(
    raw: unknown,
    catalogue: Map<string, Action>,
    index: number
  ): Action[] | undefined {
    if (raw === undefined || raw === null) return undefined;

    const names = Array.isArray(raw) ? raw : [raw];
    const strict = catalogue.size > 0;

    return names.map(entry => {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new ParseError(`Transition ${index + 1} has a "do" entry that is not an action name`);
      }

      const declared = catalogue.get(entry);
      if (declared) return { ...declared };

      if (strict) {
        throw new ParseError(
          `Transition ${index + 1} does "${entry}", which is not in the actions catalogue. ` +
          `Declared: ${[...catalogue.keys()].join(', ') || 'none'}.`
        );
      }
      return { name: entry, type: 'driver' as any, driver: entry };
    });
  }

  private parseBusMap(raw: unknown): Resource[] | undefined {
    const entries = this.mapEntries(raw, 'buses');
    if (entries.length === 0) return undefined;

    return entries.map(([name, def]) => {
      const iface = def.interface as string;
      if (!iface) throw new ParseError(`Bus "${name}" has no "interface"`);
      this.assertKnownInterface(name, iface);

      // Settings sit directly on the bus rather than under a `binding` key -
      // there is nothing else on a bus for them to be confused with.
      const { interface: _i, description, library, ...binding } = def;

      return {
        name,
        interface: iface as any,
        binding: Object.keys(binding).length > 0 ? binding : undefined,
        library: library as string | undefined,
        description: description as string | undefined,
      };
    });
  }

  private parseDeviceMap(raw: unknown): Component[] | undefined {
    const entries = this.mapEntries(raw, 'devices');
    if (entries.length === 0) return undefined;

    return entries.map(([name, def]) => {
      const type = def.type as string;
      if (!type) {
        throw new ParseError(`Device "${name}" has no "type"`);
      }

      const builtin = BUILTIN_DEVICE_TYPES[type];
      const declaredClass = def.class as string | undefined;

      if (!builtin && !declaredClass) {
        throw new ParseError(
          `Device "${name}" has type "${type}", which is not built in, so it needs an ` +
          `explicit "class" (sensor, actuator or service). Guessing would risk ` +
          `publishing an actuator as if it were a reading.\n` +
          `Built-in types: ${Object.keys(BUILTIN_DEVICE_TYPES).join(', ')}.`
        );
      }

      const { type: _t, class: _c, bus, description, ...config } = def;

      return {
        name,
        class: (declaredClass || builtin.class) as any,
        driver: (def.driver as string) || builtin?.driver || type,
        type,
        bus: bus as string | undefined,
        config: Object.keys(config).length > 0 ? config : undefined,
        description: description as string | undefined,
      };
    });
  }

  private assertKnownInterface(name: string, iface: string): void {
    const known = [
      'gpio', 'pwm', 'adc', 'uart', 'i2c', 'spi',
      'can', 'onewire', 'wifi', 'ethernet', 'ble', 'mqtt', 'custom',
    ];
    if (!known.includes(iface)) {
      throw new ParseError(
        `"${name}" has unknown interface "${iface}". Expected one of: ${known.join(', ')}.`
      );
    }
  }

  private assertLibraryRefs(resources: Resource[] | undefined, libraries: Library[] | undefined): void {
    const names = new Set((libraries || []).map(l => l.name));
    for (const resource of resources || []) {
      if (resource.library && !names.has(resource.library)) {
        throw new ParseError(
          `"${resource.name}" needs library "${resource.library}", which is not declared`
        );
      }
    }
  }

  private assertBusRefs(components: Component[] | undefined, resources: Resource[] | undefined): void {
    const names = new Set((resources || []).map(r => r.name));
    for (const component of components || []) {
      if (component.bus && !names.has(component.bus)) {
        throw new ParseError(
          `Device "${component.name}" sits on bus "${component.bus}", which is not declared. ` +
          `Declared buses: ${[...names].join(', ') || 'none'}.`
        );
      }
    }
  }

  private resetValidationState(): void {
    this.eventNames.clear();
    this.stateNames.clear();
    this.actionNames.clear();
    this.statePaths.clear();
    this.statesByLeafName.clear();
  }

  private parseSystem(raw: Record<string, unknown>): PulseSystem {
    this.resetValidationState();

    // Parse events first (referenced by transitions)
    const events = this.parseEvents(raw.events as Record<string, unknown>[]);
    events.forEach(e => this.eventNames.add(e.name));

    // Parse states (referenced by transitions)
    const states = this.parseStates(raw.states as Record<string, unknown>[]);
    this.indexStateNames(states);

    // Parse actions (referenced by transitions)
    const actions = raw.actions as Record<string, unknown>;
    if (actions) {
      Object.keys(actions).forEach(name => this.actionNames.add(name));
    }

    // Parse transitions (validates event and state references)
    const transitions = this.parseTransitions(raw.transitions as Record<string, unknown>[]);

    // Parse components, resources, parameters
    const components = this.parseComponents(raw.components as Record<string, unknown>[]);
    const resources = this.parseResources(raw.resources as Record<string, unknown>[]);
    const parameters = this.parseParameters(raw.parameters as Record<string, unknown>[]);
    const libraries = this.parseLibraries(raw.libraries as Record<string, unknown>[]);

    // Splitting a model across files makes accidental duplicates easy, and a
    // duplicate name silently shadows rather than failing later.
    this.assertUniqueNames(events, 'event');
    this.assertUniqueNames(components, 'component');
    this.assertUniqueNames(resources, 'resource');
    this.assertUniqueNames(parameters, 'parameter');
    this.assertUniqueNames(libraries, 'library');

    // A resource may name a library, which must actually be declared.
    const libraryNames = new Set((libraries || []).map(l => l.name));
    for (const resource of resources || []) {
      if (resource.library && !libraryNames.has(resource.library)) {
        throw new ParseError(
          `Resource "${resource.name}" needs library "${resource.library}", which is not declared`
        );
      }
    }

    return {
      name: raw.name as string || 'unnamed',
      version: raw.version as string,
      description: raw.description as string | undefined,
      events,
      states,
      transitions,
      components,
      resources,
      parameters,
      libraries,
    };
  }

  private assertUniqueNames(items: { name: string }[] | undefined, kind: string): void {
    if (!items) return;

    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.name)) {
        throw new ParseError(
          `Duplicate ${kind} "${item.name}" (check whether two included files both declare it)`
        );
      }
      seen.add(item.name);
    }
  }

  private parseLibraries(raw: Record<string, unknown>[] | undefined): Library[] | undefined {
    if (!raw || !Array.isArray(raw)) return undefined;

    return raw.map(entry => {
      // `libraries: [Wire, SPI]` is enough when there is nothing to configure.
      if (typeof entry === 'string') {
        return { name: entry };
      }

      const name = entry.name;
      if (typeof name !== 'string' || !name.trim()) {
        throw new ParseError('Library requires a "name"');
      }

      const source = entry.source as string | undefined;
      if (source && !['builtin', 'registry', 'git', 'local'].includes(source)) {
        throw new ParseError(
          `Library "${name}" has unknown source "${source}" ` +
          '(expected builtin, registry, git or local)'
        );
      }
      if ((source === 'git' || source === 'local') && !entry.url) {
        throw new ParseError(`Library "${name}" has source "${source}" but no "url"`);
      }

      return {
        name,
        include: entry.include as string | undefined,
        version: entry.version as string | undefined,
        source: source as Library['source'],
        url: entry.url as string | undefined,
        description: entry.description as string | undefined,
      };
    });
  }

  private parseEvents(raw: Record<string, unknown>[] | undefined): Event[] {
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map(e => ({
      name: e.name as string,
      source: ((e.source as string) || 'external') as any,
      description: e.description as string | undefined,
      payload: e.payload as Record<string, unknown> | undefined,
    }));
  }

  private parseStates(raw: Record<string, unknown>[] | undefined): State[] {
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map(s => this.parseState(s));
  }

  private parseState(raw: Record<string, unknown>): State {
    const type = (raw.type as string) || 'simple';
    const state: State = {
      name: raw.name as string,
      type: type as any,
      description: raw.description as string | undefined,
    };

    // Handle composite states
    if (type === 'composite' || type === 'orthogonal') {
      state.initial = raw.initial as StateRef;
      if (raw.regions) {
        state.regions = (raw.regions as Record<string, unknown>[]).map(r => this.parseRegion(r));
      } else if (raw.states) {
        // Flatten states into a single region
        state.regions = [{
          initial: state.initial || 'INVALID',
          states: this.parseStates(raw.states as Record<string, unknown>[]),
        }];
      }
    }

    return state;
  }

  private parseRegion(raw: Record<string, unknown>): Region {
    return {
      name: raw.name as string | undefined,
      initial: raw.initial as StateRef,
      states: this.parseStates(raw.states as Record<string, unknown>[]),
    };
  }

  private parseTransitions(raw: Record<string, unknown>[] | undefined): Transition[] {
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map(t => this.parseTransition(t));
  }

  private parseTransition(raw: Record<string, unknown>): Transition {
    const source = raw.source as StateRef;
    const event = raw.event as string;
    const target = raw.target as StateRef;

    // Validate event exists
    if (event !== '*' && !this.eventNames.has(event)) {
      throw new ParseError(`Transition references unknown event "${event}"`);
    }

    // Validate source state exists
    if (source !== '*' && !this.hasState(source)) {
      throw new ParseError(`Transition source "${source}" ${this.describeBadRef(source)}`);
    }

    // A wildcard target has no meaning - there is no state to enter.
    if (target === '*') {
      throw new ParseError('Transition target cannot be the wildcard "*"');
    }

    // Validate target state exists
    if (!this.hasState(target)) {
      throw new ParseError(`Transition target "${target}" ${this.describeBadRef(target)}`);
    }

    const guard = raw.guard !== undefined && raw.guard !== null
      ? this.parseGuard(raw.guard)
      : undefined;
    const actions = raw.actions ? this.parseActions(raw.actions as Record<string, unknown>[]) : undefined;

    return {
      source,
      target,
      event,
      guard,
      actions,
      description: raw.description as string | undefined,
    };
  }

  private parseGuard(raw: unknown): Guard {
    // The canonical form is a bare name referencing a user-written function:
    //   guard: temp_ready
    if (typeof raw === 'string') {
      if (!raw.trim()) {
        throw new ParseError('Guard name cannot be empty');
      }
      return { name: raw };
    }

    if (typeof raw !== 'object') {
      throw new ParseError(`Guard must be a name or a mapping, got ${typeof raw}`);
    }

    const obj = raw as Record<string, unknown>;

    // The old schema carried a C-like condition string. Point at the
    // replacement rather than silently ignoring it, since a dropped guard
    // would change behaviour without any visible error.
    if (obj.expression !== undefined || obj.type !== undefined || obj.evaluator !== undefined) {
      throw new ParseError(
        'Guards no longer take "type", "expression" or "evaluator". ' +
        'A guard is the name of a function you implement in C. Use:\n' +
        '  guard: my_guard_name\n' +
        'or, to keep the intent as documentation:\n' +
        '  guard:\n' +
        '    name: my_guard_name\n' +
        '    description: what this checks'
      );
    }

    const name = obj.name;
    if (typeof name !== 'string' || !name.trim()) {
      throw new ParseError('Guard requires a "name"');
    }

    return {
      name,
      description: obj.description as string | undefined,
    };
  }

  private parseActions(raw: Record<string, unknown>[]): Action[] {
    return raw.map(a => {
      if (typeof a === 'string') {
        // Simple action reference: "start_pump" → { type: 'driver', driver: 'start_pump' }
        return {
          name: a,
          type: 'driver' as any,
          driver: a,
        };
      }
      return {
        name: (a.name as string) || (a.driver as string),
        type: ((a.type as string) || 'driver') as any,
        driver: a.driver as string,
        params: a.params as Record<string, unknown> | undefined,
      };
    });
  }

  private parseComponents(raw: Record<string, unknown>[] | undefined): Component[] | undefined {
    if (!raw || !Array.isArray(raw)) return undefined;
    return raw.map(c => ({
      name: c.name as string,
      class: (c.class as string) as any,
      driver: c.driver as string,
      config: c.config as Record<string, unknown> | undefined,
      description: c.description as string | undefined,
    }));
  }

  private parseResources(raw: Record<string, unknown>[] | undefined): Resource[] | undefined {
    if (!raw || !Array.isArray(raw)) return undefined;

    const known = [
      'gpio', 'pwm', 'adc', 'uart', 'i2c', 'spi',
      'can', 'onewire', 'wifi', 'ethernet', 'ble', 'mqtt', 'custom',
    ];

    return raw.map(r => {
      const iface = r.interface as string;
      if (!iface) {
        throw new ParseError(`Resource "${r.name}" has no "interface"`);
      }
      if (!known.includes(iface)) {
        throw new ParseError(
          `Resource "${r.name}" has unknown interface "${iface}". ` +
          `Expected one of: ${known.join(', ')}.`
        );
      }

      return {
        name: r.name as string,
        interface: iface as any,
        binding: r.binding as Record<string, unknown> | undefined,
        library: r.library as string | undefined,
        description: r.description as string | undefined,
      };
    });
  }

  private parseParameters(raw: Record<string, unknown>[] | undefined): Parameter[] | undefined {
    if (!raw || !Array.isArray(raw)) return undefined;
    return raw.map(p => ({
      name: p.name as string,
      type: (p.type as string) as any,
      default: p.default,
      min: p.min as number | undefined,
      max: p.max as number | undefined,
      unit: p.unit as string | undefined,
      description: p.description as string | undefined,
    }));
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  /**
   * Index every state by both its bare name and its full hierarchical path,
   * so references can be checked exactly rather than by top-level prefix.
   */
  private indexStateNames(states: State[], prefix: string = ''): void {
    states.forEach(state => {
      if (!state.name) {
        throw new ParseError(`Encountered a state without a name under "${prefix || '<root>'}"`);
      }

      const path = prefix ? `${prefix}/${state.name}` : state.name;
      if (this.statePaths.has(path)) {
        throw new ParseError(`Duplicate state path "${path}"`);
      }

      this.stateNames.add(state.name);
      this.statePaths.add(path);

      const sameName = this.statesByLeafName.get(state.name) || [];
      sameName.push(path);
      this.statesByLeafName.set(state.name, sameName);

      if (state.regions) {
        state.regions.forEach(region => {
          this.indexStateNames(region.states, path);
        });
      }
    });
  }

  /**
   * Every `{name}` in a log template must name something the model declared.
   *
   * Checked here rather than in the backend, so a typo is a model error with
   * the alternatives listed - not a C++ compile error in generated code.
   */
  private assertLogRefs(
    tasks: Task[],
    commands: CommandSet | undefined,
    parameters: Parameter[],
    components: Component[]
  ): void {
    const known = new Map<string, string>();
    for (const parameter of parameters) known.set(parameter.name, 'parameter');
    for (const device of components) {
      if (device.class === 'sensor') known.set(device.name, 'sensor');
    }

    const check = (template: string | undefined, where: string) => {
      if (template === undefined) return;
      for (const name of templateRefs(parseTemplate(template))) {
        if (known.has(name)) continue;
        const options = [...known.keys()];
        throw new ParseError(
          `${where} logs "{${name}}", which is not a declared parameter or sensor. ` +
          (options.length
            ? `Available: ${options.join(', ')}.`
            : 'The model declares no parameters and no sensors.')
        );
      }
    };

    for (const task of tasks) check(task.log, `Task "${task.name}"`);
    for (const command of commands?.commands || []) {
      check(command.log, `Command "${command.match}"`);
    }
  }

  /** A task interval naming a parameter must name a real int one. */
  private assertTaskIntervals(tasks: Task[], parameters: Parameter[]): void {
    const byName = new Map(parameters.map(p => [p.name, p]));

    for (const task of tasks) {
      if (typeof task.every !== 'string') continue;

      const parameter = byName.get(task.every);
      if (!parameter) {
        const known = [...byName.keys()];
        throw new ParseError(
          `Task "${task.name}" runs every "${task.every}", which is not a declared parameter. ` +
          (known.length ? `Known parameters: ${known.join(', ')}.` : 'No parameters are declared.')
        );
      }
      if (parameter.type !== 'int') {
        throw new ParseError(
          `Task "${task.name}" runs every "${task.every}", which is declared as ` +
          `${parameter.type}. An interval in milliseconds must be an int.`
        );
      }
    }
  }

  /**
   * A model has to *do* something.
   *
   * A state machine is one way, but not the only one - PulseHSM is one tenant
   * of this IR, so `tasks:` or `commands:` alone is a complete project. What is
   * not allowed is a model with none of the three, which would generate a
   * sketch that runs an empty loop forever.
   */
  private assertUsable(
    states: State[],
    tasks: Task[],
    commands: CommandSet | undefined
  ): void {
    if (states.length > 0 || tasks.length > 0 || commands) return;

    // Transitions are not checked here: every one names a `from` and a `to`,
    // and those are resolved against the state list as they are parsed. A
    // transition with no states cannot get this far.
    const empty = new ParseError(
      'The model does nothing. Give it at least one of:\n' +
      '  machine:   states and transitions\n' +
      '  tasks:     work that repeats on an interval\n' +
      '  commands:  actions to run when a command arrives'
    );
    empty.kind = 'empty-model';
    throw empty;
  }

  /**
   * Check every `after:` that names a parameter, once they have all been read.
   *
   * It has to name a real parameter of an integer type, or the generated code
   * would not compile - and it would fail inside generated code the student
   * did not write, which is the worst possible place to find out.
   */
  private assertTimedTransitions(transitions: Transition[], parameters: Parameter[]): void {
    const byName = new Map(parameters.map(p => [p.name, p]));

    transitions.forEach((transition, index) => {
      if (typeof transition.after !== 'string') return;

      const where = `Transition ${index + 1} (${transition.source} → ${transition.target})`;
      const parameter = byName.get(transition.after);

      if (!parameter) {
        const known = [...byName.keys()];
        throw new ParseError(
          `${where} waits for "${transition.after}", which is not a declared parameter. ` +
          (known.length ? `Known parameters: ${known.join(', ')}.` : 'No parameters are declared.') +
          ' Use a number of milliseconds, or declare it under "parameters".'
        );
      }
      if (parameter.type !== 'int') {
        throw new ParseError(
          `${where} waits for "${transition.after}", which is declared as ` +
          `${parameter.type}. A duration in milliseconds must be an int.`
        );
      }
    });
  }

  /**
   * Check if a state exists. Accepts a full path ("running/heating") or a bare
   * leaf name ("heating") when that name is unique across the hierarchy.
   */
  private hasState(ref: StateRef): boolean {
    if (ref === '*') return true;
    if (this.statePaths.has(ref)) return true;

    // A bare name is only a valid reference when it is unambiguous.
    const candidates = this.statesByLeafName.get(ref);
    return candidates !== undefined && candidates.length === 1;
  }

  /**
   * Explain why a reference failed, so the error points at the real problem
   * rather than just saying the state is unknown.
   */
  private describeBadRef(ref: StateRef): string {
    const candidates = this.statesByLeafName.get(ref);
    if (candidates && candidates.length > 1) {
      return `is ambiguous; it matches ${candidates.join(', ')}. Use a full path.`;
    }
    return 'does not exist';
  }
}

export { Parser as default };
