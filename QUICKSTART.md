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
npm run cli -- examples/boiler.yaml --output /tmp/test.ino
cat /tmp/test.ino
```

---

## 2. Create a YAML System

Create `my_system.yaml`:

```yaml
project:
  name: my_system
  version: 1.0

system:
  # Events the system responds to
  events:
    - name: START
      source: external
    - name: STOP
      source: external

  # States the system can be in
  states:
    - name: idle
      type: simple
    - name: running
      type: simple
    - name: stopped
      type: simple

  # Transitions between states
  transitions:
    - source: idle
      event: START
      target: running
      actions:
        - begin_work

    - source: running
      event: STOP
      target: stopped
      actions:
        - end_work

  # Actions (things that happen)
  actions:
    begin_work:
      type: driver
      driver: gpio_control
      params:
        pin: LED
        value: HIGH

    end_work:
      type: driver
      driver: gpio_control
      params:
        pin: LED
        value: LOW

  # Components (sensors, actuators, services)
  components:
    - name: led
      class: actuator
      driver: gpio_control
      config:
        pin: GPIO12

  # Hardware resources
  resources:
    - name: gpio
      interface: gpio

  # Configuration parameters
  parameters:
    - name: blink_delay
      type: int
      default: 500
      unit: ms
```

---

## 3. Generate Arduino Code

```bash
node dist/src/cli.js my_system.yaml --output my_system.ino
```

This generates a complete Arduino sketch with:
- ✅ State machine enums
- ✅ Event processing loop
- ✅ Transition table
- ✅ Action stubs (you fill in logic)

---

## 4. Implement Action Logic

Open `my_system.ino` and find the action stub:

```cpp
void action_begin_work() {
  Serial.print("  -> Action: begin_work");
  
  // TODO: Implement action logic
  // Parameters: { "pin": "LED", "value": "HIGH" }
  
  // Add your code here:
  digitalWrite(LED_PIN, HIGH);
}
```

Fill in the logic:

```cpp
void action_begin_work() {
  Serial.print("  -> Action: begin_work");
  digitalWrite(LED_PIN, HIGH);
}

void action_end_work() {
  Serial.print("  -> Action: end_work");
  digitalWrite(LED_PIN, LOW);
}
```

---

## 5. Trigger Events

In `loop()`, generate events based on your sensors/inputs:

```cpp
void loop() {
  // TODO: Generate events based on sensor inputs, timers, etc.
  
  // Example: button press triggers START
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(20);  // debounce
    if (digitalRead(BUTTON_PIN) == LOW) {
      pendingEvent = EVENT_START;
    }
  }

  // Process pending event
  if (pendingEvent != (SystemEvent)-1) {
    processEvent(pendingEvent);
    pendingEvent = (SystemEvent)-1;
  }

  delay(10);
}
```

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

**Simple state**:
```yaml
- name: idle
  type: simple
```

**Hierarchical state**:
```yaml
- name: running
  type: composite
  initial: warming
  states:
    - name: warming
      type: simple
    - name: cooling
      type: simple
```

### Events

```yaml
events:
  - name: START
    source: external           # User input
  
  - name: TIMER_EXPIRED
    source: timer             # Timer
  
  - name: TEMP_REACHED
    source: sensor            # Sensor value
  
  - name: MQTT_COMMAND
    source: mqtt              # MQTT message
  
  - name: CHECK_ERROR
    source: internal          # Internal condition
```

### Transitions

**Simple**:
```yaml
- source: idle
  event: START
  target: running
```

**With guard**:
```yaml
- source: running
  event: TEMP_REACHED
  guard:
    type: expression
    expression: "temperature >= setpoint"
  target: maintaining
```

**With action**:
```yaml
- source: idle
  event: START
  target: running
  actions:
    - start_pump
```

**Wildcard (from any state)**:
```yaml
- source: "*"
  event: EMERGENCY_STOP
  target: fault
```

### Actions

```yaml
actions:
  start_pump:
    type: driver
    driver: gpio_control
    params:
      pin: PUMP_PIN
      value: HIGH
```

### Components

```yaml
components:
  - name: temperature_sensor
    class: sensor
    driver: ds18b20
    config:
      interface: onewire
      pin: GPIO4

  - name: pump
    class: actuator
    driver: gpio_control
    config:
      pin: GPIO25
```

### Resources

```yaml
resources:
  - name: gpio
    interface: gpio
  
  - name: onewire
    interface: onewire
    binding:
      pin: GPIO4
```

### Parameters

```yaml
parameters:
  - name: setpoint
    type: float
    default: 60.0
    unit: degC
    min: 0
    max: 100
```

---

## Common Patterns

### Pattern 1: Button → Action

```yaml
events:
  - name: BUTTON_PRESSED
    source: external

actions:
  toggle_led:
    type: driver
    driver: gpio_control
    params:
      pin: LED
      value: TOGGLE

transitions:
  - source: idle
    event: BUTTON_PRESSED
    target: idle
    actions:
      - toggle_led
```

In Arduino:
```cpp
if (digitalRead(BUTTON_PIN) == LOW) {
  pendingEvent = EVENT_BUTTON_PRESSED;
}
```

### Pattern 2: Sensor Reading → Conditional Transition

```yaml
events:
  - name: TEMP_CHECK
    source: sensor

transitions:
  - source: heating
    event: TEMP_CHECK
    guard:
      type: expression
      expression: "temp >= target"
    target: maintaining
    actions:
      - reduce_heat
```

In Arduino:
```cpp
float temp = tempSensor.read();
if (temp >= TARGET_TEMP) {
  pendingEvent = EVENT_TEMP_CHECK;
}
```

### Pattern 3: Timeout / Timer Event

```yaml
events:
  - name: TIMEOUT
    source: timer

transitions:
  - source: running
    event: TIMEOUT
    target: stopped
    actions:
      - cleanup
```

In Arduino:
```cpp
static unsigned long lastActivity = 0;
unsigned long now = millis();

if (now - lastActivity > TIMEOUT_MS) {
  pendingEvent = EVENT_TIMEOUT;
  lastActivity = now;
}
```

### Pattern 4: Emergency Stop (From Any State)

```yaml
transitions:
  - source: "*"
    event: EMERGENCY_STOP
    target: fault
    actions:
      - shutdown
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

### Guard Failed

If a guard blocks a transition:

```
Event: TEMP_REACHED in state: RUNNING
  -> Guard failed, transition blocked
```

The condition in your guard expression was false.

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

**Q: "Guard failed"**  
A: The guard expression evaluated to false. Check sensor values and guard condition.

**Q: "Compilation errors in .ino"**  
A: Usually missing `#include` or pin definitions. Check generated code comments and add missing headers.

**Q: "State never changes"**  
A: No events are being generated. Check that you're setting `pendingEvent` in `loop()`.

**Q: "How do I call a function from an action?"**  
A: The action stub is just a function. Call anything you want:
```cpp
void action_my_action() {
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
