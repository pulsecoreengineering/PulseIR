/**
 * Semantic validator — soft checks over a fully-parsed PulseProject.
 *
 * The parser handles hard errors (undefined refs, malformed YAML, schema
 * constraints) and stops on the first one. This module runs *after* a
 * successful parse and collects non-fatal warnings that do not block code
 * generation but are almost always mistakes:
 *
 *   - A leaf state that no transition ever targets (unreachable)
 *   - A declared event never referenced in any transition (unused)
 *   - An interface with some but not all of its required pins declared
 *
 * Parser soft-warnings (no board declared, legacy schema, pin conflicts) are
 * lifted into the same Diagnostic list so the caller has one thing to show.
 */

import type { PulseProject } from '../model/index.js';
import { flattenStates, resolveEntryLeaf, resolvePath } from './states.js';

export interface Diagnostic {
  severity: 'error' | 'warning';
  /** Short machine-readable code, e.g. "UNREACHABLE_STATE". */
  code: string;
  message: string;
}

export interface ValidationResult {
  diagnostics: Diagnostic[];
  readonly errorCount: number;
  readonly warningCount: number;
}

/** Keys that must all be present together for an interface to be useful. */
const REQUIRED_GROUPS: Record<string, string[][]> = {
  i2c:     [['sda', 'scl']],
  spi:     [['sck', 'miso', 'mosi']],
  gpio:    [['pin']],
  pwm:     [['pin']],
  adc:     [['pin']],
  onewire: [['pin']],
};

export class Validator {
  /**
   * Validate the parsed project and return all diagnostics.
   *
   * @param parserWarnings  The `parser.warnings` array from the last parse —
   *   lifted verbatim into diagnostics so callers have one list.
   */
  validate(project: PulseProject, parserWarnings: readonly string[] = []): ValidationResult {
    const diagnostics: Diagnostic[] = [];

    for (const w of parserWarnings) {
      diagnostics.push({ severity: 'warning', code: 'PARSER', message: w });
    }

    const { system } = project;

    if (system.states.length > 0) {
      this.checkUnreachableStates(project, diagnostics);
    }
    if (system.events.length > 0) {
      this.checkUnusedEvents(project, diagnostics);
    }
    if ((system.resources ?? []).length > 0) {
      this.checkPartialBindings(project, diagnostics);
    }

    return {
      diagnostics,
      get errorCount() { return diagnostics.filter(d => d.severity === 'error').length; },
      get warningCount() { return diagnostics.filter(d => d.severity === 'warning').length; },
    };
  }

  /**
   * Warn about leaf states that no transition can ever reach.
   *
   * A composite-state target is followed down its initial chain, so
   * `to: running` implicitly reaches `running/heating` when that is the
   * initial child — those leaves are counted as reachable too.
   */
  private checkUnreachableStates(project: PulseProject, out: Diagnostic[]): void {
    const { system } = project;
    const flat = flattenStates(system.states);
    const reachable = new Set<string>();

    // The machine starts in the initial leaf of the first top-level state.
    const initialLeaf = resolveEntryLeaf(system.states, system.states[0].name);
    if (initialLeaf) reachable.add(initialLeaf);

    // Every transition target — normalised to a full path, then resolved to
    // the leaf it actually lands in.
    for (const t of system.transitions) {
      if (t.target === undefined) continue;
      const fullPath = resolvePath(system.states, t.target);
      if (!fullPath) continue;
      const leaf = resolveEntryLeaf(system.states, fullPath);
      if (leaf) reachable.add(leaf);
      // Keep the path itself too — a non-leaf target is reachable as a node.
      reachable.add(fullPath);
    }

    for (const { path, isLeaf } of flat) {
      if (!isLeaf) continue;
      if (reachable.has(path)) continue;
      out.push({
        severity: 'warning',
        code: 'UNREACHABLE_STATE',
        message: `State "${path}" is never the target of any transition and is not the initial state — it will never be entered`,
      });
    }
  }

  /**
   * Warn about events that are declared but never referenced in any
   * transition or command. A declared event that nothing reacts to is
   * almost always a typo in the transition's "on:" field.
   */
  private checkUnusedEvents(project: PulseProject, out: Diagnostic[]): void {
    const { system } = project;
    const used = new Set<string>();

    for (const t of system.transitions) {
      if (t.event) used.add(t.event);
    }
    for (const cmd of system.commands?.commands ?? []) {
      if (cmd.event) used.add(cmd.event);
    }

    for (const event of system.events) {
      if (!used.has(event.name)) {
        out.push({
          severity: 'warning',
          code: 'UNUSED_EVENT',
          message: `Event "${event.name}" is declared but never referenced in a transition or command`,
        });
      }
    }
  }

  /**
   * Warn when a binding declares some but not all of a required pin group.
   * Declaring none is intentional (use board defaults); declaring half is
   * almost always a copy-paste mistake.
   */
  private checkPartialBindings(project: PulseProject, out: Diagnostic[]): void {
    for (const resource of project.system.resources ?? []) {
      const kind = String(resource.interface);
      const groups = REQUIRED_GROUPS[kind];
      if (!groups) continue;

      const binding = resource.binding ?? {};
      for (const group of groups) {
        const present = group.filter(k => binding[k] !== undefined);
        if (present.length > 0 && present.length < group.length) {
          const missing = group.filter(k => binding[k] === undefined);
          out.push({
            severity: 'warning',
            code: 'PARTIAL_BINDING',
            message:
              `${resource.name} (${kind}): has ${present.join(', ')} but is missing ` +
              `${missing.join(', ')} — declare all of [${group.join(', ')}] or none`,
          });
        }
      }
    }
  }
}
