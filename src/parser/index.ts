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
  Guard,
  Action,
  Region,
  StateRef,
} from '../model/index.js';

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
   */
  parse(yamlContent: string): PulseProject {
    try {
      const raw = yaml.load(yamlContent) as Record<string, unknown>;
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
    };
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
    return raw.map(r => ({
      name: r.name as string,
      interface: (r.interface as string) as any,
      binding: r.binding as Record<string, unknown> | undefined,
      description: r.description as string | undefined,
    }));
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
