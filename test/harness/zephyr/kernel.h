/**
 * Zephyr kernel stub for host g++ compilation tests.
 *
 * Provides: k_uptime_get(), k_msleep(), printk(), k_work/k_timer APIs,
 * and the device / DT macros (via device.h).
 */
#pragma once

#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include "device.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ── Timing ─────────────────────────────────────────────────────────────── */

static int64_t _zephyr_uptime_ms = 0;

static inline int64_t k_uptime_get(void)        { return _zephyr_uptime_ms; }
static inline int32_t k_msleep(int32_t ms)       { (void)ms; return 0; }

/* Advance the virtual clock — call from host test drivers. */
static inline void zephyrTestAdvance(int64_t ms) { _zephyr_uptime_ms += ms; }

/* ── Timeout type (k_timeout_t) ─────────────────────────────────────────── */

typedef struct { int64_t ticks; } k_timeout_t;

#define K_MSEC(ms)    ((k_timeout_t){ (int64_t)(ms) })
#define K_NO_WAIT     K_MSEC(0)
#define K_FOREVER     ((k_timeout_t){ -1LL })

/* ── Work queue (k_work) ─────────────────────────────────────────────────── */

struct k_work;
typedef void (*k_work_handler_t)(struct k_work *work);

struct k_work {
    k_work_handler_t handler;
};

static inline void k_work_init(struct k_work *work, k_work_handler_t handler) {
    if (work) work->handler = handler;
}
static inline int k_work_submit(struct k_work *work) { (void)work; return 0; }

/* K_WORK_DEFINE(name, handler) — create a statically-initialised k_work. */
#define K_WORK_DEFINE(name, _handler) \
    struct k_work name = { _handler }

/* ── Timer (k_timer) ─────────────────────────────────────────────────────── */

struct k_timer;
typedef void (*k_timer_expiry_t)(struct k_timer *timer);
typedef void (*k_timer_stop_t)(struct k_timer *timer);

struct k_timer {
    k_timer_expiry_t expiry_fn;
    k_timer_stop_t   stop_fn;
};

static inline void k_timer_init(struct k_timer *timer,
                                k_timer_expiry_t expiry_fn,
                                k_timer_stop_t   stop_fn) {
    if (timer) { timer->expiry_fn = expiry_fn; timer->stop_fn = stop_fn; }
}
static inline void k_timer_start(struct k_timer *timer,
                                  k_timeout_t duration,
                                  k_timeout_t period) {
    (void)timer; (void)duration; (void)period;
}
static inline void k_timer_stop(struct k_timer *timer) { (void)timer; }

/* K_TIMER_DEFINE(name, expiry, stop) — create a statically-initialised k_timer. */
#define K_TIMER_DEFINE(name, _expiry, _stop) \
    struct k_timer name = { _expiry, _stop }

/* ── Arduino-compatible stubs ───────────────────────────────────────────── */
/* Some model action params use HIGH/LOW, and conversion formulas may call
 * analogRead().  Guard so they don't conflict if Arduino.h is also included
 * (e.g. via PulseHSM.h in state-machine models). */
#ifndef HIGH
#  define HIGH 1
#  define LOW  0
#endif
#ifndef PULSE_ZEPHYR_ANALOGREAD_STUB
#  define PULSE_ZEPHYR_ANALOGREAD_STUB
static inline int analogRead(int _pin) { (void)_pin; return 0; }
#endif

/* ── Console ────────────────────────────────────────────────────────────── */

/* printk() routes to vprintf on the host; gcc/clang will type-check the fmt. */
#ifdef __GNUC__
__attribute__((format(printf, 1, 2)))
#endif
static inline int printk(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int r = vprintf(fmt, ap);
    va_end(ap);
    return r;
}

#ifdef __cplusplus
}
#endif
