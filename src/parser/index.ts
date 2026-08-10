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
      throw new ParseError(`Transition references unknown state "${source}"`);
    }

    // Validate target state exists
    if (target !== '*' && !this.hasState(target)) {
      throw new ParseError(`Transition references unknown state "${target}"`);
    }

    const guard = raw.guard ? this.parseGuard(raw.guard as Record<string, unknown>) : undefined;
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

  private parseGuard(raw: Record<string, unknown>): Guard {
    return {
      type: ((raw.type as string) || 'expression') as any,
      expression: raw.expression as string | undefined,
      evaluator: raw.evaluator as string | undefined,
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
   * Index all state names (flattened from hierarchy)
   */
  private indexStateNames(states: State[]): void {
    states.forEach(state => {
      this.stateNames.add(state.name);
      if (state.regions) {
        state.regions.forEach(region => {
          this.indexStateNames(region.states);
        });
      }
    });
  }

  /**
   * Check if a state exists (supports "running/heating" notation)
   */
  private hasState(ref: StateRef): boolean {
    if (ref === '*') return true;
    
    const parts = ref.split('/');
    const topLevel = parts[0];
    
    if (!this.stateNames.has(topLevel)) return false;
    
    // TODO: For hierarchical refs, validate path exists
    // This requires walking the state tree, deferred for now
    return true;
  }
}

export { Parser as default };
