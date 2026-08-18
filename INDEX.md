# PulseIR Complete Repository Index

**Last Updated**: August 2026  
**Status**: Multi-backend, multi-target — Arduino, ESP-IDF, MicroPython, Zephyr (in progress)  
**Total**: 8000+ lines (code + documentation)

---

## 📚 Documentation (Start Here)

### For First-Time Users
1. **README.md** — What is PulseIR, backends overview, examples table
2. **QUICKSTART.md** — Hands-on tutorial: GPIO state machine + sensor/display walkthrough
3. **DEVICES.md** ⭐ **NEW** — All device types, YAML config, channels, drivers, required libraries
4. **TARGETS.md** ⭐ **NEW** — Arduino, ESP-IDF, MicroPython, Zephyr: generated output, build steps, feature matrix
5. **CUSTOM_DRIVERS.md** ⭐ **NEW** — How to add any unsupported hardware without touching the codegen

### For Understanding Design
5. **ARCHITECTURE.md** — Why it's built this way, layer overview
6. **FUNCTION_CONTRACT.md** ⭐ — Guard/action binding specification (portable across all targets)

### For Implementation Details
7. **INTEGRATION.md** — How codegen integrates with PulseHSM
8. **SYSTEMCONTEXT.md** — How guards and actions receive system state through `ctx`

### For Project Status
9. **PLAN.md** — Where the project is going, open decisions
10. **MILESTONE.md** — What was built, scope, roadmap

---

## 🔧 Source Code (TypeScript/Node)

### Layer 1: Intermediate Representation
- **src/model/types.ts** (400 lines)
  - 5 enums (StateType, EventSource, ActionType, ComponentClass, InterfaceType)
  - 12 interfaces (State, Event, Transition, Guard, Action, Component, Resource, Parameter, Region, PulseSystem, PulseProject)
  - Full type system for embedded systems automation

### Layer 2: Parser (YAML → IR)
- **src/parser/index.ts** (250 lines)
  - Load YAML files
  - Map to PulseModel types
  - Validate event/state references
  - Error reporting with line numbers
  - Tested ✅

### Layer 3: Code Generator (IR → target code)

- **src/codegen/index.ts** — platform-agnostic IR traversal; delegates platform calls to the injected backend
  - Sizes `PULSEHSM_MAX_*` macros from the model
  - Registers every state via `addState()`, parents before children
  - Emits one `onEvent` handler per state
  - Resolves composite targets to a leaf before `transitionTo()`
  - Generates `SystemContext` / `SystemParameters` / `SystemSensors`
  - Generates guard and action stubs
  - BUS_SENSOR_DEFS registry: ds18b20, dht22, dht11, bme280, lcd_i2c, oled_i2c, ds3231, ds1307
  - Tested ✅

- **src/codegen/arduino.ts** — Arduino backend (default)
- **src/codegen/espidf.ts** — ESP-IDF backend (FreeRTOS / app_main)
- **src/codegen/espidf_interfaces.ts** — ESP-IDF interface emission
- **src/codegen/micropython.ts** — MicroPython backend (asyncio / main.py)
- **src/codegen/zephyr.ts** — Zephyr RTOS backend (in progress)
- **src/codegen/zephyr_interfaces.ts** — Zephyr interface emission

### Interface Backend (IR → platform calls)
- **src/codegen/interfaces.ts** — `InterfaceEmission` type; shared interface contract
- **src/codegen/backend.ts** — `PlatformBackend` interface all backends implement

### Consumer 2: MQTT Topic Manifest (IR → JSON)
- **src/emit/topics.ts** ⭐
  - The first consumer of the IR that is **not** a code generator
  - Sensors → publish topics; parameters → setpoint topics carrying type,
    unit, default and range; leaf states → a `state` topic
  - Only events declared `source: mqtt` are exposed as remote commands
  - Device and dashboard derive their topics from one model, so a renamed
    sensor cannot silently blank a chart

### Consumer 3: Library Manifest (IR → JSON)
- **src/emit/libraries.ts**
  - Merges libraries implied by interfaces with those the model declares
  - Emits PlatformIO `lib_deps`, excluding core-bundled libraries

### Consumer 4: Web Editor (IR → live browser preview)
- **web/main.ts** ⭐
  - Runs the real Parser / Codegen / TopicEmitter as a browser bundle, so the
    editor cannot drift from the CLI
  - Live panes: generated sketch, MQTT manifest, library manifest, and a
    structure view showing composite-state descent, inner-vs-outer transition
    precedence, and declared interfaces
  - Multi-file models: one tab per file, with the open buffers acting as the
    filesystem via MemoryResolver, so `include` resolves between tabs
  - Errors are reported in place; panes keep the last valid output, labelled
  - Entirely offline: no server, no upload, no CDN
- **src/analysis/states.ts** — shared hierarchy walk (leaves, entry descent,
  path resolution), used by both the topic emitter and the editor

### CLI & Utils
- **src/cli.ts** — Command-line interface (`--output`, `--topics`, `--namespace`)
- **src/model/index.ts** — Re-export all types

---

## 🧪 Tests & Examples

### Tests (All Passing ✅)
- **test/parser.test.ts**
  - Validates YAML parsing
  - Tests boiler.yaml example
  - Output: 5 events, 3 states, 5 transitions parsed correctly

- **test/codegen.test.ts**
  - Smoke test: generates a sketch from boiler.yaml and writes it to dist/

- **test/validation.test.ts**
  - Parser reference checking: unknown/ambiguous/duplicate states, bad events,
    wildcard targets, malformed guards, and the `guard: <name>` string form

- **test/multifile.test.ts**
  - Include merging and order, relative resolution, cycles, missing files,
    duplicate names across files, and the no-resolver error path

- **test/analysis.test.ts**
  - Hierarchy walk: pre-order flattening, initial-child qualification, entry
    descent through nested composites, ambiguous-name refusal

- **test/web.test.ts**
  - Fails if the committed bundle or the baked examples go stale, and if the
    page ever references an external resource

- **test/topics.test.ts**
  - Topic shape, parameter metadata, wildcard-safe segments, and that only
    `source: mqtt` events become remotely triggerable commands

- **test/compile.test.ts** ⭐
  - Compiles the generated sketch with `g++ -Wall -Wextra -Werror`, links it
    against `deps/PulseHSM.cpp`, **runs it**, and asserts the dispatch trace
  - Catches what a string-comparison test cannot: syntax errors, undefined
    symbols, and wrong runtime behaviour
  - Skips itself when no host compiler is available

### Fixtures & Harness
- **test/fixtures/hierarchy.yaml** — nested entry, inner-vs-outer precedence,
  multi-action transitions, named guards
- **test/harness/Arduino.h** — minimal host shim so sketches build with g++
- **test/harness/serial.cpp** — provides the `Serial` global

### Examples

| Model | What it demonstrates |
|-------|---------------------|
| `blink.yaml` | No state machine — one task, one interval |
| `serial_console.yaml` | `commands:` serial dispatch, baud rate from the model |
| `rtc_clock.yaml` | DS3231 RTC + I2C LCD — no C written at all |
| `traffic_light.yaml` | Hierarchical states, pedestrian request, night mode |
| `motor_controller.yaml` | Speed phases, ramp arithmetic in C, wildcard trip |
| `pump_tank.yaml` | Float-switch hysteresis, dry-run and overfill protection |
| `boiler/` | Multi-file model, hierarchy, guarded transitions |
| `greenhouse/` | All interface kinds, implied libraries, MQTT events |
| `sensor_gateway/` | Four buses, TLS uplink, sampling while disconnected |

All examples are compiled and run by the test suite. They also open in the web editor from the dropdown unchanged.

---

## 📖 Reference & Dependencies

### PulseHSM Runtime (Reference)
- **deps/PulseHSM.h** (75 lines)
  - State machine API used by generated code
  - Zero-heap, ISR-safe
  - Included for reference

- **deps/PulseHSM.cpp** (150 lines)
  - Implementation
  - Entry/exit chains, LCA algorithm
  - Event queue, transition logic

---

## 🏗️ Configuration

- **package.json** — Dependencies (js-yaml, TypeScript)
- **tsconfig.json** — TypeScript configuration (ES2020, ESM)
- **.gitignore** — Ignore node_modules, dist

---

## 📊 Reading Guide by Role

### I'm new to PulseIR
1. **QUICKSTART.md** — write YAML, generate a sketch, see it run
2. **DEVICES.md** — look up the sensor or display you are wiring
3. **TARGETS.md** — pick the right `--target` and build steps for your toolchain

### I'm building a state-machine system
1. **QUICKSTART.md** → "Common Patterns" section
2. **README.md** → Schema section and examples table
3. **FUNCTION_CONTRACT.md** → guard/action signatures you must implement

### I'm integrating with PulseCore IDE
1. **ARCHITECTURE.md** — layer overview and IR types
2. **FUNCTION_CONTRACT.md** — what the IR guarantees
3. Import `PulseProject` types from `src/model/index.ts`

### I'm adding a new backend or device type
1. **ARCHITECTURE.md** — how backends plug in
2. **src/codegen/backend.ts** — the `PlatformBackend` interface to implement
3. **src/codegen/index.ts** — `BUS_SENSOR_DEFS` to add a new device type
4. **TARGETS.md** — what the existing backends cover

---

## 🚀 Quick Commands

```bash
# Build
npm run build

# Test
npm run test

# Generate Arduino sketch (default target)
node dist/src/cli.js examples/rtc_clock.yaml --outdir build/rtc_clock

# Generate ESP-IDF project
node dist/src/cli.js examples/boiler/pulse.yaml --target espidf --outdir build/boiler

# Generate MicroPython
node dist/src/cli.js examples/blink.yaml --target micropython --output main.py

# Generate Zephyr (in progress)
node dist/src/cli.js examples/blink.yaml --target zephyr --outdir build/zephyr_blink

# MQTT topic manifest
node dist/src/cli.js examples/boiler/pulse.yaml --topics topics.json

# Library manifest (PlatformIO lib_deps)
node dist/src/cli.js examples/boiler/pulse.yaml --libraries libraries.json

# Web editor (no rebuild needed)
npm run serve

# Rebuild editor bundle first, then serve
npm run web
```

---

## 🗺️ Architecture Overview

```
YAML Input
   ↓
Parser (validation)
   ↓
PulseModel IR
   ↓
Codegen (shape generation)
   ↓
Arduino Sketch
   ↓
User fills in logic
   ↓
Deploy
```

---

## 📋 File Manifest

```
PulseIR/
├── README.md                        Overview, backends, examples, schema
├── QUICKSTART.md                    Tutorial: GPIO + sensor/display walkthrough
├── DEVICES.md                       ⭐ All device types, drivers, libraries
├── TARGETS.md                       ⭐ Arduino/ESP-IDF/MicroPython/Zephyr details
├── CUSTOM_DRIVERS.md                ⭐ Custom hardware without touching codegen
├── ARCHITECTURE.md                  Design rationale and layer overview
├── FUNCTION_CONTRACT.md             Guard/action binding spec (all targets)
├── SYSTEMCONTEXT.md                 How guards/actions receive system state
├── INTEGRATION.md                   How codegen integrates with PulseHSM
├── PLAN.md                          Roadmap and open decisions
├── MILESTONE.md                     Build history and scope
├── INDEX.md                         This file
│
├── src/
│   ├── model/
│   │   ├── types.ts                 IR type definitions
│   │   └── index.ts                 Re-exports
│   ├── parser/
│   │   └── index.ts                 YAML → IR + validation
│   ├── codegen/
│   │   ├── index.ts                 IR traversal, device registry, driver dispatch
│   │   ├── backend.ts               PlatformBackend interface
│   │   ├── interfaces.ts            InterfaceEmission type
│   │   ├── arduino.ts               Arduino backend
│   │   ├── espidf.ts                ESP-IDF backend
│   │   ├── espidf_interfaces.ts     ESP-IDF interface emission
│   │   ├── micropython.ts           MicroPython backend
│   │   ├── zephyr.ts                Zephyr backend (in progress)
│   │   └── zephyr_interfaces.ts     Zephyr interface emission
│   ├── emit/
│   │   ├── topics.ts                IR → MQTT topic manifest
│   │   └── libraries.ts             IR → library manifest (PlatformIO lib_deps)
│   ├── analysis/
│   │   ├── states.ts                Hierarchy walk (leaves, entry descent)
│   │   └── template.ts              log:/format: template parser
│   └── cli.ts                       CLI entry point
│
├── vscode/                          VS Code extension
│   ├── client/                      Extension client (activation, commands)
│   ├── server/                      Language server (diagnostics, hovers)
│   ├── syntaxes/                    TextMate grammar for .pulse.yaml
│   └── package.json                 Extension manifest
│
├── web/                             Browser editor
│   ├── index.html                   UI shell
│   ├── main.ts                      Glue — runs the real parser + codegen
│   ├── examples.ts                  Generated example registry
│   └── app.js                       Committed bundle (npm run web to rebuild)
│
├── scripts/
│   ├── build-examples.mjs           Bakes models into the editor bundle
│   ├── build-web.mjs                Bundles the editor
│   └── serve.mjs                    Static file server
│
├── test/
│   ├── parser.test.ts               Parser smoke + boiler model
│   ├── codegen.test.ts              Codegen smoke test
│   ├── backends.test.ts             Per-driver output assertions
│   ├── validation.test.ts           Reference validation (unknown states, events…)
│   ├── topics.test.ts               MQTT manifest shape
│   ├── analysis.test.ts             Hierarchy walk
│   ├── web.test.ts                  Editor freshness check
│   ├── compile.test.ts              Compile + link + run (catches syntax errors)
│   ├── fixtures/
│   │   └── hierarchy.yaml           Dispatch semantics fixture
│   └── harness/
│       ├── Arduino.h                Host shim for g++ builds
│       └── serial.cpp               Serial global
│
├── examples/
│   ├── blink.yaml                   One task, no state machine
│   ├── serial_console.yaml          Commands over serial
│   ├── rtc_clock.yaml               DS3231 + I2C LCD — no C
│   ├── traffic_light.yaml           Hierarchical states
│   ├── motor_controller.yaml        Speed phases, wildcard trip
│   ├── pump_tank.yaml               Hysteresis, protection
│   ├── boiler/                      Multi-file, hierarchy, guards
│   ├── greenhouse/                  Interfaces, libraries, MQTT
│   └── sensor_gateway/              Four buses, TLS uplink
│
├── deps/
│   ├── PulseHSM.h                   PulseHSM runtime header
│   └── PulseHSM.cpp                 PulseHSM implementation
│
└── package.json / tsconfig.json / .gitignore
```

---

## 📊 Statistics

| Metric | Count |
|--------|-------|
| TypeScript source lines | ~4000 |
| Documentation lines | ~3000 |
| Example/test lines | ~1500 |
| **Total** | ~8000+ |
| **Source files** | 15+ |
| **Doc files** | 12 |
| **Test files** | 8 |
| **Supported targets** | 4 (Arduino, ESP-IDF, MicroPython, Zephyr) |
| **Supported device types** | 12 (digital, PWM, ADC, DHT, DS18B20, BME280, RTC, LCD, OLED) |

---

## ✅ What's Complete

- [x] Three-layer architecture (Model → Parser → Codegen)
- [x] YAML parser with hierarchical reference validation
- [x] Arduino backend (production-ready)
- [x] ESP-IDF backend (production-ready)
- [x] MicroPython backend (beta)
- [x] Zephyr RTOS backend (in progress)
- [x] PlatformBackend plugin interface — new backends are self-contained
- [x] BUS_SENSOR_DEFS device registry (8 device types)
- [x] Hierarchical dispatch: entry into composite states, event bubbling
- [x] SystemContext / SystemParameters / SystemSensors generation
- [x] Guard and action stubs matching FUNCTION_CONTRACT.md (portable across all targets)
- [x] Multiple actions per transition; wildcard transitions
- [x] `tasks:` scheduling (exact-rate, resyncing)
- [x] `commands:` serial console with non-blocking line assembly
- [x] `log:` template printing (sensor + parameter refs, no printf-float)
- [x] Interrupts (ISR stubs + `attachInterrupt`)
- [x] DHT22/DHT11, DS18B20, BME280, DS3231/DS1307 sensor drivers
- [x] LCD I2C and OLED SSD1306 display drivers
- [x] HTTP client (`http_get` / `http_post`)
- [x] Deep sleep / light sleep control
- [x] NVS parameter persistence (ESP32)
- [x] Multi-file models with `imports:`
- [x] VS Code extension with diagnostics and code generation
- [x] Web editor (real parser + codegen in browser, multi-file, offline)
- [x] MQTT topic manifest emitter
- [x] Library manifest emitter (PlatformIO lib_deps)
- [x] Compile-and-run test coverage
- [x] Nine worked examples, all compiled by the test suite

---

## ⏳ What's Next

The roadmap now lives in **PLAN.md**, which adopts the direction that PulseIR
describes *what an embedded system is* while C/C++ stays the language for
*how arbitrary computation happens*.

Summary of the order of work:

1. **Phase 0 — reshape the schema** (breaking, cheap now): split the top level
   into `target` / `hardware` / `parameters` / `events` / `machine` / `actions`,
   and adopt `from` / `on` / `to` / `do` for transitions.
2. **Phase 1 — target, hardware model and validation**: pin conflict detection
   first (cheap, and the clearest case for a compiler over hand-written code),
   then `target: board:`, one verified board profile, and logical device types.
3. **Gate — five different projects** must fit the model without hacks before
   any new domain is added.
4. **Phase 2 — one domain at a time**: communication, telemetry, storage,
   diagnostics, safety.

Open decisions, and the two places the proposal needs pushback (`limits:`
quietly reintroduces expression evaluation; safety `priority` needs runtime
support PulseHSM does not have), are recorded in PLAN.md §6 and §8.

---

## 🎯 Key Decisions

1. **Binding spec first** — FUNCTION_CONTRACT.md defines guard/action contract across all targets
2. **YAML is never a language** — No expressions, no logic, only names. The
   schema has no expression field and the parser rejects the retired one, so
   this is enforced rather than merely intended (FUNCTION_CONTRACT.md §6)
3. **Platform-agnostic IR** — Same model, different scaffolding per target
4. **Validation early** — Parser catches typos, codegen assumes valid input
5. **Generate shape, not behavior** — Codegen produces stubs, user implements logic

---

## 📞 How to Use This Repo

### Clone & Setup
```bash
cd /home/claude/pulse-ir
npm install
npm run build
```

### Run Tests
```bash
node dist/test/parser.test.js
node dist/test/codegen.test.js
```

### Generate Code
```bash
node dist/src/cli.js examples/boiler.yaml --output my_system.ino
```

### Read Documentation
```bash
# Start here:
cat QUICKSTART.md

# Understand design:
cat ARCHITECTURE.md

# Learn the contract:
cat FUNCTION_CONTRACT.md
```

---

## 🤝 Contributing

When extending PulseIR:

1. **Read FUNCTION_CONTRACT.md first** — It's the binding spec
2. **Update docs when you change code** — Keep them in sync
3. **Add tests for new features** — test/ folder
4. **Follow naming conventions** — guard_*, action_*
5. **Preserve SystemContext contract** — Don't change signatures lightly

---

## 📝 Last Updated

August 2026  
Status: Multi-backend, multi-target; VS Code extension; nine examples  
Ready for: Production use on Arduino and ESP-IDF; beta MicroPython; Zephyr in progress
