/**
 * Minimal Zephyr ADC driver stub for host-compiler (g++) compile tests.
 *
 * Only the symbols used by PulseIR-generated Zephyr code are defined.
 * No actual ADC hardware is accessed; the stub lets the generated code
 * compile and link against g++ without the Zephyr SDK.
 */
#pragma once
#include "../device.h"

/* ── DT spec ─────────────────────────────────────────────────────────────── */

struct adc_dt_spec {
    const struct device *dev;
    uint8_t  channel_id;
    uint8_t  resolution;
    uint8_t  oversampling;
    bool     differential;
};

/* ── Sequence descriptor ─────────────────────────────────────────────────── */

/* Stub: only the fields the generated code directly initialises.  The real
 * Zephyr struct has more fields, but adc_sequence_init_dt() fills those in
 * at runtime.  Keeping the stub minimal avoids -Wmissing-field-initializers
 * on the designated-initialiser { .buffer = ..., .buffer_size = ... }. */
struct adc_sequence {
    void   *buffer;
    size_t  buffer_size;
};

/* ── DT spec macros ──────────────────────────────────────────────────────── */

/* ADC_DT_SPEC_GET_BY_NAME(node, name) — resolves to a zeroed spec at compile
 * time in the real SDK; here we produce a zero-initialised struct literal so
 * the generated globals compile without a DT database. */
#define ADC_DT_SPEC_GET_BY_NAME(node_id, name)  \
    { nullptr, 0, 12, 0, false }

/* ── Channel setup ───────────────────────────────────────────────────────── */

static inline int adc_channel_setup_dt(const struct adc_dt_spec *spec) {
    (void)spec;
    return 0;
}

/* ── Sequence init ───────────────────────────────────────────────────────── */

static inline int adc_sequence_init_dt(const struct adc_dt_spec *spec,
                                       struct adc_sequence *seq) {
    (void)spec; (void)seq;
    return 0;
}

/* ── Read ────────────────────────────────────────────────────────────────── */

static inline int adc_read_dt(const struct adc_dt_spec *spec,
                              struct adc_sequence *seq) {
    (void)spec;
    (void)seq;
    return 0;
}
