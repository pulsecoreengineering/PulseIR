/**
 * Zephyr net_if stub for host g++ compilation tests.
 *
 * Provides struct net_if and net_if_get_default() so Phase 4 WiFi globals
 * compile on the host without the Zephyr SDK.
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

struct net_if { int _dummy; };

static inline struct net_if *net_if_get_default(void) { return NULL; }

#ifdef __cplusplus
}
#endif
