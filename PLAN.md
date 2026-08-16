# PulseIR — Roadmap

**Status**: Multi-backend, all core features complete. Zephyr backend Phase 1 in progress.
**Last updated**: August 2026

---

## The Rule (permanent)

> **If it describes structure, relationships, configuration, state, events,
> resources or system policy — it belongs in the model.**
>
> **If it describes arbitrary computation, algorithms or data manipulation — it
> belongs in C/C++.**

---

## What is done

### Phase 0 — Schema and IR ✅

- Top-level split: `target` / `hardware` / `parameters` / `events` / `machine` / `actions` / `libraries`
- `from` / `on` / `to` / `do` + `after:` for timed transitions
- `tasks:` — periodic work without a state machine
- `commands:` — text-to-action dispatch from a declared UART
- `log:` template on tasks and commands
- `imports:` for multi-file models (merge semantics, cycle detection)
- `machine:` is optional — a blink or serial-only model generates no PulseHSM at all
- Actions catalogue with `driver:` and `params:`; identity is the action name, not the driver

### Phase 1 — Board, hardware, validation ✅

- Pin conflict detection (normalised GPIO spellings compare equal)
- Board profiles: `boards/*.yaml` with logical pin maps and capability declarations
- Board resolver: `--board <id>` or `target: board:` in the model
- Pin capability checking: input-only, reserved, ADC2/WiFi conflict
- Framework compatibility warnings (wrong backend for board)
- `assertKnownInterface` covering: gpio, pwm, adc, uart, i2c, spi, can, onewire,
  wifi, ethernet, ble, mqtt, eeprom, littlefs, ota, custom

### Gate — Five projects ✅

All five compile with `-Werror`, link against the real PulseHSM runtime, and run:

| Project | States | What it exercises |
|---|---|---|
| `boiler/` | 4 | Hierarchy, guards, wildcard fault |
| `traffic_light.yaml` | 6 | Timed phases, night mode |
| `motor_controller.yaml` | 8 | Phases, wildcard trip |
| `pump_tank.yaml` | 7 | Hysteresis, two timers on one state |
| `sensor_gateway/` | 11 | Four buses, MQTT+TLS, degraded operation |

Key findings that came out of the gate and were fixed:
- **Runtime sizing bug**: `PULSEHSM_MAX_STATES` not seen by `PulseHSM.cpp` → moved to `PulseHSM_config.h`
- **`after:` on transitions** (not states): timed transitions with guards, actions, parameters
- **`tasks:` and `commands:`**: machine-less projects work; all three sections compose correctly
- **LEDC API fork**: ESP32 Arduino core 2.x vs 3.x have incompatible `ledcSetup` API; `#ifdef ESP_ARDUINO_VERSION_MAJOR` fork generated

### Multi-backend ✅

| Backend | Target flag | File extension | Entry point |
|---|---|---|---|
| Arduino | `--target arduino` (default) | `.ino` | `setup()` + `loop()` |
| ESP-IDF | `--target espidf` | `.cpp` | `app_main()` (FreeRTOS) |
| MicroPython | `--target micropython` | `.py` | `main()` (asyncio) |

### Driver gaps ✅

Implemented after multi-backend, filling the main built-in driver gaps:

| Gap | Drivers added | Notes |
|---|---|---|
| Gap 1: Bus sensor transactions | `adc_read`, I2C/SPI sensor init | Full `InterfaceEmission` per bus type |
| Gap 2: Interrupt / ISR wiring | `attachInterrupt()` / IDF ISR | Generated in `setupInterfaces()` |
| Gap 3: Display support | Adafruit SSD1306, ST7735, ILI9341 | Library stubs + init + TODO stubs |
| Gap 4: Power management | `sleep_control` driver | `esp_deep_sleep_start()`, `esp_light_sleep_start()`, timer + ext0 wakeup |
| Gap 5: HTTP client + OTA | `http_get`, `http_post`, `ota` interface | HTTPClient (bundled core), ArduinoOTA with `loop:` emission |

State `entry:` and `exit:` actions are now indexed correctly — they were
invisible to action stub generation before Gap 4.

### Web editor ✅

- Live output: sketch + topics + libraries + diagram as you type
- Multi-file model editing (tabs act as the filesystem)
- Import/export as `.zip`; eight example projects in the dropdown
- YAML syntax highlighting without editor libraries
- `npm run check:editor` verifies pixel-alignment in a real browser

---

## In progress — Zephyr backend

`--target zephyr` generates a west-compatible project that compiles on any
Zephyr-supported board. See ARCHITECTURE.md §12 for the full design.

### Phase 1 — Skeleton (current) 🔄

**Goal**: `west build -b native_sim` passes. No hardware required.

Files to create:
- `src/codegen/zephyr.ts` — `ZephyrBackend implements PlatformBackend`
- `src/codegen/zephyr_interfaces.ts` — `ZephyrInterfaceBackend`
- `src/emit/zephyr_project.ts` — `ZephyrProjectEmitter` (CMakeLists.txt, prj.conf)
- `test/harness/zephyr/` — stub headers for g++ compilation tests
- Wire into `src/cli.ts`: case `'zephyr'` in `resolveBackend()`, new target in USAGE

**Test**: new fixture suite in `test/backends.test.ts`; `west build -b native_sim`
in a separate CI workflow using the Zephyr Docker image.

### Phase 2 — GPIO, UART, I2C 🔲

- Full `gpio_dt_spec` init in `ZephyrInterfaceBackend`
- `gpio_pin_configure_dt()` in init, `gpio_pin_set_dt()` / `gpio_pin_get_dt()` in action bodies
- Naming convention: `FOO_PIN` define → `FOO_GPIO` gpio_dt_spec; `digitalWriteExpr` derives by suffix
- `app.overlay` generation (devicetree aliases from hardware bindings)
- `prj.conf` derives `CONFIG_GPIO=y`, `CONFIG_I2C=y`, etc. from declared resources
- Add `zephyr_board` field to all `boards/*.yaml`
- Test on real hardware: ESP32 + nRF52840 DK

### Phase 3 — Tasks → Zephyr threads 🔲

- `tasks:` generate `K_TIMER_DEFINE` + `k_work_submit` (system workqueue)
- No per-task stack sizing needed; simpler than `K_THREAD_DEFINE`
- Main `while(1)` loop still runs for HSM ticking
- Loop task-polling check skipped when Zephyr backend active

### Phase 4 — WiFi, MQTT, HTTP, OTA 🔲

Compilable stubs with targeted TODOs pointing to Zephyr documentation:

| Interface | Zephyr mechanism | prj.conf |
|---|---|---|
| `wifi` | `net_mgmt` + board driver | `CONFIG_WIFI=y` |
| `mqtt` | `zephyr/net/mqtt.h` | `CONFIG_MQTT_LIB=y` |
| `http_get/post` | `zephyr/net/http/client.h` | `CONFIG_HTTP_CLIENT=y` |
| `ota` | MCUboot + `dfu/mcuboot.h` | `CONFIG_BOOTLOADER_MCUBOOT=y` |

---

## Board compatibility roadmap

### Currently supported (all backends)

`arduino_uno`, `arduino_mega`, `esp32`, `esp32_devkit_v4`, `esp32s3`,
`esp32_s3_devkit`, `pico`, `rp2040_pico`

### Planned (Zephyr Phase 2+)

These boards need a `boards/*.yaml` entry with a verified `zephyr_board` field
and pin map sourced from vendor documentation:

| Board ID | Zephyr target | Priority |
|---|---|---|
| `nrf52840_dk` | `nrf52840dk_nrf52840` | High — popular Zephyr dev board |
| `nrf5340_dk` | `nrf5340dk_nrf5340_cpuapp` | High |
| `stm32f4_disco` | `stm32f4_disco` | Medium |
| `nucleo_f767zi` | `nucleo_f767zi` | Medium |
| `mimxrt1060_evk` | `mimxrt1060_evk` | Medium |
| `bl5340_dvk` | `bl5340_dvk` | Low |
| `bbc_microbit_v2` | `bbc_microbit_v2` | Low (educational) |

Each board needs:
1. `boards/<id>.yaml` with `zephyr_board:` field and full pin map
2. At least one test model in `examples/` that runs on it
3. A citation to the vendor's hardware user guide

---

## Future domains (post-Zephyr)

These extend the model schema. Each must pass the §1 rule before it is built.

| Domain | Notes | Status |
|---|---|---|
| `communication:` | Firmware side of the existing topic manifest | Medium priority |
| `telemetry:` | Sensor sampling intervals as model data | After communication |
| `storage:` | Which parameters persist to NVS/EEPROM/LittleFS | Small, self-contained |
| `diagnostics:` | Watchdog, heartbeat, log level | Config not logic |
| `safety:` | Named guards + policy metadata (severity, latching) | Design needed first |

### `safety:` design note

`limits:` with `above:` / `below:` introduces an expression evaluator —
a camel's nose for arithmetic, comparisons, and eventually `&&` and functions.
The alternative that keeps the rule intact:

```yaml
limits:
  over_temperature:
    check: guard_over_safe_temp   # you implement this in C
    severity: critical
    response: [shutdown_all]
    latching: true
```

The compiler knows this is a safety policy and generates the wiring. It evaluates nothing.

### `to: stay` (internal transitions)

`traffic_light` uses self-transitions to latch pedestrian requests. When
entry/exit actions exist, a self-transition re-runs them; an internal one must not.
Defer until entry/exit actions are implemented, then add `to: stay` (internal)
alongside the existing `to: self` self-transition.

---

## Decisions record

| Decision | Choice | Rationale |
|---|---|---|
| Expression field | Removed permanently | Any evaluable condition grows into a language |
| `after:` location | On transitions, not states | States can't carry guards or actions |
| Tasks | k_timer + workqueue (Zephyr) | No per-thread stack sizing debates |
| GPIO (Zephyr) | gpio_dt_spec + naming convention | DT-backed; `_PIN → _GPIO` suffix derives variable |
| prj.conf | Model-driven | Users shouldn't need to know which CONFIG_* their model needs |
| Board data | From vendor docs, cited | A wrong profile is worse than no profile |
| Credentials | Never baked in | Models belong in version control; passwords do not |
