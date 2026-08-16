/**
 * Zephyr device / devicetree stub for host g++ compilation tests.
 *
 * In a real Zephyr build, DT_NODELABEL(foo) expands to a linker-section symbol
 * and DEVICE_DT_GET() resolves to the bound struct device.  Here we collapse
 * them both to a single static stub so generated code compiles on the host
 * without the Zephyr SDK.
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

struct device { int _dummy; };

/* Inline (C++17) so every TU shares one definition. */
#ifdef __cplusplus
inline const struct device _zephyr_stub_device = {};
#else
/* C path: define in exactly one TU via ZEPHYR_STUB_IMPL, else extern. */
#  ifdef ZEPHYR_STUB_IMPL
const struct device _zephyr_stub_device = {0};
#  else
extern const struct device _zephyr_stub_device;
#  endif
#endif

/* DT node token — collapsed to 0; DEVICE_DT_GET ignores it in this stub. */
#define DT_NODELABEL(label)  0
#define DT_ALIAS(alias)      0
#define DT_PATH(...)         0
#define DEVICE_DT_GET(node)  (&_zephyr_stub_device)

#ifdef __cplusplus
}
#endif
