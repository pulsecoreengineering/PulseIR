/**
 * ESP-IDF platform backend for PulseIR.
 *
 * Targets Espressif's IoT Development Framework (v4.x / v5.x) running on
 * ESP32-family chips. The generated sketch is a standard C++ translation
 * unit (`.cpp`) whose entry point is `app_main()` — the FreeRTOS task the
 * bootloader hands control to.
 *
 * Key differences from the Arduino backend:
 *   - Timing:   esp_timer_get_time() returns µs; we divide by 1000 → int64_t ms.
 *   - GPIO:     gpio_set_level() / gpio_get_level() with gpio_num_t casts.
 *   - ADC:      adc1_get_raw() (legacy driver); users should replace with
 *               adc_oneshot_read() on IDF ≥ 5.0.
 *   - PWM:      ledc_set_duty() + ledc_update_duty() (no analogWrite).
 *   - Console:  printf() via static-inline helpers; no stream object.
 *   - Entry:    void app_main(void) with a FreeRTOS for(;;) loop.
 */

import type { Resource, Library } from '../model/index.js';
import { EspIdfInterfaceBackend } from './espidf_interfaces.js';
import type { ImpliedLibrary, InterfaceEmission } from './interfaces.js';
import type { PlatformBackend, Sizing } from './backend.js';

export class EspIdfBackend implements PlatformBackend {
  readonly name = 'espidf';
  readonly fileExtension = '.cpp';

  private readonly interfaces = new EspIdfInterfaceBackend();

  platformIncludes(hasMachine: boolean, sizing: Sizing): string {
    const sizingBlock = hasMachine
      ? [
          '// Sized from the model, and repeated in PulseHSM_config.h so that PulseHSM.cpp',
          '// - a separate translation unit that never sees this file - is compiled',
          '// against the same table sizes. Defining them only here would leave the',
          '// runtime on its defaults, and states past the eighth would be silently',
          '// dropped. Generate with --outdir to get that file written for you.',
          `#define PULSEHSM_MAX_STATES  ${sizing.maxStates}   // ${sizing.stateCount} states + headroom`,
          `#define PULSEHSM_MAX_EVENTS  ${sizing.maxEvents}   // ring buffer, must be a power of two`,
          `#define PULSEHSM_MAX_DEPTH   ${sizing.levels}   // deepest nesting, including the leaf`,
          '',
        ]
      : [];

    const idfHeaders = [
      '#include "freertos/FreeRTOS.h"',
      '#include "freertos/task.h"',
      '#include "esp_timer.h"',
      '#include "driver/gpio.h"',
      '#include "driver/uart.h"',
      '#include "driver/adc.h"    // legacy ADC driver; IDF ≥5.0: esp_adc/adc_oneshot.h',
      '#include "driver/ledc.h"',
      '#include "esp_log.h"',
      hasMachine ? '#include "PulseHSM.h"' : '',
    ].filter(Boolean);

    // Static-inline console helpers let Codegen emit the same printExpr /
    // printlnExpr calls regardless of platform. The two overloads cover the
    // two types the generator actually emits: const char* and float.
    const consoleHelpers = [
      '',
      '// Console helpers — route PulseIR print calls through printf.',
      '// Overloads cover const char* (log text) and float (sensor readings).',
      'static inline void pulseIrPrint(const char *s)  { printf("%s",  s); }',
      'static inline void pulseIrPrint(float f)        { printf("%g",  f); }',
      'static inline void pulseIrPrintln(const char *s){ printf("%s\\n", s); }',
      'static inline void pulseIrPrintln(float f)      { printf("%g\\n", f); }',
      'static inline void pulseIrPrintlnEmpty()        { printf("\\n"); }',
      '',
      '// UART helpers for the command dispatcher (commands: in the model).',
      'static inline int pulseIrUartAvailable(uart_port_t port) {',
      '  size_t len = 0;',
      '  uart_get_buffered_data_len(port, &len);',
      '  return (int)len;',
      '}',
      'static inline int pulseIrUartRead(uart_port_t port) {',
      '  uint8_t b;',
      '  return uart_read_bytes(port, &b, 1, 0) == 1 ? (int)b : -1;',
      '}',
    ];

    return [...sizingBlock, ...idfHeaders, ...consoleHelpers].join('\n');
  }

  nowExpr(): string   { return '(esp_timer_get_time() / 1000LL)'; }
  timestampType(): string { return 'int64_t'; }
  durationLiteral(ms: number): string { return `INT64_C(${ms})`; }

  consoleStreamName(port: number): string {
    return port === 0 ? 'UART_NUM_0' : `UART_NUM_${port}`;
  }

  // The stream parameter is ignored — ESP-IDF routes all console output
  // through printf (via pulseIrPrint* helpers); there is no stream object.
  printExpr(_stream: string, value: string): string {
    return `pulseIrPrint(${value})`;
  }

  printlnExpr(_stream: string, value: string): string {
    return `pulseIrPrintln(${value})`;
  }

  printlnNoArgExpr(_stream: string): string {
    return 'pulseIrPrintlnEmpty()';
  }

  streamAvailableExpr(stream: string): string {
    return `pulseIrUartAvailable(${stream})`;
  }

  streamReadExpr(stream: string): string {
    return `pulseIrUartRead(${stream})`;
  }

  digitalWriteExpr(pin: string, value: string): string {
    return `gpio_set_level((gpio_num_t)(${pin}), (uint32_t)(${value}))`;
  }

  digitalReadExpr(pin: string): string {
    return `gpio_get_level((gpio_num_t)(${pin}))`;
  }

  analogReadExpr(pin: string): string {
    // adc1_channel_t and GPIO numbers are not the same on ESP32. The cast
    // is best-effort; users should replace it with the correct ADC1_CHANNEL_N
    // enum value for their pin. See espidf_interfaces.ts for the TODO note.
    return `adc1_get_raw((adc1_channel_t)(${pin}))`;
  }

  analogWriteExpr(pin: string, duty: string): string {
    // No analogWrite in ESP-IDF; use LEDC. The channel is inferred from the
    // pin number via a cast — works only if the model declares a pwm resource
    // with a matching channel binding. For direct GPIO PWM, ledcWriteLines
    // is the canonical path.
    return `ledc_set_duty_and_update(LEDC_HIGH_SPEED_MODE, (ledc_channel_t)(${pin}), (uint32_t)(${duty}), 0)`;
  }

  ledcWriteLines(pin: string, channel: string, duty: string, _board: string): string {
    // ESP-IDF LEDC requires two calls: set duty, then trigger the update.
    // The channel number is used (not the pin), because LEDC channels are
    // addressed independently of GPIO numbers.
    return [
      `  ledc_set_duty(LEDC_HIGH_SPEED_MODE, (ledc_channel_t)(${channel}), (uint32_t)(${duty}));`,
      `  ledc_update_duty(LEDC_HIGH_SPEED_MODE, (ledc_channel_t)(${channel}));`,
    ].join('\n');
  }

  emitInterface(resource: Resource, symbol: string): InterfaceEmission {
    return this.interfaces.emit(resource, symbol);
  }

  declaredLibraries(libraries: Library[] | undefined): ImpliedLibrary[] {
    return this.interfaces.declared(libraries);
  }

  interfacesNote(): string {
    return '// Resource macros and driver init calls for the hardware declared in the model.';
  }

  entryPointDeclarations(): string {
    return [
      '// ESP-IDF entry point (called by the FreeRTOS scheduler at boot).',
      'extern "C" void app_main(void);',
      'void setupInterfaces();',
    ].join('\n');
  }

  renderSetup(body: string): string {
    // _setup() is a static helper called once from app_main; it does not need
    // to be in the shared header, and static linkage keeps it out of the
    // link-time symbol table.
    return `static void _setup() {\n${body}}`;
  }

  renderLoop(body: string): string {
    // Re-indent the loop body by one level so it sits correctly inside the
    // for(;;) block, which is itself inside app_main.
    const indented = body
      .split('\n')
      .map(line => (line === '' ? '' : `  ${line}`))
      .join('\n');

    return [
      'extern "C" void app_main(void) {',
      '  _setup();',
      '  for (;;) {',
      indented,
      '    vTaskDelay(pdMS_TO_TICKS(1));',
      '  }',
      '}',
    ].join('\n');
  }
}
