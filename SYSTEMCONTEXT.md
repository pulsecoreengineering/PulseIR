# SystemContext Implementation

**Status**: Implemented
**Date**: August 10, 2026
**Binding Spec**: FUNCTION_CONTRACT.md

---

## What Changed

The codegen now generates code that follows the **FUNCTION_CONTRACT.md** binding spec.

### Before

```c
bool guard_temp_ready() {
  return false;  // No access to system state
}

void action_start_pump() {
  // How do I read sensors? Parameters? Current state?
}
```

### After

```c
bool guard_temp_ready(const SystemContext* ctx) {
  return ctx->sensors->temperature_sensor >= ctx->parameters->setpoint;
}

void action_start_pump(SystemContext* ctx) {
  // Access everything via context
  if (ctx->currentState == S_HEATING) {
    digitalWrite(PUMP_PIN, HIGH);
  }
}
```

---

## Generated Structures

Every generated sketch includes these three structures.

### 1. SystemParameters (from the model)

Generated from the model's `parameters` section, initialized with the declared
defaults. Types map as `float → float`, `int → int32_t`, `bool → bool`,
`string → const char*`.

```c
struct SystemParameters {
  float setpoint;        // degC
  float max_safe_temp;   // degC
  float hysteresis;      // degC
};

SystemParameters systemParameters = {
  60.0f,   // setpoint
  75.0f,   // max_safe_temp
  2.0f     // hysteresis
};
```

### 2. SystemSensors (you fill in the readings)

One `float` field per component with `class: sensor`. The **field name is the
component name**, so `temperature_sensor` in the model becomes
`ctx->sensors->temperature_sensor`. If the model declares no sensor components,
the struct is emitted with a `TODO` for you to fill in.

```c
struct SystemSensors {
  float temperature_sensor;  // driver: ds18b20
};

SystemSensors systemSensors = {};
```

The generator never reads hardware. Populating these fields in `loop()` is your
job.

### 3. SystemContext (runtime context)

```c
struct SystemContext {
  int currentState;                    // Current state index (compare with S_*)
  int previousState;                   // Previous state index (-1 before first transition)
  int32_t eventData;                   // Payload of the event being dispatched
  const SystemParameters* parameters;  // Read-only system parameters
  const SystemSensors* sensors;        // Current sensor readings
};

SystemContext systemContext;
```

---

## State IDs are `S_*` globals, not an enum

`currentState` and `previousState` hold **PulseHSM state indices**, which are
assigned at runtime by `addState()`. The generator stores each one in a global:

```c
int S_IDLE = -1;
int S_RUNNING = -1;
int S_HEATING = -1;
```

Compare against those globals, never against a hardcoded number:

```c
if (ctx->currentState == S_HEATING) { ... }
```

This follows PulseHSM's own rule — the return value of `addState()` must be
stored in a global, because handlers reference it long after `setup()` returns.
Nested states use the short name when it is unique across the model
(`S_HEATING`) and the full path when it is not (`S_RUNNING_HEATING`).

---

## How to Use SystemContext

### In a guard

```c
bool guard_temp_at_setpoint(const SystemContext* ctx) {
  float temp = ctx->sensors->temperature_sensor;
  float setpoint = ctx->parameters->setpoint;
  float hysteresis = ctx->parameters->hysteresis;

  return (temp >= setpoint - hysteresis) &&
         (temp <= setpoint + hysteresis);
}
```

A guard that returns `false` does **not** consume the event. The event keeps
bubbling, so an enclosing state still gets a chance to handle it.

### In an action

```c
void action_start_pump(SystemContext* ctx) {
  Serial.print("Setpoint: ");
  Serial.println(ctx->parameters->setpoint);

  Serial.print("Temperature: ");
  Serial.println(ctx->sensors->temperature_sensor);

  digitalWrite(PUMP_PIN, HIGH);
}
```

Actions run **before** the state changes, so `ctx->currentState` is still the
state being left.

### In `setup()`

The generator already points the context at the parameter and sensor structs.
Add your own hardware initialization:

```c
void setup() {
  // ... generated registration ...

  systemSensors.temperature_sensor = 0.0f;
}
```

### In `loop()`

```c
void loop() {
  // Read real sensor values
  systemSensors.temperature_sensor = readTemperatureSensor();

  // Raise events based on sensor state
  if (systemSensors.temperature_sensor >= systemParameters.setpoint) {
    fsm.sendEvent(EVENT_TEMP_REACHED);
  }

  fsm.update();
}
```

Never call `delay()` — it starves `fsm.update()`. Use `fsm.getStateElapsed()`
for timing instead.

---

## Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `currentState` | `int` | Current leaf state index (compare with `S_*`) |
| `previousState` | `int` | Previous state index (-1 before the first transition) |
| `eventData` | `int32_t` | Payload passed to `sendEvent()` (0 if unused) |
| `parameters` | `const SystemParameters*` | Read-only access to parameters |
| `sensors` | `const SystemSensors*` | Current sensor readings |

---

## Implementation Details

### Context population

The generator emits a `syncContext()` helper and calls it at the top of every
state's `onEvent` handler, so guards and actions always observe live machine
state:

```c
static void syncContext() {
  systemContext.currentState = fsm.getCurrentState();
  systemContext.previousState = fsm.getPreviousState();
  systemContext.eventData = fsm.getEventData();
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
}
```

`eventData` is read via `fsm.getEventData()`, which is only valid inside an
`onEvent` handler. If you need the payload later, copy it into your own global.

### Call sites

Guards and actions are called from the generated handler for the state that
owns the transition:

```c
bool onEvent_running_heating(uint8_t event) {
  syncContext();

  switch (event) {
    case EVENT_TEMP_REACHED:
      if (guard_running_heating_temp_reached(&systemContext)) {
        action_reduce_heat(&systemContext);
        fsm.transitionTo(S_MAINTAINING);
        return true;
      }
      break;
    default:
      break;
  }

  return false;  // not handled here - let it bubble
}
```

---

## Not Yet Implemented

`FUNCTION_CONTRACT.md` §2 shows two optional fields on the mutable action
context that the generator does **not** currently emit:

- `void (*sendEvent)(uint8_t event, int32_t data)` — actions can instead call
  `fsm.sendEvent(...)` directly, which is the same capability without the
  indirection.
- `void* userData` — use a module-level static for now.

Add them to the generated struct if you need the indirection for portability
across targets.

---

## Migration

The signature change is breaking. Old handwritten guards and actions must be
updated:

```c
// Before
bool guard_temp_ready() { }
void action_start_pump() { }

// After
bool guard_temp_ready(const SystemContext* ctx) { }
void action_start_pump(SystemContext* ctx) { }
```

Guard and action **names** are unchanged, and remain identical across targets,
so the bodies port over as-is.

---

## Checklist

- [ ] Accept `const SystemContext* ctx` in guards
- [ ] Accept `SystemContext* ctx` in actions
- [ ] Read sensor values via `ctx->sensors->*`
- [ ] Read parameters via `ctx->parameters->*`
- [ ] Compare state with the `S_*` globals, not literals
- [ ] Update `systemSensors` in `loop()`
- [ ] Don't modify `ctx->parameters` (const)
- [ ] Don't assign `ctx->currentState` (PulseHSM owns it)

---

## Related Documents

- **FUNCTION_CONTRACT.md** — Binding spec (guards/actions)
- **INTEGRATION.md** — How the generated code drives PulseHSM
- **ARCHITECTURE.md** — Overall design
- **QUICKSTART.md** — Getting started
