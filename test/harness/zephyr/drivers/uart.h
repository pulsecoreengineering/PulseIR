/**
 * Zephyr UART driver stub for host g++ compilation tests.
 */
#pragma once

#include "../device.h"

#ifdef __cplusplus
extern "C" {
#endif

/* uart_poll_in: returns 0 when a byte is available, negative otherwise. */
static inline int uart_poll_in(const struct device *dev, unsigned char *p_char) {
    (void)dev; (void)p_char;
    return -1;  /* no data */
}

/* uart_poll_out: blocks until the byte is sent (immediate in the stub). */
static inline void uart_poll_out(const struct device *dev, unsigned char out_char) {
    (void)dev; (void)out_char;
}

#ifdef __cplusplus
}
#endif
