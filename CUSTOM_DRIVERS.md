# PulseIR Custom Drivers

PulseIR's built-in driver list covers the most common hardware — GPIOs, DHT22, BME280, DS18B20, RTCs, LCDs, OLEDs, and more. For anything else, **custom drivers let you attach any hardware without touching the codegen**.

---

## How it works

The driver dispatch in PulseIR is a switch on the `driver:` string. Any name that does not match a built-in falls through to a generated TODO stub in `src/actions.cpp`:

```cpp
void action_measure_distance(SystemContext* ctx) {
  // Declared params for this action (documentation only):
  //   trigger: "trig"   -> TRIG_PIN
  //   echo: "distance"  -> DISTANCE_PIN
  //
  // Available on ctx:
  //   ctx->parameters->alert_cm   (float, cm)
  //   ctx->sensors->distance      (float) - you fill this in
  //   ctx->currentState, ctx->previousState   (compare with S_*)
  //
  // TODO: Implement the hardware calls for this action.
  (void)ctx;
}
```

That `src/actions.cpp` file is **yours**. PulseIR never overwrites it on subsequent regenerations — it prints `· src/actions.cpp (kept - your code)` instead. You write the hardware calls once; they survive every future model change.

The same applies to `src/guards.cpp`.

---

## Step-by-step: HC-SR04 ultrasonic sensor

The HC-SR04 measures distance by timing an echo pulse — not a built-in device type. Here's how to wire it into a PulseIR project using a custom driver.

### 1. Declare the hardware

Declare the trigger and echo pins using the closest matching primitive types. PulseIR sets up `pinMode()` for them; your stub handles the rest.

```yaml
hardware:
  devices:
    trig:
      type: digital_output
      pin: GPIO5      # trigger output

    distance:
      type: digital_input
      pin: GPIO18     # echo input — named "distance" so systemSensors.distance
                      # holds the computed cm reading
```

The generated header will include:

```cpp
#define TRIG_PIN     5   // GPIO5
#define DISTANCE_PIN 18  // GPIO18

struct SystemSensors {
  float distance;   // your custom driver writes here
};
```

### 2. Declare the action with a custom driver name

Use any string that isn't a built-in driver name. PulseIR will generate a stub for it.

```yaml
actions:
  measure_distance:
    driver: hcsr04_read          # not built-in → stub is generated
    params:
      trigger: trig
      echo: distance
    description: Fire HC-SR04 trigger and write cm into systemSensors.distance
```

### 3. Wire it into tasks and the state machine

```yaml
parameters:
  alert_cm:
    type: float
    default: 30.0
    unit: cm

events:
  OBJECT_NEAR: { source: sensor }

tasks:
  poll:
    every: 250
    do: [measure_distance]

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
      guard: { name: is_far, description: distance above alert_cm }
      to:    watching
```

### 4. Generate the project

```bash
node dist/src/cli.js examples/hcsr04.yaml --target arduino --outdir build/hcsr04
```

Output:

```
✓ Parsed project: hcsr04_demo
🔨 Generating sketch folder...
  ✓ hcsr04_demo.ino
  ✓ src/guards.cpp   (yours to fill in)
  ✓ src/actions.cpp  (yours to fill in)
```

### 5. Fill in `src/actions.cpp`

Replace the TODO stub with real hardware calls. The generated comment tells you exactly what variables are available.

```cpp
void action_measure_distance(SystemContext* ctx) {
  // Send a 10 µs trigger pulse
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Measure echo duration and convert to centimetres
  long duration_us = pulseIn(DISTANCE_PIN, HIGH, 30000UL);  // 30 ms timeout
  float cm = duration_us * 0.0343f / 2.0f;

  // Write into the generated sensor slot — guards and the FSM read from here
  systemSensors.distance = (duration_us == 0) ? 999.0f : cm;

  // Fire OBJECT_NEAR when an object is close — the FSM picks it up
  if (systemSensors.distance < ctx->parameters->alert_cm) {
    fsm.sendEvent(EVENT_OBJECT_NEAR);
  }

  (void)ctx;
}
```

### 6. Fill in `src/guards.cpp`

```cpp
bool guard_is_close(const SystemContext* ctx) {
  return ctx->sensors->distance < ctx->parameters->alert_cm;
}

bool guard_is_far(const SystemContext* ctx) {
  return ctx->sensors->distance >= ctx->parameters->alert_cm;
}
```

### 7. Regenerate safely

Make a model change (add a parameter, add a task) and regenerate:

```bash
node dist/src/cli.js examples/hcsr04.yaml --target arduino --outdir build/hcsr04
```

Output confirms your implementation is kept:

```
  · src/actions.cpp  (kept - your code)
  · src/guards.cpp   (kept - your code)
```

Your HC-SR04 implementation is untouched.

---

## What the generated header gives you

Every generated project exposes these in `<name>_generated.h`, which `src/actions.cpp` already includes:

| Symbol | What it is |
|--------|-----------|
| `TRIG_PIN` | `#define` for each `digital_output` device's pin number |
| `DISTANCE_PIN` | `#define` for each `digital_input` / `analog_input` device's pin |
| `systemSensors.distance` | `float` field for each declared sensor/input device |
| `systemParameters.alert_cm` | `float` / `int` / `bool` for each declared parameter |
| `fsm` | The PulseHSM state machine instance — call `fsm.sendEvent(EVENT_…)` |
| `EVENT_<NAME>` | Enum value for each declared event |
| `S_<STATE>` | Integer constant for each state — compare with `ctx->currentState` |

Pin `#define` naming: `<DEVICE_NAME_UPPERCASE>_PIN`. Device `trig` → `TRIG_PIN`. Device `distance` → `DISTANCE_PIN`.

Sensor field naming: `systemSensors.<device_name>`. Device `distance` → `systemSensors.distance`.

---

## Device declarations for custom drivers

When your custom driver fully owns a pin's timing (like HC-SR04's echo pulse), you still benefit from declaring the pin as a primitive device: PulseIR emits the `pinMode()` call in `setup()` and generates the `#define` macro for your stub to use.

| Your device needs | Declare as | What PulseIR generates |
|-------------------|-----------|----------------------|
| Output pin (drive HIGH/LOW) | `digital_output` | `pinMode(PIN, OUTPUT)` + `PIN_PIN` macro |
| Input pin (read or time) | `digital_input` | `pinMode(PIN, INPUT)` + `PIN_PIN` macro + `systemSensors.name` field |
| Analog read | `analog_input` | `PIN_PIN` macro + `systemSensors.name` field |
| No initialization needed | Omit the device — hardcode the pin number in the stub | — |

If you declare a `digital_input` device but your custom action completely replaces the normal `gpio_read` logic (as HC-SR04 does), the `systemSensors.name` field is simply a float you write to yourself — the generated poll task that would normally call `gpio_read` won't be emitted because no `gpio_read` action is declared.

---

## Cross-platform custom drivers

A custom stub defaults to Arduino API calls. To support multiple targets, use preprocessor guards:

```cpp
void action_measure_distance(SystemContext* ctx) {
  // Trigger pulse — same on all platforms
  long duration_us;

#if defined(ARDUINO)
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  duration_us = pulseIn(DISTANCE_PIN, HIGH, 30000UL);

#elif defined(IDF_VER)
  // ESP-IDF: gpio_set_level + esp_timer_get_time based timing
  gpio_set_level((gpio_num_t)TRIG_PIN, 0); esp_rom_delay_us(2);
  gpio_set_level((gpio_num_t)TRIG_PIN, 1); esp_rom_delay_us(10);
  gpio_set_level((gpio_num_t)TRIG_PIN, 0);
  // ... echo timing with gpio_get_level + esp_timer_get_time
  duration_us = 0; // fill in
#endif

  float cm = duration_us * 0.0343f / 2.0f;
  systemSensors.distance = (duration_us == 0) ? 999.0f : cm;
  if (systemSensors.distance < ctx->parameters->alert_cm)
    fsm.sendEvent(EVENT_OBJECT_NEAR);
  (void)ctx;
}
```

---

## The complete example file

See `examples/hcsr04.yaml` for the full working model — generate and run it with:

```bash
# Arduino / ESP32
node dist/src/cli.js examples/hcsr04.yaml --target arduino --outdir build/hcsr04

# ESP-IDF
node dist/src/cli.js examples/hcsr04.yaml --target espidf --outdir build/hcsr04
```

Then fill in `src/actions.cpp` and `src/guards.cpp` as shown above. No other file needs editing.

---

## Limitations

| What you can't do | Workaround |
|-------------------|-----------|
| Have PulseIR auto-select platform API (like `digitalWriteExpr` does for GPIO) | Use `#ifdef ARDUINO` / `#ifdef IDF_VER` in the stub |
| Add a new entry to `systemSensors` without declaring a device | Declare a `digital_input` or `analog_input` device whose pin slot you repurpose for the computed value |
| Have PulseIR emit your library's `#include` and object declaration | Add the `#include` and any global variables at the top of `actions.cpp` directly |
| Emit your driver's setup code into `setup()` | Add an `actions:` entry with your `driver:` name and call it from a one-shot task `every: 1` — or add the setup code to the generated `.ino`'s `// USER SETUP` comment block |

---

## Summary

1. Pick any `driver:` name that isn't in the built-in list.
2. Generate — PulseIR creates a TODO stub in `src/actions.cpp`.
3. Fill in the stub. It has the pin macros, sensor fields, and parameters it needs.
4. Regenerate freely — the stub is never overwritten.

That's it. No codegen changes, no plugin system, no build system changes.
