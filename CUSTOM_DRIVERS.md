# PulseIR Custom Drivers

PulseIR's built-in driver list covers the most common hardware — GPIOs, DHT22, BME280, DS18B20, RTCs, LCDs, OLEDs, and more. For anything else, custom drivers let you attach any hardware without touching the codegen.

---

## The idea in one sentence

Use any string as `driver:`. PulseIR generates a C++ function stub; you fill it in. That's the full contract — no codegen changes, no build-system changes.

---

## Quick start: HC-SR04 ultrasonic sensor

A three-step example with no state machine — just a task that runs on a timer.

### 1. The YAML model

```yaml
pulseir: "1"
project:
  name: hcsr04_demo
target: esp32

hardware:
  devices:
    trig:
      type: digital_output
      pin: GPIO5
    distance:
      type: digital_input
      pin: GPIO18     # named "distance" → systemSensors.distance

parameters:
  alert_cm:
    type: float
    default: 30.0
    unit: cm

actions:
  measure_distance:
    driver: hcsr04_read   # unknown driver → stub is generated
    params:
      trigger: trig
      echo: distance

tasks:
  poll:
    every: 250
    do: [measure_distance]
```

No `machine:` block — just a repeating task. You read `systemSensors.distance` in your own code.

### 2. Generate

```bash
node dist/src/cli.js hcsr04.yaml --target arduino --outdir build/hcsr04
```

```
✓ Parsed project: hcsr04_demo
🔨 Generating sketch folder...
  ✓ hcsr04_demo.ino
  ✓ src/actions.cpp  (yours to fill in)
```

### 3. Fill in `src/actions.cpp`

The generated stub has every macro and field you need in a comment at the top:

```cpp
void action_measure_distance(SystemContext* ctx) {
  //   trigger: "trig"     -> TRIG_PIN
  //   echo: "distance"    -> DISTANCE_PIN
  //   ctx->parameters->alert_cm   (float, cm)
  //   ctx->sensors->distance      (float) — you fill this in
  //
  // TODO: Implement the hardware calls for this action.
  (void)ctx;
}
```

Replace the TODO:

```cpp
void action_measure_distance(SystemContext* ctx) {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration_us = pulseIn(DISTANCE_PIN, HIGH, 30000UL);
  systemSensors.distance = (duration_us == 0) ? 999.0f : duration_us * 0.0343f / 2.0f;
  (void)ctx;
}
```

That's it. Your main sketch reads `systemSensors.distance` whenever it likes.

### 4. Regenerate safely

Make any model change and regenerate. PulseIR never overwrites `src/actions.cpp`:

```
  · src/actions.cpp  (kept - your code)
```

---

## Driver plugins — write once, reuse everywhere

A **driver plugin** is a YAML file that ships platform-specific code with the driver name. Add it to your model with a `plugins:` list and PulseIR emits the real hardware code instead of a stub — no manual editing of `src/actions.cpp` at all.

### Plugin file format

```yaml
driver: hcsr04_read
description: HC-SR04 ultrasonic distance sensor

platforms:
  arduino: |
    digitalWrite({trigger_pin}, LOW); delayMicroseconds(2);
    digitalWrite({trigger_pin}, HIGH); delayMicroseconds(10);
    digitalWrite({trigger_pin}, LOW);
    long _dur = pulseIn({echo_pin}, HIGH, 30000UL);
    systemSensors.{echo} = (_dur == 0) ? 999.0f : _dur * 0.0343f / 2.0f;

  espidf: |
    gpio_set_level((gpio_num_t){trigger_pin}, 0); esp_rom_delay_us(2);
    gpio_set_level((gpio_num_t){trigger_pin}, 1); esp_rom_delay_us(10);
    gpio_set_level((gpio_num_t){trigger_pin}, 0);
    // ... echo timing with esp_timer_get_time ...
    systemSensors.{echo} = (_dur <= 0) ? 999.0f : _dur * 0.0343f / 2.0f;

  default: |
    // TODO: implement hcsr04_read for this platform
    (void)ctx;
```

**Template variables** — filled in from the action's `params:`:

| Variable | Expands to |
|----------|-----------|
| `{key}` | The param value (device name, e.g. `"distance"`) |
| `{key_pin}` | The generated pin macro (e.g. `DISTANCE_PIN`) |
| `{driver}` | The driver name itself |

For `params: { trigger: trig, echo: distance }`:
- `{trigger}` → `trig`, `{trigger_pin}` → `TRIG_PIN`
- `{echo}` → `distance`, `{echo_pin}` → `DISTANCE_PIN`

### Using a plugin in your model

```yaml
plugins:
  - ../custom_drivers/hcsr04_read.yaml   # path relative to this YAML file
  - ../custom_drivers/my_sensor.yaml
```

PulseIR reports each plugin it loads:

```
🔌 Loaded plugin: hcsr04_read (from ../custom_drivers/hcsr04_read.yaml)
```

The generated `src/actions.cpp` contains the expanded code — no stub, no manual editing.

### The HC-SR04 plugin is ready to use

The file `custom_drivers/hcsr04_read.yaml` ships with PulseIR. It has Arduino and ESP-IDF implementations. Point your model at it and generate:

```bash
node dist/src/cli.js examples/hcsr04.yaml --target arduino --outdir build/hcsr04
```

Generated `src/actions.cpp`:

```cpp
void action_measure_distance(SystemContext* ctx) {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long _dur = pulseIn(DISTANCE_PIN, HIGH, 30000UL);
  systemSensors.distance = (_dur == 0) ? 999.0f : _dur * 0.0343f / 2.0f;
}
```

No manual editing required.

---

## State machine (optional)

If you need the firmware to react to your sensor — e.g. alert when an object comes near — add a `machine:` block:

```yaml
events:
  OBJECT_NEAR: { source: sensor }

machine:
  initial: watching
  states:
    watching:
    alerting:
  transitions:
    - from: watching
      on:    OBJECT_NEAR
      guard: { name: is_close, description: distance below alert_cm }
      to:    alerting
    - from: alerting
      on:    OBJECT_NEAR
      guard: { name: is_far,  description: distance above alert_cm }
      to:    watching
```

Then in `src/actions.cpp` fire the event when appropriate:

```cpp
  if (systemSensors.distance < ctx->parameters->alert_cm)
    fsm.sendEvent(EVENT_OBJECT_NEAR);
```

And fill in `src/guards.cpp`:

```cpp
bool guard_is_close(const SystemContext* ctx) {
  return ctx->sensors->distance < ctx->parameters->alert_cm;
}
bool guard_is_far(const SystemContext* ctx) {
  return ctx->sensors->distance >= ctx->parameters->alert_cm;
}
```

The state machine is completely optional — start without it, add it later if you need it.

---

## What the generated header gives you

Every project exposes these in `<name>_generated.h`:

| Symbol | What it is |
|--------|-----------|
| `TRIG_PIN` | `#define` for each declared device's pin number |
| `systemSensors.distance` | `float` field per sensor/input device |
| `systemParameters.alert_cm` | `float` / `int` / `bool` per declared parameter |
| `fsm` | PulseHSM instance — `fsm.sendEvent(EVENT_…)` |
| `EVENT_<NAME>` | Enum value per declared event |
| `S_<STATE>` | Integer constant per state |

Pin macro naming: `<DEVICE_NAME_UPPERCASE>_PIN`. Device `trig` → `TRIG_PIN`.
Sensor field naming: `systemSensors.<device_name>`. Device `distance` → `systemSensors.distance`.

---

## Device declarations

Declare every pin so PulseIR generates `pinMode()` and the `#define` macro:

| Your device needs | Declare as | PulseIR generates |
|-------------------|-----------|-------------------|
| Output pin | `digital_output` | `pinMode(PIN, OUTPUT)` + `PIN_PIN` macro |
| Input pin (read or time) | `digital_input` | `pinMode(PIN, INPUT)` + `PIN_PIN` macro + `systemSensors.name` |
| Analog read | `analog_input` | `PIN_PIN` macro + `systemSensors.name` |
| No init needed | Omit — hardcode in stub | — |

---

## Summary

1. Pick any `driver:` name not in the built-in list.
2. Generate — PulseIR creates a stub in `src/actions.cpp` with every macro already documented.
3. Fill in the stub (or add a plugin so it's filled in automatically).
4. Regenerate freely — `src/actions.cpp` is yours and never overwritten.

To reuse a driver across projects, write a plugin YAML once, store it in `custom_drivers/`, and point any model at it with `plugins:`.
