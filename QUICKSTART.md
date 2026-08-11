# PulseIR Quick Start

**TL;DR**: Write YAML, get Arduino code. 5 minutes.

---

## 1. Install & Build

```bash
# Install dependencies
npm install

# Build
npm run build

# Test (optional)
npm run cli -- examples/boiler/pulse.yaml --output /tmp/test.ino
cat /tmp/test.ino
```

---

## 2. Create a YAML System

Create `my_system.yaml`:

```yaml
project:
  name: my_system
  version: "1.0"

target:
  board: esp32

# What is physically wired up. The machine refers to `led`, never to GPIO12.
hardware:
  devices:
    led:
      type: digital_output
      pin: GPIO12

# Configuration contract: becomes a C struct, and a dashboard control.
parameters:
  blink_delay:
    type: int
    default: 500
    range: [50, 5000]
    unit: ms

# What the system reacts to.
events:
  START: { source: external }
  STOP:  { source: external }

# Named side effects. You implement each one in C.
actions:
  begin_work:
    driver: gpio_control
    params: { device: led, value: HIGH }
  end_work:
    driver: gpio_control
    params: { device: led, value: LOW }

# Behaviour.
machine:
  states:
    idle:
    running:
    stopped:

  transitions:
    - from: idle
      on: START
      to: running
      do: begin_work

    - from: running
      on: STOP
      to: stopped
      do: end_work
```

Sections that name things are **keyed by name**, so you cannot accidentally
declare two `START` events. Transitions stay a **list**, because their order
decides which one wins when both could fire.

---

## 3. Generate Arduino Code

```bash
node dist/src/cli.js my_system.yaml --output my_system.ino
```

This generates a complete Arduino sketch with:
- ✅ `PULSEHSM_MAX_*` macros sized from your model
- ✅ Event enum and `SystemContext` / `SystemParameters` / `SystemSensors`
- ✅ Every state registered with `addState()`, parents first
- ✅ One `onEvent` handler per state, wired to guards and actions
- ✅ Guard and action stubs (you fill in the logic)

---

## 4. Implement Action Logic

Open `my_system.ino` and find the action stub:

```cpp
void action_begin_work(SystemContext* ctx) {
  Serial.println("  -> Action: begin_work");
  // Parameters declared in the model (documentation only):
  //   pin: "LED"
  //   value: "HIGH"
  //
  // TODO: Implement the hardware calls for this action.
  (void)ctx;
}
```

Fill in the logic. Everything you need is on `ctx` - parameters, sensor
readings, and the current state:

```cpp
void action_begin_work(SystemContext* ctx) {
  Serial.println("  -> Action: begin_work");
  digitalWrite(LED_PIN, HIGH);
}

void action_end_work(SystemContext* ctx) {
  Serial.print("  -> Action: end_work, blink delay ");
  Serial.println(ctx->parameters->blink_delay);
  digitalWrite(LED_PIN, LOW);
}
```

The signature is fixed and identical on every target, so these functions port
unchanged - see FUNCTION_CONTRACT.md.

---

## 5. Trigger Events

In `loop()`, generate events based on your sensors/inputs:

```cpp
void loop() {
  // Read sensors into the context the guards and actions see
  systemSensors.water_temp = readTemperature();

  // Raise events with fsm.sendEvent(). It only queues - fsm.update()
  // dispatches. sendEvent() is ISR-safe, so interrupts may call it too.
  static unsigned long lastPress = 0;
  if (digitalRead(BUTTON_PIN) == LOW && millis() - lastPress > 50) {
    lastPress = millis();          // debounce without blocking
    fsm.sendEvent(EVENT_START);
  }

  fsm.update();
}
```

> **Never call `delay()`.** It starves `fsm.update()`, so events pile up in the
> ring buffer and timeouts fire late. Compare against `millis()` or
> `fsm.getStateElapsed()` instead.

---

## 6. Upload & Run

```bash
# Copy my_system.ino to Arduino IDE
# Upload to your board
# Open Serial Monitor
# Press button → watch state transitions!
```

---

## YAML Quick Reference

### States

**Simple state** — nothing under it:
```yaml
states:
  idle:
```

**Hierarchical state** — a state with `states:` under it is composite; you do
not declare the type:
```yaml
states:
  running:
    initial: warming      # defaults to the first child
    states:
      warming:
      cooling:
```

### Events

```yaml
events:
  START:         { source: external }   # User input
  TIMER_EXPIRED: { source: timer }      # Timer
  TEMP_REACHED:  { source: sensor }     # Sensor value
  MQTT_COMMAND:  { source: mqtt }       # Remotely triggerable
  CHECK_ERROR:   { source: internal }   # Internal condition
```

Only events declared `source: mqtt` are exposed as remote commands in the topic
manifest — a dashboard cannot fire a transition you never meant it to.

### Transitions

**Simple**:
```yaml
- from: idle
  on: START
  to: running
```

**With guard**:
```yaml
- from: running
  on: TEMP_REACHED
  guard: temp_at_setpoint
  to: maintaining
```

A guard is the **name of a function you write in C** — the YAML never contains
the condition itself. To record what it checks, use the mapping form; the
description becomes a comment in the generated stub:

```yaml
- from: running
  on: TEMP_REACHED
  guard:
    name: temp_at_setpoint
    description: water temperature has reached the setpoint
  to: maintaining
```

**With actions** — `do:` takes one name or several:
```yaml
- from: idle
  on: START
  to: running
  do: start_pump

- from: idle
  on: START
  to: running
  do: [start_pump, open_log]
```

**Wildcard (from any state)**:
```yaml
- from: "*"
  on: EMERGENCY_STOP
  to: fault
```

### Actions

```yaml
actions:
  start_pump:
    driver: gpio_control
    params: { device: pump, value: HIGH }
```

Once an `actions:` catalogue exists it is authoritative: a transition that does
an action you never declared is a typo, and is reported as one.

### Components

```yaml
hardware:
  devices:
    temperature_sensor:
      type: ds18b20        # implies class: sensor
      bus: sensor_bus
      unit: degC

    pump:
      type: digital_output # implies class: actuator
      pin: GPIO25
```

Built-in types: `digital_output`, `digital_input`, `pwm_output`,
`analog_input`, plus common parts like `ds18b20`, `dht22`, `bme280`. Any other
type must state its `class` — guessing could publish an actuator as if it were
a sensor reading.

### Resources

```yaml
hardware:
  buses:
    sensor_bus:
      interface: onewire
      pin: GPIO4

    i2c_bus:
      interface: i2c
      sda: GPIO21
      scl: GPIO22
      frequency: 400000
```

### Parameters

```yaml
parameters:
  setpoint:
    type: float
    default: 60.0
    range: [0, 100]
    unit: degC
```

---

## Common Patterns

### Pattern 1: Button → Action

```yaml
events:
  BUTTON_PRESSED: { source: external }

actions:
  toggle_led:
    driver: gpio_control
    params: { device: led, value: TOGGLE }

machine:
  transitions:
    - from: idle
      on: BUTTON_PRESSED
      to: idle
      do: toggle_led
```

In Arduino:
```cpp
if (digitalRead(BUTTON_PIN) == LOW) {
  fsm.sendEvent(EVENT_BUTTON_PRESSED);
}
```

### Pattern 2: Sensor Reading → Conditional Transition

```yaml
events:
  TEMP_CHECK: { source: sensor }

machine:
  transitions:
    - from: heating
      on: TEMP_CHECK
      guard: temp_at_target
      to: maintaining
      do: reduce_heat
```

In Arduino:
```cpp
systemSensors.water_temp = tempSensor.read();
if (systemSensors.water_temp >= systemParameters.setpoint) {
  fsm.sendEvent(EVENT_TEMP_CHECK);
}
```

The guard `temp_at_target` then decides whether the transition actually fires,
reading the same values through `ctx`.

### Pattern 3: Timeout / Timer Event

```yaml
events:
  TIMEOUT: { source: timer }

machine:
  transitions:
    - from: running
      on: TIMEOUT
      to: stopped
      do: cleanup
```

In Arduino:
```cpp
static unsigned long lastActivity = 0;
unsigned long now = millis();

if (now - lastActivity > TIMEOUT_MS) {
  fsm.sendEvent(EVENT_TIMEOUT);
  lastActivity = now;
}
```

For a timeout that always leaves the same state, PulseHSM can do this for you
via `addState()`'s `timeoutMs` / `timeoutNext`. The IR has no field for it yet
(see PLAN.md), so raise the event yourself for now.

### Pattern 4: Emergency Stop (From Any State)

```yaml
machine:
  transitions:
    - from: "*"
      on: EMERGENCY_STOP
      to: fault
      do: shutdown
```

Works from any state automatically.

---

## Debugging

### Enable Serial Logging

Generated code includes Serial debug output:

```cpp
Serial.begin(115200);
```

You'll see:
```
=== my_system v1.0 ===
HSM Started
Initial state: IDLE

Event: START in state: IDLE
  -> Action: begin_work
  -> Transitioned to: RUNNING

Event: STOP in state: RUNNING
  -> Action: end_work
  -> Transitioned to: STOPPED
```

### No Matching Transition

If you generate an event with no matching transition:

```
Event: UNKNOWN in state: RUNNING
  -> No matching transition
```

Check your YAML for the transition definition.

### Guard Blocked the Transition

If nothing happens when an event arrives, a guard may have returned false.

Generated guard stubs `return false` until you implement them, so a freshly
generated sketch will appear to ignore every guarded transition. That is
expected — fill in the stub.

Note that a blocked guard does **not** consume the event. It keeps bubbling up
the hierarchy, so an enclosing state may still handle it.

---

## File Structure

```
my_system/
├── my_system.yaml          ← Write this
├── my_system.ino           ← Generated
└── notes.txt               ← Your implementation notes
```

Then upload `my_system.ino` to Arduino IDE.

---

## Workflow

```
1. Write YAML (describe your system)
   ↓
2. Generate code (node dist/src/cli.js ... --output ...)
   ↓
3. Implement actions (fill in the stubs)
   ↓
4. Add event triggers (fill in loop() with sensor logic)
   ↓
5. Upload & test (Arduino IDE)
   ↓
6. Debug with Serial Monitor
   ↓
7. Done!
```

---

## Troubleshooting

**Q: "Unknown event in state X"**  
A: The transition for that event/state combo doesn't exist. Check YAML.

**Q: "A guarded transition never fires"**  
A: Your `guard_*` function returned false. Generated stubs return false until
you implement them — check you have filled the stub in, then check the sensor
values you read from `ctx->sensors`.

**Q: "Compilation errors in .ino"**  
A: Usually missing `#include` or pin definitions. Check generated code comments and add missing headers.

**Q: "State never changes"**  
A: No events are being raised. Call `fsm.sendEvent(EVENT_NAME)` from `loop()`
(or an ISR — it is ISR-safe), and make sure `fsm.update()` runs every
iteration. Never call `delay()`; it starves `fsm.update()`.

**Q: "How do I call a function from an action?"**  
A: The action stub is just a function. Call anything you want:
```cpp
void action_my_action(SystemContext* ctx) {
  myCustomFunction();
  digitalWrite(PIN, HIGH);
  Serial.println("Done");
}
```

---

## Next Steps

- See `ARCHITECTURE.md` for full design details
- See `examples/boiler.yaml` for a complete system
- Run tests: `npm run build && node dist/test/codegen.test.js`

---

**Happy state machine building!** 🎯
