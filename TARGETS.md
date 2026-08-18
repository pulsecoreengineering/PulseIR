# PulseIR Target Backends

PulseIR generates firmware from the same YAML model for multiple embedded platforms. This page describes each supported target: what it generates, how to build it, and what is and is not yet supported.

---

## Selecting a target

Pass `--target` to the CLI, or let the model's `target:` field imply one:

```bash
# Default (Arduino)
node dist/src/cli.js my_model.yaml --outdir build/my_project

# Explicit target
node dist/src/cli.js my_model.yaml --target espidf      --outdir build/my_project
node dist/src/cli.js my_model.yaml --target micropython --output main.py
node dist/src/cli.js my_model.yaml --target zephyr      --outdir build/my_project
```

`--target` accepts: `arduino`, `espidf`, `micropython`, `zephyr`.

### Multi-file models

In real projects the model is split across several YAML files linked by `imports:`. Pass the **entry file** (the one that declares `project:`) to the CLI — the importer resolves everything else relative to it:

```
boiler/
├── pulse.yaml      ← pass this to the CLI
├── hardware.yaml
├── parameters.yaml
└── machine.yaml
```

```bash
# Single command regardless of how many files the model spans:
node dist/src/cli.js boiler/pulse.yaml --target espidf --outdir build/boiler
```

The target flag applies to the whole merged model. See QUICKSTART.md → "Splitting a Model Across Files" for merge rules.

### The `target:` field in the model

```yaml
target: esp32          # shorthand
# or
target:
  board: esp32
```

The board hint influences pin naming conventions (GPIO vs D-prefix) but does not override `--target`. Use `--target` to switch backends; use `target.board` to record which physical board the model is designed for.

---

## Arduino

**Status: production-ready**

Generates a single `.ino` sketch that compiles under the Arduino IDE (≥ 2.0) or Arduino CLI. Compatible with every board the Arduino ecosystem supports — AVR (Uno, Mega), ESP32, ESP8266, RP2040, STM32, and more.

### Output files

| File | Description |
|------|-------------|
| `<name>.ino` | Generated sketch — do not edit |
| `<name>_guards.cpp` | Guard stubs — **your code** |
| `<name>_actions.cpp` | Action stubs — **your code** |
| `<name>.h` | Shared header: context structs, event enum, sizing macros |

With `--outdir`, all files land in a directory with the project name. The `.ino` includes the header and never overwrites the guard/action files.

### Entry point

```cpp
void setup() { /* generated: Serial.begin, interface init, FSM registration */ }
void loop()  { /* generated: sensor reads, task dispatch, FSM update */        }
```

### State machine runtime

When `machine:` is present, the sketch depends on **PulseHSM** (vendored in `deps/`). The codegen sizes `PULSEHSM_MAX_STATES`, `_EVENTS`, and `_DEPTH` from the model and emits them before the `#include "PulseHSM.h"` so the runtime builds with the right table sizes.

A model without `machine:` generates a plain sketch with `tasks:` scheduling and `commands:` serial handling — no PulseHSM dependency at all.

### Timing

`millis()` — standard Arduino clock, 1 ms resolution.

### GPIO / ADC / PWM

| Operation | Generated call |
|-----------|----------------|
| `gpio_control: HIGH/LOW` | `digitalWrite(PIN, HIGH/LOW)` |
| `gpio_control: TOGGLE` | `digitalWrite(PIN, !digitalRead(PIN))` |
| `gpio_read` | `digitalRead(PIN)` |
| `adc_read` | `analogRead(PIN)` |
| `pwm_control` | `analogWrite(PIN, duty)` (Uno) / `ledcWrite(ch, duty)` (ESP32) |

### Platform notes for AVR (Arduino Uno)

- `snprintf("%.1f", …)` does **not** work on AVR without linking `-lprintf_flt`. PulseIR avoids this by using `display.print(value, 1)` for all float-to-display rendering.
- The ESP32 variant of the Arduino core supports `ledcWrite`; the Uno does not have LEDC, so `pwm_output` there falls back to `analogWrite`.

### Build

1. Open the `.ino` in Arduino IDE 2 (or `arduino-cli compile …`)
2. Install any libraries listed in `// Requires:` comments via Library Manager
3. Upload

---

## ESP-IDF

**Status: production-ready**

Generates C++ targeting Espressif's IoT Development Framework v4.x / v5.x on ESP32-family chips. The entry point is `app_main()`, which runs inside a FreeRTOS task created by the bootloader.

### Output files

| File | Description |
|------|-------------|
| `main/<name>.cpp` | Generated sketch |
| `main/<name>_guards.cpp` | Guard stubs |
| `main/<name>_actions.cpp` | Action stubs |
| `main/<name>.h` | Shared header |
| `CMakeLists.txt` | Top-level build file |
| `main/CMakeLists.txt` | Component build file |

### Entry point

```cpp
extern "C" void app_main(void) {
  // setup code
  for (;;) {
    // loop code
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}
```

### Timing

`esp_timer_get_time()` returns microseconds; PulseIR divides by 1000 to produce milliseconds as `int64_t`.

### GPIO / ADC / PWM

| Operation | Generated call |
|-----------|----------------|
| `gpio_control` | `gpio_set_level((gpio_num_t)PIN, level)` |
| `gpio_read` | `gpio_get_level((gpio_num_t)PIN)` |
| `adc_read` | `adc1_get_raw(channel)` (IDF ≤4) — see note |
| `pwm_control` | `ledc_set_duty(…)` + `ledc_update_duty(…)` |

> **IDF ≥ 5.0 ADC note**: The legacy `adc1_get_raw()` driver still works but is deprecated. Replace generated ADC calls with `adc_oneshot_read()` from `esp_adc/adc_oneshot.h` for new projects.

### Console output

ESP-IDF has no `Serial` object. PulseIR generates a pair of static-inline helpers that let the same `printExpr` / `printlnExpr` template code work on both backends:

```cpp
static inline void _pulse_print(const char* s) { printf("%s", s); }
static inline void _pulse_print(float v)       { printf("%.2f", v); }
```

### Build

```bash
cd my_sketch
idf.py set-target esp32
idf.py build
idf.py flash monitor
```

---

## MicroPython

**Status: beta**

Generates a self-contained `main.py` that runs on any MicroPython board. There is no C++ dependency — the state machine is an inline Python class (`_HSM`) emitted directly into the file.

### Output files

| File | Description |
|------|-------------|
| `main.py` | Complete generated script — setup, loop, and inline HSM |

### Architecture

MicroPython's codegen diverges from the C++ path intentionally. `PlatformBackend` is C-expression-oriented, so MicroPython gets its own top-level generator class rather than a backend plugin. The result is idiomatic Python, not C translated to Python.

### Entry point

```python
import asyncio

async def main():
    # setup
    await asyncio.gather(
        _task_clock_tick(),
        # … other tasks
    )

asyncio.run(main())
```

Tasks declared with `every:` become `asyncio` coroutines.

### Hardware mapping

| PulseIR | MicroPython |
|---------|-------------|
| `digital_output` | `machine.Pin(pin, machine.Pin.OUT)` |
| `digital_input` | `machine.Pin(pin, machine.Pin.IN, pull)` |
| `pwm_output` | `machine.PWM(machine.Pin(pin))` |
| `analog_input` | `machine.ADC(machine.Pin(pin))` |
| `i2c` bus | `machine.I2C(id, sda=…, scl=…, freq=…)` |
| `spi` bus | `machine.SPI(id, baudrate=…, sck=…, mosi=…, miso=…)` |
| `uart` bus | `machine.UART(port, baudrate=…)` |

### Notes

- MicroPython does not have a universal driver ecosystem matching the Arduino Library Manager. Generated code includes the correct `machine.*` calls for primitive devices; library-backed sensors (DHT, DS18B20, BME280) generate commented stubs that you fill with the appropriate MicroPython module.
- The inline `_HSM` class is a minimal hierarchical state machine. It handles entry/exit, event dispatch, and guard evaluation, but does not include the compile-time sizing approach PulseHSM uses — MicroPython's dynamic typing makes that unnecessary.

### Build

Copy `main.py` to the root of the MicroPython filesystem:

```bash
# Using mpremote:
mpremote cp main.py :main.py
mpremote run main.py

# Using rshell:
rshell cp main.py /pyboard/main.py
```

---

## Zephyr RTOS

**Status: in progress**

Generates C++ targeting the Zephyr RTOS kernel. The entry point is a standard C `int main()` function; Zephyr's scheduler runs alongside it.

### Output files

| File | Description |
|------|-------------|
| `src/<name>.cpp` | Generated sketch |
| `src/<name>_guards.cpp` | Guard stubs |
| `src/<name>_actions.cpp` | Action stubs |
| `src/<name>.h` | Shared header |
| `CMakeLists.txt` | CMake build definition |
| `prj.conf` | Zephyr Kconfig fragment |

### Entry point

```cpp
int main(void) {
  // setup
  while (1) {
    // loop
    k_msleep(1);
  }
  return 0;
}
```

### What works

- `digital_output` and `digital_input` via `gpio_pin_set_dt()` / `gpio_pin_get_dt()`
- Serial logging via `printk()`
- `tasks:` scheduling via `k_timer`
- State machine registration (PulseHSM)
- `prj.conf` and `CMakeLists.txt` generation

### What is still in progress

- ADC and PWM driver bindings
- I2C sensor constructors (Zephyr uses device-tree overlays, not runtime I2C addresses)
- `commands:` serial console (Zephyr shell API differs from Arduino Serial)

### Build

```bash
west build -b <board> .
west flash
```

Requires the Zephyr SDK and `west` tool installed. See the [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/).

---

## Guard and action portability

Guard and action function signatures are identical on every target:

```cpp
bool guard_<name>(const SystemContext* ctx);
void action_<name>(SystemContext* ctx);
```

A guard or action you write for Arduino will compile unchanged on ESP-IDF and Zephyr, as long as it only uses `ctx` and standard library calls. Platform-specific hardware access (e.g. `gpio_set_level` vs `digitalWrite`) belongs in the generated glue, not in your guards and actions — that separation is what keeps them portable.

See `FUNCTION_CONTRACT.md` for the full binding specification.

---

## Feature matrix

| Feature | Arduino | ESP-IDF | MicroPython | Zephyr |
|---------|:-------:|:-------:|:-----------:|:------:|
| State machine | ✅ | ✅ | ✅ | ✅ |
| `tasks:` scheduling | ✅ | ✅ | ✅ | ✅ |
| `commands:` serial console | ✅ | ✅ | — | ⏳ |
| `digital_output / _input` | ✅ | ✅ | ✅ | ✅ |
| `pwm_output` | ✅ | ✅ | ✅ | ⏳ |
| `analog_input` | ✅ | ✅ | ✅ | ⏳ |
| Interrupts (`interrupt:`) | ✅ | ✅ | — | — |
| DHT22 / DHT11 | ✅ | ✅ | ⏳ | — |
| DS18B20 | ✅ | ✅ | ⏳ | — |
| BME280 | ✅ | ✅ | ⏳ | — |
| DS3231 / DS1307 RTC | ✅ | ✅ | ⏳ | — |
| LCD I2C | ✅ | ✅ | — | — |
| OLED I2C | ✅ | ✅ | — | — |
| `http_get / http_post` | ✅ (ESP) | ✅ | — | — |
| `sleep_control` | ✅ (ESP) | ✅ | — | — |
| MQTT telemetry | ✅ | ✅ | — | — |
| NVS parameter storage | ✅ (ESP) | ✅ | — | — |

✅ = supported and tested, ⏳ = in progress, — = not yet planned
