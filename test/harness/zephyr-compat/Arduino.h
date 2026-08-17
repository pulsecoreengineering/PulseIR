/**
 * Zephyr-compatible Arduino.h shim for host g++ compilation tests.
 *
 * Replaces test/harness/Arduino.h when compiling Zephyr-target generated code.
 * Uses the same include guard so once this is found first (via -I ordering),
 * any downstream #include <Arduino.h> from OneWire.h / WiFi.h / PubSubClient.h
 * is a no-op.
 *
 * Key differences from harness/Arduino.h:
 *  - millis() uses a self-contained static counter — no pulseTestClockMs
 *    (pulseTestClockMs lives in harness/serial.cpp, not linked by Zephyr tests)
 *  - No SerialShim / HardwareSerialShim — Zephyr targets use printk(), not Serial
 */
#ifndef PULSE_TEST_ARDUINO_H
#define PULSE_TEST_ARDUINO_H

#include <stdint.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

/* ── GPIO constants ──────────────────────────────────────────────────────── */
#define HIGH          1
#define LOW           0
#define INPUT         0
#define OUTPUT        1
#define INPUT_PULLUP  2

/* ISR attribute — empty on host. */
#ifndef IRAM_ATTR
#define IRAM_ATTR
#endif

/* Interrupt mode constants. */
#define RISING    1
#define FALLING   2
#define CHANGE    3

typedef unsigned char byte;

/* ── Timing ──────────────────────────────────────────────────────────────── */

/* Self-contained clock — each TU gets its own copy, which is fine for a
 * compile-only test where the binary is never run. */
static unsigned long _arduinoCompatMs = 0;

static inline unsigned long millis() { return _arduinoCompatMs; }
static inline void delay(unsigned long ms) { _arduinoCompatMs += ms; }

/* ── GPIO stubs ──────────────────────────────────────────────────────────── */
static inline void pinMode(int, int) {}
static inline void digitalWrite(int, int) {}
static inline int  digitalRead(int) { return 0; }
static inline void analogWrite(int, int) {}
#ifndef PULSE_ZEPHYR_ANALOGREAD_STUB
#  define PULSE_ZEPHYR_ANALOGREAD_STUB
static inline int  analogRead(int) { return 0; }
#endif
static inline int  digitalPinToInterrupt(int pin) { return pin; }
static inline void attachInterrupt(int, void(*)(), int) {}

#endif  /* PULSE_TEST_ARDUINO_H */
