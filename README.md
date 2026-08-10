# PulseIR - PulseHSM Intermediate Representation

A language-agnostic IR for embedded systems automation. Declaratively define your system behavior in YAML, then generate code for any target.

## Architecture

```
YAML (PulseProject)
  ↓ (parse)
PulseModel (IR types)
  ↓ (validate)
C++ Code (PulseHSM runtime)
```

## Project Structure

```
pulse-ir/
├── src/
│   ├── model/           # IR types (what a system looks like)
│   ├── parser/          # YAML → IR (coming next)
│   ├── codegen/         # IR → C++ (coming next)
│   └── cli.ts           # CLI entry point
├── test/
└── examples/
```

## Layer 1: IR Types (✓ DONE)

The `model/types.ts` defines the complete schema:

- **Enums**: StateType, EventSource, GuardType, ActionType, ComponentClass, InterfaceType
- **Core HSM**: State, Event, Transition, Guard, Action, Region
- **System**: Component, Resource, Parameter
- **Top-level**: PulseProject, PulseSystem

These are **intentionally simple**: just data structures, no validation or logic.

### Key Design Decisions

1. **StateRef is a string**: Supports both "idle" and "running/heating" notation
2. **Guard/Action use type + plugin pattern**: Extensible without schema changes
3. **EventSource is an enum**: Extensible (EXTERNAL, TIMER, SENSOR, MQTT, INTERNAL, CUSTOM)
4. **Metadata everywhere**: Future-proof, allows attach arbitrary data
5. **No behavior logic**: Only structure. Validation happens in the parser.

## Next: Layer 2 - Parser

The parser will:
1. Load YAML
2. Map it to PulseModel types
3. Validate (e.g., all event references exist)
4. Return parsed model or errors with line numbers

## Next: Layer 3 - Codegen

The codegen will:
1. Take validated PulseModel
2. Generate C++ code using PulseHSM library
3. Output Arduino sketch

## Example YAML (Preview)

```yaml
project:
  name: boiler_control
  version: 1.0

system:
  events:
    - name: START
      source: external
    - name: TEMP_REACHED
      source: internal

  states:
    idle:
      type: simple
    
    running:
      type: composite
      initial: heating
      states:
        heating:
        cooling:

  transitions:
    - source: idle
      event: START
      target: running
      actions:
        - start_pump
    
    - source: running/heating
      event: TEMP_REACHED
      guard:
        type: expression
        expression: "temperature >= setpoint"
      target: running/maintaining
```

## Development

```bash
npm install
npm run build
npm run test
npm run cli -- examples/boiler.yaml --output boiler.cpp
```
