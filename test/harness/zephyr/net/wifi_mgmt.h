/**
 * Zephyr WiFi management stub for host g++ compilation tests.
 *
 * Provides wifi_connect_req_params, WIFI_SECURITY_TYPE_PSK, WIFI_CHANNEL_ANY,
 * WIFI_FREQ_BAND_2_4_GHZ, NET_REQUEST_WIFI_CONNECT, and net_mgmt() so Phase 4
 * WiFi globals and init calls compile on the host without the Zephyr SDK.
 */
#pragma once

#include "net_if.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef uint8_t wifi_security_type_t;
#define WIFI_SECURITY_TYPE_NONE  ((wifi_security_type_t)0)
#define WIFI_SECURITY_TYPE_PSK   ((wifi_security_type_t)1)

#define WIFI_CHANNEL_ANY  0xFF
#define WIFI_FREQ_BAND_2_4_GHZ  0

struct wifi_connect_req_params {
    const uint8_t  *ssid;
    uint8_t         ssid_length;
    const uint8_t  *psk;
    uint8_t         psk_length;
    wifi_security_type_t security;
    uint8_t         channel;
    uint8_t         band;
};

/* Minimal net_mgmt stub — all args intentionally discarded. */
#define NET_REQUEST_WIFI_CONNECT  0

static inline int net_mgmt(uint32_t mgmt_request, struct net_if *iface,
                            void *data, size_t len) {
    (void)mgmt_request; (void)iface; (void)data; (void)len;
    return 0;
}

#ifdef __cplusplus
}
#endif
