/**
 * Zephyr kernel stub for host g++ compilation tests.
 *
 * Provides: k_uptime_get(), k_msleep(), printk(), and the device / DT macros
 * (via device.h).  All stubs are static inline so they disappear when unused.
 */
#pragma once

#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include "device.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Timing ------------------------------------------------------------------- */

static int64_t _zephyr_uptime_ms = 0;

static inline int64_t k_uptime_get(void)        { return _zephyr_uptime_ms; }
static inline int32_t k_msleep(int32_t ms)       { (void)ms; return 0; }

/* Advance the virtual clock — call from host test drivers. */
static inline void zephyrTestAdvance(int64_t ms) { _zephyr_uptime_ms += ms; }

/* Console ------------------------------------------------------------------ */

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
