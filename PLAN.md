# Adoption Plan: PulseIR as a system description language

**Status**: Proposed — decisions marked ⚠ are not yet made
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
| Multi-file models (`imports:`) | **Done**, spelled `include:`. `examples/greenhouse/` is exactly the proposed layout |
| Parameters → C struct | **Done** (`SystemParameters`, defaults from the model) |
| Parameters → UI metadata for a dashboard | **Done.** `topics.json` carries type, unit, min, max per parameter |
| MQTT publish/subscribe topic map | **Partly.** The manifest is generated; the firmware-side plumbing is not |
| Hardware pins / buses | **Partly.** `Resource` + `Component` generate includes, defines and `begin()` calls. No board concept, no logical device types |
| Validation of unknown state targets | **Done**, plus ambiguous names, duplicate names across files, include cycles, unknown interfaces |
| Pin conflict detection | **Not done** — highest-value gap |
| Board capability checks | **Not done** |
| Telemetry / storage / diagnostics / safety | **Not done** |

---

## 2. Phase 0 — Reshape the schema (breaking, do first)

These are breaking changes. They are cheap now and expensive later, which is
exactly the reason to do them before anything else.

### 2.1 Split the top level by domain

Everything currently sits under `system:`. Replace with domains that can grow
independently:

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

Later phases add `telemetry:`, `communication:`, `storage:`, `diagnostics:`,
`safety:` as siblings without disturbing anything above.

**Cost**: parser restructure, every example and doc updated. The IR types
survive mostly intact — this is a change of surface, not of model.

**Compatibility**: the parser accepts the old `system:` block for one release,
emitting a deprecation note that names the file, then drops it. No silent
translation.

### 2.2 Readable transition keywords

```yaml
# from                on              to                    do
- from: running/heating
  on: TEMP_REACHED
  to: running/maintaining
  do: reduce_heat            # scalar or list
```

`from/on/to/do` become canonical; `source/event/target/actions` stay accepted
as aliases. `do:` takes a scalar or a list, so single-action transitions — the
common case — stop needing a one-item list.

⚠ **Decision needed**: accept aliases indefinitely, or drop them at the same
time as `system:`? Accepting both forever means two ways to write everything,
which is cognitive load — the thing this project exists to remove. I lean
toward dropping them with `system:`.

### 2.3 `imports:` vs `include:`

⚠ **Decision needed**: rename `include:` → `imports:` to match the proposal, or
keep `include:`. Purely cosmetic; I have no strong view. Cheap either way, and
cheapest now.

---

## 3. Phase 1 — Target, hardware model, and validation

This is where the project stops being a code generator and starts being a
compiler. Ordered by value-per-unit-effort.

### 3.1 Pin conflict detection (do this first — cheap, high value)

Needs no board knowledge at all: two devices claiming one pin is an error
regardless of board.

```
ERROR: GPIO25 is assigned to both "pump" and "fan"
       hardware.yaml:12  pump
       hardware.yaml:19  fan
```

**Cost**: small. Walk devices and buses, collect pin claims, report collisions.
This is the single most compelling demonstration that the compiler beats
hand-written code, and it is nearly free.

### 3.2 `target: { board: esp32 }`

Adds the field and threads it to the backend. Cheap on its own; its value is
what 3.3 and 3.4 build on it.

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

### 3.4 Logical device types

So the application refers to `pump`, not `GPIO25`:

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
