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
│   ├── parser/          # YAML → IR
│   ├── codegen/         # IR → C++ (PulseHSM runtime)
│   └── cli.ts           # CLI entry point
├── test/
└── examples/
```

## Layer 1: IR Types (✓ DONE)

The `model/types.ts` defines the complete schema:

- **Enums**: StateType, EventSource, ActionType, ComponentClass, InterfaceType
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

## Layer 2: Parser (✓ DONE)

The parser:
1. Loads YAML
2. Maps it to PulseModel types
3. Validates references — unknown events, unknown or ambiguous state paths,
   duplicate states, malformed guards
4. Returns a parsed model, or a `ParseError` describing what is wrong

## Layer 3: Codegen (✓ DONE)

The codegen takes a validated PulseModel and emits an Arduino sketch that
drives the PulseHSM runtime:

- Sizes `PULSEHSM_MAX_STATES` / `_EVENTS` / `_DEPTH` from the model, above the
  include so they take effect
- Registers every state with `addState()`, parents before children
- Emits one `onEvent` handler per state — PulseHSM's event bubbling makes an
  inner transition outrank an enclosing one automatically
- Resolves composite targets down to a leaf before calling `transitionTo()`
- Generates `SystemContext`, `SystemParameters` and `SystemSensors`
- Emits guard and action stubs with the signatures in FUNCTION_CONTRACT.md

A guard is a **name**, not a condition — the model has no expression field at
all. Any `description` you attach becomes a comment in the stub for whoever
implements it. See FUNCTION_CONTRACT.md §6 and SYSTEMCONTEXT.md.

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
      guard: temp_at_setpoint
      target: running/maintaining
```

## Web Editor

A browser editor with live output: edit the model on the left, watch the
generated sketch, the MQTT topic manifest and the state structure update as you
type.

```bash
npm run web          # build the bundle and serve on :8080
```

`web/app.js` is committed, so after cloning you can also just open
`web/index.html` in a browser — no Node, no install, no network. Everything
runs in the page; nothing is uploaded.

The editor imports the **same** `Parser`, `Codegen` and `TopicEmitter` the CLI
uses, compiled to a bundle. It cannot drift from what `pulse-ir` writes to disk.

Re-run `npm run build:web` after changing anything under `src/` or `examples/`;
`npm test` fails if the committed bundle or baked examples go stale.

## Development

```bash
npm install
npm run build
npm run test
npm run cli -- examples/boiler.yaml --output boiler.ino
npm run cli -- examples/boiler.yaml --topics topics.json
```
