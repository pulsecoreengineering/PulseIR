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

#ifdef __cplusplus
}
#endif
