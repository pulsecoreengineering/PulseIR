# PulseIR Complete Repository Index

**Last Updated**: August 9, 2026  
**Status**: MVP Complete + Function Contract  
**Total**: 4500+ lines (code + documentation)

---

## 📚 Documentation (Start Here)

### For First-Time Users
1. **README.md** (100 lines) — What is PulseIR?
2. **QUICKSTART.md** (400 lines) — 5-minute hands-on tutorial

### For Understanding Design
3. **ARCHITECTURE.md** (500 lines) — Why it's built this way
4. **FUNCTION_CONTRACT.md** (300 lines) ⭐ — Guard/action binding spec

### For Implementation Details
5. **INTEGRATION.md** (600 lines) — How codegen uses PulseHSM
6. **SYSTEMCONTEXT.md** ⭐ **NEW** — How guards/actions receive system state

### For Project Status
6. **PLAN.md** ⭐ **NEW** — Where the project is going, and why
7. **MILESTONE.md** (200 lines) — What was built, scope, roadmap
7. **BUILD_SUMMARY.txt** — Visual summary of the MVP

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

### Layer 3: Code Generator (IR → C++)
- **src/codegen/index.ts**
  - Sizes `PULSEHSM_MAX_*` macros from the model (emitted before the include)
  - Registers every state via `addState()`, parents before children
  - Emits one `onEvent` handler per state; bubbling gives inner-wins precedence
  - Resolves composite targets to a leaf before `transitionTo()`
  - Generates `SystemContext` / `SystemParameters` / `SystemSensors`
  - Generates guard and action stubs with the FUNCTION_CONTRACT signatures
  - Tested ✅ (compiled, linked and executed — see test/compile.test.ts)

### Interface Backend (IR → platform calls)
- **src/codegen/interfaces.ts** ⭐
  - Turns `Resource` declarations into includes, `#define`s and `begin()` calls
  - Knows the Arduino platform so the IR does not have to; an ESP-IDF backend
    would translate the same model differently
  - Board-specific calls sit behind preprocessor guards rather than assumptions
  - Credential-shaped binding keys are emitted as blank placeholders, never
    with a value from the model

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
- **examples/greenhouse/** ⭐ — multi-file model exercising `include`, every
  interface kind, implied and declared libraries, and an MQTT-triggerable event
- **examples/boiler.yaml** (180 lines)
  - Complete industrial system: boiler temperature control
  - Hierarchical states (running/heating/cooling/maintaining)
  - Guarded transitions
  - Multiple actions
  - Components, resources, parameters
  - Real-world use case

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

### I'm a Student
1. Read **QUICKSTART.md**
2. Write your first YAML
3. Generate an Arduino sketch
4. Fill in the action logic

### I'm an Engineer
1. Read **ARCHITECTURE.md**
2. Review **FUNCTION_CONTRACT.md** (binding spec)
3. Read **INTEGRATION.md** (how it works with PulseHSM)
4. Review the source code in src/

### I'm Integrating with PulseCore IDE
1. Read **ARCHITECTURE.md** (layers)
2. Study **FUNCTION_CONTRACT.md** (what the IR needs)
3. Integrate parser to convert IDE state → YAML
4. Follow naming/signature conventions

### I'm Building a Simulator (PulseSim)
1. Read **ARCHITECTURE.md** (IR structure)
2. Load generated YAML IR
3. Import PulseModel types
4. Implement state transitions, event dispatch, guards

### I'm Creating ESP-IDF Codegen
1. Read **FUNCTION_CONTRACT.md** (binding spec)
2. Review Arduino codegen in src/codegen/
3. Replace Arduino scaffolding with ESP-IDF/FreeRTOS
4. Keep guard/action signatures identical
5. Follow same naming convention

---

## 🚀 Quick Commands

```bash
# Build
npm run build

# Test
npm run test

# Generate code
node dist/src/cli.js examples/boiler.yaml --output boiler.ino

# Generate the MQTT topic manifest for PulseDash
node dist/src/cli.js examples/boiler.yaml --topics topics.json --namespace pulsecompiler

# Web editor: serve the committed bundle (or just open web/index.html)
npm run serve

# Rebuild the bundle first, then serve (needs esbuild)
npm run web

# View generated code
cat boiler.ino
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
pulse-ir/
├── Documentation/
│   ├── README.md                    (Overview)
│   ├── QUICKSTART.md                (Tutorial)
│   ├── ARCHITECTURE.md              (Design)
│   ├── FUNCTION_CONTRACT.md         (Binding spec) ⭐
│   ├── SYSTEMCONTEXT.md             (Context struct) ⭐
│   ├── INTEGRATION.md               (PulseHSM)
│   ├── MILESTONE.md                 (Status)
│   ├── BUILD_SUMMARY.txt            (Visual)
│   └── INDEX.md                     (This file)
│
├── src/
│   ├── model/
│   │   ├── types.ts                 (IR definitions)
│   │   └── index.ts                 (Exports)
│   ├── parser/
│   │   └── index.ts                 (YAML → IR)
│   ├── codegen/
│   │   └── index.ts                 (IR → C++)
│   ├── emit/
│   │   └── topics.ts                (IR → MQTT manifest) ⭐
│   ├── analysis/
│   │   └── states.ts                (Shared hierarchy walk)
│   └── cli.ts                       (CLI)
│
├── web/                             (Browser editor) ⭐
│   ├── index.html                   (UI)
│   ├── main.ts                      (Glue - runs the real pipeline)
│   ├── examples.ts                  (Generated from the models on disk)
│   └── app.js                       (Generated bundle, committed)
│
├── scripts/
│   ├── build-examples.mjs           (Bakes models into the editor)
│   ├── build-web.mjs                (Bundles the editor)
│   └── serve.mjs                    (Static server)
│
├── test/
│   ├── parser.test.ts               (Parser smoke test)
│   ├── codegen.test.ts              (Codegen smoke test)
│   ├── validation.test.ts           (Reference validation)
│   ├── topics.test.ts               (MQTT manifest)
│   ├── analysis.test.ts             (Hierarchy walk)
│   ├── web.test.ts                  (Editor build freshness)
│   ├── compile.test.ts              (Compile + link + run) ⭐
│   ├── fixtures/
│   │   └── hierarchy.yaml           (Dispatch semantics fixture)
│   └── harness/
│       ├── Arduino.h                (Host shim)
│       └── serial.cpp               (Serial global)
│
├── examples/
│   └── boiler.yaml                  (Full example)
│
├── deps/
│   ├── PulseHSM.h                   (Runtime reference)
│   └── PulseHSM.cpp                 (Implementation)
│
└── Config
    ├── package.json
    ├── tsconfig.json
    └── .gitignore
```

---

## 📊 Statistics

| Metric | Count |
|--------|-------|
| TypeScript source lines | ~1000 |
| Documentation lines | ~1500 |
| Example/test lines | ~400 |
| **Total** | ~4500 |
| **Source files** | 8 |
| **Doc files** | 8 |
| **Test files** | 2 |

---

## ✅ What's Complete

- [x] Three-layer architecture (Model → Parser → Codegen)
- [x] YAML parser with hierarchical reference validation
- [x] C++ code generator targeting the PulseHSM runtime
- [x] Hierarchical dispatch: entry into composite states, event bubbling
- [x] SystemContext / SystemParameters / SystemSensors generation
- [x] Guard and action stubs matching FUNCTION_CONTRACT.md
- [x] Multiple actions per transition
- [x] Wildcard (`source: "*"`) transitions via a synthetic root superstate
- [x] Full documentation (6 guides)
- [x] Compile-and-run test coverage
- [x] Real-world example (boiler system)
- [x] CLI interface

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

Generated: August 9, 2026  
Status: MVP Complete  
Location: /home/claude/pulse-ir/  
Ready for: Production use & extension
