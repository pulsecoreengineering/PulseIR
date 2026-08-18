# PulseIR — Architecture Reference

**Status**: Active development · August 2026
**Backends**: Arduino ✅ · ESP-IDF ✅ · MicroPython ✅ · Zephyr 🔄

---

## 1. The Core Rule

> **If it describes structure, relationships, configuration, state, events,
> resources or system policy — it belongs in the model.**
>
> **If it describes arbitrary computation, algorithms or data manipulation — it
> belongs in C/C++.**

Guards and actions are **names of C functions**, never conditions or bodies.
The schema has no expression field. This is enforced, not merely stated.

---

## 2. System Architecture

```
YAML model (one file or a directory linked by imports:)
    │
    ├─ pulse.yaml    ← entry file (project: + imports:)
    ├─ hardware.yaml
    ├─ parameters.yaml
    └─ machine.yaml
    │
    ↓ SourceResolver  (FsResolver on disk; MemoryResolver in browser)
    ↓ Merge           (keyed sections merged; transitions concatenated)
    ↓ Parser (src/parser/index.ts)
PulseProject IR                ← runtime-neutral, platform-neutral
    ↓ Board Resolver            logical pin names → physical GPIO
    ↓ Validator                 semantic rules, pin conflicts
    ↓ Codegen (src/codegen/)
        ↓ PlatformBackend ─────→ Arduino (.ino)
                         ─────→ ESP-IDF (.cpp + FreeRTOS)
                         ─────→ MicroPython (main.py)
                         ─────→ Zephyr (.cpp + prj.conf + CMakeLists.txt) ← in progress
    ↓ Emitters (src/emit/)
        TopicEmitter  → MQTT topic manifest (topics.json)
        LibraryEmitter → library manifest (libraries.json)
        DiagramEmitter → Mermaid state diagram (.md / .mmd)
        CmakeEmitter   → ESP-IDF CMakeLists.txt
        ZephyrProjectEmitter → CMakeLists.txt + prj.conf + app.overlay  ← in progress
```

---

## 3. Layer 1 — The IR (`src/model/`)

Pure data structures. No logic, no platform assumptions.

| Concept | What it represents |
|---|---|
| `State` | HSM state: name, entry/exit actions, nested regions, initial child |
| `Event` | Named trigger with source (`external`, `sensor`, `mqtt`, …) |
| `Transition` | `from` + `on`/`after` + `guard` + `do` + `to` |
| `Action` | Named call to a C function; carries `driver` and `params` |
| `Guard` | Named C predicate; description becomes a stub comment |
| `Resource` | Declared hardware interface (gpio, i2c, uart, ota, …) |
| `Component` | Typed device: `digital_output`, `ds18b20`, … |
| `Parameter` | Named configuration value with type, range, default, unit |
| `Task` | Periodic work: interval + action list + optional log template |
| `Command` | Text-in → action/event dispatch from a declared UART |
| `PulseProject` | The root: project + target + hardware + parameters + events + machine + actions + libraries |

The IR is **intentionally frozen between backends**. Changing the model schema
never requires touching the backends.

---

## 4. Layer 2 — Parser and Board Resolver (`src/parser/`)

### 4.1 Multi-file models and the SourceResolver

A model can be a single YAML file or a directory of files linked by `imports:`. Both produce the same `PulseProject` IR — the rest of the pipeline never sees files, only the merged result.

```
pulse.yaml          ← entry file (must declare project:)
  imports:
    hardware.yaml   ← buses and devices
    parameters.yaml ← tunable values
    machine.yaml    ← events, states, transitions, actions
```

The `SourceResolver` interface (`resolver.ts`) abstracts "give me the content of this path". Two implementations ship:

| Class | File | Used by |
|-------|------|---------|
| `FsResolver` | `fs-resolver.ts` | CLI — reads from disk relative to the importing file |
| `MemoryResolver` | `resolver.ts` | Web editor — reads from the open tab buffers |

Keeping the abstraction at the `SourceResolver` boundary means the parser and merge logic are shared; only the I/O layer differs.

**Merge semantics**

| Section | Rule |
|---------|------|
| `project:` | Only the entry file may declare it; a second declaration is an error |
| `hardware.devices:`, `events:`, `actions:`, `parameters:`, `tasks:`, `commands:` | Keyed by name — names merge across files; the same name in two files is an error, not a silent override |
| `hardware.buses:` | Same as above |
| `machine.states:` | Keyed by name, same rules |
| `machine.transitions:` | Concatenated in import order, importing file last |
| `libraries:` | Concatenated; duplicates by name are deduplicated |
| `imports:` | Resolved relative to the declaring file; transitive (A imports B imports C is fine); cycles are detected and reported naming every file in the cycle |

**What the error messages look like**

```
hardware.yaml:12: device "sensor" already declared in parameters.yaml:3
pulse.yaml:5: import cycle: pulse.yaml → hardware.yaml → pulse.yaml
sensor_gateway/hardware.yaml:8: missing import target: "modbus.yaml"
```

### 4.2 Parser (`index.ts`)

Two-pass per file, applied after merging:
1. Load YAML; map each section to IR types
2. Validate all references (unknown events, unknown states, transition targets,
   action catalogue membership, pin conflicts, import cycles)

Errors include file + section context. `Parser.warnings` carries soft notices
(deprecated shapes, possible oversights) that the CLI prints as `⚠️` lines.

### 4.4 Board Resolver (`board-resolver.ts`)

Translates **logical pin names** to **physical GPIO identifiers** before
codegen runs. A model that says `pin: LED_BUILTIN` becomes `pin: GPIO2` when
compiled for `esp32`.

```bash
pulse-ir model.yaml --board esp32_devkit_v4
```

Board profiles live in `boards/*.yaml`:

```yaml
# boards/esp32.yaml
id: esp32
name: "ESP32 (generic)"
framework: arduino          # or: espidf, micropython, zephyr
zephyr_board: esp32_devkitc_wroom  # west build -b <this>
pins:
  LED_BUILTIN: GPIO2
  I2C_SDA: GPIO21
  I2C_SCL: GPIO22
  A0: GPIO36
capabilities:
  adc: [GPIO32, GPIO33, GPIO34, GPIO35, GPIO36, GPIO39]
  pwm_channels: 16
  input_only: [GPIO34, GPIO35, GPIO36, GPIO39]
  reserved: [GPIO6, GPIO7, GPIO8, GPIO9, GPIO10, GPIO11]
```

The resolver catches:
- output assigned to an input-only pin
- pin wired to integrated SPI flash
- PWM on a pin the board cannot drive
- ADC2 used while WiFi is declared

**Adding a new board**: copy any `boards/*.yaml`, fill in real vendor data
(not from memory — cite the datasheet), add a test in `test/compile.test.ts`.

### 4.5 Known board profiles

| Board ID | Framework | Zephyr target |
|---|---|---|
| `arduino_uno` | arduino | — |
| `arduino_mega` | arduino | — |
| `esp32` | arduino / espidf | `esp32_devkitc_wroom` |
| `esp32_devkit_v4` | arduino / espidf | `esp32_devkitc_wroom` |
| `esp32s3` | arduino / espidf | `esp32s3_devkitc` |
| `esp32_s3_devkit` | arduino / espidf | `esp32s3_devkitc` |
| `pico` | arduino | `rpi_pico` |
| `rp2040_pico` | arduino | `rpi_pico` |

**Planned (Zephyr Phase 2+)**: `nrf52840_dk`, `stm32f4_disco`, `mimxrt1060_evk`,
`nucleo_f767zi`, `bl5340_dvk`.

---

## 5. Layer 3 — Codegen (`src/codegen/`)

### 5.1 The `Codegen` class (`index.ts`)

Platform-agnostic traversal of the IR. Owns "what to emit":
- State machine sizing macros (`PULSEHSM_MAX_*`)
- Event and state enums
- `SystemContext`, `SystemParameters`, `SystemSensors` structs
- `setupInterfaces()` — calls each resource's init lines
- `setup()` / `loop()` or platform equivalent
- Action stubs with `driver`-specific bodies for built-in drivers
- Guard stubs
- Task scheduling logic
- Command dispatch table
- Interrupt ISR registration
- Diagnostic print calls

Codegen calls through `PlatformBackend` for every platform-specific
spelling. It never tests `if (backend.name === ...)`.

### 5.2 The `PlatformBackend` interface (`backend.ts`)

The seam between the platform-agnostic traversal and each target. Every
backend implements all 16 methods:

| Method | What it abstracts |
|---|---|
| `nowExpr()` | `millis()` · `esp_timer_get_time()/1000` · `k_uptime_get()` |
| `timestampType()` | `unsigned long` · `int64_t` |
| `digitalWriteExpr(pin, value)` | `digitalWrite(p,v)` · `gpio_set_level()` · `gpio_pin_set_dt()` |
| `digitalReadExpr(pin)` | `digitalRead(p)` · `gpio_get_level()` · `gpio_pin_get_dt()` |
| `analogReadExpr(pin)` | `analogRead(p)` · `adc1_get_raw()` · adc_read() |
| `analogWriteExpr(pin, duty)` | `analogWrite(p,d)` · `ledc_set_duty()` · `pwm_set_dt()` |
| `ledcWriteLines(pin, ch, duty, board)` | ESP32 LEDC API fork (core 2.x vs 3.x) |
| `consoleStreamName(port)` | `Serial` · `UART_NUM_0` · `""` (printk) |
| `printExpr(stream, value)` | `stream.print(v)` · `pulseIrPrint(v)` · `printk(…)` |
| `printlnExpr(stream, value)` | … |
| `streamAvailableExpr(stream)` | `stream.available()` · `uart_get_buffered_data_len()` |
| `streamReadExpr(stream)` | `stream.read()` · `uart_read_bytes()` |
| `platformIncludes(hasMachine, sizing)` | system headers, sizing macros |
| `emitInterface(resource, symbol)` | resource-specific init, globals, defines |
| `renderSetup(body)` | `void setup() {…}` · `static void _setup() {…}` |
| `renderLoop(body)` | `void loop() {…}` · `int main() { _setup(); while(1){…} }` |

### 5.3 Built-in action drivers

The following `driver:` names produce fully generated bodies (no TODO):

| Driver | What it generates |
|---|---|
| `gpio_control` | `digitalWrite()` / `gpio_set_level()` / `gpio_pin_set_dt()` |
| `pwm_control` | `ledcWrite()` / `ledc_set_duty()` |
| `adc_read` | `analogRead()` / `adc1_get_raw()` |
| `uart_write` | `Serial.println()` / `printf()` |
| `sleep_control` | `esp_deep_sleep_start()` / `esp_light_sleep_start()` (ESP32 only) |
| `http_get` | `HTTPClient::GET()` (ESP32/ESP8266 Arduino core) |
| `http_post` | `HTTPClient::POST()` (ESP32/ESP8266 Arduino core) |

All other drivers produce a typed stub the user fills in.

### 5.4 Interface backends

Hardware resource init (`emitInterface`) is platform-specific and lives in a
separate class:

| Class | File | Used by |
|---|---|---|
| `InterfaceBackend` | `interfaces.ts` | Arduino |
| `EspIdfInterfaceBackend` | `espidf_interfaces.ts` | ESP-IDF |
| `ZephyrInterfaceBackend` | `zephyr_interfaces.ts` | Zephyr ← in progress |

Each returns an `InterfaceEmission`:
```typescript
interface InterfaceEmission {
  defines:   string[];   // #define SENSOR_BUS_SDA 21
  globals:   string[];   // gpio_dt_spec, Wire objects, etc.
  init:      string[];   // Wire.begin(), gpio_config(), etc.
  libraries: ImpliedLibrary[];
  todos:     string[];   // unresolvable bindings
  loop?:     string[];   // ArduinoOTA.handle(), etc.
}
```

### 5.5 Supported interfaces (resource types)

| Interface | Arduino | ESP-IDF | Zephyr |
|---|---|---|---|
| `gpio` | ✅ | ✅ | Phase 2 |
| `pwm` | ✅ | ✅ | Phase 3 |
| `adc` | ✅ | ✅ | Phase 3 |
| `uart` | ✅ | ✅ | Phase 2 |
| `i2c` | ✅ | ✅ | Phase 2 |
| `spi` | ✅ | ✅ | Phase 3 |
| `can` | ✅ stub | ✅ stub | Phase 4 |
| `onewire` | ✅ | — | Phase 4 |
| `wifi` | ✅ | ✅ stub | Phase 4 |
| `ethernet` | ✅ stub | — | Phase 4 |
| `ble` | ✅ stub | — | Phase 4 |
| `mqtt` | ✅ stub | ✅ stub | Phase 4 |
| `eeprom` | ✅ | — | Phase 4 |
| `littlefs` | ✅ | — | Phase 4 |
| `ota` | ✅ (ArduinoOTA) | — | Phase 4 (MCUboot) |
| `custom` | ✅ (TODO) | ✅ (TODO) | Phase 4 |

---

## 6. The Emit Layer (`src/emit/`)

Parallel outputs that do not require a PlatformBackend:

| Emitter | Output | Flag |
|---|---|---|
| `TopicEmitter` | `topics.json` — MQTT topic manifest | `--topics` |
| `LibraryEmitter` | `libraries.json` — PlatformIO lib_deps | `--libraries` |
| `DiagramEmitter` | Mermaid state diagram | `--diagram` |
| `CmakeEmitter` | ESP-IDF CMakeLists.txt | `--cmake` |
| `ZephyrProjectEmitter` | CMakeLists.txt + prj.conf + app.overlay | auto (Zephyr target) |

---

## 7. The Generated Project Structure

### Arduino / ESP-IDF (`--outdir`)

```
out/
├── project_name.ino / .cpp    ← regenerated, do not edit
├── project_name_generated.h   ← regenerated, do not edit
├── PulseHSM_config.h          ← runtime table sizes (keep beside PulseHSM.h)
├── PulseHSM.h / .cpp          ← runtime, vendored
└── src/
    ├── actions.cpp             ← YOURS — written once, never overwritten
    └── guards.cpp              ← YOURS — written once, never overwritten
```

### Zephyr (`--outdir`, planned Phase 1)

```
out/
├── CMakeLists.txt             ← west build entry point (regenerated)
├── prj.conf                   ← Kconfig, derived from model (regenerated)
├── app.overlay                ← Devicetree aliases (regenerated)
├── PulseHSM.h / .cpp          ← runtime, vendored
├── PulseHSM_config.h          ← runtime table sizes
└── src/
    ├── main.cpp               ← regenerated — _setup() + int main()
    ├── actions.cpp             ← YOURS
    └── guards.cpp              ← YOURS
```

Build with:
```bash
west build -b native_sim        # simulation, no hardware needed
west build -b esp32_devkitc_wroom  # real board
./build/zephyr/zephyr.exe       # run native_sim binary
```

---

## 8. Adding a New Backend

1. Create `src/codegen/<name>.ts` — implement every method of `PlatformBackend`
2. Create `src/codegen/<name>_interfaces.ts` — implement `emit(resource, symbol)`
   returning `InterfaceEmission`
3. Add a case to `resolveBackend()` in `src/cli.ts`
4. Add the target name to the USAGE string in `src/cli.ts`
5. Add mock harness headers to `test/harness/<name>/`
6. Add fixture tests in `test/backends.test.ts`

Referencing `EspIdfBackend` + `EspIdfInterfaceBackend` is the recommended
pattern. Zephyr is the reference implementation in progress.

---

## 9. Adding a New Board

1. Create `boards/<board_id>.yaml` following the schema:

```yaml
id: nrf52840_dk
name: "Nordic nRF52840 DK"
framework: zephyr            # arduino | espidf | micropython | zephyr | any
zephyr_board: nrf52840dk_nrf52840   # west build -b <this>
pins:
  LED1: P0.13
  LED2: P0.14
  BTN1: P0.11
  I2C_SDA: P0.26
  I2C_SCL: P0.27
capabilities:
  adc: [P0.02, P0.03, P0.04, P0.05, P0.28, P0.29, P0.30, P0.31]
  pwm_channels: 8
  input_only: []
  reserved: []
citation: "https://docs.nordicsemi.com/bundle/nrf52840_dk_hw_user_guide"
```

2. Add it to the Known Boards table in `boards/README.md`
3. Add a `--board <id>` test in `test/compile.test.ts`

Board data **must come from vendor documentation** (cite it). A wrong profile
is worse than no profile — it rejects valid designs and generates wrong code.

---

## 10. Testing

### Test suites

| Suite | File | What it covers |
|---|---|---|
| Compile tests | `test/compile.test.ts` | Generates C++ for all examples; compiles with `g++`; links real or stub PulseHSM |
| Backend tests | `test/backends.test.ts` | Fixture YAML → generated output assertions (no compilation) |

### Test harness (`test/harness/`)

Platform stubs that let the host `g++` compile generated Arduino and ESP-IDF
code without the actual frameworks installed:

```
test/harness/
├── Arduino.h        ← digitalWrite, Serial, Wire, SPI, …
├── ArduinoOTA.h     ← OTA stub
├── HTTPClient.h     ← HTTP client stub
├── PubSubClient.h   ← MQTT stub
├── Adafruit_*.h     ← display library stubs
└── zephyr/          ← Zephyr stubs (Phase 1)
    ├── kernel.h     ← k_uptime_get, k_msleep, K_TIMER_DEFINE, …
    ├── drivers/
    │   ├── gpio.h   ← gpio_dt_spec, gpio_pin_set_dt, …
    │   └── uart.h   ← uart_poll_in, uart_poll_out
    └── net/         ← Phase 4
```

---

## 11. File Structure (Current)

```
pulse-ir/
├── src/
│   ├── model/
│   │   └── index.ts          IR type definitions
│   ├── parser/
│   │   ├── index.ts           YAML → IR + validation
│   │   ├── board-resolver.ts  logical pin → physical GPIO
│   │   ├── fs-resolver.ts     filesystem imports
│   │   └── resolver.ts        SourceResolver interface
│   ├── codegen/
│   │   ├── backend.ts         PlatformBackend interface
│   │   ├── index.ts           Codegen class (platform-agnostic traversal)
│   │   ├── interfaces.ts      InterfaceBackend (Arduino)
│   │   ├── arduino.ts         ArduinoBackend
│   │   ├── espidf_interfaces.ts EspIdfInterfaceBackend
│   │   ├── espidf.ts          EspIdfBackend
│   │   ├── micropython.ts     MicroPythonCodegen (standalone)
│   │   ├── zephyr_interfaces.ts ZephyrInterfaceBackend ← in progress
│   │   └── zephyr.ts          ZephyrBackend           ← in progress
│   ├── emit/
│   │   ├── topics.ts          MQTT topic manifest
│   │   ├── libraries.ts       library manifest
│   │   ├── diagram.ts         Mermaid diagram
│   │   ├── cmake.ts           ESP-IDF CMakeLists.txt
│   │   └── zephyr_project.ts  Zephyr project files   ← in progress
│   ├── analysis/
│   │   └── validate.ts        semantic validation (post-parse)
│   └── cli.ts                 CLI entry point
├── test/
│   ├── backends.test.ts       fixture tests
│   ├── compile.test.ts        compile + link tests
│   └── harness/               platform stub headers
├── boards/                    board profiles (YAML)
├── examples/                  8 worked models
├── deps/
│   ├── PulseHSM.h
│   └── PulseHSM.cpp
└── web/                       browser editor
    ├── index.html
    ├── main.ts
    └── app.js                 (committed bundle)
```

---

## 12. The Zephyr Backend Roadmap

### Phase 1 — Skeleton (current work)
Goal: `west build -b native_sim` compiles the generated project.

Files: `src/codegen/zephyr.ts`, `src/codegen/zephyr_interfaces.ts`,
`src/emit/zephyr_project.ts`, `test/harness/zephyr/`

### Phase 2 — GPIO, UART, I2C
Goal: Real hardware on ESP32 / nRF52840 / STM32.

Key design: `gpio_dt_spec` + naming convention. The `emitInterface()` for gpio
generates both `#define STATUS_LED_PIN 2` (numeric) and
`static const struct gpio_dt_spec STATUS_LED_GPIO = GPIO_DT_SPEC_GET(...)`.
`digitalWriteExpr(pin)` derives the variable by replacing the `_PIN` suffix
with `_GPIO`.

`prj.conf` is model-driven: `CONFIG_GPIO=y` when any GPIO resource is declared,
`CONFIG_I2C=y` for i2c buses, etc.

`app.overlay` provides devicetree aliases for each declared hardware binding.

### Phase 3 — Tasks → Zephyr threads
Tasks (`every: N`) become `k_timer` + system workqueue entries rather than
Arduino-style polling in the main loop.

### Phase 4 — WiFi, MQTT, HTTP, OTA
Platform-specific networking stubs with targeted TODOs. Zephyr networking is
board-specific; generated scaffolds point to the Zephyr documentation.

---

## 13. Key Design Decisions

### No expression field
The model has never had one and never will. A guard is a name; the condition
lives in C where it is type-checked and steppable. The moment `above:` exists
in a model, `below:`, `between:`, `and:` and `rate_of_change:` all have
obvious justifications and the line is gone. See FUNCTION_CONTRACT.md §6.

### Codegen calls through PlatformBackend — never tests `backend.name`
If you find yourself writing `if (backend.name === 'zephyr')` inside `Codegen`,
that logic belongs in a new method on `PlatformBackend` instead.

### Nothing appears that you did not declare
No `Serial.begin(115200)` without a declared `uart` bus. No PulseHSM include
without a declared `machine:`. A blink that declares one LED produces a sketch
with no Serial in it at all. A test asserts this against every shipped model.

### Credentials are never baked in
A binding key that looks like a secret (`password`, `token`, `key`) is emitted
as an empty placeholder with a TODO, whatever the model says.

### Board data must come from vendor documentation
Each profile cites its source. A wrong profile is worse than no profile — it
rejects valid designs and generates wrong code.

### Parameters are read every pass
`after: green_ms` re-reads the parameter each loop iteration, so retuning over
MQTT takes effect immediately rather than at the next reboot.
