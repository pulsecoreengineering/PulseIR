# PulseIR — Milestone Log

---

## Current: v0.4 — Multi-Backend + Driver Gaps (August 2026)

**Status**: All core gaps complete. Zephyr backend Phase 1 in progress.

### What was added since v0.1

#### v0.2 — ESP-IDF backend + board resolver
- `EspIdfBackend` (`--target espidf`) — `app_main()` + FreeRTOS loop
- `EspIdfInterfaceBackend` — GPIO/UART/I2C/SPI via IDF driver APIs
- `PlatformBackend` interface — the seam between Codegen and all targets
- Board resolver (`board-resolver.ts`) — logical pin names → physical GPIO
- Board profiles (`boards/*.yaml`) — esp32, esp32s3, pico, arduino_uno, arduino_mega, rp2040_pico
- Pin capability checker (input-only, reserved, ADC2/WiFi conflict)
- `--board <id>` CLI flag; `target: board:` in model
- `CmakeEmitter` — ESP-IDF CMakeLists.txt (`--cmake`)
- `DiagramEmitter` — Mermaid state diagram (`--diagram`)

#### v0.3 — MicroPython + diagnostics
- `MicroPythonCodegen` (`--target micropython`) — asyncio-based `main.py`
- Diagnostic print calls generated for state transitions and sensor reads
- `log:` template on tasks and commands
- Web editor: multi-file tabs, import/export zip, eight example projects

#### v0.4 — Driver gaps (Gaps 1–5)
- **Gap 1**: Bus sensor transactions — I2C/SPI sensor library init, `adc_read` driver
- **Gap 2**: Interrupt/ISR wiring — `attachInterrupt()` / IDF ISR; generated in `setupInterfaces()`
- **Gap 3**: Display support — Adafruit SSD1306, ST7735, ILI9341 stubs with init
- **Gap 4**: Power management — `sleep_control` driver; `esp_deep_sleep_start()`,
  `esp_light_sleep_start()`, timer + ext0 wakeup sources (ESP32 only)
- **Gap 5**: HTTP client + OTA — `http_get` / `http_post` action drivers (HTTPClient,
  bundled with ESP32/ESP8266 core); `ota` interface (ArduinoOTA); `loop:` emission
  added to `InterfaceEmission` for `ArduinoOTA.handle()`
- Fixed latent bug: state `entry:` / `exit:` actions were invisible to stub generation

---

## v0.1 — MVP (August 9, 2026)

The initial milestone: a working three-layer pipeline from YAML to Arduino sketch.

- IR types: `State`, `Event`, `Transition`, `Guard`, `Action`, `Resource`, `Parameter`
- Parser: YAML → IR with reference validation
- Arduino backend: generates complete `PulseHSM`-backed sketches
- CLI: `pulse-ir <file> --output <file>`
- `PulseHSM_config.h` sizing (fixed silent runtime sizing bug)
- `after:` timed transitions
- `tasks:` and `commands:` — machine-less projects
- Five gate projects passing: boiler, traffic_light, motor_controller, pump_tank, sensor_gateway
- LEDC API fork for ESP32 Arduino core 2.x vs 3.x

---

## Next milestone: v0.5 — Zephyr Phase 1

**Target**: `west build -b native_sim` compiles a generated Zephyr project.

Planned deliverables:
- `src/codegen/zephyr.ts` — `ZephyrBackend implements PlatformBackend`
- `src/codegen/zephyr_interfaces.ts` — `ZephyrInterfaceBackend`
- `src/emit/zephyr_project.ts` — `ZephyrProjectEmitter` (CMakeLists.txt, prj.conf)
- `test/harness/zephyr/` — Zephyr stub headers for g++ tests
- `--target zephyr` wired in CLI
- Fixture tests passing; `west build -b native_sim` passing in CI
