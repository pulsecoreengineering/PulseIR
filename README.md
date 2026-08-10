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

## Splitting a Model Across Files

One giant YAML is hard to maintain and hard to review. A model can `include`
others, so each concern lives in its own file:

```yaml
# greenhouse.yaml - the only file that declares `project`
project:
  name: greenhouse
  version: "1.0"

include:
  - hardware.yaml     # buses, libraries, sensors, actuators
  - events.yaml
  - behaviour.yaml    # states and transitions
  - tuning.yaml       # parameters
```

- Paths resolve relative to the file that lists them.
- Lists (`events`, `states`, `transitions`, `components`, `resources`,
  `parameters`, `libraries`) are concatenated; everything else is overridden by
  the including file.
- Only the root file may declare `project`.
- Include cycles, missing files, and names declared twice by different files
  are all reported rather than silently merged.

See `examples/greenhouse/`.

## Interfaces

`Resource` declares how the board is wired. The backend turns that into
platform calls — the model itself never contains peripheral code:

```yaml
resources:
  - name: sensor_bus
    interface: i2c
    binding: {sda: GPIO21, scl: GPIO22, frequency: 400000}
```

becomes

```c
#define SENSOR_BUS_SDA 21  // GPIO21
Wire.begin(SENSOR_BUS_SDA, SENSOR_BUS_SCL);
Wire.setClock(SENSOR_BUS_FREQUENCY);
```

Supported: `gpio`, `pwm`, `adc`, `uart`, `i2c`, `spi`, `can`, `onewire`,
`wifi`, `ethernet`, `ble`, `mqtt`, `custom`. Anything the backend cannot fully
wire up becomes a documented TODO rather than a silent omission.

**Credentials are never baked in.** A binding key that looks like a secret
(`password`, `token`, `key`…) is emitted as an empty placeholder with a TODO,
whatever the model says — a model belongs in version control, a Wi-Fi password
does not.

## Libraries

Libraries implied by an interface are added for you; only third-party ones need
declaring:

```yaml
libraries:
  - name: Adafruit_BME280
    include: Adafruit_BME280.h
    version: "^2.2"
    source: registry
```

The generated sketch gets the `#include` lines plus a header comment listing
what to install. `--libraries out.json` emits a machine-readable manifest with
ready-made PlatformIO `lib_deps` (core-bundled libraries excluded, since
listing them breaks a build).

## Web Editor

A browser editor with live output: edit the model on the left, watch the
generated sketch, the MQTT topic manifest, the library manifest and the state
structure update as you type.

**Multi-file models work here too.** Each file is a tab, and the open buffers
act as the filesystem, so `include` resolves between tabs exactly as it does on
disk. The entry file — the only one declaring `project` — is marked ▶; use
"+ File" to add one, "Set entry" to parse from a different file, double-click a
tab to rename, and × to delete. Everything persists across a reload.

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
