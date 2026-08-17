// Auto-generated from deps/PulseHSM.{h,cpp} — do not edit.
export const PULSEHSM_H: string = `#ifndef PULSE_HSM_H
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
`;
export const PULSEHSM_CPP: string = `#include "PulseHSM.h"
#include <string.h>

PulseHSM::PulseHSM() {
    memset(states, 0, sizeof(states));
    stateCount = 0;
    currentState = 0;
    previousState = -1;
    pendingState = -1;
    entryTime = 0;
    evtHead = 0;
    evtCount = 0;
    currentEventData = 0;
    inTransition = false;
}

int PulseHSM::addState(const char* name, Action update, Action entry, Action exit,
                       unsigned long timeoutMs, int timeoutNext, EventCb onEvent, int parent) {
    if (stateCount >= PULSEHSM_MAX_STATES) return -1;
    State& s = states[stateCount];
    s.name = name;
    s.update = update;
    s.entry = entry;
    s.exit = exit;
    s.timeoutMs = timeoutMs;
    s.timeoutNext = timeoutNext;
    s.onEvent = onEvent;
    s.parent = (int8_t)parent;
    return stateCount++;
}

void PulseHSM::begin(int startState) {
    if (startState < 0 || startState >= stateCount) return;
    pendingState = -1;
    previousState = -1;
    currentState = startState;
    entryTime = millis();
    evtHead = 0;
    evtCount = 0;
    inTransition = false;
    _callEntryChain(startState);
}

void PulseHSM::update() {
    // dispatch events
    while (evtCount > 0) {
        uint8_t evt = evtQueue[evtHead];
        currentEventData = evtData[evtHead];        // expose payload to handlers
        evtHead = (evtHead + 1) & (PULSEHSM_MAX_EVENTS - 1);
        evtCount--;
        _dispatchEvent(evt);
    }
    // auto timeout
    if (pendingState == -1 && states[currentState].timeoutMs > 0 &&
        (millis() - entryTime) >= states[currentState].timeoutMs &&
        states[currentState].timeoutNext != -1) {
        pendingState = states[currentState].timeoutNext;
    }
    _runUpdates();
    if (pendingState != -1) _executeTransition(pendingState);
}

void PulseHSM::transitionTo(int newState) {
    if (newState >= 0 && newState < stateCount) pendingState = newState;
}

void PulseHSM::sendEvent(uint8_t event, int32_t data) {
    if (evtCount < PULSEHSM_MAX_EVENTS) {
        uint8_t slot = (evtHead + evtCount) & (PULSEHSM_MAX_EVENTS - 1);
        evtQueue[slot] = event;
        evtData[slot] = data;
        evtCount++;
    }
}

int PulseHSM::getCurrentState() const { return currentState; }
const char* PulseHSM::getStateName(int idx) const {
    if (idx < 0 || idx >= stateCount) return "";
    return states[idx].name ? states[idx].name : "";
}
const char* PulseHSM::getCurrentName() const { return getStateName(currentState); }
unsigned long PulseHSM::getStateElapsed() const { return millis() - entryTime; }
int32_t PulseHSM::getEventData() const { return currentEventData; }
int PulseHSM::getPreviousState() const { return previousState; }
const char* PulseHSM::getPreviousName() const { return getStateName(previousState); }

bool PulseHSM::isInHierarchy(int s) const {
    int cur = currentState;
    while (cur != -1) {
        if (cur == s) return true;
        cur = states[cur].parent;
    }
    return false;
}

// Private methods ------------------------------------------------------------
void PulseHSM::_callEntryChain(int state, int stopAt) {
    int8_t path[PULSEHSM_MAX_DEPTH+1];
    int depth = 0;
    int s = state;
    while (s != -1 && s != stopAt && depth <= PULSEHSM_MAX_DEPTH) {
        path[depth++] = (int8_t)s;
        s = states[s].parent;
    }
    for (int i = depth-1; i >= 0; i--)
        if (states[path[i]].entry) states[path[i]].entry();
}

void PulseHSM::_callExitChain(int state, int stopAt) {
    int s = state;
    while (s != -1 && s != stopAt) {
        if (states[s].exit) states[s].exit();
        s = states[s].parent;
    }
}

void PulseHSM::_dispatchEvent(uint8_t evt) {
    int s = currentState;
    while (s != -1) {
        if (states[s].onEvent && states[s].onEvent(evt)) return;
        s = states[s].parent;
    }
    // unhandled (optional debug)
}

void PulseHSM::_runUpdates() {
    int8_t ancestors[PULSEHSM_MAX_DEPTH];
    int depth = 0;
    int s = states[currentState].parent;
    while (s != -1 && depth < PULSEHSM_MAX_DEPTH) {
        ancestors[depth++] = (int8_t)s;
        s = states[s].parent;
    }
    for (int i = depth-1; i >= 0; i--)
        if (states[ancestors[i]].update) states[ancestors[i]].update();
    if (states[currentState].update) states[currentState].update();
}

void PulseHSM::_executeTransition(int toState) {
    if (inTransition) return;
    inTransition = true;
    int from = currentState;
    int lca = _findLCA(from, toState);
    _callExitChain(from, lca);
    previousState = currentState;
    currentState = toState;
    pendingState = -1;
    entryTime = millis();
    inTransition = false;
    _callEntryChain(toState, lca);
}

int PulseHSM::_findLCA(int a, int b) const {
    int8_t ancestorsA[PULSEHSM_MAX_DEPTH+1];
    int depthA = 0;
    int s = a;
    while (s != -1 && depthA <= PULSEHSM_MAX_DEPTH) {
        ancestorsA[depthA++] = (int8_t)s;
        s = states[s].parent;
    }
    s = b;
    while (s != -1) {
        for (int i = 0; i < depthA; i++)
            if (ancestorsA[i] == s) return s;
        s = states[s].parent;
    }
    return -1;
}
`;
