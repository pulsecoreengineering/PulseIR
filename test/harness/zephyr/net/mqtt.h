/**
 * Zephyr MQTT stub for host g++ compilation tests.
 *
 * Provides struct mqtt_client, mqtt_client_init(), mqtt_connect(), and
 * MQTT_VERSION_3_1_1 so Phase 4 MQTT globals and init code compile on the
 * host without the Zephyr SDK.
 */
#pragma once

#include "socket.h"
#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define MQTT_VERSION_3_1_1  4

struct mqtt_utf8 {
    const uint8_t *utf8;
    uint32_t       size;
};

struct mqtt_client {
    struct sockaddr *broker;
    uint8_t         *rx_buf;
    size_t           rx_buf_size;
    uint8_t         *tx_buf;
    size_t           tx_buf_size;
    uint8_t          protocol;
    struct mqtt_utf8 client_id;
};

static inline void mqtt_client_init(struct mqtt_client *client) {
    if (client) { __builtin_memset(client, 0, sizeof(*client)); }
}

static inline int mqtt_connect(struct mqtt_client *client) {
    (void)client; return 0;
}

static inline int mqtt_disconnect(struct mqtt_client *client) {
    (void)client; return 0;
}

#ifdef __cplusplus
}
#endif
