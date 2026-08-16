/**
 * PlatformBackend — the seam between the IR traversal (Codegen) and every
 * target platform. Codegen owns "what to emit"; backends own "how the target
 * platform spells it".
 *
 * Each backend implements every method in this interface. Codegen calls through
 * it and never tests `if (backend.name === ...)`.
 */

import type { Resource, Library } from '../model/index.js';
import type { ImpliedLibrary, InterfaceEmission } from './interfaces.js';

/** Runtime sizing derived from the model; passed to platformIncludes(). */
export interface Sizing {
  maxStates: number;
  maxEvents: number;
  levels: number;
  stateCount: number;
}

export interface PlatformBackend {
  /** Identifier used in diagnostics and the generated file extension. */
  readonly name: string;

  /**
   * Extension for the main sketch file, including the dot.
   * Arduino uses ".ino"; a plain C++ backend would use ".cpp".
   */
  readonly fileExtension: string;

  /**
   * Everything that goes after the doc-comment preamble in the generated header:
   * sizing macros (when hasMachine is true) and platform include directives.
   */
  platformIncludes(hasMachine: boolean, sizing: Sizing): string;

  // ── Time ──────────────────────────────────────────────────────────────────

  /** Expression that returns the current millisecond count. */
  nowExpr(): string;

  /** C type for storing a millisecond timestamp or duration. */
  timestampType(): string;

  /**
   * Format a numeric millisecond literal for use in comparisons against nowExpr().
   * Arduino: `250UL`; Zephyr/ESP-IDF: `INT64_C(250)`.
   */
  durationLiteral(ms: number): string;

  /**
   * Variable/macro name for a GPIO pin, given the sanitized-upper device symbol.
   * Arduino/ESP-IDF: `${sym}_PIN` (numeric `#define`).
   * Zephyr Phase 2:  `${sym}_GPIO` (`gpio_dt_spec` struct name).
   */
  gpioPinVar(sym: string): string;

  // ── Console ───────────────────────────────────────────────────────────────

  /** The C identifier for the UART stream on a given port number. */
  consoleStreamName(port: number): string;

  /** `stream.print(value)` — value is already a valid C expression. */
  printExpr(stream: string, value: string): string;

  /** `stream.println(value)` — value is already a valid C expression. */
  printlnExpr(stream: string, value: string): string;

  /** `stream.println()` — the no-argument form that just emits a newline. */
  printlnNoArgExpr(stream: string): string;

  /** `stream.available()` */
  streamAvailableExpr(stream: string): string;

  /** `stream.read()` */
  streamReadExpr(stream: string): string;

  // ── GPIO / ADC / PWM ──────────────────────────────────────────────────────

  /** `digitalWrite(pin, value)` — no semicolon; caller appends it. */
  digitalWriteExpr(pin: string, value: string): string;

  /** `digitalRead(pin)` — no semicolon; usable inside larger expressions. */
  digitalReadExpr(pin: string): string;

  /** `analogRead(pin)` — no semicolon; usable inside larger expressions. */
  analogReadExpr(pin: string): string;

  /** `analogWrite(pin, duty)` — no semicolon; caller appends it. */
  analogWriteExpr(pin: string, duty: string): string;

  /**
   * Multi-line block for a PWM write, without a trailing `(void)ctx;`.
   * Caller appends `\n  (void)ctx;`.
   *
   * Arduino emits an `#ifdef ARDUINO_ARCH_ESP32` guard covering both LEDC
   * API generations; other backends emit their own write call.
   */
  ledcWriteLines(pin: string, channel: string, duty: string, board: string): string;

  // ── Hardware interfaces ───────────────────────────────────────────────────

  /** Translate a declared resource to the lines it contributes to the sketch. */
  emitInterface(resource: Resource, symbol: string): InterfaceEmission;

  /** Normalise model-declared libraries for the includes section. */
  declaredLibraries(libraries: Library[] | undefined): ImpliedLibrary[];

  /**
   * The platform-specific comment inserted after the `// INTERFACES` banner.
   * Arduino notes the `#ifdef` portability guards; ESP-IDF has no such guards.
   * Must start with `//` (the leading `//\n` line is the caller's separator).
   */
  interfacesNote(): string;

  // ── Entry points ──────────────────────────────────────────────────────────

  /**
   * Function prototype declarations that the generated shared header must
   * expose so other translation units (guards.cpp, actions.cpp) can see them.
   *
   * Arduino: `void setup(); void loop(); void setupInterfaces();`
   * ESP-IDF: `extern "C" void app_main(void); void setupInterfaces();`
   */
  entryPointDeclarations(): string;

  /**
   * Wrap a body string in the platform's initialisation entry point.
   * Arduino: `void setup() {\nbody}`.
   * body already ends with `\n`, so no extra newline is needed before `}`.
   */
  renderSetup(body: string): string;

  /**
   * Wrap a body string in the platform's main loop entry point.
   * Arduino: `void loop() {\nbody\n}`.
   */
  renderLoop(body: string): string;
}
