/**
 * Arduino platform backend for PulseIR.
 *
 * Translates platform-agnostic primitives from PlatformBackend into
 * Arduino-specific API calls, types and include directives.
 *
 * Hardware interface initialisation (Wire.begin, SPI.begin, etc.) is
 * delegated to the existing InterfaceBackend, which already knows the full
 * board-portability story for each bus type.
 */

import type { Resource, Library } from '../model/index.js';
import { InterfaceBackend } from './interfaces.js';
import type { ImpliedLibrary, InterfaceEmission } from './interfaces.js';
import type { PlatformBackend, Sizing } from './backend.js';

export class ArduinoBackend implements PlatformBackend {
  readonly name = 'arduino';
  readonly fileExtension = '.ino';

  private readonly interfaces = new InterfaceBackend();

  platformIncludes(hasMachine: boolean, sizing: Sizing): string {
    if (!hasMachine) {
      return '#include <Arduino.h>';
    }

    const { maxStates, maxEvents, levels, stateCount } = sizing;
    return [
      '// Sized from the model, and repeated in PulseHSM_config.h so that PulseHSM.cpp',
      '// - a separate translation unit that never sees this file - is compiled',
      '// against the same table sizes. Defining them only here would leave the',
      '// runtime on its defaults, and states past the eighth would be silently',
      '// dropped. Generate with --outdir to get that file written for you.',
      `#define PULSEHSM_MAX_STATES  ${maxStates}   // ${stateCount} states + headroom`,
      `#define PULSEHSM_MAX_EVENTS  ${maxEvents}   // ring buffer, must be a power of two`,
      `#define PULSEHSM_MAX_DEPTH   ${levels}   // deepest nesting, including the leaf`,
      '',
      '#include <Arduino.h>',
      '#include "PulseHSM.h"',
    ].join('\n');
  }

  nowExpr(): string { return 'millis()'; }
  timestampType(): string { return 'unsigned long'; }

  consoleStreamName(port: number): string {
    return port === 0 ? 'Serial' : `Serial${port}`;
  }

  printExpr(stream: string, value: string): string {
    return `${stream}.print(${value})`;
  }

  printlnExpr(stream: string, value: string): string {
    return `${stream}.println(${value})`;
  }

  printlnNoArgExpr(stream: string): string {
    return `${stream}.println()`;
  }

  streamAvailableExpr(stream: string): string {
    return `${stream}.available()`;
  }

  streamReadExpr(stream: string): string {
    return `${stream}.read()`;
  }

  digitalWriteExpr(pin: string, value: string): string {
    return `digitalWrite(${pin}, ${value})`;
  }

  digitalReadExpr(pin: string): string {
    return `digitalRead(${pin})`;
  }

  analogReadExpr(pin: string): string {
    return `analogRead(${pin})`;
  }

  analogWriteExpr(pin: string, duty: string): string {
    return `analogWrite(${pin}, ${duty})`;
  }

  ledcWriteLines(pin: string, channel: string, duty: string, _board: string): string {
    return [
      '#ifdef ARDUINO_ARCH_ESP32',
      '#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3',
      `  ledcWrite(${pin}, ${duty});`,
      '#else',
      `  ledcWrite(${channel}, ${duty});`,
      '#endif',
      '#else',
      `  analogWrite(${pin}, ${duty});`,
      '#endif',
    ].join('\n');
  }

  emitInterface(resource: Resource, symbol: string): InterfaceEmission {
    return this.interfaces.emit(resource, symbol);
  }

  declaredLibraries(libraries: Library[] | undefined): ImpliedLibrary[] {
    return this.interfaces.declared(libraries);
  }

  renderSetup(body: string): string {
    return `void setup() {\n${body}}`;
  }

  renderLoop(body: string): string {
    return `void loop() {\n${body}\n}`;
  }
}
