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
  UART = "uart",
  I2C = "i2c",
  SPI = "spi",
  CAN = "can",
  MQTT = "mqtt",
  ONEWIRE = "onewire",
  CUSTOM = "custom",
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
  type: ActionType;
  driver: string;             // Driver or action name (e.g., "gpio_control", "publish_temp")
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
  binding?: Record<string, unknown>;  // Interface-specific bindings (pins, baudrate, topic, etc.)
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
  
  metadata?: Metadata;
}

// ============================================================================
// PROJECT - Top level
// ============================================================================

export interface PulseProject {
  name: string;
  version: string;
  description?: string;
  
  // The system
  system: PulseSystem;
  
  metadata?: Metadata;
}
