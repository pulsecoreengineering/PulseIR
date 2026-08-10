/**
 * PulseHSM IR Code Generator
 * 
 * Converts PulseModel → C++ code using PulseHSM library
 */

import type {
  PulseProject,
  State,
  Transition,
  Guard,
  Action,
  ComponentClass,
} from '../model/index.js';

export class Codegen {
  private project!: PulseProject;
  private stateList: State[] = [];
  private actionSet: Set<string> = new Set();

  /**
   * Generate C++ code from a validated PulseModel
   */
  generate(project: PulseProject): string {
    this.project = project;
    this.indexStates();
    this.indexActions();

    return [
      this.generateHeader(),
      this.generateStateEnum(),
      this.generateEventEnum(),
      this.generateActionDeclarations(),
      this.generateGuardDeclarations(),
      this.generateHSMConfiguration(),
      this.generateSetupFunction(),
      this.generateLoopFunction(),
      this.generateActionImplementations(),
    ].join('\n\n');
  }

  // =========================================================================
  // HEADER
  // =========================================================================

  private generateHeader(): string {
    const { name, version } = this.project;
    const date = new Date().toISOString().split('T')[0];

    return `/**
 * PulseHSM Generated Code
 * 
 * Project: ${name}
 * Version: ${version}
 * Generated: ${date}
 * 
 * This file was auto-generated from a PulseHSM model.
 * DO NOT EDIT MANUALLY - regenerate from source instead.
 */

#include <Arduino.h>
#include "PulseHSM.h"

// Forward declarations
void onEnterStateHandlers();
void onExitStateHandlers();
void handleActions();
void checkGuards();`;
  }

  // =========================================================================
  // STATE ENUM
  // =========================================================================

  private generateStateEnum(): string {
    const stateNames = this.stateList.map(s => s.name.toUpperCase());
    const enumValues = stateNames.map((name, idx) => `  STATE_${name} = ${idx}`).join(',\n');

    return `// ============================================================================
// STATE DEFINITIONS
// ============================================================================

enum SystemState {
${enumValues}
};

const char* stateNames[] = {
${stateNames.map(name => `  "${name}"`).join(',\n')}
};`;
  }

  // =========================================================================
  // EVENT ENUM
  // =========================================================================

  private generateEventEnum(): string {
    const events = this.project.system.events;
    const eventNames = events.map(e => e.name.toUpperCase());
    const enumValues = eventNames.map((name, idx) => `  EVENT_${name} = ${idx}`).join(',\n');

    return `// ============================================================================
// EVENT DEFINITIONS
// ============================================================================

enum SystemEvent {
${enumValues}
};

const char* eventNames[] = {
${eventNames.map(name => `  "${name}"`).join(',\n')}
};`;
  }

  // =========================================================================
  // ACTION DECLARATIONS
  // =========================================================================

  private generateActionDeclarations(): string {
    const actions = Array.from(this.actionSet);
    const declarations = actions
      .map(name => `void action_${this.sanitize(name)}();`)
      .join('\n');

    return `// ============================================================================
// ACTION DECLARATIONS
// ============================================================================

${declarations}`;
  }

  // =========================================================================
  // GUARD DECLARATIONS
  // =========================================================================

  private generateGuardDeclarations(): string {
    const guards = this.project.system.transitions
      .filter(t => t.guard)
      .map((t, idx) => `bool guard_${t.source}_${t.event}_${idx}();`);

    if (guards.length === 0) return '// No guards defined';

    return `// ============================================================================
// GUARD DECLARATIONS
// ============================================================================

${guards.join('\n')}`;
  }

  // =========================================================================
  // HSM CONFIGURATION
  // =========================================================================

  private generateHSMConfiguration(): string {
    const transitions = this.generateTransitionTable();
    const component = this.generateComponentDefinitions();

    return `// ============================================================================
// HSM CONFIGURATION & STATE VARIABLES
// ============================================================================

// Current system state
SystemState currentState = STATE_${this.project.system.states[0]?.name.toUpperCase()};

// Event queue
SystemEvent pendingEvent = (SystemEvent)-1;

${component}

// Transition table
// Note: source uses int instead of SystemState to support wildcard (-1)
struct Transition {
  int source;           // SystemState or -1 for wildcard
  SystemEvent event;
  SystemState target;
  bool (*guard)();
  void (*actions)();
};

Transition transitionTable[] = {
${transitions}
};
const int transitionCount = sizeof(transitionTable) / sizeof(Transition);`;
  }

  private generateTransitionTable(): string {
    const transitions = this.project.system.transitions;

    return transitions
      .map((t, idx) => {
        // Handle wildcard source state
        const sourceState = t.source === '*' 
          ? '(SystemState)-1'
          : `STATE_${t.source.split('/')[0].toUpperCase()}`;
        
        const eventName = `EVENT_${t.event.toUpperCase()}`;
        const targetState = `STATE_${t.target.split('/')[0].toUpperCase()}`;
        const guard = t.guard ? `guard_${t.source}_${t.event}_${idx}` : 'NULL';
        const actions = t.actions && t.actions.length > 0 
          ? `action_${this.sanitize(t.actions[0].driver)}`
          : 'NULL';

        return `  { ${sourceState}, ${eventName}, ${targetState}, ${guard}, ${actions} }`;
      })
      .join(',\n');
  }

  private generateComponentDefinitions(): string {
    const components = this.project.system.components;
    if (!components || components.length === 0) return '// No components defined';

    const defs = components
      .map(c => {
        const pinComment = c.config?.pin ? ` // pin ${c.config.pin}` : '';
        return `// Component: ${c.name} (${c.class})${pinComment}`;
      })
      .join('\n');

    return defs;
  }

  // =========================================================================
  // SETUP FUNCTION
  // =========================================================================

  private generateSetupFunction(): string {
    const components = this.project.system.components || [];
    const gpioComponents = components.filter(c => c.driver.includes('gpio'));

    const initCode = gpioComponents
      .map(c => {
        const pin = c.config?.pin || 'GPIO_PIN';
        return `  // ${c.name}: ${c.class}
  // pinMode(${pin}, OUTPUT);`;
      })
      .join('\n');

    return `// ============================================================================
// SETUP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\\n\\n=== ${this.project.name} v${this.project.version} ===");
  Serial.println("HSM Started");

  // Initialize components
${initCode || '  // Initialize pins and peripherals here'}

  // Set initial state
  currentState = STATE_${this.project.system.states[0]?.name.toUpperCase()};
  Serial.print("Initial state: ");
  Serial.println(stateNames[currentState]);
}`;
  }

  // =========================================================================
  // LOOP FUNCTION
  // =========================================================================

  private generateLoopFunction(): string {
    return `// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  // TODO: Generate events based on sensor inputs, timers, etc.
  // Example:
  // if (sensorTriggered()) {
  //   pendingEvent = EVENT_TEMP_REACHED;
  // }

  // Process pending event
  if (pendingEvent != (SystemEvent)-1) {
    processEvent(pendingEvent);
    pendingEvent = (SystemEvent)-1;
  }

  delay(10);  // Main loop delay
}

// ============================================================================
// EVENT PROCESSING
// ============================================================================

void processEvent(SystemEvent event) {
  Serial.print("Event: ");
  Serial.print(eventNames[event]);
  Serial.print(" in state: ");
  Serial.println(stateNames[currentState]);

  // Find matching transition
  for (int i = 0; i < transitionCount; i++) {
    const Transition& trans = transitionTable[i];
    
    // Check if transition matches current state and event
    // (wildcard source state is represented as -1)
    bool stateMatches = (trans.source == (int)currentState) || (trans.source == -1);
    if (stateMatches && trans.event == event) {
      // Evaluate guard if present
      if (trans.guard != NULL && !trans.guard()) {
        Serial.println("  -> Guard failed, transition blocked");
        return;
      }

      // Execute actions
      if (trans.actions != NULL) {
        trans.actions();
      }

      // Transition to new state
      currentState = trans.target;
      Serial.print("  -> Transitioned to: ");
      Serial.println(stateNames[currentState]);
      return;
    }
  }

  Serial.println("  -> No matching transition");
}`;
  }

  // =========================================================================
  // ACTION IMPLEMENTATIONS
  // =========================================================================

  private generateActionImplementations(): string {
    const actions = Array.from(this.actionSet);

    const implementations = actions
      .map(name => {
        const action = this.project.system.transitions
          .flatMap(t => t.actions || [])
          .find(a => a.driver === name);

        if (!action) return '';

        const params = action.params ? JSON.stringify(action.params, null, 2) : '{}';
        const paramComment = action.params 
          ? `// ${JSON.stringify(action.params).substring(0, 40)}...`
          : '';

        return `void action_${this.sanitize(name)}() {
  ${paramComment}
  Serial.print("  -> Action: ${name}");
  
  // TODO: Implement action logic
  // ${action.params ? `Parameters: ${JSON.stringify(action.params)}` : 'No parameters'}
}`;
      })
      .filter(impl => impl.length > 0);

    return `// ============================================================================
// ACTION IMPLEMENTATIONS
// ============================================================================

${implementations.join('\n\n') || '// No actions defined'}`;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private indexStates(): void {
    this.stateList = this.flattenStates(this.project.system.states);
  }

  private flattenStates(states: State[]): State[] {
    const result: State[] = [];
    for (const state of states) {
      result.push(state);
      if (state.regions) {
        for (const region of state.regions) {
          result.push(...this.flattenStates(region.states));
        }
      }
    }
    return result;
  }

  private indexActions(): void {
    this.project.system.transitions.forEach(t => {
      if (t.actions) {
        t.actions.forEach(a => {
          this.actionSet.add(a.driver);
        });
      }
    });
  }

  private sanitize(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}

export { Codegen as default };
