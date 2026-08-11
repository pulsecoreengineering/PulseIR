# PulseIR → PulseHSM Integration

**Status**: MVP Codegen Complete  
**PulseHSM Version**: Production (ISR-safe, zero-heap)

---

## Overview

PulseIR codegen generates Arduino sketches that **use PulseHSM as the runtime**. The generated code:

1. Instantiates `PulseHSM`
2. Defines states and state callbacks
3. Sets up event dispatch
4. Implements transitions and actions

This document explains the mapping from PulseIR model → PulseHSM API calls.

---

## PulseHSM Core Concepts

### State Definition

```cpp
int addState(
  const char* name,           // Display name
  Action update,              // Called every loop() while active
  Action entry,               // Called when entering state
  Action exit,                // Called when exiting state
  unsigned long timeoutMs,    // Auto-timeout (0 = disabled)
  int timeoutNext,            // State to transition to on timeout
  EventCb onEvent,            // Event handler for this state
  int parent = -1             // Parent state (for hierarchy)
);
```

### State Machine Lifecycle

```cpp
PulseHSM hsm;

// Define states
int stateIdle = hsm.addState("idle", nullptr, onEnterIdle, nullptr, 0, -1, onEventIdle, -1);
int stateRun = hsm.addState("running", nullptr, onEnterRun, nullptr, 0, -1, onEventRun, -1);

// Start FSM
hsm.begin(stateIdle);

// Main loop
void loop() {
  // Generate events based on inputs
  hsm.sendEvent(EVT_START);
  
  // Update state machine
  hsm.update();
}
```

### Events

```cpp
// Send event (optional int32_t payload)
hsm.sendEvent(EVT_TEMP_REACHED, 65);  // payload = 65°C

// Inside event handler, read payload
bool onEventRunning(uint8_t evt) {
  int32_t temp = hsm.getEventData();  // = 65
  return true;  // handled
}
```

### Hierarchical States

```cpp
// Parent state
int stateOperating = hsm.addState("operating", nullptr, nullptr, nullptr, 0, -1, nullptr, -1);

// Child states (parent = stateOperating)
int stateHeating = hsm.addState("heating", nullptr, onEnter, nullptr, 0, -1, onEvent, stateOperating);
int stateCooling = hsm.addState("cooling", nullptr, onEnter, nullptr, 0, -1, onEvent, stateOperating);
```

When transitioning to `heating`, entry chain is:
1. Exit old state's chain
2. Enter `operating` (parent)
3. Enter `heating` (child)

---

## Generated Code Structure

### 1. State Enums (Simplified)

**Input YAML**:
```yaml
states:
  - name: idle
  - name: running
    type: composite
    initial: heating
    states:
      - name: heating
      - name: cooling
```

**Generated C++**:
```cpp
// All states flattened to enum
enum SystemState {
  STATE_IDLE = 0,
  STATE_RUNNING = 1,      // (parent, but still enumerated)
  STATE_HEATING = 2,      // (child)
  STATE_COOLING = 3       // (child)
};

const char* stateNames[] = {
  "IDLE", "RUNNING", "HEATING", "COOLING"
};
```

### 2. Event Enums

**Input YAML**:
```yaml
events:
  - name: START
    source: external
  - name: TEMP_REACHED
    source: sensor
```

**Generated C++**:
```cpp
enum SystemEvent {
  EVENT_START = 0,
  EVENT_TEMP_REACHED = 1
};

const char* eventNames[] = {
  "START", "TEMP_REACHED"
};
```

### 3. PulseHSM Instance

**Generated C++**:
```cpp
PulseHSM hsm;

void setup() {
  // Add all states
  hsm.addState("idle",      nullptr, onEnterIdle,    nullptr, 0, -1, onEventIdle,    -1);
  hsm.addState("running",   nullptr, onEnterRunning, nullptr, 0, -1, onEventRunning, -1);
  hsm.addState("heating",   nullptr, onEnterHeating, nullptr, 0, -1, onEventHeating, STATE_RUNNING);
  hsm.addState("cooling",   nullptr, onEnterCooling, nullptr, 0, -1, onEventCooling, STATE_RUNNING);

  // Start in initial state
  hsm.begin(STATE_IDLE);
}

void loop() {
  // Generate events (user fills this in)
  if (sensorTriggered()) {
    hsm.sendEvent(EVENT_TEMP_REACHED, sensorValue);
  }

  // Update state machine
  hsm.update();
}
```

### 4. Event Dispatch

**YAML Transitions**:
```yaml
transitions:
  - source: idle
    event: START
    target: running
    guard:
      name: ready_to_run
    actions:
      - start_pump
```

**Generated Event Handler**:
```cpp
bool onEventIdle(uint8_t evt) {
  switch (evt) {
    case EVENT_START:
      // Check guard
      if (!guard_idle_START(&systemContext)) {
        return false;  // Guard failed, bubble up
      }
      
      // Execute action
      action_start_pump(&systemContext);
      
      // Transition
      hsm.transitionTo(STATE_RUNNING);
      return true;  // Handled
  }
  return false;  // Not handled, bubble up
}
```

### 5. Guard Implementation

**YAML Guard**:
```yaml
guard:
  name: temp_at_setpoint
```

**Generated C++**:
```cpp
// Parameters stored in global variables (or class members)
float temperature = 0.0;
float setpoint = 60.0;

bool guard_idle_START(const SystemContext* ctx) {
  return temperature >= setpoint;
}
```

### 6. Action Implementation

**YAML Action**:
```yaml
actions:
  start_pump:
    type: driver
    driver: gpio_control
    params:
      pin: PUMP_PIN
      value: HIGH
```

**Generated Stub**:
```cpp
void action_start_pump(SystemContext* ctx) {
  Serial.print("  -> Action: start_pump");
  
  // TODO: Implement
  // Parameters: { "pin": "PUMP_PIN", "value": "HIGH" }
  
  digitalWrite(PUMP_PIN, HIGH);
}
```

---

## State Hierarchy Mapping

### PulseIR Model

```yaml
running:
  type: composite
  initial: heating
  states:
    heating:
    cooling:
    maintaining:
```

### Generated Code

```cpp
// State IDs
enum SystemState {
  STATE_RUNNING = 1,      // Parent
  STATE_HEATING = 2,      // Child
  STATE_COOLING = 3,      // Child
  STATE_MAINTAINING = 4   // Child
};

// Setup
hsm.addState("running",     nullptr, onEnterRunning,     nullptr, 0, -1, onEventRunning,     -1);
hsm.addState("heating",     nullptr, onEnterHeating,     nullptr, 0, -1, onEventHeating,     STATE_RUNNING);
hsm.addState("cooling",     nullptr, onEnterCooling,     nullptr, 0, -1, onEventCooling,     STATE_RUNNING);
hsm.addState("maintaining", nullptr, onEnterMaintaining, nullptr, 0, -1, onEventMaintaining, STATE_RUNNING);

// Initial state
hsm.begin(STATE_HEATING);  // Start in running/heating
```

### Entry/Exit Chain

When transitioning `IDLE` → `HEATING`:

1. Exit IDLE
2. Enter RUNNING (parent entry)
3. Enter HEATING (child entry)

When transitioning `HEATING` → `COOLING` (same parent):

1. Exit HEATING
2. (Stay in RUNNING, no exit)
3. Enter COOLING

PulseHSM handles this via LCA (Lowest Common Ancestor) algorithm.

---

## Event Flow

### Single Event Dispatch

```
hsm.sendEvent(EVENT_START)
    ↓
Event added to ring buffer
    ↓
hsm.update() called
    ↓
Event dequeued and dispatched
    ↓
onEventHeating(EVENT_START)?
    ↓ No, bubble up
onEventRunning(EVENT_START)?
    ↓ No, bubble up
onEventIdle(EVENT_START)?
    ↓ Yes, handled
    ↓ Execute guard → Execute action → Call transitionTo()
    ↓
Next update() executes transition
    ↓
Exit chain → Enter chain
```

### Multiple Events in Queue

```cpp
hsm.sendEvent(EVENT_A);
hsm.sendEvent(EVENT_B);
hsm.sendEvent(EVENT_C);

// update() processes all three
hsm.update();
// → Dispatches A, B, C in order
// → Executes any pending transitions
```

---

## Generated Code Example (Boiler System)

### Full Generated Structure

```cpp
#include <Arduino.h>
#include "PulseHSM.h"

// ============================================================================
// STATE & EVENT DEFINITIONS
// ============================================================================

enum SystemState {
  STATE_IDLE = 0,
  STATE_RUNNING = 1,
  STATE_HEATING = 2,
  STATE_MAINTAINING = 3,
  STATE_COOLING = 4,
  STATE_FAULT = 5
};

enum SystemEvent {
  EVENT_START = 0,
  EVENT_STOP = 1,
  EVENT_TEMP_REACHED = 2,
  EVENT_OVER_TEMP = 3,
  EVENT_EMERGENCY_STOP = 4
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

PulseHSM hsm;

// System parameters
float setpoint = 60.0;
float max_safe_temp = 75.0;
float temperature = 0.0;

// ============================================================================
// FORWARD DECLARATIONS
// ============================================================================

bool onEventIdle(uint8_t evt);
bool onEventRunning(uint8_t evt);
bool onEventHeating(uint8_t evt);
bool onEventMaintaining(uint8_t evt);
bool onEventCooling(uint8_t evt);
bool onEventFault(uint8_t evt);

void onEnterIdle();
void onEnterRunning();
void onEnterHeating();
void onEnterMaintaining();
void onEnterCooling();
void onEnterFault();

void action_start_pump(SystemContext* ctx);
void action_stop_pump(SystemContext* ctx);
void action_reduce_heat(SystemContext* ctx);
void action_activate_cooling(SystemContext* ctx);
void action_shutdown_all(SystemContext* ctx);

bool guard_idle_START(const SystemContext* ctx);
bool guard_heating_TEMP_REACHED(const SystemContext* ctx);
bool guard_maintaining_OVER_TEMP(const SystemContext* ctx);

// ============================================================================
// GUARD IMPLEMENTATIONS
// ============================================================================

bool guard_idle_START(const SystemContext* ctx) {
  return true;  // No guard
}

bool guard_heating_TEMP_REACHED(const SystemContext* ctx) {
  return temperature >= setpoint;
}

bool guard_maintaining_OVER_TEMP(const SystemContext* ctx) {
  return temperature > max_safe_temp;
}

// ============================================================================
// ACTION IMPLEMENTATIONS
// ============================================================================

void action_start_pump(SystemContext* ctx) {
  Serial.println("  -> Action: start_pump");
  digitalWrite(PUMP_PIN, HIGH);
}

void action_stop_pump(SystemContext* ctx) {
  Serial.println("  -> Action: stop_pump");
  digitalWrite(PUMP_PIN, LOW);
}

// ... etc ...

// ============================================================================
// STATE EVENT HANDLERS
// ============================================================================

bool onEventIdle(uint8_t evt) {
  switch (evt) {
    case EVENT_START:
      if (!guard_idle_START(&systemContext)) return false;
      action_start_pump(&systemContext);
      hsm.transitionTo(STATE_HEATING);
      return true;
    
    case EVENT_EMERGENCY_STOP:
      action_shutdown_all(&systemContext);
      hsm.transitionTo(STATE_FAULT);
      return true;
  }
  return false;
}

bool onEventHeating(uint8_t evt) {
  switch (evt) {
    case EVENT_TEMP_REACHED:
      if (!guard_heating_TEMP_REACHED(&systemContext)) return false;
      action_reduce_heat(&systemContext);
      hsm.transitionTo(STATE_MAINTAINING);
      return true;
    
    case EVENT_EMERGENCY_STOP:
      action_shutdown_all(&systemContext);
      hsm.transitionTo(STATE_FAULT);
      return true;
  }
  return false;
}

// ... etc ...

// ============================================================================
// STATE ENTRY HANDLERS
// ============================================================================

void onEnterIdle() {
  Serial.println("Enter: IDLE");
}

void onEnterHeating() {
  Serial.println("Enter: HEATING");
}

// ... etc ...

// ============================================================================
// SETUP & LOOP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("boiler_control v1.0 starting...");

  // Configure GPIO
  pinMode(PUMP_PIN, OUTPUT);
  pinMode(HEATER_PIN, OUTPUT);
  pinMode(COOLING_FAN_PIN, OUTPUT);

  // Add states
  hsm.addState("idle",       nullptr, onEnterIdle,       nullptr, 0, -1, onEventIdle,       -1);
  hsm.addState("running",    nullptr, onEnterRunning,    nullptr, 0, -1, onEventRunning,    -1);
  hsm.addState("heating",    nullptr, onEnterHeating,    nullptr, 0, -1, onEventHeating,    STATE_RUNNING);
  hsm.addState("maintaining",nullptr, onEnterMaintaining,nullptr, 0, -1, onEventMaintaining,STATE_RUNNING);
  hsm.addState("cooling",    nullptr, onEnterCooling,    nullptr, 0, -1, onEventCooling,    STATE_RUNNING);
  hsm.addState("fault",      nullptr, onEnterFault,      nullptr, 0, -1, onEventFault,      -1);

  // Start FSM
  hsm.begin(STATE_IDLE);
}

void loop() {
  // TODO: Poll sensors and generate events
  // Example:
  // float temp = readTemperatureSensor();
  // if (temp >= setpoint) {
  //   hsm.sendEvent(EVENT_TEMP_REACHED, (int32_t)temp);
  // }

  // Update state machine
  hsm.update();

  delay(10);
}
```

---

## Key Generated Code Patterns

### Pattern 1: Unconditional Transition

```yaml
transitions:
  - source: idle
    event: START
    target: running
    actions:
      - start_pump
```

```cpp
bool onEventIdle(uint8_t evt) {
  if (evt == EVENT_START) {
    action_start_pump(&systemContext);
    hsm.transitionTo(STATE_RUNNING);
    return true;
  }
  return false;
}
```

### Pattern 2: Guarded Transition

```yaml
transitions:
  - source: heating
    event: TEMP_REACHED
    guard:
      name: temp_at_setpoint
    target: maintaining
    actions:
      - reduce_heat
```

```cpp
bool onEventHeating(uint8_t evt) {
  if (evt == EVENT_TEMP_REACHED) {
    if (!guard_heating_TEMP_REACHED(&systemContext)) return false;
    action_reduce_heat(&systemContext);
    hsm.transitionTo(STATE_MAINTAINING);
    return true;
  }
  return false;
}

bool guard_heating_TEMP_REACHED(const SystemContext* ctx) {
  return temperature >= setpoint;
}
```

### Pattern 3: Wildcard Transition (Emergency Stop)

```yaml
transitions:
  - source: "*"
    event: EMERGENCY_STOP
    target: fault
    actions:
      - shutdown_all
```

```cpp
// Generated in EVERY state's event handler
bool onEventIdle(uint8_t evt) {
  if (evt == EVENT_EMERGENCY_STOP) {
    action_shutdown_all(&systemContext);
    hsm.transitionTo(STATE_FAULT);
    return true;
  }
  return false;
}

bool onEventHeating(uint8_t evt) {
  if (evt == EVENT_EMERGENCY_STOP) {
    action_shutdown_all(&systemContext);
    hsm.transitionTo(STATE_FAULT);
    return true;
  }
  // ... other events ...
  return false;
}

// ... repeated in all event handlers ...
```

---

## Memory & Performance

### Generated Code Overhead

For a typical system (5 states, 5 events, 3 actions):

| Metric | Size |
|--------|------|
| State definitions | ~50 bytes |
| Event handlers | ~300 bytes |
| Guard functions | ~100 bytes |
| Action stubs | ~200 bytes |
| Total .text | ~650 bytes |
| Total .data | ~100 bytes (strings) |

### Runtime Performance

| Operation | Time |
|-----------|------|
| sendEvent() | O(1) — ring buffer append |
| update() | O(n) — n = events in queue |
| Event dispatch | O(d) — d = state depth (max 4) |
| Transition | O(h) — h = hierarchy height |

For 8 states, max 4 events/update, depth ≤ 4: **< 1ms per loop iteration**.

---

## Integration Checklist

When generating code for a new system:

- [ ] All states defined in `addState()` calls
- [ ] Initial state correct (leaf state, not parent)
- [ ] Event handlers check both conditions and actions
- [ ] Guards implemented as separate functions
- [ ] Actions stubbed with TODO comments
- [ ] Wildcard transitions in all handlers (emergency stops)
- [ ] Entry/exit handlers defined (even if empty)
- [ ] GPIO pins defined as constants
- [ ] Serial logging enabled for debugging
- [ ] loop() has sensor poll + hsm.update()

---

## Debugging Tips

### Serial Logging Output

Generated code includes logging:

```
boiler_control v1.0 starting...
Initial state: IDLE

Event: START in state: IDLE
  -> Guard: passed
  -> Action: start_pump
  -> Transitioned to: HEATING

Event: TEMP_REACHED in state: HEATING
  -> Guard: passed (60 >= 60)
  -> Action: reduce_heat
  -> Transitioned to: MAINTAINING
```

### Checking State

```cpp
Serial.print("Current: ");
Serial.println(hsm.getCurrentName());

Serial.print("Previous: ");
Serial.println(hsm.getPreviousName());

Serial.print("Time in state: ");
Serial.print(hsm.getStateElapsed());
Serial.println(" ms");
```

### Event Data

```cpp
hsm.sendEvent(EVENT_TEMP_REACHED, 65);

bool onEventHeating(uint8_t evt) {
  if (evt == EVENT_TEMP_REACHED) {
    int32_t temp = hsm.getEventData();  // = 65
    Serial.print("Temp: ");
    Serial.println(temp);
  }
}
```

---

## Next Steps

1. **PulseCore IDE**: Serialize visual FSM → YAML IR
2. **PulseSim**: Import YAML IR, simulate state machine
3. **PulseDash**: Visualize live state from deployed system (via PulseCore Monitor)
4. **Multi-target codegen**: ESP-IDF, FreeRTOS, bare metal

---

**Last Updated**: August 9, 2026  
**Related Files**: PulseHSM.h, PulseHSM.cpp, ARCHITECTURE.md
