/**
 * Zephyr HTTP client stub for host g++ compilation tests.
 *
 * Provides struct http_request, http_client_req(), HTTP_GET, HTTP_POST, and
 * K_SECONDS so Phase 4 HTTP action bodies compile on the host without the
 * Zephyr SDK.
 */
#pragma once

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    HTTP_DELETE = 0,
    HTTP_GET,
    HTTP_HEAD,
    HTTP_OPTIONS,
    HTTP_PATCH,
    HTTP_POST,
    HTTP_PUT,
} http_method_t;

struct http_request {
    http_method_t     method;
    const char       *url;
    const char       *host;
    const char       *protocol;
    const char       *content_type_value;
    const char       *payload;
    size_t            payload_len;
    uint8_t          *recv_buf;
    size_t            recv_buf_len;
    void             *response;  /* http_response_cb_t — opaque for stub purposes */
};

#ifndef K_SECONDS
#define K_SECONDS(s)  ((int32_t)((s) * 1000))
#endif

static inline int http_client_req(int sock, struct http_request *req,
                                  int32_t timeout, void *user_data) {
    (void)sock; (void)req; (void)timeout; (void)user_data;
    return 0;
}

#ifdef __cplusplus
}
#endif
