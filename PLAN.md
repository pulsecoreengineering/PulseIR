# Adoption Plan: PulseIR as a system description language

**Status**: Phase 0 complete. Phase 1 under way (pin checking done; board
profiles next).
**Supersedes**: the roadmap that used to live in INDEX.md

This plan adopts the direction that PulseIR should describe *what an embedded
system is*, with C/C++ remaining the language for *how arbitrary computation
happens*. It is written to be executed in order, with a hard gate in the middle
that stops feature work until the abstraction has been proven.

---

## 0. The rule

> **If it describes structure, relationships, configuration, state, events,
> resources or system policy, it belongs in the model.**
>
> **If it describes arbitrary computation, algorithms or data manipulation, it
> belongs in C/C++.**

This becomes the test every proposed feature must pass. The moment the model
needs `if`, `for`, `while`, variables, functions or expressions, the answer is
a named C function, not a schema extension.

The rule is already partly enforced rather than merely stated:

- guards and actions are **names of C functions**, never conditions or bodies
- the schema has **no expression field**, and the parser rejects the retired
  one with migration guidance
- interfaces declare *how the board is wired*, never peripheral logic

Phase 0 makes the rule canonical in `FUNCTION_CONTRACT.md` so it governs new
sections too, not just guards and actions.

---

## 1. What already exists

Listed so we do not plan to build it twice.

| Proposed | Status |
|---|---|
| C/C++ escape hatch for behaviour | **Done.** Guards/actions are named C functions; the expression field was removed deliberately |
| Multi-file models (`imports:`) | **Done.** `examples/boiler/` and `examples/greenhouse/` are the proposed layout |
| Parameters → C struct | **Done** (`SystemParameters`, defaults from the model) |
| Parameters → UI metadata for a dashboard | **Done.** `topics.json` carries type, unit, min, max per parameter |
| MQTT publish/subscribe topic map | **Partly.** The manifest is generated; the firmware-side plumbing is not |
| Hardware pins / buses | **Done** for declaration: `hardware.buses` / `hardware.devices` with logical types, generating includes, defines and `begin()` calls |
| Validation of unknown state targets | **Done**, plus ambiguous names, duplicate names across files, include cycles, unknown interfaces |
| Pin conflict detection | **Not done** — highest-value gap |
| Board capability checks | **Not done.** `target.board` is carried; profiles are Phase 1 |
| Telemetry / storage / diagnostics / safety | **Not done** |

---

## 2. Phase 0 — Reshape the schema ✅ DONE

Decisions taken: old transition keywords dropped rather than kept as permanent
aliases, `imports:` over `include:`, one release of deprecation for the retired
shapes.

Delivered:

- top level split into `target` / `hardware` / `parameters` / `events` /
  `machine` / `actions` / `libraries`
- sections carrying identity are keyed by name; transitions stay an ordered list
- `from` / `on` / `to` / `do`, with `do:` taking one name or several
- `imports:` replaces `include:`
- `target: { board: }` carried into the IR, ready for Phase 1
- devices declare a `type` that implies class and driver; an unfamiliar type
  must state its class rather than be guessed at
- the `actions:` catalogue is now real. It previously parsed for names only,
  so declared `params` never reached the generated stub — they do now
- an action's identity is its name, not its driver. Two actions sharing
  `gpio_control` used to collide into one stub
- examples migrated to the directory layout; retired shapes still parse for one
  release and report a warning through `Parser.warnings`, shown by the CLI and
  the editor

The IR itself was left alone, so codegen, the emitters and the editor needed no
changes — this was a change of surface, as intended.

## 3. Phase 1 — Target, hardware model, and validation

This is where the project stops being a code generator and starts being a
compiler. Ordered by value-per-unit-effort.

### 3.1 Pin conflict detection ✅ DONE

Needs no board knowledge at all: two devices claiming one pin is an error
regardless of board. Spellings are normalised, so `GPIO25`, `gpio_25` and `25`
compare equal, and devices sharing a declared bus are correctly *not* reported.

It paid for itself immediately by flagging `examples/greenhouse`, which
declared GPIO25 as both a PWM bus and a `pwm_output` device. The underlying
cause was that **devices generated no initialisation at all** - only buses did -
so the model needed a fake "bus" to get its `ledcSetup`. Devices now initialise
themselves, and the boiler finally emits the `pinMode` for its pump, which it
never had.

```
ERROR: GPIO25 is assigned to both "pump" and "fan"
       hardware.yaml:12  pump
       hardware.yaml:19  fan
```

**Cost**: small. Walk devices and buses, collect pin claims, report collisions.
This is the single most compelling demonstration that the compiler beats
hand-written code, and it is nearly free.

### 3.2 `target: { board: esp32 }` ✅ parsed in Phase 0

The field is read into the IR. What remains is a backend that consumes it.

### 3.3 Board profiles

Data describing what each board's pins can do:

```yaml
# profiles/esp32.yaml
board: esp32
pins:
  gpio34: { input_only: true }
  gpio6:  { reserved: spi_flash }
  # ...
capabilities: { pwm_channels: 16, adc: [...], dac: [...] }
```

Then the compiler catches things that currently reach the bench:

- an output assigned to an input-only pin
- a pin wired to the integrated SPI flash
- PWM requested on a pin or channel the board cannot provide
- ADC2 used while Wi-Fi is declared

⚠ **This data must come from vendor documentation, not from memory.** Writing a
board profile from recall is exactly the failure this repo already suffered
once, where documentation asserted behaviour the code did not have. A wrong
profile is worse than no profile: it rejects valid designs and teaches students
something false. Each profile ships with a citation and a test.

**Cost**: moderate per board. Start with **one** board (esp32), verified.

### 3.4 Logical device types ✅ DONE in Phase 0

Landed early because the schema reshape had to decide the shape anyway:

```yaml
hardware:
  board: esp32
  buses:
    sensor_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    temperature: { type: ds18b20, bus: one_wire, pin: GPIO4 }
    pump:        { type: digital_output, pin: GPIO25 }
    heater:      { type: pwm_output, pin: GPIO27, channel: 0 }
```

`buses` is today's `Resource`; `devices` is today's `Component` with a `type`
that implies class, driver and init. A small registry of built-in types
(`digital_output`, `digital_input`, `pwm_output`, `analog_input`) plus
named driver types (`ds18b20`, `bme280`) that resolve to a library.

**Cost**: moderate. Touches the interface backend, the topic emitter (sensor
discovery) and the library emitter.

**Portability caveat**: this makes the *model* portable, not the output. The
Arduino backend assumes an Arduino core; a bare STM32 target needs a second
backend, not just a second board profile. Worth saying plainly so `board:`
is not oversold.

---

## 4. The gate — five projects before any new domain

Nothing from Phase 2 starts until the same model shape covers, without ugly
workarounds:

1. Boiler controller *(exists)*
2. Traffic light
3. Motor controller
4. Pump / tank controller
5. Industrial sensor gateway

Each lands as a real example, generated, compiled, linked and run by the test
suite — the same bar `boiler` and `greenhouse` already meet.

The gate is the point of the plan. If a project needs a schema hack, that is
the abstraction telling us something, and it is far cheaper to hear it now than
after telemetry, storage, diagnostics and safety are all built on top.

### 4.1 Result ✅ ALL FIVE PASS

All five are modelled, generated, compiled with `-Werror`, linked against the
real runtime, run, and checked against an expected dispatch trace. **No schema
change was needed** — every project is written in the Phase 0 schema exactly as
it stands.

| Project | Files | States | Shape it exercises |
|---|---|---|---|
| `boiler` | 4 | 4 | Hierarchy, guards, wildcard fault |
| `traffic_light` | 1 | 6 | Self-transitions, a parent-level mode switch |
| `motor_controller` | 1 | 6 | Phases with the arithmetic left in C, wildcard trip |
| `pump_tank` | 1 | 7 | Hysteresis, two guards on one event across two levels |
| `sensor_gateway` | 3 | 10 | Four buses, MQTT + TLS, degraded operation |

Passing is not the interesting part. Three things came out of it.

#### Finding 1 — The runtime was silently sized wrong (fixed)

`sensor_gateway` is the first model with more than eight states, and its ninth
and tenth were **silently refused**. `PULSEHSM_MAX_STATES` was defined in the
sketch only; `PulseHSM.cpp` is a separate translation unit, never saw it, and
stayed on the default of `8`. `addState()` returned `-1`, `transitionTo(-1)` did
nothing, and the machine simply ignored two of its own states. Nothing warned.

Worse than the dropped states: the macro also sizes members of the `PulseHSM`
class, so the two translation units disagreed about the object's layout. That
is undefined behaviour in every model, not only large ones — the small ones were
getting away with it.

Fixed by moving the sizes into a generated `PulseHSM_config.h` that
`PulseHSM.h` picks up via `__has_include`, so every translation unit is
compiled against the same numbers. Both output paths write it: `--outdir`
beside the runtime it vendors, and `--output` beside the sketch — a single-file
sketch still links against a separately compiled `PulseHSM.cpp`, so it had the
identical bug.

Belt and braces, since a config header can still be moved or go stale:
`setup()` now checks that every `addState()` came back with a real index and
prints a `FATAL` line if not. The failure was silent, which was the worst part
of it; now it is not.

A regression test builds `sensor_gateway` the way the Arduino IDE would and
asserts no state index came back negative.

This is the clearest evidence so far for the project's own argument: a
hand-written version of this firmware would have had the same bug, with nothing
to catch it.

#### Finding 2 — A state cannot say how long it lasts

Every one of the four new projects hit this, and it is the single biggest gap:

| Project | Wants |
|---|---|
| `traffic_light` | green for `green_ms`, amber for `amber_ms`, … |
| `motor_controller` | `restart_delay` before a trip can be reset |
| `pump_tank` | trip after `dry_run_ms` without flow; after `max_fill_ms` filling |
| `sensor_gateway` | retry the uplink after `retry_backoff` |

`addState()` already takes `timeoutMs` and `timeoutNext`, and codegen already
passes `0` and `-1` for them on every single state. The runtime supports this
and the IR simply has no field. So the model declares a `TIMER_EXPIRED` event
and a parameter, and the C code has to own the clock, compare it against
`fsm.getStateElapsed()` and raise the event itself — for something the runtime
would do for free.

It also fails the §0 rule in the wrong direction: a duration is *data*, not
logic, so pushing it into C is pushing declarative content into the escape
hatch. **Recommendation: `after: { ms, to }` on a state, in Phase 1.** It is a
two-field addition that maps onto arguments already being emitted, and it
removes hand-written timing from four of five projects.

#### Finding 3 — There are no internal transitions

`traffic_light` wants "on `WALK_REQUEST`, latch the request, stay in `go`".
`to:` is mandatory, so it is written as a self-transition. Harmless *today*,
because states have no entry/exit actions — the moment they do, a self
transition will re-run them and an internal one must not.

Not urgent, and it should not be fixed by making `to:` optional, which reads as
an omission rather than a decision. **Recommendation: defer until entry/exit
actions exist, then add `to: self` (re-enter) alongside `stay` (internal).**

#### What did *not* break

Worth recording, because these were the parts I expected to bend:

- **The binding rule held.** Every project wanted arithmetic somewhere — a
  speed ramp, a debounce, a flow average — and every time it landed naturally
  in a named action or guard. Nothing tempted the model toward an expression
  field.
- **Bus-attached devices needed no pin.** `line_pressure` on a Modbus register
  has no GPIO at all, and the pin checker correctly stayed quiet.
- **Action identity held.** `start_pump` and `stop_pump` share a driver and
  stayed distinct stubs.
- **Guard fall-through held.** `pump_tank` has a guarded `TIMER_EXPIRED` in a
  leaf *and* in its parent; both blocking leaves the machine exactly where it
  was, which is what the bubbling contract promises.

---

## 5. Phase 2 — Additional domains, one at a time

Only after the gate, and each one must pass the §0 rule before it is built.

| Domain | Notes |
|---|---|
| `communication:` | Highest value: the topic manifest exists, so this is generating the device side of a map that already exists. Closes the loop where a renamed sensor cannot break a dashboard |
| `telemetry:` | Sources and intervals. Mostly scheduling, which PulseHSM can already express |
| `storage:` | Which parameters persist to NVS/EEPROM. Small and self-contained |
| `diagnostics:` | Watchdog, heartbeat, log level. Configuration, not logic |
| `safety:` | **Most valuable and most dangerous — see §6** |

---

## 6. Where I would push back

Recorded so these are decided deliberately rather than drifted into.

### 6.1 `limits:` quietly reintroduces evaluation

This proposal:

```yaml
limits:
  boiler_temperature:
    source: temperature_sensor
    critical: { above: 75 }
    action: { critical: [shutdown_all] }
```

means the generated firmware evaluates `temperature > 75`. That is an
expression — structured rather than parsed, but an expression. It is the exact
camel's nose the rest of the document warns against, sitting inside the
document's own proposal.

There is a real argument for it: a safety limit is a *policy*, and a policy the
compiler understands can be checked, documented and enforced in ways a hand-
written `if` cannot. But once `above:` exists, `below:`, `between:`, `and:` and
`rate_of_change:` all have obvious justifications, and the line is gone.

⚠ **Decision needed, and I would take it late — after the gate.** The
alternative that keeps the rule intact: a limit names a guard, exactly as
transitions do, and the *policy* metadata (severity, latching, response) stays
declarative:

```yaml
limits:
  over_temperature:
    check: guard_over_safe_temp     # you implement this in C
    severity: critical
    response: [shutdown_all]
    latching: true
```

The compiler still knows this is a safety policy rather than an ordinary
transition, still generates the wiring, still reports it — and evaluates
nothing.

### 6.2 Safety `priority` needs runtime support that does not exist

`priority: critical` implies a safety event preempts normal dispatch. PulseHSM
dispatches from the current leaf **upward**, so a handler at the root has the
*lowest* precedence, not the highest. A wildcard `EMERGENCY_STOP` today only
fires if no inner state consumed the event first.

Making safety genuinely preemptive means checking safety events *before* normal
dispatch — a change to the runtime or to the generated dispatch path, not a
schema addition. Worth knowing before `safety:` is designed, because the schema
would otherwise promise something the runtime does not deliver.

### 6.3 The proposal is larger than its own advice

The document warns against scope creep and then proposes seven new top-level
domains. Its own recommendation — *"start with a very strong core: hardware +
events + HSM + actions + parameters + validation + C/C++ escape hatch"* — is
the right one, and it excludes telemetry, storage, diagnostics and safety from
the first phase. This plan follows the advice rather than the list.

### 6.4 `${MQTT_BROKER}` substitution

Environment substitution is a good idea and fits the existing rule that
credentials are never baked into generated code. Worth adopting — but as a
general mechanism (`${VAR}` resolved at generate time, absent variables
reported, never silently empty), not as an MQTT-specific feature.

---

## 7. Order of work

```
Phase 0   schema reshape                  breaking, cheap now
   │      top-level domains
   │      from/on/to/do
   │      rule made canonical
   ▼
Phase 1   pin conflicts                   cheap, high value
   │      target: board:
   │      board profile (esp32 only)
   │      logical device types
   ▼
GATE      five projects, compiled and run
   │
   ▼
Phase 2   communication → telemetry → storage → diagnostics → safety
          one at a time, each tested against the §0 rule
```

---

## 8. Decisions needed before Phase 0 starts

1. **Aliases** — keep `source/event/target/actions` forever, or drop them when
   `system:` is dropped? *(I lean: drop.)*
2. **`include:` or `imports:`** — cosmetic, cheapest to settle now.
3. **Deprecation window** — how long does the parser accept the old `system:`
   shape? *(I lean: one release, with a deprecation note naming the file.)*
4. **First board profile** — esp32 classic, or esp32s3? Only one gets verified
   first, and it should be the one most projects target.
5. **`limits:`** — defer the evaluation question to after the gate, as
   recommended? *(I lean: yes.)*
