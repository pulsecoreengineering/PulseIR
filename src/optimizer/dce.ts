/**
 * Dead Code Elimination (DCE) optimizer pass.
 *
 * Operates on the PulseProject IR after parsing and before codegen.
 * Returns a new project with unreferenced components and parameters
 * stripped out, plus a list of human-readable warnings for each removal.
 *
 * Never mutates the input — always returns a fresh object.
 */

import type {
  PulseProject,
  PulseSystem,
  Component,
  Parameter,
  Event,
  Action,
  State,
} from '../model/types.js';

export interface DceResult {
  project: PulseProject;
  /** One line per removed symbol, suitable for printing as compiler warnings. */
  warnings: string[];
}

// ============================================================================
// Public entry point
// ============================================================================

export function eliminateDeadCode(project: PulseProject): DceResult {
  const warnings: string[] = [];
  const sys = project.system;

  const allActions = collectAllActions(sys);

  // ── Components ─────────────────────────────────────────────────────────────
  // A component is "live" when its name appears as:
  //   • any string param value of any reachable action  (device:, echo:, trigger:, …)
  //   • any {placeholder} in a task or command log string
  //   • the sensor field of a telemetry or communication publish entry
  //   • the "raises:" config of another component (ISR wiring keeps the event alive)

  const referencedByActions = new Set<string>();

  for (const action of allActions) {
    collectStringParamValues(action, referencedByActions);
  }

  // Log-string placeholders reference both parameters and sensor components.
  const referencedInLogs = new Set<string>();
  for (const task of sys.tasks ?? []) {
    if (task.log) extractPlaceholders(task.log, referencedInLogs);
  }
  for (const cmd of sys.commands?.commands ?? []) {
    if (cmd.log) extractPlaceholders(cmd.log, referencedInLogs);
  }

  // Telemetry / communication publish reference sensor names directly.
  const referencedInComms = new Set<string>();
  for (const ch of sys.telemetry?.channels ?? []) {
    referencedInComms.add(ch.sensor);
  }
  for (const pub of sys.communication?.publish ?? []) {
    referencedInComms.add(pub.sensor);
  }

  // ISR raises: config keeps the named event alive but doesn't reference
  // the device itself — we don't need to check this for component liveness.

  const liveComponents = new Set([
    ...referencedByActions,
    ...referencedInLogs,
    ...referencedInComms,
  ]);

  const prunedComponents: Component[] = [];
  for (const c of sys.components ?? []) {
    if (liveComponents.has(c.name)) {
      prunedComponents.push(c);
    } else {
      warnings.push(
        `[DCE] hardware component "${c.name}" is declared but never referenced — ` +
        `removed (no #define, no pinMode, no struct field generated).`,
      );
    }
  }

  // ── Parameters ─────────────────────────────────────────────────────────────
  // A parameter is "live" when its name appears as:
  //   • the every: interval of a task or periodic/timed transition
  //   • any {placeholder} in a task or command log string
  //   • any string param value of any reachable action
  //   • a telemetry or safety interval expression
  //   • a communication subscribe parameter

  const referencedParams = new Set<string>(referencedInLogs);

  // every: / after: / every: on transitions — may be a parameter name
  for (const task of sys.tasks ?? []) {
    if (typeof task.every === 'string') referencedParams.add(task.every);
  }
  for (const t of sys.transitions) {
    if (typeof t.after === 'string') referencedParams.add(t.after);
    if (typeof t.every === 'string') referencedParams.add(t.every);
  }

  // Action params may contain parameter names (e.g. pwm duty references a param)
  for (const name of referencedByActions) referencedParams.add(name);

  // Telemetry per-channel interval
  if (typeof sys.telemetry?.interval_ms === 'string') {
    referencedParams.add(sys.telemetry.interval_ms);
  }
  for (const ch of sys.telemetry?.channels ?? []) {
    if (typeof ch.interval_ms === 'string') referencedParams.add(ch.interval_ms);
  }

  // Communication subscribe exposes parameters to MQTT setpoints
  for (const sub of sys.communication?.subscribe ?? []) {
    if (sub.parameter) referencedParams.add(sub.parameter);
  }

  // Diagnostics heartbeat interval
  if (typeof sys.diagnostics?.heartbeat?.interval_ms === 'string') {
    referencedParams.add(sys.diagnostics.heartbeat.interval_ms);
  }

  const prunedParameters: Parameter[] = [];
  for (const p of sys.parameters ?? []) {
    if (referencedParams.has(p.name)) {
      prunedParameters.push(p);
    } else {
      warnings.push(
        `[DCE] parameter "${p.name}" is declared but never referenced — ` +
        `removed (no struct field, no initializer generated).`,
      );
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  // An event is "live" when it appears in:
  //   • a transition's event: field (something reacts to it)
  //   • a command's event: field (a serial command triggers it)
  //   • a component's config.raises field (an ISR fires it)
  // An event declared but unreachable in any of those ways will never cause
  // a state transition and is safe to remove.

  const referencedEvents = new Set<string>();

  for (const t of sys.transitions) {
    if (t.event) referencedEvents.add(t.event);
  }
  for (const cmd of sys.commands?.commands ?? []) {
    if (cmd.event) referencedEvents.add(cmd.event);
  }
  // ISR-raises config: the component fires this event on interrupt.
  for (const c of sys.components ?? []) {
    const raises = c.config?.raises as string | undefined;
    if (raises) referencedEvents.add(raises);
  }

  // The validator already emits [UNUSED_EVENT] warnings before the optimizer
  // runs, so we don't duplicate them here — we just quietly remove dead events
  // from the IR so the codegen never sees their enum values or dispatch cases.
  const prunedEvents: Event[] = sys.events.filter(e => referencedEvents.has(e.name));

  // ── Rebuild ────────────────────────────────────────────────────────────────

  const prunedSystem: PulseSystem = {
    ...sys,
    events:     prunedEvents,
    components: prunedComponents.length > 0 ? prunedComponents : undefined,
    parameters: prunedParameters.length > 0 ? prunedParameters : undefined,
  };

  return {
    project: { ...project, system: prunedSystem },
    warnings,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Walk every action across all usage sites in the system. */
function collectAllActions(sys: PulseSystem): Action[] {
  const out: Action[] = [];

  for (const task of sys.tasks ?? []) out.push(...task.actions);

  for (const t of sys.transitions) out.push(...(t.actions ?? []));

  const walkState = (state: State) => {
    out.push(...(state.entry ?? []), ...(state.exit ?? []));
    for (const region of state.regions ?? []) region.states.forEach(walkState);
  };
  sys.states.forEach(walkState);

  for (const cmd of sys.commands?.commands ?? []) {
    out.push(...(cmd.actions ?? []));
  }

  return out;
}

/** Add every string (or string[]) param value to the set. */
function collectStringParamValues(action: Action, into: Set<string>): void {
  for (const val of Object.values(action.params ?? {})) {
    if (typeof val === 'string') {
      into.add(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') into.add(item);
      }
    }
  }
}

/** Extract {placeholder} names from a log template string. */
function extractPlaceholders(template: string, into: Set<string>): void {
  const re = /\{(\w+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) into.add(m[1]);
}
