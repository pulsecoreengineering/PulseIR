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

- **Enums**: StateType, EventSource, ActionType, ComponentClass, InterfaceType,
  LibrarySource
- **Core HSM**: State, Event, Transition, Guard, Action, Region
- **System**: Component, Resource, Parameter, Library
- **Top-level**: PulseProject, PulseSystem, Target

These are **intentionally simple**: just data structures, no validation or logic.

### Key Design Decisions

1. **StateRef is a string**: Supports both "idle" and "running/heating" notation
2. **Guards and actions are names**: the model never contains a condition or a
   body, so it cannot become a programming language (FUNCTION_CONTRACT.md §6)
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

## The Schema

The model is split by domain, so each concern lives on its own and new ones can
be added without disturbing what is there:

```yaml
project:   { name, version, description }
target:    { board }
hardware:  { buses, devices }
parameters:
events:
machine:   { states, transitions }
actions:
libraries:
```

Sections that carry identity are **keyed by name**, so a duplicate is
impossible to write. Transitions stay a **list**, because order decides which
one shadows another.

```yaml
project:
  name: boiler_control
  version: "1.0"

target:
  board: esp32

hardware:
  devices:
    pump:   { type: digital_output, pin: GPIO25 }
    heater: { type: pwm_output, pin: GPIO27, channel: 0 }

parameters:
  setpoint:
    type: float
    default: 60.0
    range: [10.0, 90.0]
    unit: degC

events:
  START:        { source: external }
  TEMP_REACHED: { source: sensor }

actions:
  start_pump:
    driver: gpio_control
    params: { device: pump, value: HIGH }

machine:
  states:
    idle:
    running:
      initial: heating
      states:
        heating:
        maintaining:

  transitions:
    - from: idle
      on: START
      to: running                # enters running/heating
      do: start_pump

    - from: running/heating
      on: TEMP_REACHED
      guard: temp_at_setpoint    # you implement this in C
      to: running/maintaining
```

### Transitions Driven by Time

A transition fires either when an event arrives (`on:`) or when a duration
elapses (`after:`) — never both, and never neither:

```yaml
    - from: operating/go
      after: green_ms            # a parameter, so it stays tunable
      to: operating/prepare_stop
      do: [all_lamps_off, show_amber]

    - from: filling/priming
      after: 8000                # or just a number of milliseconds
      to: fault/dry_run
```

`after:` is a normal transition in every other respect — guards, `do:`,
ordering and fall-through all behave exactly as they do with `on:`. Two
timers on one state are read in order, so "proceed once flow appears, but trip
at eight seconds if it never does" is two lines.

- **A timer starts when its state is entered.** Put one on a composite and it
  measures the whole phase: moving between that state's children does not
  restart it.
- **A parameter is read every pass**, so retuning `green_ms` over MQTT takes
  effect immediately rather than at the next reboot.
- **A state cannot time out into itself.** The clock only restarts on entry, so
  that would fire on every pass instead of repeating. Alternate between two
  states for a cycle.

This replaces the pattern of declaring a `TIMER_EXPIRED` event and comparing
`millis()` by hand: a duration is data, and data belongs in the model.

A device declares what it *is*, so the machine refers to `pump` rather than to
GPIO25. `type` implies a class and a driver for the common cases; anything
unfamiliar must state its `class` rather than be guessed at.

## Splitting a Model Across Files

One giant YAML is hard to maintain and hard to review, so a model is normally a
directory:

```
boiler/
├── pulse.yaml         the only file that declares `project`
├── hardware.yaml      buses and devices
├── parameters.yaml
├── machine.yaml       events, states, transitions
└── src/               your C++ - guards and actions
```

```yaml
# pulse.yaml
project:
  name: boiler_control
  version: "1.0"

target:
  board: esp32

imports:
  - hardware.yaml
  - parameters.yaml
  - machine.yaml
```

- Paths resolve relative to the file that lists them.
- Name-keyed sections merge; **a name declared in two files is an error**, not a
  silent override - neither file looks wrong on its own.
- Transitions concatenate, in import order, with the importing file last.
- Only the entry file may declare `project`.
- Import cycles and missing files are reported, naming the file that asked.

See `examples/boiler/` and `examples/sensor_gateway/`.

## Examples

Six worked models, each generated, compiled, linked against the real runtime
and run by the test suite. They double as the acceptance gate for the schema
(PLAN.md §4) — every one is written in the schema as it stands, with no
special cases.

| Model | Shows |
|---|---|
| `traffic_light.yaml` | Phases, a pedestrian request, a night mode on the parent state |
| `motor_controller.yaml` | Speed phases with the ramp arithmetic left in C, wildcard trip |
| `pump_tank.yaml` | Float-switch hysteresis, dry-run and overfill protection |
| `boiler/` | Multi-file, hierarchy, guards |
| `greenhouse/` | Interfaces, third-party libraries, MQTT |
| `sensor_gateway/` | Four buses, TLS uplink, keeps sampling with the link down |

They open in the web editor from the dropdown, unchanged.

## Interfaces

`Resource` declares how the board is wired. The backend turns that into
platform calls — the model itself never contains peripheral code:

```yaml
hardware:
  buses:
    sensor_bus:
      interface: i2c
      sda: GPIO21
      scl: GPIO22
      frequency: 400000
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
npm run serve        # serve the committed bundle on :8080
npm run web          # rebuild the bundle first, then serve
```

`web/app.js` is committed, so `npm run serve` needs nothing but Node — and you
can skip that too and open `web/index.html` straight from disk. Everything runs
in the page; nothing is uploaded.

Only `npm run web` needs esbuild. If it reports esbuild is missing, run
`npm install` (it is a devDependency) or use `npm run serve` instead.

The editor imports the **same** `Parser`, `Codegen` and `TopicEmitter` the CLI
uses, compiled to a bundle. It cannot drift from what `pulse-ir` writes to disk.

Re-run `npm run build:web` after changing anything under `src/` or `examples/`;
`npm test` fails if the committed bundle or baked examples go stale.

`web/app.js` and `web/examples.ts` are generated but committed, and the build
writes them **only when the output actually changes** — so rebuilding on an
unchanged checkout leaves the tree clean and never blocks a `git pull`. If an
older build did leave them modified and a pull refuses to run, they are
regenerable, so discarding is safe:

```bash
git checkout -- web/app.js web/examples.ts
git pull
```

## Generating a Sketch Folder

`--outdir` is the recommended way to generate, because it keeps generated code
and your code apart:

```bash
node dist/src/cli.js examples/boiler/pulse.yaml --outdir build/boiler
```

```
build/boiler/
├── boiler_control.ino            regenerated every run - do not edit
├── boiler_control_generated.h    regenerated every run - do not edit
├── PulseHSM_config.h             runtime table sizes, from the model
├── PulseHSM.h / .cpp             the runtime, vendored so it just builds
└── src/
    ├── guards.cpp                YOURS - written once, never overwritten
    └── actions.cpp               YOURS - written once, never overwritten
```

`PulseHSM_config.h` is how the runtime learns how big your machine is.
`PulseHSM.h` includes it, so the sketch and `PulseHSM.cpp` — separate
translation units — are compiled against the same table sizes. Defining those
sizes in the sketch alone is not enough: `PulseHSM.cpp` never sees it, keeps its
default of eight states, and silently refuses the ninth. Keep the file next to
`PulseHSM.h`.

Fill in the stubs in `src/`, then regenerate as often as you like: the sketch
and header are rewritten, and your implementations are left alone. The folder
opens directly in the Arduino IDE with nothing to install.

`--output <file>` still emits one self-contained sketch, which is handy for a
quick look but **loses your edits on the next run**. It writes
`PulseHSM_config.h` alongside, because the sketch is one file but the build is
not — `PulseHSM.cpp` is compiled separately and needs the same sizes.

If that header ever goes missing, `setup()` says so on the serial port rather
than running a machine that is quietly missing states.

## What the Compiler Catches

Beyond generating code, the model is checked before anything is written:

- a pin claimed by two different devices or buses, whatever the spelling
  (`GPIO25`, `gpio_25` and `25` are the same pin)
- a transition to a state that does not exist, or an ambiguous bare name
- a transition with both `on:` and `after:`, or with neither
- an `after:` naming a parameter that is missing, or is not an int
- an action a transition performs that the catalogue never declared
- a device on a bus that was never declared
- a name declared in two different files
- an import cycle

Devices sharing a bus are not a conflict - that is what a bus is for.

## Development

```bash
npm install
npm run build
npm run test
npm run cli -- examples/boiler/pulse.yaml --output boiler.ino
npm run cli -- examples/boiler/pulse.yaml --topics topics.json
npm run cli -- examples/boiler/pulse.yaml --libraries libraries.json
```
