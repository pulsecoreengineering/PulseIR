/**
 * PulseHSM IR Code Generator
 *
 * Converts PulseModel → C++ code targeting the PulseHSM runtime (deps/).
 *
 * The model maps onto the library like this:
 *   - every IR state becomes a PulseHSM state, registered parent-before-child
 *   - a state's outgoing transitions become its `onEvent` callback
 *   - event bubbling gives "innermost transition wins" for free: a leaf handler
 *     that returns false lets the event rise to its superstate
 *   - a guard that blocks does NOT consume the event, so an enclosing state
 *     still gets a chance to handle it
 *   - `transitionTo()` always receives a leaf, so composite targets are
 *     resolved down through their initial children first
 *
 * Guard and action signatures follow FUNCTION_CONTRACT.md exactly:
 *   bool guard_<name>(const SystemContext* ctx)
 *   void action_<name>(SystemContext* ctx)
 *
 * The generator emits *shape* only. Guards and actions are names of functions
 * the user writes in C; any description attached to them is reproduced as a
 * comment in the stub body, never as code.
 */

import type {
  PulseProject,
  State,
  Transition,
  Parameter,
  StateRef,
} from '../model/index.js';
import { InterfaceBackend } from './interfaces.js';
import type { ImpliedLibrary, InterfaceEmission } from './interfaces.js';

export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodegenError';
  }
}

/**
 * A state flattened out of the hierarchy, carrying everything registration
 * needs: its full path, its parent, and its initial child.
 */
interface FlatState {
  state: State | null;   // null for the synthetic root
  path: string;          // "running/heating"
  symbol: string;        // "S_HEATING" - the global holding its runtime index
  index: number;
  parent: number;        // -1 for top-level
  depth: number;         // 0 for top-level
  initialChild: number;  // -1 when this is a leaf
}

interface GuardBinding {
  fnName: string;        // "guard_temp_ready"
  description?: string;  // human intent, copied into the stub as a comment
}

/** Name of the synthetic superstate that owns wildcard ("*") transitions. */
const ROOT_PATH = '__root';

export class Codegen {
  private project!: PulseProject;
  private states: FlatState[] = [];
  private byPath: Map<string, number> = new Map();
  private byLeafName: Map<string, number[]> = new Map();

  /** Index of the synthetic root, or -1 when the model has no wildcards. */
  private rootIndex = -1;

  /** transition index → guard binding (only for transitions that have a guard) */
  private guards: Map<number, GuardBinding> = new Map();
  /** guard function name → binding, deduplicated so each stub is emitted once */
  private guardStubs: Map<string, GuardBinding> = new Map();
  /** every distinct action name referenced by a transition */
  private actionNames: Set<string> = new Set();
  /** state index → transitions leaving that state, in model order */
  private transitionsBySource: Map<number, number[]> = new Map();

  private readonly interfaces = new InterfaceBackend();
  /** resource name → what its interface contributes to the sketch */
  private emissions: Map<string, InterfaceEmission> = new Map();
  /** Every library needed, deduplicated by name. */
  private libraries: Map<string, ImpliedLibrary> = new Map();

  /**
   * Generate C++ code from a validated PulseModel
   */
  generate(project: PulseProject): string {
    this.reset();
    this.project = project;
    this.indexStates();
    this.indexGuards();
    this.indexActions();
    this.indexTransitions();
    this.indexInterfaces();

    return [
      this.generateHeader(),
      this.generateIncludes(),
      this.generateInterfaces(),
      this.generateEventEnum(),
      this.generateParameterStruct(),
      this.generateSensorStruct(),
      this.generateContextStruct(),
      this.generateMachineDeclarations(),
      this.generateGuardDeclarations(),
      this.generateActionDeclarations(),
      this.generateEventHandlers(),
      this.generateSetupFunction(),
      this.generateLoopFunction(),
      this.generateGuardImplementations(),
      this.generateActionImplementations(),
    ].join('\n\n') + '\n';
  }

  private reset(): void {
    this.states = [];
    this.byPath = new Map();
    this.byLeafName = new Map();
    this.rootIndex = -1;
    this.guards = new Map();
    this.guardStubs = new Map();
    this.actionNames = new Set();
    this.transitionsBySource = new Map();
    this.emissions = new Map();
    this.libraries = new Map();
  }

  /**
   * Work out what each declared resource contributes, and collect every
   * library needed - both the ones an interface implies and the ones the
   * model declares.
   */
  private indexInterfaces(): void {
    for (const resource of this.project.system.resources || []) {
      const emission = this.interfaces.emit(resource, this.sanitizeUpper(resource.name));
      this.emissions.set(resource.name, emission);

      for (const library of emission.libraries) {
        if (!this.libraries.has(library.name)) this.libraries.set(library.name, library);
      }
    }

    // Declared libraries win, so a model can pin a version or override a header.
    for (const library of this.interfaces.declared(this.project.system.libraries)) {
      this.libraries.set(library.name, library);
    }
  }

  // =========================================================================
  // HEADER
  // =========================================================================

  private generateHeader(): string {
    const { name, version } = this.project;
    const date = new Date().toISOString().split('T')[0];

    // These three macros only take effect if they precede the include.
    const maxStates = this.states.length + 2;      // + headroom for growth
    const maxEvents = this.nextPowerOfTwo(Math.max(8, this.project.system.events.length));
    const levels = Math.max(1, ...this.states.map(s => s.depth + 1));

    return `/**
 * PulseHSM Generated Code
 *
 * Project: ${name}
 * Version: ${version}
 * Generated: ${date}
 *
 * This file was auto-generated from a PulseHSM model.
 * DO NOT EDIT MANUALLY - regenerate from source instead.
 *
 * Guard/action signatures follow FUNCTION_CONTRACT.md:
 *   bool guard_<name>(const SystemContext* ctx)
 *   void action_<name>(SystemContext* ctx)
 */

// Sized from the model. These must stay above the include to take effect.
#define PULSEHSM_MAX_STATES  ${maxStates}   // ${this.states.length} states + headroom
#define PULSEHSM_MAX_EVENTS  ${maxEvents}   // ring buffer, must be a power of two
#define PULSEHSM_MAX_DEPTH   ${levels}   // deepest nesting, including the leaf

#include <Arduino.h>
#include "PulseHSM.h"`;
  }

  // =========================================================================
  // LIBRARY INCLUDES
  // =========================================================================

  private generateIncludes(): string {
    if (this.libraries.size === 0) {
      return `// ============================================================================
// LIBRARIES
// ============================================================================

// No external libraries required.`;
    }

    const libraries = Array.from(this.libraries.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    const includes = libraries
      .map(l => `#include <${l.include}>`)
      .join('\n');

    // The install list is the "how do I get these" half of the story; the
    // machine-readable version comes out of `--libraries`.
    const install = libraries
      .map(l => {
        const via = l.source === 'builtin'
          ? 'bundled with the board core'
          : 'install via Library Manager / lib_deps';
        return `//   ${l.name.padEnd(16)} ${via}  (${l.reason})`;
      })
      .join('\n');

    return `// ============================================================================
// LIBRARIES
// ============================================================================
//
// Required before this sketch will build:
${install}

${includes}`;
  }

  // =========================================================================
  // INTERFACES
  // =========================================================================

  private generateInterfaces(): string {
    const resources = this.project.system.resources || [];
    if (resources.length === 0) {
      return `// ============================================================================
// INTERFACES
// ============================================================================

// No resources declared.

void setupInterfaces() {}`;
    }

    const blocks: string[] = [];
    const globals: string[] = [];
    const body: string[] = [];
    const todos: string[] = [];

    for (const resource of resources) {
      const emission = this.emissions.get(resource.name);
      if (!emission) continue;

      const heading = `// ${resource.name} (${resource.interface})` +
        (resource.description ? ` - ${resource.description}` : '');

      if (emission.defines.length > 0) {
        blocks.push([heading, ...emission.defines].join('\n'));
      } else {
        blocks.push(heading);
      }

      globals.push(...emission.globals);

      if (emission.init.length > 0) {
        body.push(`  // ${resource.name}`);
        // Preprocessor directives must start at column zero.
        body.push(...emission.init.map(line => (line.startsWith('#') ? line : `  ${line}`)));
        body.push('');
      }

      todos.push(...emission.todos);
    }

    const todoBlock = todos.length > 0
      ? `//\n// Still yours to finish:\n${todos.map(t => `//   - ${t}`).join('\n')}\n`
      : '';

    return `// ============================================================================
// INTERFACES
// ============================================================================
//
// Pin arguments to begin() require an ESP32/ESP8266/RP2040 core; the fallbacks
// below cover cores without them. Adjust setupInterfaces() for other boards.
${todoBlock}
${blocks.join('\n\n')}
${globals.length > 0 ? `\n${globals.join('\n')}\n` : ''}
void setupInterfaces() {
${body.length > 0 ? body.join('\n').replace(/\n+$/, '') : '  // Nothing to initialise'}
}`;
  }

  // =========================================================================
  // EVENT ENUM
  // =========================================================================

  private generateEventEnum(): string {
    const events = this.project.system.events;
    if (events.length === 0) {
      throw new CodegenError('System defines no events; nothing to dispatch');
    }
    if (events.length > 256) {
      throw new CodegenError('PulseHSM event IDs are uint8_t; at most 256 events are supported');
    }

    const eventNames = events.map(e => this.sanitizeUpper(e.name));
    const enumValues = eventNames.map((name, idx) => `  EVENT_${name} = ${idx}`).join(',\n');

    return `// ============================================================================
// EVENT DEFINITIONS
// ============================================================================

// uint8_t to match PulseHSM::sendEvent / EventCb.
enum SystemEvent : uint8_t {
${enumValues}
};

const char* eventNames[] = {
${eventNames.map(name => `  "${name}"`).join(',\n')}
};`;
  }

  // =========================================================================
  // SYSTEM PARAMETERS (from YAML)
  // =========================================================================

  private generateParameterStruct(): string {
    const parameters = this.project.system.parameters || [];

    if (parameters.length === 0) {
      return `// ============================================================================
// SYSTEM PARAMETERS
// ============================================================================

// No parameters defined in the model.
struct SystemParameters {};

SystemParameters systemParameters = {};`;
    }

    const fields = parameters
      .map(p => {
        const unit = p.unit ? `  // ${p.unit}` : '';
        return `  ${this.cType(p)} ${this.sanitize(p.name)};${unit}`;
      })
      .join('\n');

    const inits = parameters
      .map((p, idx) => {
        const comma = idx < parameters.length - 1 ? ',' : '';
        return `  ${this.cLiteral(p)}${comma}   // ${this.sanitize(p.name)}`;
      })
      .join('\n');

    return `// ============================================================================
// SYSTEM PARAMETERS
// ============================================================================

// Generated from the model's "parameters" section.
struct SystemParameters {
${fields}
};

// Initialized with the defaults declared in the model.
SystemParameters systemParameters = {
${inits}
};`;
  }

  // =========================================================================
  // SYSTEM SENSORS (user fills in)
  // =========================================================================

  private generateSensorStruct(): string {
    const sensors = (this.project.system.components || []).filter(
      c => String(c.class) === 'sensor'
    );

    const fields = sensors.length > 0
      ? sensors
          .map(c => `  float ${this.sanitize(c.name)};  // driver: ${c.driver}`)
          .join('\n')
      : '  // TODO: Add your sensor readings here (e.g. float temperature;)';

    return `// ============================================================================
// SYSTEM SENSORS
// ============================================================================

// One field per sensor component in the model. Populate these from real
// hardware reads in loop() - the generator never reads hardware for you.
struct SystemSensors {
${fields}
};

SystemSensors systemSensors = {};`;
  }

  // =========================================================================
  // SYSTEM CONTEXT
  // =========================================================================

  private generateContextStruct(): string {
    return `// ============================================================================
// SYSTEM CONTEXT (see FUNCTION_CONTRACT.md)
// ============================================================================

struct SystemContext {
  int currentState;                    // Current state index (compare with S_*)
  int previousState;                   // Previous state index (-1 before first transition)
  int32_t eventData;                   // Payload of the event being dispatched
  const SystemParameters* parameters;  // Read-only system parameters
  const SystemSensors* sensors;        // Current sensor readings
};

SystemContext systemContext;`;
  }

  // =========================================================================
  // MACHINE + STATE INDEX GLOBALS
  // =========================================================================

  private generateMachineDeclarations(): string {
    // PulseHSM hands back an index from addState(); it must live in a global,
    // because handlers reference it long after setup() returns.
    const indices = this.states
      .map(s => `int ${s.symbol} = -1;${s.path === ROOT_PATH ? '  // synthetic root for wildcard transitions' : `  // ${s.path}`}`)
      .join('\n');

    return `// ============================================================================
// STATE MACHINE
// ============================================================================

PulseHSM fsm;

// State indices returned by addState(). Globals, per the PulseHSM contract.
${indices}`;
  }

  // =========================================================================
  // GUARD / ACTION DECLARATIONS
  // =========================================================================

  private generateGuardDeclarations(): string {
    if (this.guardStubs.size === 0) {
      return `// ============================================================================
// GUARD DECLARATIONS
// ============================================================================

// No guards defined`;
    }

    const declarations = Array.from(this.guardStubs.keys())
      .map(fnName => `bool ${fnName}(const SystemContext* ctx);`)
      .join('\n');

    return `// ============================================================================
// GUARD DECLARATIONS
// ============================================================================

${declarations}`;
  }

  private generateActionDeclarations(): string {
    if (this.actionNames.size === 0) {
      return `// ============================================================================
// ACTION DECLARATIONS
// ============================================================================

// No actions defined`;
    }

    const declarations = Array.from(this.actionNames)
      .map(name => `void action_${this.sanitize(name)}(SystemContext* ctx);`)
      .join('\n');

    return `// ============================================================================
// ACTION DECLARATIONS
// ============================================================================

${declarations}`;
  }

  // =========================================================================
  // EVENT HANDLERS (one per state with outgoing transitions)
  // =========================================================================

  private generateEventHandlers(): string {
    const handlers: string[] = [];

    for (const flat of this.states) {
      const owned = this.transitionsBySource.get(flat.index);
      if (!owned || owned.length === 0) continue;
      handlers.push(this.generateHandler(flat, owned));
    }

    const sync = `// Refresh the context handed to every guard and action.
// Called at the top of each handler so guards see the live machine state.
static void syncContext() {
  systemContext.currentState = fsm.getCurrentState();
  systemContext.previousState = fsm.getPreviousState();
  systemContext.eventData = fsm.getEventData();
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
}`;

    if (handlers.length === 0) {
      return `// ============================================================================
// EVENT HANDLERS
// ============================================================================

${sync}

// No transitions defined`;
    }

    return `// ============================================================================
// EVENT HANDLERS
// ============================================================================
//
// Returning true consumes the event. Returning false lets it bubble to the
// enclosing state, which is what makes an inner transition outrank an outer
// one on the same event.

${sync}

${handlers.join('\n\n')}`;
  }

  private generateHandler(flat: FlatState, owned: number[]): string {
    const transitions = this.project.system.transitions;

    // Group this state's transitions by event, preserving model order.
    const byEvent = new Map<string, number[]>();
    for (const idx of owned) {
      const event = transitions[idx].event;
      const list = byEvent.get(event) || [];
      list.push(idx);
      byEvent.set(event, list);
    }

    const cases: string[] = [];

    for (const [event, indices] of byEvent) {
      const body: string[] = [];
      let shadowed = false;

      for (const idx of indices) {
        if (shadowed) {
          const t = transitions[idx];
          body.push(
            `      // Unreachable: an earlier unguarded transition on this event\n` +
            `      // always fires first (-> ${t.target}).`
          );
          break;
        }

        const t = transitions[idx];
        const guard = this.guards.get(idx);
        const target = this.states[this.resolveEntry(this.resolveRef(t.target, 'target'))];
        const calls = (t.actions || [])
          .map(a => `        action_${this.sanitize(a.driver)}(&systemContext);`)
          .join('\n');

        const fire = [
          calls,
          `        fsm.transitionTo(${target.symbol});`,
          '        return true;',
        ].filter(Boolean).join('\n');

        if (guard) {
          // A blocked guard must not consume the event - fall through so the
          // next candidate, and then the enclosing state, still get a turn.
          body.push(`      if (${guard.fnName}(&systemContext)) {
${fire}
      }`);
        } else {
          body.push(`      {
${fire}
      }`);
          shadowed = true;
        }
      }

      cases.push(`    case EVENT_${this.sanitizeUpper(event)}:
${body.join('\n')}
      break;`);
    }

    const label = flat.path === ROOT_PATH
      ? 'wildcard transitions (source: "*")'
      : `state "${flat.path}"`;

    return `// Handles ${label}.
bool ${this.handlerName(flat)}(uint8_t event) {
  syncContext();

  switch (event) {
${cases.join('\n')}
    default:
      break;
  }

  return false;  // not handled here - let it bubble
}`;
  }

  private handlerName(flat: FlatState): string {
    return `onEvent_${this.sanitize(flat.path)}`;
  }

  // =========================================================================
  // SETUP
  // =========================================================================

  private generateSetupFunction(): string {
    if (this.states.length === 0) {
      throw new CodegenError('System defines no states; nothing to generate');
    }

    const components = this.project.system.components || [];
    const gpioComponents = components.filter(c => c.driver.includes('gpio'));

    const componentComments = components.length > 0
      ? components
          .map(c => {
            const pin = c.config?.pin ? ` - pin ${c.config.pin}` : '';
            return `// Component: ${c.name} (${c.class})${pin}`;
          })
          .join('\n')
      : '// No components defined';

    const initCode = gpioComponents
      .map(c => {
        const pin = c.config?.pin || 'GPIO_PIN';
        return `  // pinMode(${pin}, OUTPUT);  // ${c.name}`;
      })
      .join('\n');

    // Registration order is pre-order, so a parent is always registered before
    // its children - which PulseHSM requires for the hierarchy to work.
    const registrations = this.states
      .map(flat => {
        const handler = this.transitionsBySource.get(flat.index)?.length
          ? this.handlerName(flat)
          : 'nullptr';
        const parent = flat.parent === -1 ? '-1' : this.states[flat.parent].symbol;

        return `  ${flat.symbol} = fsm.addState(
      "${flat.path}",
      nullptr,   // update
      nullptr,   // entry
      nullptr,   // exit
      0,         // timeoutMs
      -1,        // timeoutNext
      ${handler},  // onEvent
      ${parent});`;
      })
      .join('\n\n');

    // begin() requires a leaf, so descend the initial chain from the first
    // top-level state in the model.
    const firstTopLevel = this.states.findIndex(s => s.parent === -1 && s.path !== ROOT_PATH);
    const rootRelative = this.rootIndex !== -1
      ? this.states.findIndex(s => s.parent === this.rootIndex)
      : firstTopLevel;
    const startIndex = this.resolveEntry(rootRelative === -1 ? 0 : rootRelative);

    return `// ============================================================================
// SETUP
// ============================================================================

${componentComments}

void setup() {
  Serial.begin(115200);
  Serial.println("\\n\\n=== ${this.project.name} v${this.project.version} ===");

  // Buses and peripherals declared as resources
  setupInterfaces();

  // Initialize components
${initCode || '  // Initialize pins and peripherals here'}

  // Wire up the context handed to every guard and action
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;

  // Register states. Parents are registered before their children.
${registrations}

  // begin() must be given a leaf state.
  fsm.begin(${this.states[startIndex].symbol});

  Serial.print("Initial state: ");
  Serial.println(fsm.getCurrentName());
}`;
  }

  // =========================================================================
  // LOOP
  // =========================================================================

  private generateLoopFunction(): string {
    const example = this.project.system.events[0];
    const exampleName = example ? `EVENT_${this.sanitizeUpper(example.name)}` : 'EVENT_NONE';

    return `// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  // TODO: Read sensors into systemSensors, then raise events.
  // Example:
  //   systemSensors.temperature = readTemperature();
  //   if (systemSensors.temperature >= systemParameters.setpoint) {
  //     fsm.sendEvent(${exampleName});
  //   }
  //
  // sendEvent() is ISR-safe, so interrupts may call it directly.
  // Never call delay() here - it starves fsm.update().

  fsm.update();
}`;
  }

  // =========================================================================
  // GUARD IMPLEMENTATIONS
  // =========================================================================

  private generateGuardImplementations(): string {
    if (this.guardStubs.size === 0) {
      return `// ============================================================================
// GUARD IMPLEMENTATIONS
// ============================================================================

// No guards defined`;
    }

    const implementations = Array.from(this.guardStubs.entries())
      .map(([fnName, binding]) => {
        // The description is prose from the model, carried through purely as
        // documentation for whoever implements this.
        const intent = binding.description
          ? `  // Intent: ${binding.description}\n  //\n`
          : '';

        return `bool ${fnName}(const SystemContext* ctx) {
${intent}  // TODO: Implement this check using ctx->sensors, ctx->parameters,
  //       ctx->currentState and ctx->eventData.
  (void)ctx;
  return false;
}`;
      })
      .join('\n\n');

    return `// ============================================================================
// GUARD IMPLEMENTATIONS
// ============================================================================

${implementations}`;
  }

  // =========================================================================
  // ACTION IMPLEMENTATIONS
  // =========================================================================

  private generateActionImplementations(): string {
    if (this.actionNames.size === 0) {
      return `// ============================================================================
// ACTION IMPLEMENTATIONS
// ============================================================================

// No actions defined`;
    }

    const implementations = Array.from(this.actionNames).map(name => {
      const action = this.project.system.transitions
        .flatMap(t => t.actions || [])
        .find(a => a.driver === name);

      const paramDoc = action?.params
        ? Object.entries(action.params)
            .map(([k, v]) => `  //   ${k}: ${JSON.stringify(v)}`)
            .join('\n')
        : '  //   (none)';

      return `void action_${this.sanitize(name)}(SystemContext* ctx) {
  Serial.println("  -> Action: ${name}");
  // Parameters declared in the model (documentation only):
${paramDoc}
  //
  // TODO: Implement the hardware calls for this action.
  (void)ctx;
}`;
    });

    return `// ============================================================================
// ACTION IMPLEMENTATIONS
// ============================================================================

${implementations.join('\n\n')}`;
  }

  // =========================================================================
  // INDEXING
  // =========================================================================

  private indexStates(): void {
    // A wildcard transition needs somewhere to live. PulseHSM has no implicit
    // root, so synthesise one and hang the model's top-level states off it -
    // then bubbling carries unhandled events up to the wildcard handlers.
    const needsRoot = this.project.system.transitions.some(t => t.source === '*');

    if (needsRoot) {
      this.rootIndex = 0;
      this.states.push({
        state: null,
        path: ROOT_PATH,
        symbol: 'S_ROOT',
        index: 0,
        parent: -1,
        depth: 0,
        initialChild: -1,
      });
      this.byPath.set(ROOT_PATH, 0);
    }

    this.flatten(this.project.system.states, this.rootIndex, needsRoot ? 1 : 0, '');

    if (this.states.length > 127) {
      // PulseHSM stores parent as int8_t.
      throw new CodegenError(
        `Model has ${this.states.length} states; PulseHSM supports at most 127`
      );
    }

    // Prefer the short leaf name (S_HEATING) when it is unambiguous, and fall
    // back to the full path (S_RUNNING_HEATING) when two states in different
    // branches share a name.
    for (const flat of this.states) {
      if (flat.state === null) continue;
      const siblings = this.byLeafName.get(flat.state.name) || [];
      const basis = siblings.length === 1 ? flat.state.name : flat.path;
      flat.symbol = `S_${this.sanitizeUpper(basis)}`;
    }

    const seen = new Set<string>();
    for (const flat of this.states) {
      if (seen.has(flat.symbol)) {
        throw new CodegenError(
          `State "${flat.path}" collides with another state on generated symbol ${flat.symbol}`
        );
      }
      seen.add(flat.symbol);
    }

    // Resolve each composite state's initial child now that paths are indexed.
    for (const flat of this.states) {
      if (flat.state === null) continue;
      const initialRef = this.initialRefFor(flat.state);
      if (!initialRef) continue;

      // "initial: heating" is relative to the composite state that declares it.
      const nested = `${flat.path}/${initialRef}`;
      const childIdx = this.byPath.has(nested)
        ? this.byPath.get(nested)!
        : this.byPath.get(initialRef);

      if (childIdx === undefined) {
        throw new CodegenError(
          `State "${flat.path}" declares initial child "${initialRef}", which does not exist`
        );
      }
      flat.initialChild = childIdx;
    }
  }

  private flatten(states: State[], parent: number, depth: number, prefix: string): void {
    for (const state of states) {
      if (!state.name) {
        throw new CodegenError(`Encountered a state without a name under "${prefix || '<root>'}"`);
      }

      const path = prefix ? `${prefix}/${state.name}` : state.name;
      const index = this.states.length;

      if (this.byPath.has(path)) {
        throw new CodegenError(`Duplicate state path "${path}"`);
      }

      this.states.push({
        state,
        path,
        symbol: '',
        index,
        parent,
        depth,
        initialChild: -1,
      });
      this.byPath.set(path, index);

      const sameName = this.byLeafName.get(state.name) || [];
      sameName.push(index);
      this.byLeafName.set(state.name, sameName);

      for (const region of state.regions || []) {
        this.flatten(region.states, index, depth + 1, path);
      }
    }
  }

  /** A composite state's initial child, from either the state or its region. */
  private initialRefFor(state: State): StateRef | undefined {
    if (state.initial) return state.initial;
    const region = state.regions?.[0];
    if (region?.initial && region.initial !== 'INVALID') return region.initial;
    return undefined;
  }

  private indexGuards(): void {
    this.project.system.transitions.forEach((t, idx) => {
      if (!t.guard) return;

      if (!t.guard.name) {
        throw new CodegenError(`Transition ${idx} has a guard without a name`);
      }

      // The guard's name is the user's, unchanged, so the same hand-written
      // function ports across targets. Two transitions naming the same guard
      // share one stub deliberately.
      const fnName = `guard_${this.sanitize(t.guard.name)}`;
      const binding: GuardBinding = { fnName, description: t.guard.description };

      this.guards.set(idx, binding);

      const existing = this.guardStubs.get(fnName);
      if (!existing) {
        this.guardStubs.set(fnName, binding);
      } else if (!existing.description && binding.description) {
        // Keep whichever mention bothered to document itself.
        this.guardStubs.set(fnName, binding);
      }
    });
  }

  private indexActions(): void {
    this.project.system.transitions.forEach((t, idx) => {
      for (const a of t.actions || []) {
        if (!a.driver) {
          throw new CodegenError(`Transition ${idx} has an action without a name`);
        }
        this.actionNames.add(a.driver);
      }
    });
  }

  private indexTransitions(): void {
    this.project.system.transitions.forEach((t, idx) => {
      let sourceIdx: number;

      if (t.source === '*') {
        if (this.rootIndex === -1) {
          throw new CodegenError('Internal error: wildcard transition without a synthetic root');
        }
        sourceIdx = this.rootIndex;
      } else {
        sourceIdx = this.resolveRef(t.source, 'source');
      }

      // Validate the target eagerly so errors point at the model, not at C++.
      this.resolveEntry(this.resolveRef(t.target, 'target'));

      const list = this.transitionsBySource.get(sourceIdx) || [];
      list.push(idx);
      this.transitionsBySource.set(sourceIdx, list);
    });
  }

  // =========================================================================
  // REFERENCE RESOLUTION
  // =========================================================================

  /**
   * Resolve a StateRef to an index. Accepts a full path ("running/heating")
   * or a bare leaf name ("heating") when that name is unambiguous.
   */
  private resolveRef(ref: StateRef, role: 'source' | 'target'): number {
    if (ref === '*') {
      throw new CodegenError(`Wildcard "*" is not a valid transition ${role}`);
    }

    const exact = this.byPath.get(ref);
    if (exact !== undefined) return exact;

    const candidates = this.byLeafName.get(ref);
    if (candidates && candidates.length === 1) return candidates[0];
    if (candidates && candidates.length > 1) {
      const paths = candidates.map(i => this.states[i].path).join(', ');
      throw new CodegenError(
        `Transition ${role} "${ref}" is ambiguous; it matches ${paths}. Use a full path.`
      );
    }

    throw new CodegenError(`Transition ${role} references unknown state "${ref}"`);
  }

  /** Descend a composite state to the leaf that actually becomes active. */
  private resolveEntry(index: number): number {
    let current = index;
    const seen = new Set<number>();
    while (this.states[current].initialChild !== -1) {
      if (seen.has(current)) {
        throw new CodegenError(
          `Cycle in initial-child chain at state "${this.states[current].path}"`
        );
      }
      seen.add(current);
      current = this.states[current].initialChild;
    }
    return current;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private nextPowerOfTwo(n: number): number {
    let value = 1;
    while (value < n) value *= 2;
    return value;
  }

  private cType(p: Parameter): string {
    switch (p.type) {
      case 'float': return 'float';
      case 'int': return 'int32_t';
      case 'bool': return 'bool';
      case 'string': return 'const char*';
      default:
        throw new CodegenError(`Parameter "${p.name}" has unsupported type "${p.type}"`);
    }
  }

  private cLiteral(p: Parameter): string {
    const value = p.default;

    switch (p.type) {
      case 'float': {
        const n = Number(value ?? 0);
        if (!Number.isFinite(n)) {
          throw new CodegenError(`Parameter "${p.name}" has a non-numeric default`);
        }
        // Keep the decimal point so the literal stays floating point.
        return `${Number.isInteger(n) ? n.toFixed(1) : String(n)}f`;
      }
      case 'int': {
        const n = Number(value ?? 0);
        if (!Number.isInteger(n)) {
          throw new CodegenError(`Parameter "${p.name}" has a non-integer default`);
        }
        return String(n);
      }
      case 'bool':
        return value ? 'true' : 'false';
      case 'string':
        return JSON.stringify(String(value ?? ''));
      default:
        throw new CodegenError(`Parameter "${p.name}" has unsupported type "${p.type}"`);
    }
  }

  private sanitize(name: string): string {
    const cleaned = String(name)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned || 'unnamed';
  }

  private sanitizeUpper(name: string): string {
    return this.sanitize(name).toUpperCase();
  }
}

export { Codegen as default };
