/**
 * Zephyr RTOS platform backend for PulseIR.
 *
 * Generates a west-compatible C++ project that targets any Zephyr-supported
 * board. Phase 1 compiles on native_sim with no hardware required.
 *
 * Key differences from the Arduino and ESP-IDF backends:
 *   - Timing:   k_uptime_get() returns int64_t milliseconds directly.
 *   - GPIO:     Phase 1 uses gpio_pin_set(DEVICE_DT_GET(DT_NODELABEL(gpio0)), pin, v).
 *               Phase 2 will upgrade to gpio_dt_spec + gpio_pin_set_dt().
 *   - Console:  printk() — no stream object, no printf format string width.
 *               Two static-inline overloads bridge the printExpr / printlnExpr
 *               calls Codegen emits regardless of platform.
 *   - UART:     uart_poll_in() / uart_poll_out() for command dispatching.
 *   - Entry:    int main(void) — _setup() once, then while(1) with k_msleep(1).
 *   - Tasks:    Phase 1 uses the Arduino-style polling check inherited from
 *               Codegen's loop body. Phase 3 will replace this with
 *               k_timer + k_work_submit to the system workqueue.
 */

import type { Resource, Library } from '../model/index.js';
import { ZephyrInterfaceBackend } from './zephyr_interfaces.js';
import type { ImpliedLibrary, InterfaceEmission } from './interfaces.js';
import type { PlatformBackend, Sizing } from './backend.js';

export class ZephyrBackend implements PlatformBackend {
  readonly name = 'zephyr';
  readonly fileExtension = '.cpp';

  private readonly interfaces = new ZephyrInterfaceBackend();

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

    const zephyrHeaders = [
      '#include <zephyr/kernel.h>',
      '#include <zephyr/drivers/gpio.h>',
      '#include <zephyr/drivers/uart.h>',
      hasMachine ? '#include "PulseHSM.h"' : '',
    ].filter(Boolean);

    // printk() supports %s and %g-style floats on most Zephyr configs, but the
    // safest path is static-inline wrappers that match the printExpr /
    // printlnExpr calls Codegen emits regardless of platform.
    const consoleHelpers = [
      '',
      '// Console helpers — route PulseIR print calls through printk.',
      'static inline void pulseIrPrint(const char *s)   { printk("%s", s); }',
      'static inline void pulseIrPrint(float f)         { printk("%d", (int)(f * 100)); } // x100 int',
      'static inline void pulseIrPrintln(const char *s) { printk("%s\\n", s); }',
      'static inline void pulseIrPrintln(float f)       { printk("%d\\n", (int)(f * 100)); }',
      'static inline void pulseIrPrintlnEmpty()         { printk("\\n"); }',
      '',
      '// UART helpers for the command dispatcher (commands: in the model).',
      '// uart_poll_in returns 0 on success (byte ready), negative on failure.',
      'static inline int pulseIrUartAvailable(const struct device *dev) {',
      '  unsigned char c;',
      '  return uart_poll_in(dev, &c) == 0 ? 1 : 0;',
      '}',
      'static inline int pulseIrUartRead(const struct device *dev) {',
      '  unsigned char c = 0;',
      '  return uart_poll_in(dev, &c) == 0 ? (int)c : -1;',
      '}',
    ];

    return [...sizingBlock, ...zephyrHeaders, ...consoleHelpers].join('\n');
  }

  // ── Time ────────────────────────────────────────────────────────────────────

  nowExpr(): string      { return 'k_uptime_get()'; }
  timestampType(): string { return 'int64_t'; }

  // ── Console ──────────────────────────────────────────────────────────────────

  // Phase 1: named Zephyr UART devices. Real models should declare
  //   hardware: buses: console: { interface: uart, port: 0 }
  // which generates #define CONSOLE_PORT 0 and resolves to uart0.
  consoleStreamName(port: number): string {
    return `DEVICE_DT_GET(DT_NODELABEL(uart${port}))`;
  }

  // Stream parameter unused — all output goes through printk helpers.
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

  // ── GPIO / ADC / PWM ────────────────────────────────────────────────────────

  // Phase 1: raw gpio_pin_set via DEVICE_DT_GET(DT_NODELABEL(gpio0)).
  // Phase 2 will use gpio_dt_spec: if pin ends in _PIN, derive _GPIO variable
  // and call gpio_pin_set_dt(&SYMBOL_GPIO, value).
  digitalWriteExpr(pin: string, value: string): string {
    return `gpio_pin_set(DEVICE_DT_GET(DT_NODELABEL(gpio0)), (gpio_pin_t)(${pin}), (int)(${value}))`;
  }

  digitalReadExpr(pin: string): string {
    return `gpio_pin_get(DEVICE_DT_GET(DT_NODELABEL(gpio0)), (gpio_pin_t)(${pin}))`;
  }

  analogReadExpr(pin: string): string {
    // ADC in Zephyr uses adc_read() with a sequence descriptor; a direct
    // analogRead equivalent does not exist. Phase 3 will generate the full
    // adc_sequence flow. For now, emit a zero with a TODO comment.
    return `/* TODO: adc_read() sequence needed for pin ${pin} */ 0`;
  }

  analogWriteExpr(pin: string, duty: string): string {
    // PWM in Zephyr uses pwm_set_dt() or pwm_set_cycles(); Phase 3.
    return `/* TODO: pwm_set_dt() needed for pin ${pin}, duty ${duty} */ (void)0`;
  }

  // Phase 3 will generate pwm_set_dt() here with proper DT node resolution.
  ledcWriteLines(pin: string, _channel: string, duty: string, _board: string): string {
    return `  /* TODO: pwm_set_dt() for ${pin} duty=${duty} — Phase 3 */`;
  }

  // ── Hardware interfaces ───────────────────────────────────────────────────

  emitInterface(resource: Resource, symbol: string): InterfaceEmission {
    return this.interfaces.emit(resource, symbol);
  }

  declaredLibraries(libraries: Library[] | undefined): ImpliedLibrary[] {
    return this.interfaces.declared(libraries);
  }

  interfacesNote(): string {
    return [
      '// Zephyr driver initialisations for the hardware declared in the model.',
      '// Phase 1: GPIO uses DEVICE_DT_GET(DT_NODELABEL(gpio0)) — no app.overlay needed.',
      '// Phase 2 will upgrade GPIO to gpio_dt_spec + app.overlay devicetree aliases.',
    ].join('\n');
  }

  // ── Entry points ──────────────────────────────────────────────────────────

  entryPointDeclarations(): string {
    return [
      '// Zephyr entry point.',
      'int main(void);',
      'void setupInterfaces();',
    ].join('\n');
  }

  renderSetup(body: string): string {
    // _setup() is a file-scope helper called once from main(); static linkage
    // keeps it out of the link-time symbol table.
    return `static void _setup() {\n${body}}`;
  }

  renderLoop(body: string): string {
    // Re-indent the loop body by one level to sit correctly inside while(1).
    const indented = body
      .split('\n')
      .map(line => (line === '' ? '' : `  ${line}`))
      .join('\n');

    return [
      'int main(void) {',
      '  _setup();',
      '  while (1) {',
      indented,
      '    k_msleep(1);',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
  }
}
