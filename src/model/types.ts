/**
 * PulseHSM Intermediate Representation - Core Types
 * 
 * These are the fundamental data structures that represent a system model.
 * They are intentionally simple and schema-agnostic.
 */

// ============================================================================
// ENUMS - Define the taxonomy
// ============================================================================

export enum StateType {
  SIMPLE = "simple",
  COMPOSITE = "composite",
  ORTHOGONAL = "orthogonal",
}

export enum EventSource {
  EXTERNAL = "external",      // User input, GPIO
  TIMER = "timer",            // Timer expiration
  SENSOR = "sensor",          // Sensor value change
  MQTT = "mqtt",              // MQTT message
  INTERNAL = "internal",      // Internal condition
  CUSTOM = "custom",          // Plugin-defined
}

export enum ActionType {
  DRIVER = "driver",          // Call a driver/plugin
  BUILTIN = "builtin",        // Reserved for future built-in actions
}

export enum ComponentClass {
  SENSOR = "sensor",
  ACTUATOR = "actuator",
  SERVICE = "service",
}

export enum InterfaceType {
  GPIO = "gpio",
  PWM = "pwm",
  ADC = "adc",
  UART = "uart",
  I2C = "i2c",
  SPI = "spi",
  CAN = "can",
  ONEWIRE = "onewire",
  WIFI = "wifi",
  ETHERNET = "ethernet",
  BLE = "ble",
  MQTT = "mqtt",
  CUSTOM = "custom",
}

/**
 * Where a library comes from. This tells a build system how to obtain it and
 * a generator whether to use `<angle>` or "quoted" includes.
 */
export enum LibrarySource {
  BUILTIN = "builtin",    // ships with the core toolchain (Wire, SPI, WiFi)
  REGISTRY = "registry",  // Arduino Library Manager / PlatformIO registry
  GIT = "git",
  LOCAL = "local",        // vendored beside the sketch
}

// ============================================================================
// METADATA - Attach extra info to anything
// ============================================================================

export interface Metadata {
  [key: string]: unknown;
}

// ============================================================================
// REFERENCES - Type-safe state/event references
// ============================================================================

/**
 * A state reference can be:
 * - "idle"                    (top-level state)
 * - "running/heating"         (nested state)
 * - "*"                       (wildcard: any state)
 */
export type StateRef = string;

/**
 * An event reference is just the event name
 */
export type EventRef = string;

// ============================================================================
// PARAMETERS - Configuration values
// ============================================================================

export interface Parameter {
  name: string;
  type: "float" | "int" | "bool" | "string";
  default: unknown;
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
  metadata?: Metadata;
}

// ============================================================================
// GUARDS - Conditions on transitions
// ============================================================================

/**
 * A guard is a *reference* to a user-written function, never a condition the
 * IR can evaluate.
 *
 * There is deliberately no expression field. Anything evaluable here would
 * grow into a programming language - precedence, scoping, type rules, error
 * messages - with no debugger and no IDE support, and it would be one more
 * dialect for a learner to pick up on top of the C they already need. The
 * condition lives in C, where it can be stepped through and type-checked.
 */
export interface Guard {
  name: string;               // user implements bool guard_<name>(const SystemContext*)
  description?: string;       // human-readable intent, copied into the stub. Never parsed.
  metadata?: Metadata;
}

// ============================================================================
// ACTIONS - Things that happen on transitions
// ============================================================================

export interface Action {
  /**
   * The action's identity, and the stub generated for it: `action_<name>`.
   * Several actions may share a driver, so this is what must be unique.
   */
  name: string;
  type: ActionType;
  driver: string;             // Implementing plugin (e.g., "gpio_control")
  params?: Record<string, unknown>;  // Driver-specific parameters
  metadata?: Metadata;
}

// ============================================================================
// EVENTS - System events
// ============================================================================

export interface Event {
  name: string;
  source: EventSource;
  payload?: Record<string, unknown>;  // Event schema (optional)
  description?: string;
  metadata?: Metadata;
}

// ============================================================================
// STATES - The core HSM building blocks
// ============================================================================

export interface State {
  name: string;
  type: StateType;
  description?: string;
  
  // For COMPOSITE states
  initial?: StateRef;         // Initial child state
  regions?: Region[];         // For COMPOSITE/ORTHOGONAL
  
  metadata?: Metadata;
}

/**
 * A region is a container of states (for hierarchical and orthogonal decomposition)
 */
export interface Region {
  name?: string;              // Optional region name
  initial: StateRef;          // Initial state in this region
  states: State[];            // Child states
}

// ============================================================================
// TRANSITIONS - State changes
// ============================================================================

export interface Transition {
  source: StateRef;
  target: StateRef;
  event: EventRef;
  guard?: Guard;
  actions?: Action[];
  description?: string;
  metadata?: Metadata;
}

// ============================================================================
// COMPONENTS - Sensors, actuators, services
// ============================================================================

export interface Component {
  name: string;
  class: ComponentClass;
  driver: string;             // Driver plugin name (e.g., "ds18b20", "gpio_control")
  /**
   * Logical device type from the model's `hardware.devices`, e.g.
   * "digital_output" or "ds18b20". Built-in types imply a class and a driver,
   * so the application can refer to `pump` without knowing a pin exists.
   */
  type?: string;
  /** Name of the bus this device sits on, for shared buses like I2C. */
  bus?: string;
  config?: Record<string, unknown>;
  description?: string;
  metadata?: Metadata;
}

// ============================================================================
// RESOURCES - Hardware interfaces
// ============================================================================

export interface Resource {
  name: string;
  interface: InterfaceType;
  /**
   * Interface-specific settings: pins, baud rate, bus frequency, host.
   *
   * These are declarative facts about how the board is wired, never peripheral
   * logic. A backend translates them into whatever its platform requires -
   * `Wire.begin(sda, scl)` on Arduino, `i2c_param_config()` on ESP-IDF - so
   * the model itself stays platform-agnostic.
   *
   * Credential-shaped keys (password, token, key, secret...) are deliberately
   * NOT baked into generated code; see Library and the codegen notes.
   */
  binding?: Record<string, unknown>;
  /** Name of a declared Library this interface needs, when not implied. */
  library?: string;
  description?: string;
  metadata?: Metadata;
}

// ============================================================================
// LIBRARIES - Third-party code the generated sketch depends on
// ============================================================================

/**
 * A library the generated code needs. The model declares *what* is required;
 * how to obtain it is left to the build system, and how to call it is left to
 * the user's driver code.
 *
 * Libraries implied by an interface (Wire for I2C, SPI for SPI) do not need
 * declaring - each backend knows its own platform's built-ins.
 */
export interface Library {
  name: string;               // "PubSubClient"
  /** Header to include, e.g. "PubSubClient.h". Defaults to `<name>.h`. */
  include?: string;
  /** Version constraint for the build system, e.g. "^2.8". */
  version?: string;
  source?: LibrarySource;
  /** Repository or path, for GIT and LOCAL sources. */
  url?: string;
  description?: string;
  metadata?: Metadata;
}

// ============================================================================
// SYSTEM - The main model
// ============================================================================

export interface PulseSystem {
  name: string;
  version?: string;
  description?: string;
  
  // HSM core
  events: Event[];
  states: State[];
  transitions: Transition[];
  
  // System components and resources
  components?: Component[];
  resources?: Resource[];
  parameters?: Parameter[];
  libraries?: Library[];
  
  metadata?: Metadata;
}

// ============================================================================
// PROJECT - Top level
// ============================================================================

/**
 * What the model is built for.
 *
 * The board name selects a backend's board profile - which pins exist, what
 * they can do - so the compiler can reject a design before it reaches a bench.
 * It does not make the *output* portable on its own: a backend still targets
 * one toolchain family.
 */
export interface Target {
  board?: string;             // "esp32", "esp32s3", ...
  description?: string;
  metadata?: Metadata;
}

export interface PulseProject {
  name: string;
  version: string;
  description?: string;

  target?: Target;

  // The system
  system: PulseSystem;

  metadata?: Metadata;
}
