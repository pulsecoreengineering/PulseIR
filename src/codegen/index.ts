/**
 * Codegen — IR traversal and structure; platform-agnostic.
 *
 * This class owns *what* to emit: it walks the PulseModel, resolves state
 * hierarchies, manages guard/action/transition indexing, and decides the
 * overall shape of the generated output. Everything that is
 * platform-specific — function names, include directives, UART API spellings,
 * GPIO call signatures — is delegated to the injected PlatformBackend.
 *
 * The default backend (ArduinoBackend) is backward-compatible: callers that
 * do `new Codegen()` get the same Arduino output as before.
 *
 * The model maps onto the PulseHSM runtime like this:
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
  Event,
  Resource,
  StateRef,
  Action,
} from '../model/index.js';
import { parseTemplate } from '../analysis/template.js';
import type { ImpliedLibrary, InterfaceEmission } from './interfaces.js';
import type { PlatformBackend, Sizing } from './backend.js';
import { ArduinoBackend } from './arduino.js';

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
 * and the bus owns the initialisation. Their library objects and begin() calls
 * are handled by BUS_SENSOR_DEFS below.
 */
const DEVICE_INTERFACE: Record<string, { interface: string; mode?: string }> = {
  digital_output: { interface: 'gpio', mode: 'OUTPUT' },
  digital_input:  { interface: 'gpio', mode: 'INPUT' },
  pwm_output:     { interface: 'pwm' },
  analog_input:   { interface: 'adc' },
};

/**
 * Bus-attached or library-backed sensor/actuator types.
 *
 * PulseIR generates the glue: the #include, the object declaration, and the
 * begin() call. The user installs the named library from the Arduino Library
 * Manager. The wire protocol stays entirely inside the library.
 */
interface BusSensorDef {
  library: string;      // Library Manager display name
  include: string;      // Header to include
  objectClass: string;  // C++ class name
  reason: string;       // Comment shown in the install list
  /** How the sensor connects. Controls constructor and init emission. */
  mountedOn: 'onewire_ref' | 'pin' | 'i2c';
  /** Constructor type argument, e.g. 'DHT22' for DHT sensors. */
  typeArg?: string;
  // i2c-mount customization (all optional; defaults match BME280 behavior)
  /** Config keys whose values are passed as ctor args in this order. */
  ctorConfigKeys?: string[];
  /** Literal strings appended after config ctor args (e.g. '&Wire', '-1'). */
  ctorLiterals?: string[];
  /** Initialization method name (default: 'begin'). */
  beginMethod?: string;
  /** Constant prepended before address in the begin() call (OLED). */
  beginPrefix?: string;
  /** True: no address argument anywhere — begin() called with no args. */
  noAddress?: boolean;
  /** Extra method calls emitted after the main init call (e.g. 'backlight()'). */
  postInit?: string[];
  /** Hint address shown in TODO when user omits address (e.g. '0x3C' for OLED). */
  hintAddress?: string;
}

const BUS_SENSOR_DEFS: Record<string, BusSensorDef> = {
  ds18b20: {
    library:     'DallasTemperature',
    include:     'DallasTemperature.h',
    objectClass: 'DallasTemperature',
    reason:      'DS18B20 1-Wire temperature sensor',
    mountedOn:   'onewire_ref',
  },
  dht22: {
    library:     'DHT sensor library',
    include:     'DHT.h',
    objectClass: 'DHT',
    reason:      'DHT11/DHT22 temperature + humidity',
    mountedOn:   'pin',
    typeArg:     'DHT22',
  },
  dht11: {
    library:     'DHT sensor library',
    include:     'DHT.h',
    objectClass: 'DHT',
    reason:      'DHT11/DHT22 temperature + humidity',
    mountedOn:   'pin',
    typeArg:     'DHT11',
  },
  bme280: {
    library:     'Adafruit BME280 Library',
    include:     'Adafruit_BME280.h',
    objectClass: 'Adafruit_BME280',
    reason:      'BME280 temperature / humidity / pressure',
    mountedOn:   'i2c',
  },
  lcd_i2c: {
    library:        'LiquidCrystal_I2C',
    include:        'LiquidCrystal_I2C.h',
    objectClass:    'LiquidCrystal_I2C',
    reason:         'I2C character LCD display',
    mountedOn:      'i2c',
    ctorConfigKeys: ['address', 'cols', 'rows'],
    beginMethod:    'init',
    postInit:       ['backlight()'],
    hintAddress:    '0x27',
  },
  oled_i2c: {
    library:        'Adafruit SSD1306',
    include:        'Adafruit_SSD1306.h',
    objectClass:    'Adafruit_SSD1306',
    reason:         'I2C OLED display (SSD1306)',
    mountedOn:      'i2c',
    ctorConfigKeys: ['width', 'height'],
    ctorLiterals:   ['&Wire', '-1'],
    beginPrefix:    'SSD1306_SWITCHCAPVCC',
    hintAddress:    '0x3C',
  },
  ds3231: {
    library:     'RTClib',
    include:     'RTClib.h',
    objectClass: 'RTC_DS3231',
    reason:      'DS3231 real-time clock',
    mountedOn:   'i2c',
    noAddress:   true,
  },
  ds1307: {
    library:     'RTClib',
    include:     'RTClib.h',
    objectClass: 'RTC_DS1307',
    reason:      'DS1307 real-time clock',
    mountedOn:   'i2c',
    noAddress:   true,
  },
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
  /** state index → periodic ("every") transitions, in model order */
  private periodicBySource: Map<number, number[]> = new Map();

  private readonly backend: PlatformBackend;
  /** resource name → what its interface contributes to the sketch */
  private emissions: Map<string, InterfaceEmission> = new Map();
  /** Every library needed, deduplicated by name. */
  private libraries: Map<string, ImpliedLibrary> = new Map();

  /**
   * Task bases that use a native timer (e.g. k_timer on Zephyr) instead of
   * the polling runTask_BASE() pattern.  Populated during generateTasks() and
   * consumed by generateLoopFunction() and generateSetupFunction().
   */
  private nativeTimerBases = new Set<string>();
  /** Setup lines (one per native-timer task) injected into _setup(). */
  private nativeTimerSetupLines: string[] = [];

  constructor(backend: PlatformBackend = new ArduinoBackend()) {
    this.backend = backend;
  }

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
      this.generateEntryExitCallbacks(),
      this.generateTasks(),
      this.generateCommands(),
      this.generateMqttWiring(),
      this.generateTelemetry(),
      this.generateStorageWiring(),
      this.generateReadSensors(),
      this.generateSafetyChecks(),
      this.generateDiagnostics(),
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
        { path: `${base}${this.backend.fileExtension}`, contents: this.composeSketch(headerName) },
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
      this.generateDocComment(),
      `#ifndef ${guard}\n#define ${guard}`,
      this.backend.platformIncludes(this.hasMachine, this.sizing()),
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

${this.backend.entryPointDeclarations()}${this.declInterfaceGlobals()}`,
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
      this.generateEntryExitCallbacks(),
      this.generateTasks(),
      this.generateCommands(),
      this.generateMqttWiring(),
      this.generateTelemetry(),
      this.generateStorageWiring(),
      this.generateReadSensors(),
      this.generateSafetyChecks(),
      this.generateDiagnostics(),
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
    this.periodicBySource = new Map();
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
      this.addEmission(resource.name, this.backend.emitInterface(resource, this.sanitizeUpper(resource.name)));
    }

    // A device that owns its pin initialises itself, so `pump: {type:
    // digital_output, pin: GPIO25}` produces its pinMode with no bus declared.
    for (const device of this.project.system.components || []) {
      const mapping = DEVICE_INTERFACE[device.type || ''];
      if (!mapping) continue;

      const binding = { ...(device.config || {}) };
      if (mapping.mode && binding.mode === undefined) binding.mode = mapping.mode;

      this.addEmission(device.name, this.backend.emitInterface(
        {
          name: device.name,
          interface: mapping.interface as never,
          binding,
          description: device.description,
        },
        this.sanitizeUpper(device.name)
      ));
    }

    // Library-backed sensors (ds18b20, dht22, bme280 …) generate their own
    // object declarations and begin() calls via BUS_SENSOR_DEFS.
    this.indexBusSensors();

    // Interrupt wiring: ISR stubs + attachInterrupt() for digital_input devices
    // that declare an "interrupt:" field.
    this.indexInterrupts();

    // Action-implied libraries (e.g. HTTPClient when http_get/http_post is used).
    this.indexActionLibraries();

    // Declared libraries win, so a model can pin a version or override a header.
    for (const library of this.backend.declaredLibraries(this.project.system.libraries)) {
      this.libraries.set(library.name, library);
    }
  }

  /**
   * Generate library includes, object declarations, and begin() calls for
   * sensor device types defined in BUS_SENSOR_DEFS.
   *
   * PulseIR's contract: emit the glue (include + object + init); leave the
   * wire-protocol implementation to the user's installed library. A
   * "// Requires:" comment tells the user which package to install.
   */
  private indexBusSensors(): void {
    for (const device of this.project.system.components || []) {
      const def = BUS_SENSOR_DEFS[device.type || ''];
      if (!def) continue;

      const config  = device.config || {};
      const sym     = this.sanitizeUpper(device.name);
      const objVar  = this.sanitize(device.name);

      const emission: InterfaceEmission = {
        defines:   [],
        globals:   [],
        init:      [],
        libraries: [{ name: def.library, include: def.include, source: 'registry', reason: def.reason }],
        todos:     [],
      };

      if (def.mountedOn === 'onewire_ref') {
        // DS18B20 — sits on a declared OneWire bus.
        // The bus resource already generates the OneWire object; we just
        // construct a DallasTemperature on top of it.
        const busVar = device.bus ? this.busObjVar(device.bus) : 'oneWireBus';
        emission.globals.push(
          `// Requires: ${def.library} — install via Arduino Library Manager`,
          `${def.objectClass} ${objVar}(&${busVar});`
        );
        emission.init.push(`${objVar}.begin();`);

        if (!device.bus) {
          emission.todos.push(`${device.name}: declare a OneWire bus and reference it with "bus:"`);
        }

      } else if (def.mountedOn === 'pin') {
        // DHT22/DHT11 — has its own data pin.
        const pinRaw   = String(config.pin ?? '');
        const gpioMat  = /^(?:GPIO|IO)[_-]?(\d+)$/i.exec(pinRaw);
        const pinLit   = gpioMat ? `${gpioMat[1]}  // ${pinRaw}` : (pinRaw || '/* pin */');
        const pinMacro = `${sym}_PIN`;

        emission.defines.push(`#define ${pinMacro} ${pinLit}`);
        emission.globals.push(
          `// Requires: ${def.library} — install via Arduino Library Manager`,
          `${def.objectClass} ${objVar}(${pinMacro}${def.typeArg ? `, ${def.typeArg}` : ''});`
        );
        emission.init.push(`${objVar}.begin();`);

        if (!config.pin) {
          emission.todos.push(`${device.name}: add "pin: GPIO<N>" to specify the data pin`);
        }

      } else if (def.mountedOn === 'i2c') {
        // I2C-attached device. Behavior varies by def fields; defaults match BME280.
        const addrNum = config.address !== undefined ? Number(config.address) : undefined;
        const addrHex = addrNum !== undefined
          ? `0x${addrNum.toString(16).toUpperCase()}`
          : undefined;

        // Build constructor argument list from ctorConfigKeys, then ctorLiterals.
        const ctorParts: string[] = [];
        for (const key of (def.ctorConfigKeys ?? [])) {
          if (key === 'address') {
            ctorParts.push(addrHex ?? (def.hintAddress ?? '0x27') + '  /* TODO: verify address */');
          } else {
            const val = config[key];
            ctorParts.push(val !== undefined ? String(val) : `/* ${key} */`);
          }
        }
        for (const lit of (def.ctorLiterals ?? [])) {
          ctorParts.push(lit);
        }

        emission.globals.push(
          `// Requires: ${def.library} — install via Arduino Library Manager`,
          `${def.objectClass} ${objVar}${ctorParts.length ? `(${ctorParts.join(', ')})` : ''};`
        );

        // Build init call.
        const beginMethod  = def.beginMethod ?? 'begin';
        const addressInCtor = (def.ctorConfigKeys ?? []).includes('address');

        let initArgs: string;
        if (def.noAddress) {
          initArgs = '';  // DS3231/DS1307: begin() with no args
        } else if (addressInCtor) {
          initArgs = '';  // LCD: address already in ctor; init() takes no args
        } else {
          // BME280 / OLED: address goes into begin()
          const addr = addrHex ?? (def.hintAddress ?? '0x76');
          const parts = def.beginPrefix ? [def.beginPrefix, addr] : [addr];
          initArgs = parts.join(', ');
        }

        emission.init.push(`${objVar}.${beginMethod}(${initArgs});`);
        for (const call of (def.postInit ?? [])) {
          emission.init.push(`${objVar}.${call};`);
        }

        if (addrNum === undefined && !def.noAddress) {
          const hint = def.hintAddress ?? '0x76';
          const detail = (def.ctorConfigKeys ?? []).includes('address')
            ? `in the ctor — default is ${hint}`
            : `passed to ${beginMethod}() — default is ${hint}`;
          emission.todos.push(`${device.name}: verify the I2C address (${detail})`);
        }
      }

      this.addEmission(device.name, emission);
    }
  }

  /**
   * Append ISR stubs and attachInterrupt() calls to emissions for digital_input
   * devices that declare an "interrupt:" config field.
   *
   * PulseIR generates the glue — the ISR function and the attachInterrupt call —
   * and optionally dispatches to the state machine when "raises:" names an event.
   * The function is marked IRAM_ATTR so it runs from IRAM on ESP32; on other
   * platforms IRAM_ATTR is defined as an empty macro in the harness.
   */
  private indexInterrupts(): void {
    for (const device of this.project.system.components || []) {
      if (device.type !== 'digital_input') continue;
      const config = device.config || {};
      if (!config.interrupt) continue;

      const existing = this.emissions.get(device.name);
      if (!existing) continue;

      const mode    = String(config.interrupt).toUpperCase();
      const sym     = this.sanitizeUpper(device.name);
      const pin     = `${sym}_PIN`;
      const isrName = `isr_${this.sanitize(device.name)}`;

      let isrBody: string;
      const raises = config.raises as string | undefined;
      if (raises && this.hasMachine) {
        isrBody = `  fsm.sendEvent(EVENT_${this.sanitizeUpper(raises)});`;
      } else if (raises) {
        isrBody = `  // TODO: dispatch EVENT_${this.sanitizeUpper(raises)} when the machine is running`;
      } else {
        isrBody = `  // TODO: handle interrupt for ${device.name} (add "raises: EVENT_NAME" to wire it)`;
      }

      existing.globals.push(
        '',
        `// ISR for ${device.name} — fires on ${mode} edge`,
        `#ifndef IRAM_ATTR`,
        `#define IRAM_ATTR  // non-ESP32: no IRAM section needed`,
        `#endif`,
        `void IRAM_ATTR ${isrName}() {`,
        isrBody,
        `}`,
      );

      existing.init.push(
        `attachInterrupt(digitalPinToInterrupt(${pin}), ${isrName}, ${mode});`
      );
    }
  }

  /**
   * Add action-implied libraries to the library map.
   * Called after all emissions are indexed so action tables are complete.
   */
  private indexActionLibraries(): void {
    const allDrivers = new Set<string>();
    const collectFrom = (actions: { driver?: string }[] | undefined) => {
      for (const a of actions || []) {
        if (a.driver) allDrivers.add(a.driver);
      }
    };
    // Collect drivers from all possible action sites.
    const collectState = (state: State) => {
      collectFrom(state.entry);
      collectFrom(state.exit);
      const collectRegion = (states: State[]) => states.forEach(collectState);
      for (const region of state.regions || []) collectRegion(region.states);
    };
    for (const state of this.project.system.states || []) collectState(state);
    this.project.system.transitions.forEach(t => collectFrom(t.actions));
    for (const task of this.project.system.tasks || []) collectFrom(task.actions);
    for (const cmd of this.project.system.commands?.commands || []) collectFrom(cmd.actions);

    if (allDrivers.has('http_get') || allDrivers.has('http_post')) {
      if (!this.libraries.has('HTTPClient')) {
        this.libraries.set('HTTPClient', {
          name: 'HTTPClient',
          include: 'HTTPClient.h',
          source: 'builtin',
          reason: 'HTTP client actions (bundled with ESP32/ESP8266 Arduino core)',
        });
      }
    }
  }

  /** Convert a bus resource name to the camelCase variable the interface backend generates. */
  private busObjVar(busName: string): string {
    return this.sanitizeUpper(busName)
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
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
  private sizing(): Sizing {
    return {
      maxStates: this.states.length + 2,      // + headroom for growth
      maxEvents: this.nextPowerOfTwo(Math.max(8, this.project.system.events.length)),
      levels: Math.max(1, ...this.states.map(s => s.depth + 1)),
      stateCount: this.states.length,
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
    const { maxStates, maxEvents, levels, stateCount } = this.sizing();

    return `/**
 * PulseHSM sizing for ${this.project.name} - GENERATED, DO NOT EDIT.
 *
 * PulseHSM.h includes this file, so the runtime and the sketch are compiled
 * against the same table sizes. Keep it next to PulseHSM.h; deleting it drops
 * the runtime back to its defaults, which are smaller than this model needs.
 */
#ifndef PULSEHSM_CONFIG_H
#define PULSEHSM_CONFIG_H

#define PULSEHSM_MAX_STATES  ${maxStates}   // ${stateCount} states + headroom
#define PULSEHSM_MAX_EVENTS  ${maxEvents}   // ring buffer, must be a power of two
#define PULSEHSM_MAX_DEPTH   ${levels}   // deepest nesting, including the leaf

#endif  // PULSEHSM_CONFIG_H
`;
  }

  private generateDocComment(): string {
    const { name, version, author } = this.project;
    const date = new Date().toISOString().split('T')[0];
    const authorLine = author ? ` * Author:    ${author}\n` : '';
    const runtimeNote = this.hasMachine
      ? ' * Runtime: PulseHSM (this model declares a state machine).'
      : ' * Runtime: none. No state machine is declared; no runtime library is needed.';
    const sigNote = this.hasMachine
      ? ` * Guard/action signatures follow FUNCTION_CONTRACT.md:\n *   bool guard_<name>(const SystemContext* ctx)\n *   void action_<name>(SystemContext* ctx)`
      : ` * Action signatures follow FUNCTION_CONTRACT.md:\n *   void action_<name>(SystemContext* ctx)`;

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
${runtimeNote}
 *
${sigNote}
 */`;
  }

  private generateHeader(): string {
    return `${this.generateDocComment()}\n\n${this.backend.platformIncludes(this.hasMachine, this.sizing())}`;
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
    const busSensors = (this.project.system.components || [])
      .filter(d => BUS_SENSOR_DEFS[d.type || ''])
      .map(d => ({
        name: d.name,
        interface: d.type!,
        description: d.description,
      }));
    return [...buses, ...devices, ...busSensors];
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
${this.backend.interfacesNote()}
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

    const fieldLines: string[] = [];
    for (const c of sensors) {
      if (c.channels?.length) {
        // Multi-channel device: one field per channel, labeled with the device driver.
        for (const ch of c.channels) {
          fieldLines.push(`  float ${this.sanitize(ch.name)};  // ${c.driver}.${ch.measure ?? ch.name}`);
        }
      } else {
        const unitNote = c.config?.unit ? `, unit: ${c.config.unit}` : '';
        fieldLines.push(`  float ${this.sanitize(c.name)};  // driver: ${c.driver}${unitNote}`);
      }
    }

    const fields = fieldLines.length > 0
      ? fieldLines.join('\n')
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
    const hasCommands = !!this.project.system.commands;
    const cmdMacro = hasCommands
      ? '\n/** Maximum tokens in a command line (command + arguments). */\n#define PULSE_CMD_MAX_ARGS 8\n'
      : '';
    const cmdFields = hasCommands
      ? `\n  int    argc;                         // Token count (0 outside a command handler)\n  char*  argv[PULSE_CMD_MAX_ARGS];     // argv[0] = command name, argv[1..] = arguments`
      : '';

    return `// ============================================================================
// SYSTEM CONTEXT (see FUNCTION_CONTRACT.md)
// ============================================================================
${cmdMacro}
struct SystemContext {
  int currentState;                    // Current state index (compare with S_*)
  int previousState;                   // Previous state index (-1 before first transition)
  int32_t eventData;                   // Payload of the event being dispatched
  const SystemParameters* parameters;  // Read-only system parameters
  const SystemSensors* sensors;        // Current sensor readings${cmdFields}
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
        const target = this.states[this.resolveEntry(this.resolveRef(t.target!, 'target'))];
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
  // DIAGNOSTICS — watchdog, heartbeat LED, log level
  // =========================================================================

  /**
   * Generate the runSafetyChecks() function.
   *
   * Called at the very top of loop(), before the HSM tick, so a critical
   * fault preempts normal dispatch regardless of the current leaf state.
   * Latching rules trip once and stay active even when the guard goes false.
   * Actions receive nullptr because there is no active event context.
   */
  private generateSafetyChecks(): string {
    const safety = this.project.system.safety;
    if (!safety) return '';

    const blocks: string[] = [];

    for (const rule of safety.rules) {
      const lines: string[] = [];

      // Comment header for the rule.
      const parts = [rule.name];
      if (rule.severity) parts.push(rule.severity);
      if (rule.latching) parts.push('latching');
      lines.push(`  // ${parts.join(', ')}`);
      if (rule.description) lines.push(`  // ${rule.description}`);

      // Latch variable (static — survives across calls, resets only on power cycle).
      const latchVar = `_latch_${this.sanitize(rule.name)}`;
      if (rule.latching) {
        lines.push(`  static bool ${latchVar} = false;`);
      }

      // Auto-reset: checked before the trip guard so that if both fire
      // simultaneously the fault immediately re-trips after restoring.
      if (rule.latching && rule.reset_when) {
        lines.push(`  if (${latchVar} && ${rule.reset_when}()) {`);
        lines.push(`    ${latchVar} = false;`);
        for (const action of rule.restore || []) {
          lines.push(`    ${this.sanitize(action)}(nullptr);`);
        }
        lines.push('  }');
      }

      // Condition expression.
      const cond = rule.latching
        ? `${latchVar} || ${rule.check}()`
        : `${rule.check}()`;

      const body: string[] = [];
      if (rule.latching) body.push(`    ${latchVar} = true;`);

      // Response actions (nullptr context — no active event).
      for (const action of rule.response || []) {
        body.push(`    ${this.sanitize(action)}(nullptr);`);
      }

      // State transition.
      if (rule.to) {
        const idx = this.resolveEntry(this.resolveRef(rule.to, 'target'));
        const sym = this.states[idx].symbol;
        body.push(`    fsm.transitionTo(${sym});`);
      }

      body.push('    return;');

      lines.push(`  if (${cond}) {`);
      lines.push(...body);
      lines.push('  }');
      blocks.push(lines.join('\n'));
    }

    const body = blocks.join('\n\n');

    return `// ============================================================================
// SAFETY CHECKS
// ============================================================================
//
// runSafetyChecks() runs at the very top of loop(), before the HSM tick.
// Guards are C functions you implement — the condition logic stays in code,
// the response policy (severity, actions, target state, latching) lives here.
// Actions are called with a null context (no active event during safety checks).

static void runSafetyChecks() {
${body}
}`;
  }

  private generateDiagnostics(): string {
    const diag = this.project.system.diagnostics;
    if (!diag) return '';

    const setupLines: string[] = [];
    const loopLines: string[] = [];
    const includeLines: string[] = [];

    if (diag.watchdog) {
      const timeout = diag.watchdog.timeout_s ?? 5;
      includeLines.push(
        '#ifdef ARDUINO_ARCH_ESP32',
        '#include <esp_task_wdt.h>',
        '#endif',
      );
      setupLines.push(
        '  // Hardware watchdog — panics if the loop stalls.',
        '#ifdef ARDUINO_ARCH_ESP32',
        `  esp_task_wdt_init(${timeout}, true);`,
        '  esp_task_wdt_add(NULL);',
        '#endif',
      );
      loopLines.push(
        '  // Feed the hardware watchdog.',
        '#ifdef ARDUINO_ARCH_ESP32',
        '  esp_task_wdt_reset();',
        '#endif',
      );
    }

    if (diag.heartbeat) {
      const pin = diag.heartbeat.pin ?? 2;
      const pinExpr = typeof pin === 'number' ? String(pin) : `HEARTBEAT_PIN`;
      const ivRaw = diag.heartbeat.interval_ms ?? 1000;
      const ivExpr = typeof ivRaw === 'number'
        ? this.backend.durationLiteral(ivRaw)
        : `(${this.backend.timestampType()})systemParameters.${this.sanitize(String(ivRaw))}`;

      if (typeof pin !== 'number') {
        // Named pin — emit a #define so the user can override it.
        setupLines.unshift(`  // Heartbeat pin — override HEARTBEAT_PIN if needed.`);
        includeLines.push(`#ifndef HEARTBEAT_PIN\n#define HEARTBEAT_PIN ${pin}\n#endif`);
      }

      setupLines.push(
        `  // Heartbeat LED on pin ${pinExpr}.`,
        `  pinMode(${pinExpr}, OUTPUT);`,
      );
      loopLines.push(
        `  // Toggle heartbeat LED every ${typeof ivRaw === 'number' ? `${ivRaw}ms` : ivRaw + ' ms'}.`,
        '  {',
        '    static unsigned long _heartAt = 0;',
        `    const unsigned long _iv = ${ivExpr};`,
        `    if (${this.backend.nowExpr()} - _heartAt >= _iv) {`,
        '      _heartAt += _iv;',
        `      if (${this.backend.nowExpr()} - _heartAt >= _iv) _heartAt = ${this.backend.nowExpr()};`,
        `      digitalWrite(${pinExpr}, !digitalRead(${pinExpr}));`,
        '    }',
        '  }',
      );
    }

    if (setupLines.length === 0 && loopLines.length === 0) return '';

    const lines: string[] = [
      '// ============================================================================',
      '// DIAGNOSTICS',
      '// ============================================================================',
      ...(diag.log_level ? [`//\n// log_level: ${diag.log_level}`] : []),
    ];

    if (includeLines.length > 0) {
      lines.push('', ...includeLines);
    }

    if (setupLines.length > 0) {
      lines.push(
        '',
        `static void setupDiagnostics() {\n${setupLines.join('\n')}\n}`,
      );
    }

    if (loopLines.length > 0) {
      lines.push(
        '',
        `static void runDiagnostics() {\n${loopLines.join('\n')}\n}`,
      );
    }

    return lines.join('\n');
  }

  // =========================================================================
  // TELEMETRY — per-channel MQTT publishing with individual intervals
  // =========================================================================

  private generateTelemetry(): string {
    const tel = this.project.system.telemetry;
    if (!tel) return '';

    const mqtt = this.mqttResource();
    if (!mqtt) {
      // Parser should have caught this, but guard defensively.
      return '// telemetry: declared but no MQTT bus found';
    }

    const client = this.mqttClientVar(mqtt);

    const channelBlocks: string[] = [];
    for (const ch of tel.channels) {
      const ivRaw = ch.interval_ms ?? tel.interval_ms!;
      const ivExpr = typeof ivRaw === 'number'
        ? this.backend.durationLiteral(ivRaw)
        : `(${this.backend.timestampType()})systemParameters.${this.sanitize(String(ivRaw))}`;

      const field = `systemSensors.${this.sanitize(ch.sensor)}`;
      const topicPart = ch.topic
        ? `"${ch.topic}"`
        : `"%s/${this.topicSegment(ch.sensor)}", _mqttPrefix`;

      const publishCall = ch.topic
        ? `snprintf(_t, sizeof(_t), ${topicPart});`
        : `snprintf(_t, sizeof(_t), "${this.topicSegment(ch.sensor)}", _mqttPrefix);`;

      channelBlocks.push(
        `  // ${ch.sensor}${typeof ivRaw === 'number' ? ` — every ${ivRaw}ms` : ` — every \${${ivRaw}}ms`}`,
        '  {',
        '    static unsigned long _due = 0;',
        `    const unsigned long _iv = ${ivExpr};`,
        `    if (${this.backend.nowExpr()} - _due >= _iv) {`,
        '      _due += _iv;',
        `      if (${this.backend.nowExpr()} - _due >= _iv) _due = ${this.backend.nowExpr()};`,
        ch.topic
          ? `      snprintf(_t, sizeof(_t), "${ch.topic}");`
          : `      snprintf(_t, sizeof(_t), "%s/${this.topicSegment(ch.sensor)}", _mqttPrefix);`,
        `      snprintf(_v, sizeof(_v), "%.4g", (double)${field});`,
        `      ${client}.publish(_t, _v);`,
        '    }',
        '  }',
      );
    }

    const body = [
      `  if (!${client}.connected()) return;`,
      '  char _t[128];',
      '  char _v[32];',
      '',
      ...channelBlocks,
    ].join('\n');

    return `// ============================================================================
// TELEMETRY
// ============================================================================
//
// Per-channel MQTT publishing. Each sensor has its own deadline so a fast
// reading and a slow diagnostic can coexist without either blocking the other.

static void runTelemetry() {
${body}
}`;
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

        const hasTimed    = (this.timedBySource.get(flat.index)?.length ?? 0) > 0;
        const hasPeriodic = (this.periodicBySource.get(flat.index)?.length ?? 0) > 0;
        const hasUpdate   = hasTimed || hasPeriodic;
        const entryCb     = this.entryCallbackName(flat);
        const exitCb      = this.exitCallbackName(flat);

        return `  ${flat.symbol} = fsm.addState(
      "${flat.path}",
      ${hasUpdate ? `${this.timerNames(flat).tick},   // update - "after" timers and "every" periodics` : 'nullptr,   // update'}
      ${entryCb ? `${entryCb},  // entry` : 'nullptr,   // entry'}
      ${exitCb  ? `${exitCb},   // exit`  : 'nullptr,   // exit'}
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

    const stream = this.consoleStream();

    const machineSetup = !this.hasMachine ? '' : `
  // Register states. Parents are registered before their children.
${registrations}

${this.registrationCheck()}
  // begin() must be given a leaf state.
  fsm.begin(${this.states[startIndex].symbol});
${this.hasConsole && this.isVerbose ? `
  ${this.backend.printExpr(stream, '"Initial state: "')};
  ${this.backend.printlnExpr(stream, 'fsm.getCurrentName()')};
` : ''}`;

    const loadCall = this.persistedParameters().length > 0
      ? '\n  // Restore persisted parameters from NVS.\n  loadParameters();\n'
      : '';

    const diagSetup = this.project.system.diagnostics ? '\n  setupDiagnostics();\n' : '';

    const timerStarts = this.nativeTimerSetupLines.length > 0
      ? '\n  // Start platform-native task timers.\n' +
        this.nativeTimerSetupLines.map(l => `  ${l}`).join('\n') + '\n'
      : '';

    const setupBody = `  // Buses and peripherals declared as resources. Nothing else is opened: a
  // peripheral the model did not declare has no business appearing here.
  setupInterfaces();
${timerStarts}${diagSetup}${loadCall}
  // Wire up the context handed to every action
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
${machineSetup}`;

    return `// ============================================================================
// SETUP
// ============================================================================

${componentComments}

${this.backend.renderSetup(setupBody)}`;
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

  /** The C identifier for the console stream, e.g. `Serial`. */
  private consoleStream(): string {
    const resource = this.declaredConsole();
    const port = resource ? Number(resource.binding?.port ?? 1) : 0;
    return this.backend.consoleStreamName(port);
  }

  /** `enteredAt`-style globals and the loop body for `tasks:`. */
  private generateTasks(): string {
    const tasks = this.project.system.tasks || [];
    if (tasks.length === 0) return '';

    const tsType = this.backend.timestampType();
    const now = this.backend.nowExpr();

    // Reset native-timer tracking so regeneration from a fresh Codegen instance
    // doesn't accumulate stale entries across multiple generate() calls.
    this.nativeTimerBases.clear();
    this.nativeTimerSetupLines = [];

    const blocks = tasks.map(task => {
      const base = this.sanitize(task.name);
      const interval = typeof task.every === 'string'
        ? `(${tsType})systemParameters.${this.sanitize(task.every)}`
        : this.backend.durationLiteral(task.every);
      const source = typeof task.every === 'string' ? `${task.every} (parameter)` : `every ${task.every}ms`;
      const calls = [
        ...task.actions.map(a => `  action_${this.sanitize(a.name)}(&systemContext);`),
        // After the actions: a task that samples and then reports should print
        // the reading it just took, not the one before it.
        ...(task.log ? [this.logLines(task.log, '  ')] : []),
      ].join('\n');

      // Delegate to the backend's native timer mechanism when available.
      const nativeTimer = this.backend.timerTask?.(base, interval, calls);
      if (nativeTimer !== undefined) {
        this.nativeTimerBases.add(base);
        this.nativeTimerSetupLines.push(nativeTimer.setup);
        return `// Task "${task.name}" - ${source} (k_timer/k_work workqueue).${task.description ? `\n// ${task.description}` : ''}\n${nativeTimer.decls}`;
      }

      return `// Task "${task.name}" - ${source}.${task.description ? `\n// ${task.description}` : ''}
static ${tsType} dueAt_${base} = 0;

static void runTask_${base}() {
  const ${tsType} interval = ${interval};
  const ${tsType} nowMs = ${now};
  if (nowMs - dueAt_${base} < interval) return;

  // Advance the deadline by whole intervals rather than restarting from now.
  // Restarting adds however long the loop took to come round to every period,
  // and that error accumulates: a 100ms blink slowly becomes a 103ms blink.
  dueAt_${base} += interval;

  // Unless we are already a full interval behind - a long blocking call, or
  // the interval was just shortened - in which case give up on catching up
  // and resync, rather than firing repeatedly in a burst.
  if (nowMs - dueAt_${base} >= interval) dueAt_${base} = nowMs;

${calls}
}`;
    });

    const hasPolling = tasks.some(t => !this.nativeTimerBases.has(this.sanitize(t.name)));
    const hasNative  = this.nativeTimerBases.size > 0;

    const header = hasNative && !hasPolling
      ? `// ============================================================================
// TASKS
// ============================================================================
//
// Each task runs on the Zephyr system workqueue, fired by a k_timer.  The
// timer's start() call is in _setup(); no polling is needed in main().`
      : `// ============================================================================
// TASKS
// ============================================================================
//
// Each runs on its own interval, checked every pass of loop(). An interval
// naming a parameter is read every time, so retuning it takes effect at once.
// Subtraction on unsigned long is correct across the millis() rollover.`;

    return `${header}

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

      return `  if (strcmp(cmd, ${JSON.stringify(command.match)}) == 0) {${
        command.description ? `\n    // ${command.description}` : ''
      }
${[calls, raise, reply].filter(Boolean).join('\n')}
    return;
  }`;
    });

    const unknown = set.reportUnknown === false ? '' : `
  ${this.backend.printExpr(stream, '"Unknown command: "')};
  ${this.backend.printlnExpr(stream, 'cmd')};`;

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

static void dispatchCommand(const char* cmd) {
${cases.join('\n')}${unknown}
}

/**
 * Read whatever has arrived, a line at a time.
 *
 * Never blocks: it consumes only what is already buffered, so loop() keeps
 * running whether or not anyone is typing.
 */
static void pollCommands() {
  while (${this.backend.streamAvailableExpr(stream)} > 0) {
    const int next = ${this.backend.streamReadExpr(stream)};

    if (next == '\\n' || next == '\\r') {
      if (commandOverflow) {
        ${this.backend.printlnExpr(stream, '"Command too long; ignored."')};
        commandLength = 0;
        commandOverflow = false;
      } else if (commandLength > 0) {
        commandLine[commandLength] = '\\0';
        systemContext.argc = 0;
        char* tok = strtok(commandLine, " \\t");
        while (tok && systemContext.argc < PULSE_CMD_MAX_ARGS) {
          systemContext.argv[systemContext.argc++] = tok;
          tok = strtok(nullptr, " \\t");
        }
        if (systemContext.argc > 0) {
          dispatchCommand(systemContext.argv[0]);
        }
        commandLength = 0;
        commandOverflow = false;
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
}`;
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

  // =========================================================================
  // GENERATED ACTION BODIES
  // =========================================================================

  /**
   * Generate the real hardware call for a built-in driver action, or fall back
   * to a TODO comment for custom drivers the generator cannot know about.
   *
   * The surrounding function still keeps its param documentation and context
   * listing — only the implementation line changes.
   */
  private actionBody(action: Action | undefined): string {
    const driver = action?.driver as string | undefined;
    const params = action?.params ?? {};

    switch (driver) {
      case 'gpio_control': {
        const rawDevice  = params.device  as string | undefined;
        const rawDevices = params.devices as string[] | undefined;
        const targets = rawDevices ?? (rawDevice ? [rawDevice] : []);
        const value   = params.value as string | number | undefined;
        if (targets.length === 0 || value === undefined) break;

        const valueStr = String(value).toUpperCase();
        if (valueStr === 'TOGGLE') {
          // Toggle: read the current state and invert it.
          return targets
            .map(t => {
              const pin = this.backend.gpioPinVar(this.sanitizeUpper(String(t)));
              return `  ${this.backend.digitalWriteExpr(pin, `!${this.backend.digitalReadExpr(pin)}`)};`;
            })
            .join('\n') + '\n  (void)ctx;';
        }

        const valueExpr = valueStr === 'HIGH' || value === 1
          ? 'HIGH'
          : valueStr === 'LOW' || value === 0
          ? 'LOW'
          : this.isParameter(String(value))
          ? `systemParameters.${this.sanitize(String(value))} ? HIGH : LOW`
          : null;  // unknown value — fall back to TODO

        if (valueExpr === null) break;

        return targets
          .map(t => `  ${this.backend.digitalWriteExpr(this.backend.gpioPinVar(this.sanitizeUpper(String(t))), valueExpr)};`)
          .join('\n') + '\n  (void)ctx;';
      }

      case 'adc_read': {
        const deviceName = String(params.device ?? '');
        if (this.isSensorComponent(deviceName)) {
          const pinMacro = `${this.sanitizeUpper(deviceName)}_PIN`;
          const field    = `systemSensors.${this.sanitize(deviceName)}`;
          const component = (this.project.system.components || []).find(c => c.name === deviceName);
          const rawConversion = component?.config?.conversion;
          if (typeof rawConversion === 'string' && rawConversion.trim()) {
            const expr = rawConversion.trim().replace(/\{pin\}/g, pinMacro);
            return `  ${field} = (float)(${expr});\n  (void)ctx;`;
          }
          return `  ${field} = ${this.backend.analogReadExpr(pinMacro)};\n  (void)ctx;`;
        }
        break;
      }

      case 'gpio_read': {
        const deviceName = String(params.device ?? '');
        if (this.isSensorComponent(deviceName)) {
          const pin   = this.backend.gpioPinVar(this.sanitizeUpper(deviceName));
          const field = `systemSensors.${this.sanitize(deviceName)}`;
          return `  ${field} = (float)${this.backend.digitalReadExpr(pin)};\n  (void)ctx;`;
        }
        break;
      }

      case 'ds18b20': {
        const deviceName = String(params.device ?? '');
        if (this.isSensorComponent(deviceName)) {
          const objVar = this.sanitize(deviceName);
          const field  = `systemSensors.${objVar}`;
          return `  ${objVar}.requestTemperatures();\n  ${field} = ${objVar}.getTempCByIndex(0);\n  (void)ctx;`;
        }
        break;
      }

      case 'dht22':
      case 'dht11': {
        const deviceName = String(params.device ?? '');
        const component  = (this.project.system.components || []).find(c => c.name === deviceName);
        if (component && this.isSensorComponent(deviceName)) {
          const objVar = this.sanitize(deviceName);
          if (component.channels?.length) {
            // Multi-channel: read both temperature and humidity in one action call.
            const lines = component.channels.map(ch => {
              const field   = `systemSensors.${this.sanitize(ch.name)}`;
              const measure = ch.measure ?? ch.name;
              const readCall = measure === 'humidity'
                ? `${objVar}.readHumidity()`
                : `${objVar}.readTemperature()`;
              return `  ${field} = ${readCall};\n  if (isnan(${field})) { /* read failed */ }`;
            });
            return lines.join('\n') + '\n  (void)ctx;';
          }
          const field   = `systemSensors.${objVar}`;
          const measure = String(component.config?.measure ?? 'temperature');
          const readCall = measure === 'humidity'
            ? `${objVar}.readHumidity()`
            : `${objVar}.readTemperature()`;
          return `  ${field} = ${readCall};\n  if (isnan(${field})) { /* read failed */ }\n  (void)ctx;`;
        }
        break;
      }

      case 'bme280': {
        const deviceName = String(params.device ?? '');
        const component  = (this.project.system.components || []).find(c => c.name === deviceName);
        if (component && this.isSensorComponent(deviceName)) {
          const objVar = this.sanitize(deviceName);
          if (component.channels?.length) {
            // Multi-channel: read every declared channel in one action.
            const lines = component.channels.map(ch => {
              const field = `systemSensors.${this.sanitize(ch.name)}`;
              const measure = ch.measure ?? ch.name;
              let readCall: string;
              switch (measure) {
                case 'humidity': readCall = `${objVar}.readHumidity()`; break;
                case 'pressure': readCall = `${objVar}.readPressure() / 100.0F`; break;
                default:         readCall = `${objVar}.readTemperature()`; break;
              }
              return `  ${field} = ${readCall};`;
            });
            return lines.join('\n') + '\n  (void)ctx;';
          }
          const field   = `systemSensors.${objVar}`;
          const measure = String(component.config?.measure ?? 'temperature');
          let readCall: string;
          switch (measure) {
            case 'humidity': readCall = `${objVar}.readHumidity()`; break;
            case 'pressure': readCall = `${objVar}.readPressure() / 100.0F`; break;
            default:         readCall = `${objVar}.readTemperature()`; break;
          }
          return `  ${field} = ${readCall};\n  (void)ctx;`;
        }
        break;
      }

      case 'lcd_display':
      case 'lcd_print': {
        const deviceName = String(params.device ?? '');
        const device = (this.project.system.components || []).find(c => c.name === deviceName);
        if (!device) break;
        const objVar  = this.sanitize(deviceName);
        const bufSize = (typeof device.config?.cols === 'number' ? device.config.cols : 16) + 1;
        const lines: string[] = [];

        if (params.clear) lines.push(`  ${objVar}.clear();`);

        if (params.lines !== undefined) {
          // Multi-line form: lines: ["...", {row, col, format}, ...]
          const rawLines = Array.isArray(params.lines) ? params.lines : [];
          rawLines.forEach((item, idx) => {
            const row = (typeof item === 'object' && item && !Array.isArray(item) ? (item as Record<string, unknown>).row : undefined) ?? idx;
            const col = (typeof item === 'object' && item && !Array.isArray(item) ? (item as Record<string, unknown>).col : undefined) ?? 0;
            const fmt = typeof item === 'string' ? item : (typeof (item as Record<string, unknown>).format === 'string' ? (item as Record<string, unknown>).format as string : undefined);
            lines.push(...this.renderLcdLine(String(fmt ?? ''), Number(row), Number(col), objVar, bufSize));
          });
        } else if (typeof params.format === 'string') {
          // Single-line form: format, row, col
          const row = params.row ?? 0;
          const col = params.col ?? 0;
          lines.push(...this.renderLcdLine(params.format, Number(row), Number(col), objVar, bufSize));
        } else {
          // No format — legacy stub
          const col = params.col ?? 0;
          const row = params.row ?? 0;
          lines.push(
            `  ${objVar}.setCursor(${col}, ${row});`,
            `  // ${objVar}.print("your text");        // literal string`,
            `  // ${objVar}.print(systemSensors.value); // sensor reading`,
          );
        }

        lines.push('  (void)ctx;');
        return lines.join('\n');
      }

      case 'lcd_clear': {
        const deviceName = String(params.device ?? '');
        const device = (this.project.system.components || []).find(c => c.name === deviceName);
        if (!device) break;
        return `  ${this.sanitize(deviceName)}.clear();\n  (void)ctx;`;
      }

      case 'oled_print': {
        const deviceName = String(params.device ?? '');
        const device = (this.project.system.components || []).find(c => c.name === deviceName);
        if (!device) break;
        const objVar = this.sanitize(deviceName);
        const x    = params.x ?? 0;
        const y    = params.y ?? 0;
        const size = params.size ?? 1;
        return [
          `  ${objVar}.clearDisplay();`,
          `  ${objVar}.setTextSize(${size});`,
          `  ${objVar}.setTextColor(SSD1306_WHITE);`,
          `  ${objVar}.setCursor(${x}, ${y});`,
          `  // ${objVar}.print("your text");        // literal string`,
          `  // ${objVar}.print(systemSensors.value); // sensor reading`,
          `  ${objVar}.display();`,
          `  (void)ctx;`,
        ].join('\n');
      }

      case 'rtc_read': {
        const deviceName = String(params.device ?? '');
        const component = (this.project.system.components || []).find(c => c.name === deviceName);
        if (!component) break;
        const objVar = this.sanitize(deviceName);
        const channels = component.channels ?? [];
        if (channels.length === 0) break;  // no channels declared → leave as stub

        const lines: string[] = [`  DateTime _now = ${objVar}.now();`];
        for (const ch of channels) {
          const field = `systemSensors.${this.sanitize(ch.name)}`;
          const measure = ch.measure ?? ch.name;
          let readExpr: string;
          switch (measure) {
            case 'hour':       readExpr = '_now.hour()'; break;
            case 'minute':     readExpr = '_now.minute()'; break;
            case 'second':     readExpr = '_now.second()'; break;
            case 'day':        readExpr = '_now.day()'; break;
            case 'month':      readExpr = '_now.month()'; break;
            case 'year':       readExpr = '_now.year()'; break;
            case 'dayOfWeek':  readExpr = '_now.dayOfTheWeek()'; break;
            default:           readExpr = `_now.${measure}()`; break;
          }
          lines.push(`  ${field} = (float)${readExpr};`);
        }
        lines.push('  (void)ctx;');
        return lines.join('\n');
      }

      case 'pwm_control': {
        const deviceName = String(params.device ?? '');
        const device = (this.project.system.components || []).find(c => c.name === deviceName);
        if (!device) break;

        const sym       = this.sanitizeUpper(deviceName);
        const freqMacro = `${sym}_FREQUENCY`;
        const resMacro  = `${sym}_RESOLUTION`;
        const dutyRaw   = params.duty;
        const dutyParam = (this.project.system.parameters || []).find(p => p.name === String(dutyRaw));
        const dutyExpr  = dutyParam
          ? `ctx->parameters->${this.sanitize(String(dutyRaw))}`
          : dutyRaw !== undefined ? String(dutyRaw) : '0';

        const board = (this.project.target?.board ?? '').toLowerCase();
        return this.backend.pwmWriteLines(sym, freqMacro, resMacro, dutyExpr, board) + '\n  (void)ctx;';
      }

      case 'console_help': {
        if (!this.hasConsole) break;
        const cmds = (this.project.system.commands?.commands ?? []).map(c => c.match);
        const stream = this.consoleStream();
        const list = cmds.length ? cmds.join(', ') : '(no commands declared)';
        return `  ${this.backend.printlnExpr(stream, `"Commands: ${list}"`)};` + '\n  (void)ctx;';
      }

      case 'sleep_control': {
        const mode = String(params.mode ?? 'deep_sleep');
        const durationMs = params.duration_ms !== undefined ? Number(params.duration_ms) : undefined;
        const wakePin    = params.wake_pin    !== undefined ? String(params.wake_pin)    : undefined;
        const wakeLevel  = params.wake_level  !== undefined ? Number(params.wake_level)  : 0;

        const lines: string[] = [
          '  // Requires: ESP32 Arduino core (sleep APIs are built-in)',
          '  #ifdef ARDUINO_ARCH_ESP32',
        ];
        if (durationMs !== undefined) {
          lines.push(`    esp_sleep_enable_timer_wakeup(${durationMs}ULL * 1000ULL);  // ${durationMs} ms`);
        }
        if (wakePin !== undefined) {
          lines.push(`    esp_sleep_enable_ext0_wakeup((gpio_num_t)${wakePin}, ${wakeLevel});`);
        }
        if (mode === 'light_sleep') {
          lines.push('    esp_light_sleep_start();');
        } else {
          lines.push('    esp_deep_sleep_start();  // does not return');
        }
        lines.push(
          '  #else',
          `    // TODO: sleep_control is ESP32-only. Add your MCU's low-power call here.`,
          '  #endif',
          '  (void)ctx;',
        );
        return lines.join('\n');
      }

      case 'http_get': {
        const url   = params.url !== undefined ? JSON.stringify(String(params.url)) : '"http://example.com/api"';
        const board = (this.project.target?.board ?? '').toLowerCase();
        return this.backend.httpGetLines(url, board);
      }

      case 'http_post': {
        const url         = params.url          !== undefined ? JSON.stringify(String(params.url))          : '"http://example.com/api"';
        const body        = params.body         !== undefined ? JSON.stringify(String(params.body))         : '"{}"';
        const contentType = params.content_type !== undefined ? JSON.stringify(String(params.content_type)) : '"application/json"';
        const board       = (this.project.target?.board ?? '').toLowerCase();
        return this.backend.httpPostLines(url, body, contentType, board);
      }
    }

    // Unknown or custom driver — the user writes the body.
    return '  // TODO: Implement the hardware calls for this action.\n  (void)ctx;';
  }

  /** True when name is a declared model parameter. */
  private isParameter(name: string): boolean {
    return (this.project.system.parameters || []).some(p => p.name === name);
  }

  /** True when name is a declared sensor component. */
  private isSensorComponent(name: string): boolean {
    return (this.project.system.components || []).some(
      c => c.name === name && String(c.class) === 'sensor'
    );
  }

  // =========================================================================
  // STORAGE WIRING (persist: true parameters)
  // =========================================================================

  /** Parameters the model has marked persist:true. */
  private persistedParameters() {
    return (this.project.system.parameters || []).filter(p => p.persist === true);
  }

  /**
   * Generate loadParameters() / saveParameters() using the Arduino Preferences
   * library (ESP32-native, wraps NVS).  On non-ESP32 targets the functions are
   * still emitted but wrapped in #ifdef ARDUINO_ARCH_ESP32, so the sketch
   * compiles everywhere while the persistence calls are simply no-ops on AVR
   * or RP2040 boards — the user can swap in EEPROM.h calls there.
   *
   * NVS key names are limited to 15 characters; keys are truncated with a
   * comment so the user can see the mapping.
   */
  private generateStorageWiring(): string {
    const persisted = this.persistedParameters();
    if (persisted.length === 0) return '';

    const ns = this.topicSegment(this.project.name).slice(0, 15);  // NVS namespace max 15 chars

    const prefsGet = (p: typeof persisted[0]): string => {
      const field = `systemParameters.${this.sanitize(p.name)}`;
      const key   = this.sanitize(p.name).slice(0, 15);
      const dflt  = this.cLiteral(p);
      switch (p.type) {
        case 'float':  return `  ${field} = _prefs.getFloat("${key}", ${dflt});`;
        case 'bool':   return `  ${field} = _prefs.getBool("${key}", ${dflt});`;
        default:       return `  ${field} = _prefs.getInt("${key}", ${dflt});`;
      }
    };

    const prefsPut = (p: typeof persisted[0]): string => {
      const field = `systemParameters.${this.sanitize(p.name)}`;
      const key   = this.sanitize(p.name).slice(0, 15);
      switch (p.type) {
        case 'float':  return `  _prefs.putFloat("${key}", ${field});`;
        case 'bool':   return `  _prefs.putBool("${key}", ${field});`;
        default:       return `  _prefs.putInt("${key}", ${field});`;
      }
    };

    const loadBody = persisted.map(prefsGet).join('\n');
    const saveBody = persisted.map(prefsPut).join('\n');

    return `// ============================================================================
// STORAGE WIRING (persist: true parameters)
// ============================================================================
//
// Parameters marked persist:true are loaded from NVS at boot and saved
// whenever they change. Call saveParameters() after any write to these fields
// (the MQTT setpoint handler does this automatically when both are present).
//
// Requires the Preferences library — included with the ESP32 Arduino core.
// Non-ESP32 targets compile but skip NVS calls; replace with EEPROM.h if needed.

#ifdef ARDUINO_ARCH_ESP32
#include <Preferences.h>
static Preferences _prefs;
#endif

static void loadParameters() {
#ifdef ARDUINO_ARCH_ESP32
  _prefs.begin("${ns}", true);  // read-only
${loadBody}
  _prefs.end();
#endif
}

static void saveParameters() {
#ifdef ARDUINO_ARCH_ESP32
  _prefs.begin("${ns}", false);  // read-write
${saveBody}
  _prefs.end();
#endif
}`;
  }

  // =========================================================================
  // SENSOR READS
  // =========================================================================

  /**
   * Generate a `readSensors()` function that populates `systemSensors` from
   * declared sensor devices that have a known, PIN-based read pattern.
   *
   * Only analog_input and digital_input are emitted here — they need no extra
   * library and the read is a single `analogRead`/`digitalRead` call. Bus-based
   * sensors (ds18b20, bme280, etc.) require library-specific objects; their
   * stubs live in the action bodies that explicitly trigger a read, and the
   * developer adds the object global for their chosen library.
   */
  private generateReadSensors(): string {
    const sensors = (this.project.system.components || []).filter(
      c => String(c.class) === 'sensor' &&
           (c.type === 'analog_input' || c.type === 'digital_input')
    );
    if (sensors.length === 0) return '';

    const reads = sensors.map(c => {
      const pinMacro = `${this.sanitizeUpper(c.name)}_PIN`;
      const field    = `systemSensors.${this.sanitize(c.name)}`;

      const rawConversion = c.config?.conversion;
      if (typeof rawConversion === 'string' && rawConversion.trim()) {
        // User-supplied conversion formula. {pin} expands to the pin macro so
        // the expression stays board-agnostic:
        //   conversion: "analogRead({pin}) * (3.3 / 4095.0) * 100.0"
        // becomes:
        //   systemSensors.temp = analogRead(TEMP_PIN) * (3.3 / 4095.0) * 100.0;
        const expr = rawConversion.trim().replace(/\{pin\}/g, pinMacro);
        const unit = c.config?.unit ? `  // ${c.config.unit}` : '';
        return `  ${field} = (float)(${expr});${unit}`;
      }

      return c.type === 'analog_input'
        ? `  ${field} = ${this.backend.analogReadExpr(pinMacro)};`
        : `  ${field} = (float)${this.backend.digitalReadExpr(this.backend.gpioPinVar(this.sanitizeUpper(c.name)))};`;
    });

    return `// Populate systemSensors before guards and actions read them.
// Called at the top of every loop() pass.
static void readSensors() {
${reads.join('\n')}
}`;
  }

  // =========================================================================
  // MQTT WIRING
  // =========================================================================

  /** Return the declared mqtt resource, or undefined. */
  private mqttResource(): Resource | undefined {
    return (this.project.system.resources || []).find(r => String(r.interface) === 'mqtt');
  }

  /**
   * Sanitize a name for use as an MQTT topic segment.
   * Mirrors the TopicEmitter.segment() logic: keep alphanumerics and ._-,
   * replace everything else with underscore.
   */
  private topicSegment(name: string): string {
    return name.trim().replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^_+|_+$/g, '');
  }

  /**
   * Derive the PubSubClient variable name from the mqtt resource name.
   * Mirrors the lower() helper in interfaces.ts:
   *   "mqtt"      → "mqtt"
   *   "broker"    → "broker"
   *   "mqtt_bus"  → "mqttBus"
   */
  private mqttClientVar(resource: Resource): string {
    const upper = this.sanitizeUpper(resource.name);
    return upper.toLowerCase().replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  }

  /**
   * Generate the MQTT subscription/publication wiring:
   *   - onMqttMessage()  — callback updating parameters or raising events
   *   - connectMqtt()    — connect once + subscribe
   *   - publishMqtt()    — publish sensor readings and current state
   *
   * Emitted only when an mqtt resource is declared AND there is something to
   * subscribe to or publish (parameters, MQTT-sourced events, or sensors).
   * The loop() generator injects the reconnect/loop/publish calls.
   */
  private generateMqttWiring(): string {
    const mqtt = this.mqttResource();
    if (!mqtt) return '';

    const allComponents = this.project.system.components || [];
    const allParameters = this.project.system.parameters || [];
    const allEvents     = this.project.system.events || [];
    const comm          = this.project.system.communication;

    // Build wiring lists. When communication: is declared, only listed items
    // are wired; each can carry a stable topic segment that overrides the name.
    // Without it, the implicit behaviour holds: all sensors publish, all
    // parameters and mqtt-sourced events subscribe.
    interface SensorWire { name: string; seg: string }
    interface ParamWire  { parameter: Parameter; seg: string }
    interface EventWire  { event: Event; seg: string }

    let sensorWires: SensorWire[];
    let paramWires:  ParamWire[];
    let eventWires:  EventWire[];

    if (comm) {
      sensorWires = (comm.publish || []).map(item => ({
        name: item.sensor,
        seg:  this.topicSegment(item.topic ?? item.sensor),
      }));
      const subItems = comm.subscribe || [];
      paramWires = subItems
        .filter(item => item.parameter !== undefined)
        .map(item => {
          const parameter = allParameters.find(p => p.name === item.parameter)!;
          return { parameter, seg: this.topicSegment(item.topic ?? item.parameter!) };
        });
      eventWires = subItems
        .filter(item => item.event !== undefined)
        .map(item => {
          const event = allEvents.find(e => e.name === item.event)!;
          return { event, seg: this.topicSegment(item.topic ?? item.event!) };
        });
    } else {
      sensorWires = [];
      for (const c of allComponents.filter(c => String(c.class) === 'sensor')) {
        if (c.channels?.length) {
          // Multi-channel device: publish each channel under its own topic.
          for (const ch of c.channels) {
            sensorWires.push({ name: ch.name, seg: this.topicSegment(ch.name) });
          }
        } else {
          sensorWires.push({ name: c.name, seg: this.topicSegment(c.name) });
        }
      }
      paramWires = allParameters.map(p => ({ parameter: p, seg: this.topicSegment(p.name) }));
      eventWires = allEvents
        .filter(e => String(e.source) === 'mqtt')
        .map(e => ({ event: e, seg: this.topicSegment(e.name) }));
    }

    const hasSubscriptions = paramWires.length > 0 || eventWires.length > 0;
    // When telemetry: is declared, sensor publishing moves to runTelemetry(),
    // so publishMqtt() only needs to exist for machine-state publishing.
    const telemetryDeclared = !!this.project.system.telemetry;
    const hasPublications   = (!telemetryDeclared && sensorWires.length > 0) || this.hasMachine;

    if (!hasSubscriptions && !hasPublications) return '';

    const client  = this.mqttClientVar(mqtt);
    const binding = mqtt.binding || {};

    // The topic namespace — the project name by default, overridable in the model.
    const ns = this.topicSegment(
      typeof binding.prefix === 'string' ? String(binding.prefix) : this.project.name
    );

    // ── onMqttMessage ──────────────────────────────────────────────────────

    const hasPersistAndMqtt = paramWires.some(w => w.parameter.persist) && hasSubscriptions;

    const setpointCases = paramWires.map(({ parameter: p, seg }) => {
      const field = `systemParameters.${this.sanitize(p.name)}`;
      let conv: string;
      switch (p.type) {
        case 'float':  conv = `${field} = atof(buf);`;                                 break;
        case 'bool':   conv = `${field} = buf[0] == '1' || strcmp(buf, "true") == 0;`; break;
        default:       conv = `${field} = (int)atol(buf);`;                             break;
      }
      const save = hasPersistAndMqtt ? ' saveParameters();' : '';
      return `  if (strcmp(suffix, "/setpoint/${seg}") == 0) { ${conv}${save} return; }`;
    });

    const eventCases = eventWires.map(({ event: e, seg }) => {
      const evSym = `EVENT_${this.sanitizeUpper(e.name)}`;
      const dispatch = this.hasMachine
        ? `fsm.sendEvent(${evSym})`
        : `/* no machine — ${e.name} cannot be dispatched */`;
      return `  if (strcmp(suffix, "/event/${seg}") == 0) { ${dispatch}; return; }`;
    });

    const callbackBody = [
      '  char buf[128];',
      '  if (length >= sizeof(buf)) length = sizeof(buf) - 1;',
      '  memcpy(buf, payload, length);',
      '  buf[length] = \'\\0\';',
      '',
      '  const size_t prefixLen = strlen(_mqttPrefix);',
      '  if (strncmp(topic, _mqttPrefix, prefixLen) != 0) return;',
      '  const char* suffix = topic + prefixLen;',
      '',
      ...(setpointCases.length > 0 ? ['  // Setpoints → update parameters.', ...setpointCases, ''] : []),
      ...(eventCases.length > 0    ? ['  // Events → dispatch to state machine.', ...eventCases] : []),
    ].join('\n');

    // ── connectMqtt ────────────────────────────────────────────────────────

    const subscribeLines = [
      ...paramWires.map(({ seg }) =>
        `  snprintf(_t, sizeof(_t), "%s/setpoint/${seg}", _mqttPrefix);\n  ${client}.subscribe(_t);`
      ),
      ...eventWires.map(({ seg }) =>
        `  snprintf(_t, sizeof(_t), "%s/event/${seg}", _mqttPrefix);\n  ${client}.subscribe(_t);`
      ),
    ];

    // client_id binding overrides MQTT_DEVICE_ID for the broker connection.
    const clientIdExpr = typeof binding.client_id === 'string'
      ? this.sanitizeUpper(mqtt.name) + '_CLIENT_ID'
      : 'MQTT_DEVICE_ID';

    const connectBody = [
      `  if (${client}.connected()) return;`,
      `  snprintf(_mqttPrefix, sizeof(_mqttPrefix), "${ns}/" MQTT_DEVICE_ID);`,
      `  if (!${client}.connect(${clientIdExpr})) return;`,
      '',
      `  ${client}.setCallback(onMqttMessage);`,
      '',
      ...(subscribeLines.length > 0 ? ['  char _t[128];', ...subscribeLines] : []),
    ].join('\n');

    // ── publishMqtt ────────────────────────────────────────────────────────

    const publishLines: string[] = [];
    const effectiveSensorWires = telemetryDeclared ? [] : sensorWires;
    if (effectiveSensorWires.length > 0) {
      publishLines.push('  // Sensor readings.');
      for (const { name, seg } of effectiveSensorWires) {
        const field = `systemSensors.${this.sanitize(name)}`;
        publishLines.push(
          `  snprintf(_t, sizeof(_t), "%s/${seg}", _mqttPrefix);`,
          `  snprintf(_v, sizeof(_v), "%.4g", ${field});`,
          `  ${client}.publish(_t, _v);`,
        );
      }
    }
    if (this.hasMachine) {
      publishLines.push('  // Current leaf state.');
      publishLines.push(`  snprintf(_t, sizeof(_t), "%s/state", _mqttPrefix);`);
      publishLines.push(`  ${client}.publish(_t, fsm.getCurrentName());`);
    }

    const publishBody = [
      `  if (!${client}.connected()) return;`,
      '  char _t[128];',
      ...(effectiveSensorWires.length > 0 ? ['  char _v[32];'] : []),
      '',
      ...publishLines,
    ].join('\n');

    // ── assemble ───────────────────────────────────────────────────────────

    const callbackSection = hasSubscriptions
      ? `static void onMqttMessage(char* topic, uint8_t* payload, unsigned int length) {\n${callbackBody}\n}`
      : '';

    const connectSection  = hasSubscriptions
      ? `static void connectMqtt() {\n${connectBody}\n}`
      : `static void connectMqtt() {\n  if (${client}.connected()) return;\n  snprintf(_mqttPrefix, sizeof(_mqttPrefix), "${ns}/" MQTT_DEVICE_ID);\n  ${client}.connect(MQTT_DEVICE_ID);\n}`;

    const publishSection  = hasPublications
      ? `static void publishMqtt() {\n${publishBody}\n}`
      : '';

    const parts = [
      `// ============================================================================
// MQTT WIRING
// ============================================================================
//
// The device identifies itself via MQTT_DEVICE_ID. Pass as a build flag:
//   Arduino: -DMQTT_DEVICE_ID=\\"unit-001\\"    (in build_flags or compiler flags)
//   IDF:     CONFIG_MQTT_DEVICE_ID in sdkconfig
#include <string.h>   // memcpy, strlen, strcmp, strncmp
#include <stdio.h>    // snprintf
#include <stdlib.h>   // atof, atol

#ifndef MQTT_DEVICE_ID
#define MQTT_DEVICE_ID "device"
#endif

// Runtime topic prefix: "${ns}/<device_id>"
static char _mqttPrefix[96];`,
      callbackSection,
      connectSection,
      publishSection,
    ].filter(Boolean);

    return parts.join('\n\n');
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
        out.push(`${indent}${this.backend.printExpr(stream, JSON.stringify(segment.value))};`);
        continue;
      }
      out.push(`${indent}${this.backend.printExpr(stream, this.logValue(segment.name))};`);
    }

    out.push(`${indent}${this.backend.printlnNoArgExpr(stream)};`);
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
  private everyUsedAction(): Action[] {
    const stateActions: Action[] = [];
    const collectState = (state: State) => {
      for (const a of state.entry || []) stateActions.push(a);
      for (const a of state.exit  || []) stateActions.push(a);
      for (const region of state.regions || []) region.states.forEach(collectState);
    };
    for (const state of this.project.system.states || []) collectState(state);

    return [
      ...this.project.system.transitions.flatMap(t => t.actions || []),
      ...stateActions,
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

    if (this.project.system.commands) {
      lines.push('  //   ctx->argc, ctx->argv[]   (command tokens; argv[0] is the command name)');
    }

    if (lines.length === 0) return '';

    return `  //\n  // Available on ctx:\n${lines.join('\n')}\n`;
  }

  /** C names a state with timed transitions needs. */
  private timerNames(flat: FlatState): { since: string; tick: string } {
    const base = this.sanitize(flat.path);
    return { since: `enteredAt_${base}`, tick: `tick_${base}` };
  }

  /**
   * The name of the entry callback to pass to addState(), or null when the
   * state needs no entry hook at all.
   *
   * Non-null when the state declares entry: actions OR has after: transitions
   * (which need a clock stamp on entry).
   */
  private entryCallbackName(flat: FlatState): string | null {
    const hasTimed = (this.timedBySource.get(flat.index)?.length ?? 0) > 0;
    const hasEntryActions = (flat.state?.entry?.length ?? 0) > 0;
    if (!hasTimed && !hasEntryActions) return null;
    return `on_enter_${this.sanitize(flat.path)}`;
  }

  /**
   * The name of the exit callback to pass to addState(), or null when the
   * state has no exit: actions.
   */
  private exitCallbackName(flat: FlatState): string | null {
    return (flat.state?.exit?.length ?? 0) > 0
      ? `on_exit_${this.sanitize(flat.path)}`
      : null;
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
    if (this.timedBySource.size === 0 && this.periodicBySource.size === 0) return '';

    const tsType = this.backend.timestampType();
    const now = this.backend.nowExpr();
    const transitions = this.project.system.transitions;
    const blocks: string[] = [];

    // Collect all states that need an update callback — either timed or periodic.
    const allSources = new Set([
      ...this.timedBySource.keys(),
      ...this.periodicBySource.keys(),
    ]);

    for (const flat of this.states) {
      if (!allSources.has(flat.index)) continue;

      const timedOwned = this.timedBySource.get(flat.index) || [];
      const periodicOwned = this.periodicBySource.get(flat.index) || [];

      const { since, tick } = this.timerNames(flat);
      const body: string[] = [];

      // "after:" clauses — one-shot timed transitions.
      // Unlike an event handler, an earlier unguarded candidate does NOT
      // shadow the ones after it: they are reached at different elapsed times.
      if (timedOwned.length > 0) {
        const elapsedLine = `  const ${tsType} elapsed = ${now} - ${since};`;
        const timedBody: string[] = [elapsedLine];

        for (const idx of timedOwned) {
          const t = transitions[idx];
          const guard = this.guards.get(idx);
          const target = this.states[this.resolveEntry(this.resolveRef(t.target!, 'target'))];
          const duration = typeof t.after === 'string'
            ? `(${tsType})systemParameters.${this.sanitize(t.after)}`
            : this.backend.durationLiteral(t.after ?? 0);
          const source = typeof t.after === 'string' ? `${t.after} (parameter)` : `${t.after} ms`;

          const calls = (t.actions || [])
            .map(a => `    action_${this.sanitize(a.name)}(&systemContext);`)
            .join('\n');

          const fire = [
            calls,
            `    fsm.transitionTo(${target.symbol});`,
            '    return;',
          ].filter(Boolean).join('\n');

          const condition = guard
            ? `elapsed >= ${duration} && ${guard.fnName}(&systemContext)`
            : `elapsed >= ${duration}`;

          timedBody.push(`  // after ${source} -> ${t.target}${guard ? ', if the guard allows' : ''}
  if (${condition}) {
${fire}
  }`);
        }
        body.push(...timedBody);
      }

      // "every:" clauses — repeating in-state callbacks.
      // Uses deadline-advance-by-interval to prevent drift (same as tasks:).
      if (periodicOwned.length > 0) {
        for (let i = 0; i < periodicOwned.length; i++) {
          const idx = periodicOwned[i];
          const t = transitions[idx];
          const guard = this.guards.get(idx);
          const interval = typeof t.every === 'string'
            ? `(${tsType})systemParameters.${this.sanitize(t.every)}`
            : this.backend.durationLiteral(t.every ?? 0);
          const source = typeof t.every === 'string' ? `${t.every} (parameter)` : `every ${t.every} ms`;

          const dueVar = `dueAt_${this.sanitize(flat.path)}_${i}`;

          const calls = (t.actions || [])
            .map(a => `    action_${this.sanitize(a.name)}(&systemContext);`)
            .join('\n');

          const guardCheck = guard ? `\n  if (!${guard.fnName}(&systemContext)) { ${dueVar} += _iv_${i}; return; }` : '';
          const intervalVar = `_iv_${i}`;

          body.push(`  // ${source}
  {
    const ${tsType} ${intervalVar} = ${interval};
    if (${now} - ${dueVar} >= ${intervalVar}) {
      ${dueVar} += ${intervalVar};
      if (${now} - ${dueVar} >= ${intervalVar}) ${dueVar} = ${now};${guardCheck}
${calls}
    }
  }`);
        }
      }

      // "every:" deadline globals (one per periodic transition; survive state re-entry).
      const periodicGlobals = periodicOwned.map((_, i) =>
        `static ${tsType} dueAt_${this.sanitize(flat.path)}_${i} = 0;`
      ).join('\n');

      const hasTimed = timedOwned.length > 0;

      // Only emit the entry-timestamp global when "after:" is present.
      const sinceGlobal = hasTimed ? `static ${tsType} ${since} = 0;\n` : '';

      // Entry callback: stamps the clock (for "after:") and runs any entry:
      // actions declared on the state.  Generated here for timed states;
      // generateEntryExitCallbacks() covers states that only have entry actions.
      const entryName = this.entryCallbackName(flat);
      const entryActionCalls = (flat.state?.entry ?? [])
        .map(a => `  action_${this.sanitize(a.name)}(&systemContext);`)
        .join('\n');
      const entryFnBody = [
        entryActionCalls ? `  syncContext();\n${entryActionCalls}` : null,
        hasTimed ? `  ${since} = ${now};` : null,
      ].filter(Boolean).join('\n');
      const entryFn = entryName ? `static void ${entryName}() {\n${entryFnBody}\n}\n\n` : '';

      blocks.push(`// Update tick for "${flat.path}".
${sinceGlobal}${periodicGlobals}

${entryFn}static void ${tick}() {
  syncContext();

${body.join('\n\n')}
}`);
    }

    return `// ============================================================================
// TIMED AND PERIODIC TRANSITIONS
// ============================================================================
//
// "after:" generates a one-shot timed transition. Ancestors tick before their
// active child, so when both a state and its parent time out on the same pass
// the inner one wins - the same precedence event handling already has.
//
// "every:" runs actions on a repeating interval while the machine stays in
// that state. Uses deadline-advance-by-interval to prevent drift.
//
// Subtraction on unsigned long is correct across the millis() rollover.

${blocks.join('\n\n')}`;
  }

  /**
   * Generate entry and exit callbacks for states that declare `entry:` or
   * `exit:` actions but have no timed/periodic transitions.
   *
   * Timed states have their entry callback merged into generateTimeouts() so
   * the clock stamp and entry actions appear in a single function.  Exit
   * callbacks are always generated here since PulseHSM has no exit equivalent
   * of the timer tick.
   */
  private generateEntryExitCallbacks(): string {
    if (!this.hasMachine) return '';

    const blocks: string[] = [];

    for (const flat of this.states) {
      if (flat.state === null) continue;

      const hasTimed = (this.timedBySource.get(flat.index)?.length ?? 0) > 0;
      const entryActions = flat.state.entry ?? [];
      const exitActions  = flat.state.exit  ?? [];

      // Timed states handle their entry callback in generateTimeouts().
      if (!hasTimed && entryActions.length > 0) {
        const name  = this.entryCallbackName(flat)!;
        const calls = entryActions
          .map(a => `  action_${this.sanitize(a.name)}(&systemContext);`)
          .join('\n');
        blocks.push(`static void ${name}() {\n  syncContext();\n${calls}\n}`);
      }

      if (exitActions.length > 0) {
        const name  = this.exitCallbackName(flat)!;
        const calls = exitActions
          .map(a => `  action_${this.sanitize(a.name)}(&systemContext);`)
          .join('\n');
        blocks.push(`static void ${name}() {\n  syncContext();\n${calls}\n}`);
      }
    }

    if (blocks.length === 0) return '';

    return `// ============================================================================
// ENTRY AND EXIT ACTIONS
// ============================================================================
//
// Called once when the machine enters or exits a state. syncContext() runs
// first so the action stub sees consistent sensor readings.

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
    ${this.backend.printlnExpr(stream, '"FATAL: PulseHSM refused a state - its table is too small."')};
    ${this.backend.printlnExpr(stream, '"       Keep PulseHSM_config.h beside PulseHSM.h and rebuild."')};
  }
`;
  }

  // =========================================================================
  // LOOP
  // =========================================================================

  private generateLoopFunction(): string {
    const body: string[] = [];

    // Diagnostics first: watchdog reset must fire every loop without fail.
    if (this.project.system.diagnostics) {
      body.push('  runDiagnostics();');
    }

    // Interface loop hooks (e.g. ArduinoOTA.handle()) — must run every tick.
    for (const emission of this.emissions.values()) {
      if (emission.loop && emission.loop.length > 0) {
        body.push(...emission.loop);
      }
    }

    // MQTT reconnect + message pump (must come before everything that may
    // dispatch events, so an incoming MQTT message can be acted on this tick).
    const mqttRes = this.mqttResource();
    if (mqttRes) {
      const client = this.mqttClientVar(mqttRes);
      const sensors = (this.project.system.components || []).filter(
        c => String(c.class) === 'sensor'
      );
      const telemetryDeclared = !!this.project.system.telemetry;
      // When telemetry: is declared, sensors are published by runTelemetry() at
      // per-channel intervals; publishMqtt() is only needed for machine state.
      const hasPublications = (!telemetryDeclared && sensors.length > 0) || this.hasMachine;
      body.push(
        `  // Maintain MQTT connection and pump incoming messages.`,
        `  {`,
        `    static ${this.backend.timestampType()} _mqttReconnectAt = 0;`,
        `    if (!${client}.connected() && ${this.backend.nowExpr()} - _mqttReconnectAt >= ${this.backend.durationLiteral(5000)}) {`,
        `      _mqttReconnectAt = ${this.backend.nowExpr()};`,
        `      connectMqtt();`,
        `    }`,
        `    ${client}.loop();`,
        `  }`,
      );
      if (hasPublications) {
        body.push(
          `  // Publish sensor readings and state periodically.`,
          `  {`,
          `    static ${this.backend.timestampType()} _mqttPublishAt = 0;`,
          `    if (${this.backend.nowExpr()} - _mqttPublishAt >= ${this.backend.durationLiteral(5000)}) {`,
          `      _mqttPublishAt = ${this.backend.nowExpr()};`,
          `      publishMqtt();`,
          `    }`,
          `  }`,
        );
      }
      if (telemetryDeclared) {
        body.push(`  runTelemetry();`);
      }
    }

    // Sensor reads come first: guards and actions in the same pass see fresh values.
    const hasPinSensors = (this.project.system.components || []).some(
      c => String(c.class) === 'sensor' &&
           (c.type === 'analog_input' || c.type === 'digital_input')
    );
    if (hasPinSensors) body.push('  readSensors();');

    if (this.project.system.commands) body.push('  pollCommands();');

    for (const task of this.project.system.tasks || []) {
      const base = this.sanitize(task.name);
      // Native-timer tasks (k_timer on Zephyr) fire autonomously; no poll call.
      if (!this.nativeTimerBases.has(base)) {
        body.push(`  runTask_${base}();`);
      }
    }

    if (this.hasMachine) {
      const example = this.project.system.events[0];
      const exampleName = example ? `EVENT_${this.sanitizeUpper(example.name)}` : 'EVENT_NONE';

      // When readSensors() already covers all sensors, the TODO shrinks to
      // just "raise events based on the readings you now have".
      const sensorComment = hasPinSensors
        ? `  // TODO: Raise events from the readings readSensors() just populated.
  // Example:
  //   if (systemSensors.temp >= systemParameters.setpoint) {
  //     fsm.sendEvent(${exampleName});
  //   }
  //
  // sendEvent() is ISR-safe, so interrupts may call it directly.`
        : `  // TODO: Read sensors into systemSensors, then raise events.
  // Example:
  //   systemSensors.temperature = readTemperature();
  //   if (systemSensors.temperature >= systemParameters.setpoint) {
  //     fsm.sendEvent(${exampleName});
  //   }
  //
  // sendEvent() is ISR-safe, so interrupts may call it directly.`;

      body.push(`${sensorComment}

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

    // Safety checks run first: a critical fault must act before anything else.
    const safetyCall = this.project.system.safety ? '  runSafetyChecks();\n' : '';

    const loopBody = `${safetyCall}${sync}${body.join('\n')}`;

    return `// ============================================================================
// MAIN LOOP
// ============================================================================
//
// Never call delay() here: it stops everything below it from running.

${this.backend.renderLoop(loopBody)}`;
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
        ? `  ${this.backend.printlnExpr(this.consoleStream(), `"  -> Action: ${name}"`)};` + '\n'
        : '';

      const body = this.actionBody(action);

      return `void action_${this.sanitize(name)}(SystemContext* ctx) {
${trace}  // Declared params for this action (documentation only):
${paramDoc}
${this.contextDoc()}  //
${body}
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

    // State entry/exit actions (inline or from catalogue).
    const collectState = (state: State) => {
      collect(state.entry, `State "${state.name}" entry`);
      collect(state.exit,  `State "${state.name}" exit`);
      for (const region of state.regions || []) region.states.forEach(collectState);
    };
    for (const state of this.project.system.states || []) collectState(state);

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

      // Periodic ("every") transitions have no target — they stay in place.
      // Validate the target only for transitions that actually leave the state.
      if (t.every === undefined) {
        this.resolveEntry(this.resolveRef(t.target!, 'target'));
      }

      // Timed transitions never reach an onEvent handler - no event arrives -
      // so they are collected separately and become the state's update tick.
      // Periodic transitions similarly land in the update tick.
      const bucket = t.after !== undefined ? this.timedBySource
                   : t.every !== undefined ? this.periodicBySource
                   : this.transitionsBySource;
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

  /** True when channelName comes from an RTC device (values are integers, not floats). */
  private isRtcChannel(channelName: string): boolean {
    for (const c of this.project.system.components ?? []) {
      if (c.driver !== 'rtc_read') continue;
      if (c.channels?.some(ch => ch.name === channelName)) return true;
    }
    return false;
  }

  /**
   * Convert an lcd format template (e.g. "{hour}:{minute}:{second}") into the
   * lines of code that write it to the display.
   *
   * RTC channels use %02d + (int) cast; other sensors use %.1f.
   * A literal % in the template is doubled for snprintf.
   * If the template has no {name} refs, print() is used directly.
   */
  private renderLcdLine(fmt: string, row: number, col: number, objVar: string, bufSize: number): string[] {
    const refs: string[] = [];
    // Collect refs to decide whether snprintf is needed.
    const refPattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = refPattern.exec(fmt)) !== null) refs.push(m[1]);

    const setCursor = `  ${objVar}.setCursor(${col}, ${row});`;

    if (refs.length === 0) {
      // Pure literal — no snprintf needed.
      const escaped = fmt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return [setCursor, `  ${objVar}.print("${escaped}");`];
    }

    // Build the snprintf format string and argument list.
    const snprintfFmt = fmt
      .replace(/%/g, '%%')   // escape literal % before we add our own
      .replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
        return this.isRtcChannel(name) ? '%02d' : '%.1f';
      });

    const args = refs.map(name =>
      this.isRtcChannel(name)
        ? `(int)systemSensors.${this.sanitize(name)}`
        : `systemSensors.${this.sanitize(name)}`
    );

    const escaped = snprintfFmt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return [
      `  char _lcd_buf[${bufSize}];`,
      `  snprintf(_lcd_buf, sizeof(_lcd_buf), "${escaped}", ${args.join(', ')});`,
      setCursor,
      `  ${objVar}.print(_lcd_buf);`,
    ];
  }
}

export { Codegen as default };
