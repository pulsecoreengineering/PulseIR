/**
 * PulseHSM IR Parser
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
} from '../model/index.js';
import type { SourceResolver } from './resolver.js';

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

export class ParseError extends Error {
  constructor(
    message: string,
    public line?: number,
    public column?: number
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/** Name a document in an error message, whether or not it came from a file. */
function describe(origin: string | null): string {
  return origin ? `"${origin}"` : 'The model';
}

export class Parser {
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

    if (doc.includes !== undefined && doc.include === undefined) {
      throw new ParseError(`${describe(origin)} uses "includes"; the key is "include"`);
    }

    const refs = this.includeRefs(doc.include, origin);
    if (refs.length === 0) return doc;

    const resolver = options.resolver;
    if (!resolver) {
      throw new ParseError(
        `${describe(origin)} uses "include", but this parser was given no way to ` +
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
    delete result.include;

    const baseSystem = base.system as Record<string, unknown> | undefined;
    const overlaySystem = overlay.system as Record<string, unknown> | undefined;
    if (!baseSystem || !overlaySystem) return result;

    const system: Record<string, unknown> = { ...baseSystem, ...overlaySystem };

    for (const key of MERGED_LISTS) {
      const left = baseSystem[key];
      const right = overlaySystem[key];
      if (Array.isArray(left) && Array.isArray(right)) {
        system[key] = [...left, ...right];
      }
    }

    result.system = system;
    return result;
  }

  // =========================================================================
  // PARSING
  // =========================================================================

  private parseProject(raw: Record<string, unknown>): PulseProject {
    const projectRaw = raw.project as Record<string, unknown>;
    if (!projectRaw) {
      throw new ParseError('Missing "project" section');
    }

    const systemRaw = raw.system as Record<string, unknown>;
    if (!systemRaw) {
      throw new ParseError('Missing "system" section');
    }

    const system = this.parseSystem(systemRaw);

    return {
      name: projectRaw.name as string || 'unnamed',
      version: projectRaw.version as string || '0.1.0',
      description: projectRaw.description as string | undefined,
      system,
    };
  }

  private parseSystem(raw: Record<string, unknown>): PulseSystem {
    // Clear validation state
    this.eventNames.clear();
    this.stateNames.clear();
    this.actionNames.clear();
    this.statePaths.clear();
    this.statesByLeafName.clear();

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
          type: 'driver' as any,
          driver: a,
        };
      }
      return {
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
