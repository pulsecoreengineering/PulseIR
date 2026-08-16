/**
 * Zephyr POSIX socket stub for host g++ compilation tests.
 *
 * Provides sockaddr_in, AF_INET, htons(), and zsock_* wrappers so Phase 4
 * MQTT globals and HTTP action bodies compile on the host without the Zephyr SDK.
 */
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#ifndef AF_INET
#define AF_INET   2
#endif

#ifndef SOCK_STREAM
#define SOCK_STREAM  1
#endif

#ifndef IPPROTO_TCP
#define IPPROTO_TCP  6
#endif

typedef uint16_t in_port_t;

struct in_addr { uint32_t s_addr; };

struct sockaddr_in {
    uint16_t    sin_family;
    in_port_t   sin_port;
    struct in_addr sin_addr;
};

struct sockaddr { uint16_t sa_family; };

static inline uint16_t htons(uint16_t v) {
    return (uint16_t)((v << 8) | (v >> 8));
}

static inline int zsock_socket(int domain, int type, int proto) {
    (void)domain; (void)type; (void)proto; return -1;
}

static inline int zsock_close(int fd) { (void)fd; return 0; }

#ifdef __cplusplus
}
#endif
