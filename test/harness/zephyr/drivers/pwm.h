/**
 * Zephyr PWM driver stub for host g++ compilation tests.
 *
 * Provides the pwm_dt_spec type, PWM_DT_SPEC_GET initialiser, pwm_set_dt()
 * inline, and the PWM_HZ / PWM_MSEC helper macros so generated Phase 3 code
 * compiles on the host without the Zephyr SDK.
 */
#pragma once

#include "../device.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef uint32_t pwm_flags_t;

#define PWM_POLARITY_NORMAL    ((pwm_flags_t)0U)
#define PWM_POLARITY_INVERTED  ((pwm_flags_t)1U)

/* Period in nanoseconds for a given frequency in Hz. */
#define PWM_HZ(freq)   ((uint32_t)(1000000000u / (unsigned)(freq)))
/* Period in nanoseconds for a given period in milliseconds. */
#define PWM_MSEC(ms)   ((uint32_t)((unsigned)(ms) * 1000000u))

struct pwm_dt_spec {
    const struct device *dev;
    uint32_t             channel;
    uint32_t             period;
    pwm_flags_t          flags;
};

/* PWM_DT_SPEC_GET(node_id, prop) — both args discarded in the stub. */
#define PWM_DT_SPEC_GET(node_id, prop)  { NULL, 0u, 0u, PWM_POLARITY_NORMAL }

static inline int pwm_set_dt(const struct pwm_dt_spec *spec,
                              uint32_t period, uint32_t pulse) {
    (void)spec; (void)period; (void)pulse;
    return 0;
}

#ifdef __cplusplus
}
#endif
