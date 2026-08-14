/**
 * Arduino backend for PulseIR.
 *
 * This is *a* backend, not the IR: it turns a PulseModel into an Arduino
 * sketch. When the model declares a state machine it targets the PulseHSM
 * runtime; when it does not, it emits plain Arduino with no runtime at all,
 * and `hasMachine` is the seam between the two.
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
  Resource,
  StateRef,
  Action,
} from '../model/index.js';
import { parseTemplate } from '../analysis/template.js';
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

/**
 * Primitive device types that own a pin outright, and the interface that
 * initialises them. A `digital_output` needs its `pinMode`, and declaring the
 * device should be enough to get it - requiring a separate `gpio` bus for that
 * is the boilerplate this project exists to remove.
 *
 * Part types like ds18b20 or bme280 are absent on purpose: they sit on a bus,
 * and the bus owns the initialisation.
 */
const DEVICE_INTERFACE: Record<string, { interface: string; mode?: string }> = {
  digital_output: { interface: 'gpio', mode: 'OUTPUT' },
  digital_input:  { interface: 'gpio', mode: 'INPUT' },
  pwm_output:     { interface: 'pwm' },
  analog_input:   { interface: 'adc' },
};

export interface GeneratedFile {
  /** Path relative to the output directory. */
  path: string;
  contents: string;
}

export interface GeneratedProject {
  /**
   * Whether this project uses PulseHSM at all.
   *
   * False for a model with no `machine:`, and the caller must not vendor the
   * runtime beside it - shipping a copy of PulseHSM with a blink would say the
   * dependency exists when it does not.
   */
  needsRuntime: boolean;
  /** Rewritten on every run. Never edit these. */
  generated: GeneratedFile[];
  /** Written only if absent, so your implementations survive regeneration. */
  scaffolds: GeneratedFile[];
}

export class Codegen {
  private project!: PulseProject;
  private states: FlatState[] = [];
  private byPath: Map<string, number> = new Map();
  private byLeafName: Map<string, number[]> = new Map();

  /** Index of the synthetic root, or -1 when the model has no wildcards. */
  private rootIndex = -1;

  /**
   * True when the model declares a state machine.
   *
   * PulseHSM is one tenant of this IR, not its foundation: a blink, or a board
   * that answers commands over the serial monitor, is a complete project with
   * no states at all. When this is false nothing about the runtime is emitted -
   * no include, no sizing header, no fsm - and the sketch is plain Arduino.
   */
  private get hasMachine(): boolean {
    return this.states.length > 0;
  }

  /** transition index → guard binding (only for transitions that have a guard) */
  private guards: Map<number, GuardBinding> = new Map();
  /** guard function name → binding, deduplicated so each stub is emitted once */
  private guardStubs: Map<string, GuardBinding> = new Map();
  /** every distinct action name referenced by a transition */
  private actionNames: Set<string> = new Set();
  /** state index → event-driven transitions leaving it, in model order */
  private transitionsBySource: Map<number, number[]> = new Map();
  /** state index → timed ("after") transitions leaving it, in model order */
  private timedBySource: Map<number, number[]> = new Map();

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
    this.assertConsoleForLogs();

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
      this.generateTimeouts(),
      this.generateTasks(),
      this.generateCommands(),
      this.generateSetupFunction(),
      this.generateLoopFunction(),
      this.generateGuardImplementations(),
      this.generateActionImplementations(),
    ].join('\n\n') + '\n';
  }

  /**
   * Generate the project as separate files, so regenerating never touches code
   * you wrote.
   *
   * Everything derived from the model is rewritten every time. Guard and action
   * bodies are *scaffolds*: emitted once if absent, and never again. That split
   * is the whole point - with a single self-contained sketch, regenerating
   * silently destroys every implementation you filled in.
   */
  generateFiles(project: PulseProject): GeneratedProject {
    this.reset();
    this.project = project;
    this.indexStates();
    this.indexGuards();
    this.indexActions();
    this.indexTransitions();
    this.indexInterfaces();
    this.assertConsoleForLogs();

    const base = this.sanitize(project.name);
    const headerName = `${base}_generated.h`;
    const guardName = 'src/guards.cpp';
    const actionName = 'src/actions.cpp';

    return {
      // Only a project with a state machine needs the runtime, the header that
      // sizes it, or a place to put guards - guards live on transitions.
      needsRuntime: this.hasMachine,
      generated: [
        ...(this.hasMachine
          ? [{ path: 'PulseHSM_config.h', contents: this.generateConfigHeader() }]
          : []),
        { path: headerName, contents: this.composeHeader(headerName) },
        { path: `${base}.ino`, contents: this.composeSketch(headerName) },
      ],
      scaffolds: [
        ...(this.hasMachine
          ? [{ path: guardName, contents: this.composeGuardFile(headerName) }]
          : []),
        { path: actionName, contents: this.composeActionFile(headerName) },
      ],
    };
  }

  /** Declarations: types, macros and prototypes that every file shares. */
  private composeHeader(headerName: string): string {
    const guard = `PULSEIR_${this.sanitizeUpper(this.project.name)}_GENERATED_H`;

    return [
      this.generateHeader(),
      `#ifndef ${guard}\n#define ${guard}`,
      this.generateIncludes(),
      this.declInterfaces(),
      this.declEventEnum(),
      this.declParameterStruct(),
      this.declSensorStruct(),
      this.declContextStruct(),
      this.hasMachine ? this.machineGlobals(true) : '',
      `// Instances the sketch defines.
extern SystemParameters systemParameters;
extern SystemSensors systemSensors;
extern SystemContext systemContext;

// The Arduino IDE auto-prototypes these for .ino files, but a .cpp in src/
// needs them declared.
void setup();
void loop();
void setupInterfaces();${this.declInterfaceGlobals()}`,
      this.generateGuardDeclarations(),
      this.generateActionDeclarations(),
      `#endif  // ${guard}`,
    ].join('\n\n') + '\n';
  }

  /** Definitions the model owns. Rewritten on every generate. */
  private composeSketch(headerName: string): string {
    // The sizing macros must precede PulseHSM.h, and the header does that -
    // so the sketch includes the header first and nothing else.
    return [
      `/**\n * PulseIR Generated Code - DO NOT EDIT.\n *\n * Regenerated from the model every time. Your guards and actions live in\n * src/, which this file never overwrites.\n */\n\n#include "${headerName}"`,
      this.defEventNames(),
      this.defParameterInstance(),
      'SystemSensors systemSensors = {};',
      'SystemContext systemContext;',
      this.hasMachine
        ? this.machineGlobals(false).replace(/^\/\/ =+\n\/\/ STATE MACHINE\n\/\/ =+\n\n/m, '')
        : '',
      this.defInterfaces().trimStart(),
      this.generateEventHandlers(),
      this.generateTimeouts(),
      this.generateTasks(),
      this.generateCommands(),
      this.generateSetupFunction(),
      this.generateLoopFunction(),
    ].join('\n\n') + '\n';
  }

  private composeGuardFile(headerName: string): string {
    return `/**
 * Guards - YOUR CODE. Safe to edit; regenerating never overwrites this file.
 *
 * A guard is a pure check: return true to allow the transition, false to block
 * it. Blocking does not consume the event, so an enclosing state still gets a
 * chance to handle it.
 *
 * Delete this file and regenerate to get fresh stubs.
 */

#include "${headerName}"

${this.generateGuardImplementations()}
`;
  }

  private composeActionFile(headerName: string): string {
    return `/**
 * Actions - YOUR CODE. Safe to edit; regenerating never overwrites this file.
 *
 * Actions run before the state changes, so ctx->currentState is still the state
 * being left. Everything you need is on ctx: parameters, sensor readings, the
 * current and previous state, and the event payload.
 *
 * Delete this file and regenerate to get fresh stubs.
 */

#include "${headerName}"

${this.generateActionImplementations()}
`;
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
    this.timedBySource = new Map();
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
      this.addEmission(resource.name, this.interfaces.emit(resource, this.sanitizeUpper(resource.name)));
    }

    // A device that owns its pin initialises itself, so `pump: {type:
    // digital_output, pin: GPIO25}` produces its pinMode with no bus declared.
    for (const device of this.project.system.components || []) {
      const mapping = DEVICE_INTERFACE[device.type || ''];
      if (!mapping) continue;

      const binding = { ...(device.config || {}) };
      if (mapping.mode && binding.mode === undefined) binding.mode = mapping.mode;

      this.addEmission(device.name, this.interfaces.emit(
        {
          name: device.name,
          interface: mapping.interface as never,
          binding,
          description: device.description,
        },
        this.sanitizeUpper(device.name)
      ));
    }

    // Declared libraries win, so a model can pin a version or override a header.
    for (const library of this.interfaces.declared(this.project.system.libraries)) {
      this.libraries.set(library.name, library);
    }
  }

  private addEmission(name: string, emission: InterfaceEmission): void {
    this.emissions.set(name, emission);
    for (const library of emission.libraries) {
      if (!this.libraries.has(library.name)) this.libraries.set(library.name, library);
    }
  }

  // =========================================================================
  // HEADER
  // =========================================================================

  /**
   * How big the runtime's tables have to be for this model.
   *
   * These decide the layout of the PulseHSM class, so every translation unit
   * has to see the same values - see generateConfigHeader().
   */
  private sizing(): { maxStates: number; maxEvents: number; levels: number } {
    return {
      maxStates: this.states.length + 2,      // + headroom for growth
      maxEvents: this.nextPowerOfTwo(Math.max(8, this.project.system.events.length)),
      levels: Math.max(1, ...this.states.map(s => s.depth + 1)),
    };
  }

  /**
   * PulseHSM_config.h - the sizing macros, in a file the runtime itself reads.
   *
   * A `#define` in the sketch is not enough. PulseHSM.cpp is its own
   * translation unit and never sees it, so it keeps the defaults: the sketch
   * allocates a table for N states while the runtime is compiled believing
   * there are 8. Small models get away with it; the ninth state is silently
   * refused and the machine is quietly wrong. PulseHSM.h includes this file,
   * so every translation unit agrees.
   *
   * Public because `--output` needs it too: a single-file sketch still links
   * against a separately compiled PulseHSM.cpp. Call it after generate().
   */
  generateConfigHeader(): string {
    const { maxStates, maxEvents, levels } = this.sizing();

    return `/**
 * PulseHSM sizing for ${this.project.name} - GENERATED, DO NOT EDIT.
 *
 * PulseHSM.h includes this file, so the runtime and the sketch are compiled
 * against the same table sizes. Keep it next to PulseHSM.h; deleting it drops
 * the runtime back to its defaults, which are smaller than this model needs.
 */
#ifndef PULSEHSM_CONFIG_H
#define PULSEHSM_CONFIG_H

#define PULSEHSM_MAX_STATES  ${maxStates}   // ${this.states.length} states + headroom
#define PULSEHSM_MAX_EVENTS  ${maxEvents}   // ring buffer, must be a power of two
#define PULSEHSM_MAX_DEPTH   ${levels}   // deepest nesting, including the leaf

#endif  // PULSEHSM_CONFIG_H
`;
  }

  private generateHeader(): string {
    const { name, version, author } = this.project;
    const date = new Date().toISOString().split('T')[0];
    const authorLine = author ? ` * Author:    ${author}\n` : '';

    const preamble = `/**
 * PulseIR Generated Code
 *
 * Project: ${name}
 * Version: ${version}
${authorLine} * Generated: ${date}
 *
 * This file was auto-generated from a PulseIR model.
 * DO NOT EDIT MANUALLY - regenerate from source instead.
 *
 * Runtime: none. This model declares no state machine, so the sketch below is
 * plain Arduino and needs no library beyond the core.
 *
 * Action signatures follow FUNCTION_CONTRACT.md:
 *   void action_<name>(SystemContext* ctx)
 */`;

    // No state machine, so no runtime: this is a plain Arduino sketch.
    if (!this.hasMachine) {
      return `${preamble}\n\n#include <Arduino.h>`;
    }

    const { maxStates, maxEvents, levels } = this.sizing();

    return `/**
 * PulseIR Generated Code
 *
 * Project: ${name}
 * Version: ${version}
${authorLine} * Generated: ${date}
 *
 * This file was auto-generated from a PulseIR model.
 * DO NOT EDIT MANUALLY - regenerate from source instead.
 *
 * Runtime: PulseHSM (this model declares a state machine).
 *
 * Guard/action signatures follow FUNCTION_CONTRACT.md:
 *   bool guard_<name>(const SystemContext* ctx)
 *   void action_<name>(SystemContext* ctx)
 */

// Sized from the model, and repeated in PulseHSM_config.h so that PulseHSM.cpp
// - a separate translation unit that never sees this file - is compiled
// against the same table sizes. Defining them only here would leave the
// runtime on its defaults, and states past the eighth would be silently
// dropped. Generate with --outdir to get that file written for you.
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
    return `${this.declInterfaces()}
${this.defInterfaces()}`;
  }

  /** Pin and setting macros. Drivers reference these, so they go in the header. */
  /** Buses first, then self-initialising devices - the order they set up in. */
  private initialisedResources(): { name: string; interface: string; description?: string }[] {
    const buses = (this.project.system.resources || []).map(r => ({
      name: r.name,
      interface: String(r.interface),
      description: r.description,
    }));
    const devices = (this.project.system.components || [])
      .filter(d => DEVICE_INTERFACE[d.type || ''])
      .map(d => ({
        name: d.name,
        interface: DEVICE_INTERFACE[d.type!].interface,
        description: d.description,
      }));
    return [...buses, ...devices];
  }

  private declInterfaces(): string {
    const resources = this.initialisedResources();
    if (resources.length === 0) {
      return `// ============================================================================
// INTERFACES
// ============================================================================

// No resources declared.`;
    }

    const blocks: string[] = [];
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
${blocks.join('\n\n')}`;
  }

  /** Client objects and the init sequence: definitions the sketch owns. */
  private defInterfaces(): string {
    const resources = this.initialisedResources();
    if (resources.length === 0) return '\nvoid setupInterfaces() {}';

    const globals: string[] = [];
    const body: string[] = [];

    for (const resource of resources) {
      const emission = this.emissions.get(resource.name);
      if (!emission) continue;

      globals.push(...emission.globals);

      if (emission.init.length > 0) {
        body.push(`  // ${resource.name}`);
        // Preprocessor directives must start at column zero.
        body.push(...emission.init.map(line => (line.startsWith('#') ? line : `  ${line}`)));
        body.push('');
      }
    }

    return `${globals.length > 0 ? `\n${globals.join('\n')}\n` : ''}
void setupInterfaces() {
${body.length > 0 ? body.join('\n').replace(/\n+$/, '') : '  // Nothing to initialise'}
}`;
  }

  /**
   * `extern` forms of the interface objects, so a driver in src/ can reach the
   * OneWire bus or MQTT client that the sketch defines.
   */
  private declInterfaceGlobals(): string {
    const externs: string[] = [];

    for (const emission of this.emissions.values()) {
      for (const line of emission.globals) {
        if (line.trimStart().startsWith('//')) continue;
        // `PubSubClient broker(transport);` -> `extern PubSubClient broker;`
        const match = /^([A-Za-z_][\w:<>]*)\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?;$/.exec(line.trim());
        if (match) externs.push(`extern ${match[1]} ${match[2]};`);
      }
    }

    if (externs.length === 0) return '';
    return `\n// Objects the sketch defines, available to your drivers.\n${externs.join('\n')}`;
  }

  // =========================================================================
  // EVENT ENUM
  // =========================================================================

  private generateEventEnum(): string {
    const events = this.project.system.events;
    if (events.length === 0) {
      if (this.hasMachine) {
        throw new CodegenError('System defines no events; nothing to dispatch');
      }
      // A machine-less project has nothing to dispatch, so there is no enum.
      return '';
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

  /** The enum alone, plus an extern for the names array the sketch defines. */
  private declEventEnum(): string {
    const [enumPart] = this.generateEventEnum().split('\nconst char* eventNames');
    return `${enumPart}\nextern const char* eventNames[];`;
  }

  private defEventNames(): string {
    const names = this.project.system.events.map(e => this.sanitizeUpper(e.name));
    return `const char* eventNames[] = {\n${names.map(n => `  "${n}"`).join(',\n')}\n};`;
  }

  // =========================================================================
  // SYSTEM PARAMETERS (from YAML)
  // =========================================================================

  private generateParameterStruct(): string {
    return `${this.declParameterStruct()}

${this.defParameterInstance()}`;
  }

  private declParameterStruct(): string {
    const parameters = this.project.system.parameters || [];

    if (parameters.length === 0) {
      return `// ============================================================================
// SYSTEM PARAMETERS
// ============================================================================

// No parameters defined in the model.
struct SystemParameters {};`;
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
};`;
  }

  /** The instance, with defaults from the model. Belongs to one translation unit. */
  private defParameterInstance(): string {
    const parameters = this.project.system.parameters || [];
    if (parameters.length === 0) return 'SystemParameters systemParameters = {};';

    const inits = parameters
      .map((p, idx) => {
        const comma = idx < parameters.length - 1 ? ',' : '';
        return `  ${this.cLiteral(p)}${comma}   // ${this.sanitize(p.name)}`;
      })
      .join('\n');

    return `// Initialized with the defaults declared in the model.
SystemParameters systemParameters = {
${inits}
};`;
  }

  // =========================================================================
  // SYSTEM SENSORS (user fills in)
  // =========================================================================

  private generateSensorStruct(): string {
    return `${this.declSensorStruct()}

SystemSensors systemSensors = {};`;
  }

  private declSensorStruct(): string {
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
};`;
  }

  // =========================================================================
  // SYSTEM CONTEXT
  // =========================================================================

  private generateContextStruct(): string {
    return `${this.declContextStruct()}

SystemContext systemContext;`;
  }

  private declContextStruct(): string {
    return `// ============================================================================
// SYSTEM CONTEXT (see FUNCTION_CONTRACT.md)
// ============================================================================

struct SystemContext {
  int currentState;                    // Current state index (compare with S_*)
  int previousState;                   // Previous state index (-1 before first transition)
  int32_t eventData;                   // Payload of the event being dispatched
  const SystemParameters* parameters;  // Read-only system parameters
  const SystemSensors* sensors;        // Current sensor readings
};`;
  }

  // =========================================================================
  // MACHINE + STATE INDEX GLOBALS
  // =========================================================================

  private generateMachineDeclarations(): string {
    return this.hasMachine ? this.machineGlobals(false) : '';
  }

  /**
   * `extern` when the header declares them for user code to reference;
   * definitions when the sketch owns them.
   */
  private machineGlobals(asExtern: boolean): string {
    // PulseHSM hands back an index from addState(); it must live in a global,
    // because handlers reference it long after setup() returns.
    const indices = this.states
      .map(s => {
        const note = s.path === ROOT_PATH
          ? '  // synthetic root for wildcard transitions'
          : `  // ${s.path}`;
        return asExtern ? `extern int ${s.symbol};${note}` : `int ${s.symbol} = -1;${note}`;
      })
      .join('\n');

    return `// ============================================================================
// STATE MACHINE
// ============================================================================

${asExtern ? 'extern PulseHSM fsm;' : 'PulseHSM fsm;'}

// State indices returned by addState(). Globals, per the PulseHSM contract.
${indices}`;
  }

  // =========================================================================
  // GUARD / ACTION DECLARATIONS
  // =========================================================================

  private generateGuardDeclarations(): string {
    if (!this.hasMachine) return '';

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

    // Without a machine there is no runtime to ask where we are, so the state
    // fields stay at their "no state" values and only the data is refreshed.
    const sync = this.hasMachine
      ? `// Refresh the context handed to every guard and action.
// Called at the top of each handler so guards see the live machine state.
static void syncContext() {
  systemContext.currentState = fsm.getCurrentState();
  systemContext.previousState = fsm.getPreviousState();
  systemContext.eventData = fsm.getEventData();
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
}`
      : `// Refresh the context handed to every action. This project has no state
// machine, so the state fields stay at -1 and only the data is refreshed.
static void syncContext() {
  systemContext.currentState = -1;
  systemContext.previousState = -1;
  systemContext.eventData = 0;
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
}`;

    if (handlers.length === 0) {
      // A machine-less project still needs syncContext, but not the heading.
      if (!this.hasMachine) return sync;

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
      const event = transitions[idx].event!;
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
          .map(a => `        action_${this.sanitize(a.name)}(&systemContext);`)
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

        const timed = this.timedBySource.get(flat.index)?.length
          ? this.timerNames(flat)
          : null;

        return `  ${flat.symbol} = fsm.addState(
      "${flat.path}",
      ${timed ? `${timed.tick},   // update - checks the "after" timers` : 'nullptr,   // update'}
      ${timed ? `${timed.mark},  // entry - starts the "after" clock` : 'nullptr,   // entry'}
      nullptr,   // exit
      0,         // timeoutMs - unused; see generateTimeouts()
      -1,        // timeoutNext
      ${handler},  // onEvent
      ${parent});`;
      })
      .join('\n\n');

    // begin() requires a leaf, so descend the initial chain from the first
    // top-level state in the model. Only meaningful when there is a machine.
    const firstTopLevel = this.states.findIndex(s => s.parent === -1 && s.path !== ROOT_PATH);
    const rootRelative = this.rootIndex !== -1
      ? this.states.findIndex(s => s.parent === this.rootIndex)
      : firstTopLevel;
    const startIndex = this.hasMachine
      ? this.resolveEntry(rootRelative === -1 ? 0 : rootRelative)
      : -1;

    const machineSetup = !this.hasMachine ? '' : `
  // Register states. Parents are registered before their children.
${registrations}

${this.registrationCheck()}
  // begin() must be given a leaf state.
  fsm.begin(${this.states[startIndex].symbol});
${this.hasConsole && this.isVerbose ? `
  ${this.consoleStream()}.print("Initial state: ");
  ${this.consoleStream()}.println(fsm.getCurrentName());
` : ''}`;

    return `// ============================================================================
// SETUP
// ============================================================================

${componentComments}

void setup() {
  // Buses and peripherals declared as resources. Nothing else is opened: a
  // peripheral the model did not declare has no business appearing here.
  setupInterfaces();

  // Wire up the context handed to every action
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
${machineSetup}}`;
  }

  // =========================================================================
  // CONSOLE, TASKS AND COMMANDS
  //
  // None of this needs a state machine. A blink is scheduling and a command
  // table is a lookup, so both are configuration, and both belong to projects
  // that never declare a state at all.
  // =========================================================================

  /**
   * The declared UART that owns the console, or undefined.
   *
   * Never invents one. The generator must not open, configure or write to a
   * peripheral the model did not ask for - a model that says nothing about a
   * serial port should produce a sketch that says nothing about one either.
   */
  private declaredConsole(): Resource | undefined {
    const named = this.project.system.commands?.source;
    const buses = this.project.system.resources || [];

    if (named) {
      const found = buses.find(r => r.name === named);
      if (!found) {
        throw new CodegenError(
          `commands.source is "${named}", which is not a declared bus. ` +
          'Declare it under hardware.buses.'
        );
      }
      return found;
    }

    // Port 0 is the USB serial monitor on every board this targets.
    return buses.find(r => String(r.interface) === 'uart' && Number(r.binding?.port ?? 1) === 0);
  }

  /** True when the model declares somewhere for generated code to print. */
  private get hasConsole(): boolean {
    return this.declaredConsole() !== undefined;
  }

  /** True when action-trace println calls should be emitted. */
  private get isVerbose(): boolean {
    return this.project.target?.verbose ?? true;
  }

  /** The C expression naming the console stream, e.g. `Serial`. */
  private consoleStream(): string {
    const resource = this.declaredConsole();
    if (!resource) return 'Serial';

    const port = Number(resource.binding?.port ?? 1);
    return port === 0 ? 'Serial' : `Serial${port}`;
  }

  /** `enteredAt`-style globals and the loop body for `tasks:`. */
  private generateTasks(): string {
    const tasks = this.project.system.tasks || [];
    if (tasks.length === 0) return '';

    const blocks = tasks.map(task => {
      const base = this.sanitize(task.name);
      const interval = typeof task.every === 'string'
        ? `(unsigned long)systemParameters.${this.sanitize(task.every)}`
        : `${task.every}UL`;
      const source = typeof task.every === 'string' ? `${task.every} (parameter)` : `every ${task.every}ms`;
      const calls = [
        ...task.actions.map(a => `  action_${this.sanitize(a.name)}(&systemContext);`),
        // After the actions: a task that samples and then reports should print
        // the reading it just took, not the one before it.
        ...(task.log ? [this.logLines(task.log, '  ')] : []),
      ].join('\n');

      return `// Task "${task.name}" - ${source}.${task.description ? `\n// ${task.description}` : ''}
static unsigned long dueAt_${base} = 0;

static void runTask_${base}() {
  const unsigned long interval = ${interval};
  const unsigned long now = millis();
  if (now - dueAt_${base} < interval) return;

  // Advance the deadline by whole intervals rather than restarting from now.
  // Restarting adds however long the loop took to come round to every period,
  // and that error accumulates: a 100ms blink slowly becomes a 103ms blink.
  dueAt_${base} += interval;

  // Unless we are already a full interval behind - a long blocking call, or
  // the interval was just shortened - in which case give up on catching up
  // and resync, rather than firing repeatedly in a burst.
  if (now - dueAt_${base} >= interval) dueAt_${base} = now;

${calls}
}`;
    });

    return `// ============================================================================
// TASKS
// ============================================================================
//
// Each runs on its own interval, checked every pass of loop(). An interval
// naming a parameter is read every time, so retuning it takes effect at once.
// Subtraction on unsigned long is correct across the millis() rollover.

${blocks.join('\n\n')}`;
  }

  /** The line reader and dispatch table for `commands:`. */
  private generateCommands(): string {
    const set = this.project.system.commands;
    if (!set) return '';

    if (!this.hasConsole) {
      throw new CodegenError(
        'commands: needs a console to read from, and the model declares none. Add one:\n' +
        '  hardware:\n' +
        '    buses:\n' +
        '      console: { interface: uart, port: 0, baud: 115200 }\n' +
        'and name it with "source: console" if you have more than one UART.'
      );
    }

    const stream = this.consoleStream();

    const cases = set.commands.map(command => {
      const calls = (command.actions || [])
        .map(a => `    action_${this.sanitize(a.name)}(&systemContext);`)
        .join('\n');
      const raise = command.event
        ? `    fsm.sendEvent(EVENT_${this.sanitizeUpper(command.event)});`
        : '';
      const reply = command.log ? this.logLines(command.log, '    ') : '';

      return `  if (strcmp(line, ${JSON.stringify(command.match)}) == 0) {${
        command.description ? `\n    // ${command.description}` : ''
      }
${[calls, raise, reply].filter(Boolean).join('\n')}
    return;
  }`;
    });

    const unknown = set.reportUnknown === false ? '' : `
  ${stream}.print("Unknown command: ");
  ${stream}.println(line);`;

    return `// ============================================================================
// COMMANDS
// ============================================================================
//
// One line of text in, one named action out. Reading the line is generated;
// making sense of anything *inside* it is not - that belongs in your action,
// where a parser can be written and debugged like ordinary C.

// Most Arduino cores pull this in through Arduino.h, but not all of them, and
// the dispatch table below is nothing but strcmp.
#include <string.h>

/** Longest command line accepted. Anything longer is reported and discarded. */
#define COMMAND_BUFFER 64

static char commandLine[COMMAND_BUFFER];
static uint8_t commandLength = 0;
static bool commandOverflow = false;

static void dispatchCommand(const char* line) {
${cases.join('\n')}${unknown}
}

/**
 * Read whatever has arrived, a line at a time.
 *
 * Never blocks: it consumes only what is already buffered, so loop() keeps
 * running whether or not anyone is typing.
 */
static void pollCommands() {
  while (${stream}.available() > 0) {
    const int next = ${stream}.read();

    if (next == '\\n' || next == '\\r') {
      if (commandOverflow) {
        ${stream}.println("Command too long; ignored.");
several_reset
      } else if (commandLength > 0) {
        commandLine[commandLength] = '\\0';
        dispatchCommand(commandLine);
several_reset
      }
      continue;
    }

    if (commandLength >= COMMAND_BUFFER - 1) {
      // Truncating and dispatching would run the wrong command; refuse instead.
      commandOverflow = true;
      continue;
    }
    commandLine[commandLength++] = (char)next;
  }
}`.replace(/several_reset/g, '        commandLength = 0;\n        commandOverflow = false;');
  }

  /**
   * Where a declared param value can be found in C.
   *
   * `params:` is documentation - the generator never turns it into code - but
   * documentation that says `duty: "fan_duty"` leaves the reader to work out
   * that fan_duty is a parameter and what it is called in the generated
   * struct. Naming the C expression closes that gap without writing the body.
   */
  private resolveParamHint(value: unknown): string {
    if (typeof value !== 'string') return '';

    const parameter = (this.project.system.parameters || []).find(p => p.name === value);
    if (parameter) return `   -> ctx->parameters->${this.sanitize(value)}`;

    const device = (this.project.system.components || []).find(c => c.name === value);
    if (device) {
      const pin = device.config?.pin !== undefined ? `${this.sanitizeUpper(value)}_PIN` : null;
      return pin ? `   -> ${pin}` : `   -> device "${value}"`;
    }

    return '';
  }

  /**
   * Board-aware hint for the PWM write call, shown in action stubs when an
   * action references a pwm_output device.
   *
   * The function name differs by board and by ESP32 core version, so this
   * comment is the difference between a student calling the wrong API and
   * getting a compile error they cannot diagnose.
   */
  private pwmWriteHint(action: { name: string; driver?: string; params?: Record<string, unknown> }): string {
    if (action.driver !== 'pwm_control') return '';

    const deviceName = String(action.params?.device ?? '');
    const device = (this.project.system.components || []).find(c => c.name === deviceName);
    if (!device) return '';

    const pinMacro = `${this.sanitizeUpper(deviceName)}_PIN`;
    const channelMacro = `${this.sanitizeUpper(deviceName)}_CHANNEL`;

    // Resolve the duty argument to its C expression.
    const dutyRaw = action.params?.duty;
    const dutyParam = (this.project.system.parameters || []).find(p => p.name === String(dutyRaw));
    const dutyExpr = dutyParam
      ? `ctx->parameters->${this.sanitize(String(dutyRaw))}`
      : dutyRaw !== undefined ? String(dutyRaw) : '0';

    const board = (this.project.target?.board ?? '').toLowerCase();
    const isEsp32 = /esp32/.test(board);
    const isAvr   = /avr|uno|mega|nano|atmega|leonardo/.test(board);
    const isRp    = /rp2040|pico/.test(board);

    if (isEsp32) {
      return (
        '\n  // PWM write (target: ' + board + '):\n' +
        `  //   core 3.x: ledcWrite(${pinMacro}, ${dutyExpr});\n` +
        `  //   core 2.x: ledcWrite(${channelMacro}, ${dutyExpr});`
      );
    }

    if (isAvr || isRp) {
      return (
        '\n  // PWM write (target: ' + board + '):\n' +
        `  //   analogWrite(${pinMacro}, ${dutyExpr});`
      );
    }

    // No target declared, or an unrecognised board — show all options.
    return (
      '\n  // PWM write:\n' +
      `  //   ESP32 core 3.x: ledcWrite(${pinMacro}, ${dutyExpr});\n` +
      `  //   ESP32 core 2.x: ledcWrite(${channelMacro}, ${dutyExpr});\n` +
      `  //   AVR / RP2040:   analogWrite(${pinMacro}, ${dutyExpr});`
    );
  }

  /**
   * A `log:` template as print calls.
   *
   * Emitted verbatim in order - one print per literal, one per value - because
   * printf on an embedded core drags in float formatting and costs several
   * kilobytes of flash for what is a handful of prints.
   */
  private logLines(template: string, indent: string): string {
    const stream = this.consoleStream();
    const segments = parseTemplate(template);
    const out: string[] = [];

    for (const segment of segments) {
      if (segment.kind === 'text') {
        out.push(`${indent}${stream}.print(${JSON.stringify(segment.value)});`);
        continue;
      }
      out.push(`${indent}${stream}.print(${this.logValue(segment.name)});`);
    }

    out.push(`${indent}${stream}.println();`);
    return out.join('\n');
  }

  /** Where a logged name lives in C. Validated by the parser, so it resolves. */
  private logValue(name: string): string {
    const parameter = (this.project.system.parameters || []).find(p => p.name === name);
    if (parameter) return `systemParameters.${this.sanitize(name)}`;
    return `systemSensors.${this.sanitize(name)}`;
  }

  /** Anything in the model that wants to print needs somewhere to print to. */
  private assertConsoleForLogs(): void {
    if (this.hasConsole) return;

    const wants = [
      ...(this.project.system.tasks || []).filter(t => t.log).map(t => `task "${t.name}"`),
      ...(this.project.system.commands?.commands || [])
        .filter(c => c.log)
        .map(c => `command "${c.match}"`),
    ];
    if (wants.length === 0) return;

    throw new CodegenError(
      `${wants.join(', ')} declares "log:", but the model declares no console. Add one:\n` +
      '  hardware:\n' +
      '    buses:\n' +
      '      console: { interface: uart, port: 0, baud: 115200 }'
    );
  }

  /** Every action the model actually uses, wherever it was used. */
  private everyUsedAction(): { name: string; params?: Record<string, unknown> }[] {
    return [
      ...this.project.system.transitions.flatMap(t => t.actions || []),
      ...(this.project.system.tasks || []).flatMap(t => t.actions),
      ...(this.project.system.commands?.commands || []).flatMap(c => c.actions || []),
    ];
  }

  /**
   * What a guard or action can read, listed by name in the stub.
   *
   * This is the answer to "my action needs a sensor reading - where does it
   * come from". Everything the model declares is already on the context; the
   * stub says so rather than leaving it to be discovered in a header.
   */
  private contextDoc(): string {
    const lines: string[] = [];

    for (const parameter of this.project.system.parameters || []) {
      const unit = parameter.unit ? `, ${parameter.unit}` : '';
      lines.push(`  //   ctx->parameters->${this.sanitize(parameter.name)}   (${parameter.type}${unit})`);
    }

    const sensors = (this.project.system.components || []).filter(c => c.class === 'sensor');
    for (const sensor of sensors) {
      const unit = sensor.config?.unit ? `, ${sensor.config.unit}` : '';
      lines.push(`  //   ctx->sensors->${this.sanitize(sensor.name)}   (float${unit}) - you fill this in`);
    }

    if (this.hasMachine) {
      lines.push('  //   ctx->currentState, ctx->previousState   (compare with S_*)');
      lines.push('  //   ctx->eventData   (payload of the event being dispatched)');
    }

    if (lines.length === 0) return '';

    return `  //\n  // Available on ctx:\n${lines.join('\n')}\n`;
  }

  /** The two C names a state with timed transitions needs. */
  private timerNames(flat: FlatState): { since: string; mark: string; tick: string } {
    const base = this.sanitize(flat.path);
    return { since: `enteredAt_${base}`, mark: `enter_${base}`, tick: `tick_${base}` };
  }

  /**
   * `after:` on a transition - it fires when a duration elapses instead of when
   * an event arrives. Everything else about it is a normal transition: guards,
   * `do:`, ordering and fall-through all behave identically.
   *
   * PulseHSM has timeoutMs/timeoutNext on addState(), and this deliberately
   * does not use them, for four reasons:
   *
   *  1. timeoutNext is a state index needed *at registration time*, and states
   *     register parents-first in declaration order. Any cycle - go leads to
   *     prepare_stop leads to stop leads back to go - refers forward to a state
   *     whose index is still -1.
   *  2. The runtime only checks the timeout of `currentState`, which is always
   *     a leaf, so a timeout on a composite would never fire. "Filling must not
   *     run past max_fill_ms, whichever phase it is in" needs the composite.
   *  3. One timeout per state cannot carry a guard, actions, or a second
   *     candidate - and the traffic light needs all three on `stop`.
   *  4. timeoutMs is captured once. Reading the parameter every tick means
   *     retuning green_ms at runtime takes effect immediately, instead of
   *     silently keeping whatever the value was at boot.
   *
   * The entry callback stamps the clock and the update callback checks it -
   * both slots the generator owns. Entry only fires when the state is really
   * entered, so moving between two children does not restart their parent's
   * clock, which is exactly the semantics a composite timeout needs.
   */
  private generateTimeouts(): string {
    if (this.timedBySource.size === 0) return '';

    const transitions = this.project.system.transitions;
    const blocks: string[] = [];

    for (const flat of this.states) {
      const owned = this.timedBySource.get(flat.index);
      if (!owned || owned.length === 0) continue;

      const { since, mark, tick } = this.timerNames(flat);
      const body: string[] = [];

      // Unlike an event handler, an earlier unguarded candidate does NOT
      // shadow the ones after it: they are reached at different elapsed times.
      // "after 8s, trip" listed before "after 2s, proceed" still lets the
      // shorter one fire, because at 2s the longer test is simply false.
      for (const idx of owned) {
        const t = transitions[idx];
        const guard = this.guards.get(idx);
        const target = this.states[this.resolveEntry(this.resolveRef(t.target, 'target'))];
        const duration = typeof t.after === 'string'
          ? `(unsigned long)systemParameters.${this.sanitize(t.after)}`
          : `${t.after}UL`;
        const source = typeof t.after === 'string' ? `${t.after} (parameter)` : `${t.after} ms`;

        const calls = (t.actions || [])
          .map(a => `    action_${this.sanitize(a.name)}(&systemContext);`)
          .join('\n');

        const fire = [
          calls,
          `    fsm.transitionTo(${target.symbol});`,
          '    return;',
        ].filter(Boolean).join('\n');

        // Guards see the live machine, same as in an event handler.
        const condition = guard
          ? `elapsed >= ${duration} && ${guard.fnName}(&systemContext)`
          : `elapsed >= ${duration}`;

        body.push(`  // after ${source} -> ${t.target}${guard ? ', if the guard allows' : ''}
  if (${condition}) {
${fire}
  }`);
      }

      blocks.push(`// Timers for "${flat.path}".
static unsigned long ${since} = 0;

static void ${mark}() {
  ${since} = millis();
}

static void ${tick}() {
  syncContext();
  const unsigned long elapsed = millis() - ${since};

${body.join('\n\n')}
}`);
    }

    return `// ============================================================================
// TIMED TRANSITIONS
// ============================================================================
//
// Generated from "after:" in the model. Ancestors tick before their active
// child, so when both a state and its parent time out on the same pass the
// inner one wins - the same precedence event handling already has.
//
// Subtraction on unsigned long is correct across the millis() rollover.

${blocks.join('\n\n')}`;
  }

  /**
   * Catch a runtime compiled against a smaller state table than this model
   * needs.
   *
   * addState() returns -1 when the table is full, and a transition to -1 does
   * nothing at all - the machine ignores states it appears to have. That is
   * exactly what happens when PulseHSM.cpp cannot see PulseHSM_config.h, and
   * it is silent, so the sketch says so itself.
   */
  private registrationCheck(): string {
    // Reporting it needs somewhere to report to, and writing to a port the
    // model never declared is not an option: on an AVR, printing to a Serial
    // that was never begun fills the TX buffer and blocks forever. Declaring a
    // console is what turns this check on.
    if (!this.hasConsole) {
      return `  // No console is declared, so this cannot be reported at runtime. If states
  // seem to be missing - a transition that does nothing - check that
  // PulseHSM_config.h sits beside PulseHSM.h, and declare a console to have
  // the sketch say so itself.
`;
    }

    const test = this.states.map(s => `${s.symbol} < 0`).join(' ||\n      ');
    const stream = this.consoleStream();

    return `  // A negative index means the runtime ran out of state slots, which happens
  // when PulseHSM.cpp was compiled without seeing PulseHSM_config.h. Silent
  // otherwise: transitions to a dropped state simply do nothing.
  if (${test}) {
    ${stream}.println("FATAL: PulseHSM refused a state - its table is too small.");
    ${stream}.println("       Keep PulseHSM_config.h beside PulseHSM.h and rebuild.");
  }
`;
  }

  // =========================================================================
  // LOOP
  // =========================================================================

  private generateLoopFunction(): string {
    const body: string[] = [];

    if (this.project.system.commands) body.push('  pollCommands();');

    for (const task of this.project.system.tasks || []) {
      body.push(`  runTask_${this.sanitize(task.name)}();`);
    }

    if (this.hasMachine) {
      const example = this.project.system.events[0];
      const exampleName = example ? `EVENT_${this.sanitizeUpper(example.name)}` : 'EVENT_NONE';

      body.push(`  // TODO: Read sensors into systemSensors, then raise events.
  // Example:
  //   systemSensors.temperature = readTemperature();
  //   if (systemSensors.temperature >= systemParameters.setpoint) {
  //     fsm.sendEvent(${exampleName});
  //   }
  //
  // sendEvent() is ISR-safe, so interrupts may call it directly.

  fsm.update();`);
    } else if (body.length === 0) {
      body.push('  // Nothing declared to run. Add tasks: or commands: to the model.');
    }

    // Tasks and commands call actions from loop(), not from an event handler,
    // so nothing else has refreshed the context they are handed. With a machine
    // this used to be skipped, and those actions saw whatever the last event
    // dispatch left behind - a stale currentState and a stale eventData.
    const sync = this.project.system.commands || (this.project.system.tasks || []).length
      ? '  syncContext();\n'
      : '';

    return `// ============================================================================
// MAIN LOOP
// ============================================================================
//
// Never call delay() here: it stops everything below it from running.

void loop() {
${sync}${body.join('\n')}
}`;
  }

  // =========================================================================
  // GUARD IMPLEMENTATIONS
  // =========================================================================

  private generateGuardImplementations(): string {
    if (!this.hasMachine) return '';

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
      // An action may be used by a transition, a task or a command, and its
      // declared params have to be found wherever it was used.
      const action = this.everyUsedAction().find(a => a.name === name);

      const paramDoc = action?.params
        ? Object.entries(action.params)
            .map(([k, v]) => `  //   ${k}: ${JSON.stringify(v)}${this.resolveParamHint(v)}`)
            .join('\n')
        : '  //   (none)';

      // Printing to a port the model never declared would be the generator
      // reaching for a peripheral nobody asked for. Also suppressed when
      // target.debug is false (production builds).
      const trace = this.hasConsole && this.isVerbose
        ? `  ${this.consoleStream()}.println("  -> Action: ${name}");\n`
        : '';

      const pwmHint = action ? this.pwmWriteHint(action) : '';

      return `void action_${this.sanitize(name)}(SystemContext* ctx) {
${trace}  // Declared params for this action (documentation only):
${paramDoc}
${this.contextDoc()}  //
  // TODO: Implement the hardware calls for this action.${pwmHint}
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
    const collect = (actions: { name: string }[] | undefined, where: string) => {
      for (const action of actions || []) {
        if (!action.name) throw new CodegenError(`${where} has an action without a name`);
        this.actionNames.add(action.name);
      }
    };

    this.project.system.transitions.forEach((t, idx) => collect(t.actions, `Transition ${idx}`));

    // Tasks and commands call actions too, and a machine-less project has
    // nothing but those - miss them and it generates no stubs at all.
    for (const task of this.project.system.tasks || []) {
      collect(task.actions, `Task "${task.name}"`);
    }
    for (const command of this.project.system.commands?.commands || []) {
      collect(command.actions, `Command "${command.match}"`);
    }
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

      // Timed transitions never reach an onEvent handler - no event arrives -
      // so they are collected separately and become the state's update tick.
      const bucket = t.after !== undefined ? this.timedBySource : this.transitionsBySource;
      const list = bucket.get(sourceIdx) || [];
      list.push(idx);
      bucket.set(sourceIdx, list);
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
