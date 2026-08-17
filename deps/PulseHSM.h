#ifndef PULSE_HSM_H
#define PULSE_HSM_H

// Platform abstraction — provide millis() from whatever timer the target has.
//
// Detection priority:
//   1. ARDUINO macro (set by -DARDUINO=version in the Arduino IDE build): use
//      the Arduino core's native millis().
//   2. esp_timer.h in the include path (ESP-IDF SDK present): provide a shim.
//   3. Arduino.h in the include path (host/test-harness environment with an
//      Arduino shim): include it and get millis() from there.
//   4. POSIX fallback for any other bare-C++ environment.
#ifdef ARDUINO
#  include <Arduino.h>
#elif defined(__has_include) && __has_include("esp_timer.h")
#  include "esp_timer.h"
static inline unsigned long millis() {
  return (unsigned long)(esp_timer_get_time() / 1000ULL);
}
#elif defined(__has_include) && __has_include(<Arduino.h>)
#  include <Arduino.h>
#else
#  include <time.h>
static inline unsigned long millis() {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (unsigned long)((unsigned long)ts.tv_sec * 1000UL +
                         (unsigned long)ts.tv_nsec / 1000000UL);
}
#endif

// Compile-time configuration.
//
// These sizes decide the layout of PulseHSM, so *every* translation unit has
// to agree on them. A #define in the .ino cannot do that: PulseHSM.cpp is
// compiled separately and would keep the defaults, producing two different
// classes with the same name. Put the values in PulseHSM_config.h beside this
// header instead - it is picked up here, so every TU sees the same sizes.
// PulseIR generates that file for you.
#if defined(__has_include)
#  if __has_include("PulseHSM_config.h")
#    include "PulseHSM_config.h"
#  endif
#endif

#ifndef PULSEHSM_MAX_STATES
#define PULSEHSM_MAX_STATES 8
#endif
#ifndef PULSEHSM_MAX_EVENTS
#define PULSEHSM_MAX_EVENTS 8
#endif
#ifndef PULSEHSM_MAX_DEPTH
#define PULSEHSM_MAX_DEPTH 4
#endif

class PulseHSM {
public:
    using Action = void (*)();
    using EventCb = bool (*)(uint8_t event);   // true = handled, false = bubble up

    PulseHSM();

    // Add a state – returns index, or -1 if table full
    int addState(const char* name,
                 Action update,
                 Action entry,
                 Action exit,
                 unsigned long timeoutMs,
                 int timeoutNext,
                 EventCb onEvent,
                 int parent = -1);

    // Start FSM (must be a leaf state)
    void begin(int startState);

    // Run scheduler – call in loop()
    void update();

    // Request a transition (deferred)
    void transitionTo(int newState);

    // Send an event (ISR-safe, ring buffer).
    // Optional int32 payload — read it inside an onEvent handler via getEventData().
    // sendEvent(EVT) still works (data defaults to 0) — fully backward compatible.
    void sendEvent(uint8_t event, int32_t data = 0);

    // Getters
    int getCurrentState() const;
    const char* getStateName(int idx) const;
    const char* getCurrentName() const;
    unsigned long getStateElapsed() const;
    bool isInHierarchy(int state) const;   // true if state is active ancestor

    // Context for the event currently being dispatched (valid inside onEvent handlers)
    int32_t getEventData() const;

    // Where we came from (valid in entry/exit/update of the new state)
    int getPreviousState() const;
    const char* getPreviousName() const;

private:
    struct State {
        const char* name;
        Action update;
        Action entry;
        Action exit;
        unsigned long timeoutMs;
        int timeoutNext;
        EventCb onEvent;
        int8_t parent;
    };
    State states[PULSEHSM_MAX_STATES];
    int stateCount;
    int currentState;
    int previousState;
    int pendingState;
    unsigned long entryTime;
    uint8_t evtQueue[PULSEHSM_MAX_EVENTS];
    int32_t evtData[PULSEHSM_MAX_EVENTS];   // parallel payload ring
    uint8_t evtHead;
    uint8_t evtCount;
    int32_t currentEventData;               // payload of event being dispatched
    bool inTransition;

    void _callEntryChain(int state, int stopAt = -1);
    void _callExitChain(int state, int stopAt = -1);
    void _dispatchEvent(uint8_t evt);
    void _runUpdates();
    void _executeTransition(int toState);
    int _findLCA(int a, int b) const;
};

#endif
