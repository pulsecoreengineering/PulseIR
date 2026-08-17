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
      '#include <zephyr/drivers/pwm.h>',
      '#include <zephyr/drivers/uart.h>',
      '#include <zephyr/net/net_if.h>',
      '#include <zephyr/net/wifi_mgmt.h>',
      '#include <zephyr/net/mqtt.h>',
      '#include <zephyr/net/http/client.h>',
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
  durationLiteral(ms: number): string { return `INT64_C(${ms})`; }
  gpioPinVar(sym: string): string { return `${sym}_GPIO`; }

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

  // Phase 2: gpio_dt_spec — pin is a SYMBOL_GPIO variable declared in globals.
  // app.overlay provides the gpio0 node bindings; west build resolves them.
  digitalWriteExpr(pin: string, value: string): string {
    return `gpio_pin_set_dt(&${pin}, (int)(${value}))`;
  }

  digitalReadExpr(pin: string): string {
    return `gpio_pin_get_dt(&${pin})`;
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

  ledcWriteLines(pin: string, _channel: string, duty: string, _board: string): string {
    // Fallback for callers that still use ledcWriteLines directly (none in Phase 3+).
    return `  /* TODO: pwm_set_dt() for ${pin} duty=${duty} */`;
  }

  pwmWriteLines(sym: string, freqMacro: string, resMacro: string, dutyExpr: string, _board: string): string {
    // pwm_set_dt(spec, period_ns, pulse_ns)
    // PWM_HZ(freq) = 1_000_000_000 / freq gives period_ns.
    // Duty scale: 0 to (2^resolution - 1).
    return `  pwm_set_dt(&${sym}_PWM, PWM_HZ(${freqMacro}), PWM_HZ(${freqMacro}) * (uint32_t)(${dutyExpr}) / ((1u << ${resMacro}) - 1u));`;
  }

  httpGetLines(url: string, _board: string): string {
    // Zephyr HTTP client (CONFIG_HTTP_CLIENT=y). The caller must open a TCP
    // socket to the server before invoking http_client_req().
    // Use {} (value-init) not {0}: the first field is an enum, so {0} triggers
    // -fpermissive, and {0} with -Wmissing-field-initializers is also an error.
    return [
      '  {',
      '    static uint8_t _http_recv[512];',
      '    struct http_request _http_req;',
      '    __builtin_memset(&_http_req, 0, sizeof(_http_req));',
      '    _http_req.method       = HTTP_GET;',
      `    _http_req.url          = ${url};`,
      `    _http_req.host         = ${url};  /* TODO: split host from path */`,
      '    _http_req.protocol     = "HTTP/1.1";',
      '    _http_req.recv_buf     = _http_recv;',
      '    _http_req.recv_buf_len = sizeof(_http_recv);',
      '    /* TODO: open TCP socket to host:80, then call:',
      '     *   http_client_req(sock, &_http_req, K_SECONDS(3), NULL);',
      '     *   zsock_close(sock);',
      '     */',
      '    (void)_http_req;',
      '  }',
      '  (void)ctx;',
    ].join('\n');
  }

  httpPostLines(url: string, body: string, contentType: string, _board: string): string {
    return [
      '  {',
      '    static uint8_t _http_recv[512];',
      `    static const char _http_body[] = ${body};`,
      '    struct http_request _http_req;',
      '    __builtin_memset(&_http_req, 0, sizeof(_http_req));',
      '    _http_req.method             = HTTP_POST;',
      `    _http_req.url                = ${url};`,
      `    _http_req.host               = ${url};  /* TODO: split host from path */`,
      '    _http_req.protocol           = "HTTP/1.1";',
      `    _http_req.content_type_value = ${contentType};`,
      '    _http_req.payload            = _http_body;',
      '    _http_req.payload_len        = sizeof(_http_body) - 1;',
      '    _http_req.recv_buf           = _http_recv;',
      '    _http_req.recv_buf_len       = sizeof(_http_recv);',
      '    /* TODO: open TCP socket to host:80, then call:',
      '     *   http_client_req(sock, &_http_req, K_SECONDS(3), NULL);',
      '     *   zsock_close(sock);',
      '     */',
      '    (void)_http_req;',
      '  }',
      '  (void)ctx;',
    ].join('\n');
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
      '// Phase 2: GPIO uses gpio_dt_spec + GPIO_DT_SPEC_GET — include the generated',
      '// app.overlay in your west build (west build -b <board> -- -DOVERLAY_CONFIG=app.overlay).',
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
