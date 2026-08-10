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
6. **MILESTONE.md** (200 lines) — What was built, scope, roadmap
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

### Consumer 2: MQTT Topic Manifest (IR → JSON)
- **src/emit/topics.ts** ⭐
  - The first consumer of the IR that is **not** a code generator
  - Sensors → publish topics; parameters → setpoint topics carrying type,
    unit, default and range; leaf states → a `state` topic
  - Only events declared `source: mqtt` are exposed as remote commands
  - Device and dashboard derive their topics from one model, so a renamed
    sensor cannot silently blank a chart

### Consumer 3: Web Editor (IR → live browser preview)
- **web/main.ts** ⭐
  - Runs the real Parser / Codegen / TopicEmitter as a browser bundle, so the
    editor cannot drift from the CLI
  - Live panes: generated sketch, MQTT manifest, and a structure view that
    shows composite-state descent and inner-vs-outer transition precedence
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

# Web editor (or just open web/index.html)
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

Ordered by what the project is actually *for*: reducing the cognitive load of
learning a multi-tool ecosystem. PulseIR pays for itself only if it removes the
incidental complexity of each tool's flavour — not if it becomes one more thing
to learn on top of them.

**The test to hold this to:** can a student finish a beginner project, including
debugging it when it breaks, without reading the underlying tool's source? While
the answer is no, PulseIR is adding load rather than removing it.

### 1. Prove the spine (blocking — do this first)

- [ ] Write the same small project by hand against three PulseCore tools and
      diff them. Whatever is genuinely common becomes the IR; whatever is not
      becomes a backend detail. **Do not extend the schema before this.**
- [ ] Decide from that diff whether the tools share a reactive/event-driven
      core. If they do, one spine with per-tool backends is right. If they do
      not, PulseIR stays a state-machine IR and unification moves up a level,
      to shared project layout and naming conventions.

### 2. Make the ecosystem hooks real

The IR already models devices and wiring, but codegen barely uses it. This is
the part that generalises beyond PulseHSM.

- [x] **MQTT topic manifest** (`src/emit/topics.ts`) — proves the IR has a
      non-C++ consumer. Next: emit the matching publish/subscribe wiring into
      the firmware, so both sides come from the same model.
- [ ] `Resource` codegen — currently produces **nothing at all**
- [ ] `Component` → driver binding — currently only comments and a sensor struct
- [ ] A second backend (ESP-IDF), to prove the spine is not PulseHSM-shaped
- [x] **Web editor** (`web/`) — live YAML → sketch / topics / structure, running
      the real pipeline in the browser. First step toward the IR not being
      hand-authored.
- [ ] Structured editing in the browser (add a state or transition through the
      UI rather than by typing YAML) — the next step toward **nobody
      hand-writing this YAML**
- [ ] PulseCore IDE serialization — the IR is a serialization format, not an
      authoring format
- [ ] PulseSim. Not blocked by guards being opaque — it never needs to evaluate
      them. Two routes, both open: *interactive stepping*, where the simulator
      asks whether a guard holds instead of computing it (better for teaching
      bubbling and entry/exit order anyway), or *running the real guards on the
      host*. The second is already half-built: `test/harness/` compiles a
      generated sketch against an Arduino shim and executes it. Add scripted
      event injection and a trace format and that harness is PulseSim.

### 3. Cheap completions (unblocked, low cost)

PulseHSM already supports both of these; only the IR lacks the fields.

- [ ] Entry/exit actions on states (`addState` takes them; we always pass
      `nullptr`)
- [ ] Timeout transitions (`timeoutMs` / `timeoutNext` are always `0` / `-1`)
- [ ] Dependency graph validation

### 4. Blocked — needs a decision or a runtime change

- [ ] **Orthogonal regions.** Not a codegen feature. PulseHSM has a single
      `int currentState` and one parent chain in `_dispatchEvent`; parallel
      regions need several simultaneously-active leaves. This requires
      redesigning the runtime. `Region[]` existing in the IR types makes it
      look closer than it is.
- [ ] **State history.** Same constraint — needs runtime support.
- [ ] Visual diagram generation

### How to measure progress

Not in generated lines — the boiler example turns 168 lines of YAML into ~199
lines of scaffolding, which is roughly break-even as pure code generation. The
metric that matters is **time to first working project on tool N, given the
student already knows tool 1.** That is testable with real students, and it
beats any architectural argument.

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
