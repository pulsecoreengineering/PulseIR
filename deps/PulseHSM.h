#ifndef PULSE_HSM_H
#define PULSE_HSM_H

#include <Arduino.h>

// Compile-time configuration
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
