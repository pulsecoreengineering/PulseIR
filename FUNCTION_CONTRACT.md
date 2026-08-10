# PulseIR Function Contract

**Status**: Binding Specification  
**Version**: 1.0  
**Date**: August 9, 2026

---

## Core Principle

**YAML never contains logic. YAML only contains names.**

Guards and actions are **references to user-defined functions**. The generator's job is to describe *shape* (states, events, transitions), never *behavior*. All actual logic lives in user-written code.

---

## 1. Guard Function Contract

A guard is a **pure boolean check** — no side effects allowed.

### YAML Definition

```yaml
transitions:
  - source: heating
    event: TEMP_CHECK
    guard: temp_ready
    target: maintaining
    actions:
      - reduce_heat
```

### Generated Stub (Fixed Signature)

```c
bool guard_temp_ready(const SystemContext* ctx) {
  // TODO: Implement
  return false;
}
```

### Rules

1. **Signature is always**: `bool guard_<name>(const SystemContext* ctx)`
2. **Return value only**: True = allow transition, False = block transition
3. **Pure check**: No side effects by convention
4. **Single responsibility**: One condition per guard
5. **If composition needed**: User writes one function that does the composition

### SystemContext

The guard receives a read-only context object:

```c
typedef struct {
  int currentState;           // Current state ID
  int previousState;          // Previous state
  int32_t eventData;          // Payload from the triggering event
  const SystemParameters* parameters;  // All system parameters
  const SystemSensors* sensors;        // Current sensor readings
} SystemContext;
```

**User reads what they need from this context**. No YAML ever evaluates sensor values or parameters.

---

## 2. Action Function Contract

An action is a **stateful operation** — all I/O, timing, and side effects happen here.

### YAML Definition

```yaml
actions:
  begin_work:
    type: driver
    driver: gpio_control
    params:
      pin: LED
      value: HIGH
```

### Generated Stub (Fixed Signature)

```c
void action_begin_work(SystemContext* ctx) {
  Serial.print("  -> Action: begin_work");
  
  // TODO: Implement action logic
  // Parameters: { "pin": "LED", "value": "HIGH" }
  
  // User writes the actual hardware calls here
  digitalWrite(LED_PIN, HIGH);
}
```

### Rules

1. **Signature is always**: `void action_<name>(SystemContext* ctx)`
2. **Parameters in YAML are documentation only** — never evaluated by codegen
3. **All hardware calls are 100% user-written**
4. **Can read from SystemContext** to adapt behavior based on system state
5. **Can set next events** via the context (for chained actions)

### SystemContext (Mutable for Actions)

Actions receive a mutable context:

```c
typedef struct {
  int currentState;
  int previousState;
  int32_t eventData;
  const SystemParameters* parameters;
  const SystemSensors* sensors;
  
  // Action may set next event
  void (*sendEvent)(uint8_t event, int32_t data);
  
  // Action may read custom user state
  void* userData;
} SystemContext;
```

---

## 3. Naming Convention

- **Guard functions**: `guard_<name>`
- **Action functions**: `action_<name>`
- **Names must be identical across all targets** (Arduino, ESP-IDF, future)

This allows the same user-written guard/action source file to be reused across platforms.

---

## 4. No YAML Logic — Examples

### ❌ NOT ALLOWED (logic in YAML)

```yaml
# DO NOT DO THIS:
guards:
  temp_and_pressure_ok:
    expression: "temperature >= setpoint AND pressure < max_pressure"

actions:
  maybe_start:
    condition: "ready && connected"
    then: start_pump
    else: stop_pump
```

### ✅ ALLOWED (YAML names, user code implements)

```yaml
guards:
  temp_ready: null   # Just a name

actions:
  begin_work: null   # Just a name

# Transitions reference the names:
transitions:
  - source: idle
    event: START
    guard: temp_ready            # ← Reference to user function
    target: running
    actions:
      - begin_work               # ← Reference to user function
```

**User writes**:

```c
bool guard_temp_ready(const SystemContext* ctx) {
  // User implements the actual check
  return ctx->sensors->temperature >= ctx->parameters->setpoint;
}

void action_begin_work(SystemContext* ctx) {
  // User implements the actual work
  digitalWrite(PUMP_PIN, HIGH);
  Serial.println("Pump started");
}
```

---

## 5. Multi-Target Portability

The contract is platform-agnostic. Each target provides its own scaffolding:

| Platform | Event Loop | Timing | Guard/Action Signatures |
|----------|-----------|--------|------------------------|
| **Arduino** | `loop()` polling | `millis()` | **Same** |
| **ESP-IDF** | FreeRTOS task + esp_event | `esp_timer_get_time()` | **Same** |
| **Bare Metal** | interrupt-driven | platform timer | **Same** |

The **scaffolding changes per target**, but:
- Guard signature never changes
- Action signature never changes
- YAML schema never changes
- Naming convention never changes
- User-written source files are 100% reusable

---

## 6. What PulseIR Will Never Do

These are hard boundaries:

- ❌ Parse or evaluate expressions written in YAML
- ❌ Support boolean composition (AND/OR/NOT) in YAML
- ❌ Model hardware peripherals or interrupts in YAML
- ❌ Diverge guard/action signatures between targets
- ❌ Evaluate YAML parameters as guards (e.g., `"param >= 60"`)
- ❌ Provide built-in conditional actions (no if/then/else in YAML)

**If a feature request would require any of the above, it's out of scope.**

---

## 7. Codegen Responsibility

### What the generator MUST do:

✅ Parse YAML and extract guard/action names  
✅ Emit stub function signatures with fixed signature  
✅ Generate call sites in event handlers  
✅ Wire transitions to guards and actions  
✅ Pass SystemContext to guard/action calls  
✅ Document parameter values in comments  

### What the generator MUST NOT do:

❌ Evaluate or interpret guard condition strings  
❌ Parse expressions or mathematical notation  
❌ Make decisions about what values to pass  
❌ Implement guard/action logic  
❌ Change signatures based on YAML content  

---

## 8. Implementation Checklist

For each codegen target:

- [ ] Define `SystemContext` struct with platform-specific fields
- [ ] Define `SystemParameters` struct (read from YAML)
- [ ] Define `SystemSensors` struct (platform-specific sensors)
- [ ] Generate guard stubs with correct signature
- [ ] Generate action stubs with correct signature
- [ ] Wire guard calls in event dispatch logic
- [ ] Wire action calls at transition points
- [ ] Pass populated SystemContext to all calls
- [ ] Document YAML params as comments in action stubs
- [ ] Ensure naming convention matches (guard_*, action_*)

---

## 9. Examples

### Example 1: Temperature Guard

**YAML**:
```yaml
transitions:
  - source: heating
    event: TEMP_CHECK
    guard: temp_at_setpoint
    target: maintaining
```

**User Code**:
```c
bool guard_temp_at_setpoint(const SystemContext* ctx) {
  float temp = ctx->sensors->temperature;
  float setpoint = ctx->parameters->setpoint;
  float hysteresis = ctx->parameters->hysteresis;
  
  return (temp >= setpoint - hysteresis) &&
         (temp <= setpoint + hysteresis);
}
```

### Example 2: Action with Parameters

**YAML**:
```yaml
actions:
  set_pump:
    type: driver
    driver: gpio_control
    params:
      pin: PUMP_PIN
      value: HIGH
```

**User Code**:
```c
void action_set_pump(SystemContext* ctx) {
  Serial.println("  -> Action: set_pump");
  // Parameters documented in comments:
  // pin: PUMP_PIN
  // value: HIGH
  
  digitalWrite(PUMP_PIN, HIGH);
}
```

### Example 3: Complex Guard (Composition)

**YAML**:
```yaml
transitions:
  - source: running
    event: CHECK_SAFETY
    guard: system_safe_to_continue
    target: running
```

**User Code** (User implements composition):
```c
bool guard_system_safe_to_continue(const SystemContext* ctx) {
  bool temp_ok = ctx->sensors->temperature < ctx->parameters->max_safe_temp;
  bool pressure_ok = ctx->sensors->pressure < ctx->parameters->max_pressure;
  bool timeout_ok = ctx->currentState != ctx->previousState || 
                    (millis() - ctx->entryTime) < TIMEOUT_MS;
  
  return temp_ok && pressure_ok && timeout_ok;
}
```

---

## 10. Questions & Answers

**Q: Can a guard have side effects?**  
A: By convention, no. A guard should be a pure check. If you need side effects, do them in an action.

**Q: Can an action return a value?**  
A: No. Actions are always void. If you need to communicate something, set a next event via `ctx->sendEvent()`.

**Q: Can I call one guard from another?**  
A: Yes. But keep it simple. The code is user-written, so do what makes sense.

**Q: How do I pass data between actions?**  
A: Use `ctx->userData` (opaque pointer to user-defined state) or module-level statics.

**Q: What if I need more than SystemContext?**  
A: You can. SystemContext is the baseline contract. Individual platforms may extend it (e.g., ESP-IDF might add FreeRTOS task handles). Just stick to the core fields.

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Aug 9, 2026 | Initial contract specification |

---

## 12. Related Documents

- **ARCHITECTURE.md** — Overall system design
- **INTEGRATION.md** — How codegen integrates with PulseHSM
- **QUICKSTART.md** — Hands-on tutorial

---

**This contract is binding. Any codegen that violates it is out of spec.**
