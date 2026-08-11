# PulseIR - Architecture & Design Decisions

**Status**: MVP Complete (August 2026)  
**Version**: 0.1.0

---

## 1. What is PulseIR?

PulseIR is a **unified intermediate representation (IR) for embedded systems automation**. It solves a critical problem in the PulseCore ecosystem:

**Problem**: Each tool (PulseCore IDE, PulseSim, PulseDash, PulseHSM runtime) was building its own format for describing systems. This created friction and inconsistency.

**Solution**: Define a **single, language-agnostic IR** that all tools consume and produce. YAML is just one serialization format—the real value is the model.

---

## 2. The Three-Layer Architecture

```
Layer 1: PulseModel (IR Types)
   ↓ (Language-agnostic data structures)
   
Layer 2: Parser (YAML → IR)
   ↓ (Load, parse, validate)
   
Layer 3: Codegen (IR → C++)
   ↓ (Generate Arduino sketches)
```

### Layer 1: PulseModel (`src/model/types.ts`)

**What it is**: Pure data structures. No logic, no assumptions.

**Core concepts**:
- **States** (SIMPLE, COMPOSITE, ORTHOGONAL) — hierarchical state machine
- **Events** (EXTERNAL, TIMER, SENSOR, MQTT, INTERNAL, CUSTOM) — system events
- **Transitions** (source → event → target) — state changes
- **Guards** (name + optional description) — conditional transitions
- **Actions** (type + driver) — things that happen
- **Components** (SENSOR, ACTUATOR, SERVICE) — system parts
- **Resources** (GPIO, UART, I2C, SPI, CAN, MQTT, CUSTOM) — hardware interfaces
- **Parameters** (configuration values) — system tuning

**Why this design**:
- **Extensible**: New event sources, action types, or resource interfaces don't require schema changes
- **Reusable**: Same model used by parser, codegen, simulator, visualizer
- **Language-agnostic**: Can serialize to YAML, JSON, protobuf, or anything else
- **Metadata-friendly**: Every concept can carry arbitrary metadata for future tools

### Layer 2: Parser (`src/parser/index.ts`)

**What it does**:
1. Load YAML file
2. Map to PulseModel types
3. Validate references (events exist, transitions point to real states, etc.)
4. Return `PulseProject` or `ParseError` with line numbers

**Key decisions**:
- **StateRef is a string**: Supports both flat ("idle") and hierarchical ("running/heating") notation
- **Two-pass validation**: Parse first, then validate references (catches typos early)
- **Clear error messages**: Line numbers and specific reference issues

**What it doesn't do** (yet):
- Validate guard expressions (out of scope - guards are names, see §3.2)
- Type-check action parameters (drivers define their own schemas)
- Resolve dependencies between components (planned for v1.1)

### Layer 3: Codegen (`src/codegen/index.ts`)

**What it does**:
1. Take validated `PulseProject`
2. Generate complete Arduino sketch
3. Register the state hierarchy with PulseHSM and wire up per-state handlers
4. Stub guard and action handlers (user fills in logic)

**Generated code includes**:
- `PULSEHSM_MAX_*` sizing macros, emitted above the include so they take effect
- Event enum (`uint8_t`, to match `sendEvent` / `EventCb`)
- `SystemParameters`, `SystemSensors` and `SystemContext`
- One `addState()` registration per state, parents before children
- One `onEvent` handler per state with outgoing transitions
- Guard and action stubs ready for implementation
- Serial logging for debugging

**Design**:
- **Drives the real runtime**: dispatch, entry/exit chains and LCA handling
  belong to PulseHSM; codegen does not reimplement them
- **Hierarchy comes from the library**: event bubbling makes an inner
  transition outrank an enclosing one, so there is no precedence logic to write
- **Always transitions to a leaf**: composite targets are resolved through
  their initial children before `transitionTo()`
- **Extensible stubs**: guards and actions are pre-declared, user fills in
- **Zero assumptions**: Doesn't assume specific hardware, pins, or libraries

---

## 3. Key Design Decisions & Why

### 3.1 "Stable Core + Extensible Domains"

**Decision**: Keep the core HSM schema minimal and stable. Extend via plugins.

**Why**: 
- The core (states, events, transitions, guards, actions) is rarely wrong
- New sensors, actuators, interfaces come constantly
- Hard-coding them into the schema creates maintenance burden

**How**:
```yaml
# Instead of:
type: ds18b20
type: max6675
type: dht21

# We do:
components:
  water_temp:
    class: sensor
    driver: ds18b20    # ← plugin reference, not hard-coded
    config:
      interface: onewire
      pin: GPIO4
```

### 3.2 "Guards Are Names, Not Conditions"

**Decision**: Don't make YAML itself a programming language. There is no
expression field in the schema.

**Why**: YAML is for data, not code. An evaluable condition never stays one
comparison — it grows precedence, scoping, type rules, `&&`, function calls
and arithmetic, until it is a language with no debugger and no IDE support.
It would also be one more dialect for a learner to absorb on top of the C
they already need, which is the cost PulseIR exists to remove.

An earlier version of this schema carried
`expression: "temperature >= setpoint"` and emitted it as a comment. That was
the worst option available: the model looked executable, but nothing ran it.

**How**:
```yaml
guard: temp_at_setpoint
```

With the intent recorded as prose, copied into the generated stub as a comment
and never parsed:
```yaml
guard:
  name: temp_at_setpoint
  description: water temperature has reached the setpoint
```

The condition itself lives in C, where it is type-checked and steppable:
```c
bool guard_temp_at_setpoint(const SystemContext* ctx) {
  return ctx->sensors->temperature_sensor >= ctx->parameters->setpoint;
}
```

See FUNCTION_CONTRACT.md §6.

### 3.3 "Action Type + Driver Pattern"

**Decision**: Actions reference drivers by name, not hard-coded in schema.

**Why**: Same as components—new actions come constantly. Don't bind the schema to specific implementations.

**How**:
```yaml
actions:
  start_pump:
    type: driver
    driver: gpio_control      # ← plugin
    params:
      pin: PUMP
      value: HIGH
```

### 3.4 "StateRef as String with Hierarchy Notation"

**Decision**: Use "running/heating" instead of separate state IDs.

**Why**:
- Human-readable
- Works with flat and hierarchical states
- Compiler turns it into enums anyway

**How**:
```yaml
states:
  running:
    type: composite
    initial: heating
    states:
      heating:
      cooling:

transitions:
  - source: running/heating    # ← works naturally
    event: TEMP_REACHED
    target: running/maintaining
```

---

## 4. The Extensibility Model

### 4.1 Adding a New Event Source

**Today**: EXTERNAL, TIMER, SENSOR, MQTT, INTERNAL

**To add a new source** (e.g., CAN bus):

1. Add to enum:
```typescript
export enum EventSource {
  // ...
  CAN = "can",
}
```

2. Parser automatically accepts it
3. Codegen includes it in event logging
4. Done ✓

### 4.2 Adding a New Action Type

**Today**: `type: driver` + `driver: name`

**To add a new type** (e.g., `type: mqtt_publish`):

1. Add to enum:
```typescript
export enum ActionType {
  DRIVER = "driver",
  MQTT_PUBLISH = "mqtt_publish",
}
```

2. Codegen handles it:
```typescript
switch (action.type) {
  case 'driver':
    // existing logic
  case 'mqtt_publish':
    // new logic
}
```

3. No schema changes needed ✓

### 4.3 Adding a New Resource Interface

**Today**: GPIO, UART, I2C, SPI, CAN, MQTT, ONEWIRE

**To add BLE, NB-IoT, etc.**:

1. Add to enum
2. Parser validates it
3. Codegen includes it
4. Components can reference it
5. No schema changes ✓

---

## 5. Data Flow Through the System

### 5.1 From YAML to Arduino

```
human writes boiler.yaml
        ↓
parser.parse(yaml)
  - Load YAML
  - Map to PulseModel types
  - Validate event/state references
        ↓
PulseProject object (fully validated IR)
        ↓
codegen.generate(project)
  - Flatten state tree
  - Index all actions
  - Generate state/event enums
  - Generate transition table
  - Generate setup/loop/event processing
        ↓
boiler.ino (Arduino sketch, 238 lines)
        ↓
user fills in action implementations
        ↓
Arduino IDE → upload → ESP32 runs it
```

### 5.2 From IR to Multiple Tools (Future)

```
PulseProject (IR)
    ├→ Codegen → Arduino C++
    ├→ PulseSim → Browser simulation
    ├→ PulseDash → HMI configuration
    ├→ Visualizer → Diagram
    └→ Documentation → Auto-docs
```

---

## 6. MVP Scope (What's In)

✅ **Complete**:
- Core HSM: states, events, transitions, guards, actions
- Hierarchical states (COMPOSITE type)
- Wildcard transitions (from any state)
- Component model (sensors, actuators, services)
- Resource model (GPIO, UART, I2C, etc.)
- Parameters (configuration values)
- YAML parser with validation
- C++ code generator (Arduino compatible)
- CLI interface

**Not in scope (v1.1+)**:
- ❌ Orthogonal regions (parallel states)
- ❌ State history
- ❌ Dependency graph validation
- ❌ Guard expression validation (out of scope by design)
- ❌ Component driver plugin system
- ❌ PulseSim integration
- ❌ PulseDash integration
- ❌ Web UI / PulseCore IDE serialization

---

## 7. How to Use It

### 7.1 Write YAML

```yaml
project:
  name: boiler_control
  version: 1.0

system:
  events:
    - name: START
      source: external
    - name: TEMP_REACHED
      source: sensor

  states:
    - name: idle
      type: simple
    - name: running
      type: composite
      initial: heating
      states:
        - name: heating
          type: simple
        - name: cooling
          type: simple

  transitions:
    - source: idle
      event: START
      target: running
      actions:
        - start_pump

  actions:
    start_pump:
      type: driver
      driver: gpio_control
      params:
        pin: PUMP
        value: HIGH

  components:
    - name: pump
      class: actuator
      driver: gpio_control
      config:
        pin: GPIO25
```

### 7.2 Parse & Generate

```bash
# Build
npm run build

# Parse and generate
node dist/src/cli.js examples/boiler.yaml --output boiler.ino

# Or use in code
import { Parser } from './src/parser/index.js';
import { Codegen } from './src/codegen/index.js';

const parser = new Parser();
const project = parser.parse(yamlContent);

const codegen = new Codegen();
const code = codegen.generate(project);
```

### 7.3 Implement Actions

The generated .ino includes action stubs:

```cpp
void action_start_pump(SystemContext* ctx) {
  Serial.print("  -> Action: start_pump");
  
  // TODO: Implement action logic
  // Parameters: { "pin": "PUMP", "value": "HIGH" }
  
  // Add your code:
  digitalWrite(PUMP_PIN, HIGH);
}
```

---

## 8. Testing & Validation

### 8.1 Parser Test
```bash
npm run build
node dist/test/parser.test.js
```

Tests that `boiler.yaml` parses correctly:
- ✓ Events loaded
- ✓ States indexed
- ✓ Transitions validated
- ✓ Hierarchical states work

### 8.2 Codegen Test
```bash
npm run build
node dist/test/codegen.test.js
```

Tests that code generation works:
- ✓ State/event enums created
- ✓ Transition table built
- ✓ Action stubs generated
- ✓ Arduino sketch is valid C++

---

## 9. File Structure

```
pulse-ir/
├── src/
│   ├── model/
│   │   ├── types.ts         ← IR type definitions (enums, interfaces)
│   │   └── index.ts
│   ├── parser/
│   │   └── index.ts         ← YAML → IR
│   ├── codegen/
│   │   └── index.ts         ← IR → C++
│   └── cli.ts               ← Command-line interface
├── test/
│   ├── parser.test.ts       ← Parser validation
│   └── codegen.test.ts      ← Codegen validation
├── examples/
│   └── boiler.yaml          ← Full example system
├── README.md                ← Quick start
├── ARCHITECTURE.md          ← This file
├── package.json
└── tsconfig.json
```

---

## 10. Next Steps & Roadmap

### Immediate (v0.2)
- [ ] Orthogonal regions (parallel states)
- [ ] State history support
- [x] Guard expressions removed from the schema (see §3.2)
- [ ] Component driver validation

### Short term (v1.0)
- [ ] Dependency graph (what components depend on what)
- [ ] Plugin system for drivers
- [ ] PulseSim adapter (export to simulator)
- [ ] PulseCore IDE serialization (IDE → YAML → IR)

### Medium term (v1.1)
- [ ] Visual diagram generator (IR → Mermaid/PlantUML)
- [ ] Test generation (generate test cases from HSM)
- [ ] Multi-target codegen (Arduino, ESP-IDF, generic C)
- [ ] Parameter validation and bounds checking

### Long term (v2.0)
- [ ] Cloud sync (push/pull YAML to cloud)
- [ ] Version control integration
- [ ] Collaborative editing
- [ ] Analytics (which transitions are used, state timing, etc.)

---

## 11. Key Design Philosophy

**"The IR is the architecture, not the YAML"**

- YAML is a convenience format for humans
- The real value is `PulseModel` (the types)
- Multiple serializations (YAML, JSON, protobuf, etc.) can map to the same IR
- Multiple tools (codegen, simulator, visualizer, IDE) all consume the same IR

**"Stable core, extensible domains"**

- Core HSM concepts (states, events, transitions) are stable
- Domains (components, resources, actions) are extensible
- Add new event sources, action types, resources without touching core types

**"Validation is early, generation is dumb"**

- Parser validates references, catches typos, enforces schema
- Codegen assumes valid input, just generates code
- This separation makes both simpler and more reliable

---

## 12. Questions & Answers

**Q: Why not use UML SCXML?**  
A: Too heavy for embedded systems. Too many features we don't need. PulseIR is minimal but extensible.

**Q: Why not visual design first?**  
A: Text (YAML) is easier to version control, review, and generate from other tools. Visual tools serialize to YAML.

**Q: Can I use this without Arduino?**  
A: Yes. The IR is target-agnostic. Codegen to C++, then adapt to your platform.

**Q: What about performance?**  
A: Linear transition table lookup is O(n). For typical systems (~10-20 transitions), negligible. Can optimize to hash table later if needed.

**Q: How do I handle sensor polling?**  
A: Generated loop has a TODO for sensor logic. User fills in:
```cpp
void loop() {
  // Poll sensors into the struct guards and actions read
  systemSensors.water_temp = tempSensor.read();

  if (systemSensors.water_temp > systemParameters.setpoint) {
    fsm.sendEvent(EVENT_TEMP_REACHED);
  }

  fsm.update();   // dispatches queued events; never call delay()
}
```

---

## 13. References & Context

**Project Context**:
- Part of **PulseCore Engineering** ecosystem
- Solves unified modeling problem for embedded systems + industrial automation
- Educational focus: make embedded systems fun, not complex

**Previous Decisions**:
- Chosen PulseHSM as the C++ runtime (proved in production)
- ISO C++ with zero heap allocation, ISR-safe
- Extensible via plugins (not hard-coded driver list)

**Related Tools** (planned integration):
- **PulseCore IDE**: Visual FSM designer (will serialize to this IR)
- **PulseSim**: Browser-based simulator (will consume this IR)
- **PulseDash**: Industrial HMI (will visualize system state from this IR)
- **PulseCore Monitor**: SMS-based monitoring (will work with deployed systems from this IR)

---

## 14. How to Extend This Document

Add new files as complexity grows:
- `PARSER_DETAILS.md` — reference resolution, validation rules
- `CODEGEN_TARGETS.md` — supporting multiple output languages (ESP-IDF, bare metal, etc.)
- `SCHEMA_SPEC.md` — formal YAML schema specification
- `EXAMPLES.md` — walkthroughs for different system types
- `INTEGRATION.md` — how to wire up PulseCore IDE, PulseSim, etc.

---

**Last Updated**: August 9, 2026  
**By**: PulseCore Engineering Team  
**Status**: MVP Complete, Ready for Integration
