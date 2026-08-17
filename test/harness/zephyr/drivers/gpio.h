/**
 * Zephyr GPIO driver stub for host g++ compilation tests.
 */
#pragma once

#include "../device.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef uint32_t gpio_pin_t;
typedef uint32_t gpio_flags_t;

/* Direction / pull flags (subset used by PulseIR Phase 1). */
#define GPIO_INPUT              ((gpio_flags_t)0x001U)
#define GPIO_OUTPUT_INACTIVE    ((gpio_flags_t)0x101U)
#define GPIO_OUTPUT_ACTIVE      ((gpio_flags_t)0x102U)
#define GPIO_PULL_UP            ((gpio_flags_t)0x010U)
#define GPIO_PULL_DOWN          ((gpio_flags_t)0x020U)

static inline int gpio_pin_configure(const struct device *dev,
                                     gpio_pin_t pin, gpio_flags_t flags) {
    (void)dev; (void)pin; (void)flags;
    return 0;
}

static inline int gpio_pin_set(const struct device *dev,
                                gpio_pin_t pin, int value) {
    (void)dev; (void)pin; (void)value;
    return 0;
}

static inline int gpio_pin_get(const struct device *dev, gpio_pin_t pin) {
    (void)dev; (void)pin;
    return 0;
}

static inline int gpio_pin_toggle(const struct device *dev, gpio_pin_t pin) {
    (void)dev; (void)pin;
    return 0;
}

/* ── Phase 2: gpio_dt_spec ─────────────────────────────────────────────── */

struct gpio_dt_spec {
    const struct device *port;
    gpio_pin_t           pin;
    gpio_flags_t         dt_flags;
};

/* GPIO_DT_SPEC_GET(node_id, prop) — both arguments discarded in the stub. */
#define GPIO_DT_SPEC_GET(node_id, prop)  { NULL, 0, (gpio_flags_t)0 }

static inline int gpio_pin_configure_dt(const struct gpio_dt_spec *spec,
                                        gpio_flags_t flags) {
    (void)spec; (void)flags;
    return 0;
}

static inline int gpio_pin_set_dt(const struct gpio_dt_spec *spec, int value) {
    (void)spec; (void)value;
    return 0;
}

static inline int gpio_pin_get_dt(const struct gpio_dt_spec *spec) {
    (void)spec;
    return 0;
}

#ifdef __cplusplus
}
#endif
