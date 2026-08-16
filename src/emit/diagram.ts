/**
 * Mermaid stateDiagram-v2 emitter.
 *
 * Turns the state machine in a PulseProject into a Mermaid diagram that can
 * be pasted into GitHub Markdown, Notion, or any Mermaid renderer. The output
 * is the raw diagram body (starting with "stateDiagram-v2"); the CLI wraps it
 * in a fenced code block for Markdown files.
 *
 * Wildcard transitions ("*" source) cannot be drawn as fan-out arrows without
 * cluttering the diagram, so they are emitted as comments at the bottom.
 */

import type { PulseProject, State } from '../model/index.js';
import type { Transition } from '../model/types.js';

export class DiagramEmitter {
  /**
   * Emit a Mermaid stateDiagram-v2 string from the project's state machine.
   * Returns a short comment when the project has no machine.
   */
  emit(project: PulseProject): string {
    const { states, transitions } = project.system;

    if (states.length === 0) {
      return '%% No state machine declared in this model\n';
    }

    const lines: string[] = ['stateDiagram-v2'];
    const indent = '    ';

    // Initial pseudo-transition to the first top-level state.
    lines.push(`${indent}[*] --> ${mid(states[0].name)}`);

    // Composite states need a block declaration; leaf states appear implicitly.
    for (const state of states) {
      this.emitState(state, lines, indent);
    }

    lines.push('');

    // Normal transitions (non-wildcard, non-periodic).
    const normals   = transitions.filter(t => t.source !== '*' && t.every === undefined);
    const wilds     = transitions.filter(t => t.source === '*');
    const periodics = transitions.filter(t => t.every !== undefined);

    for (const t of normals) {
      const src   = mid(leafOf(t.source));
      const tgt   = mid(leafOf(t.target!));
      const label = transitionLabel(t);
      lines.push(`${indent}${src} --> ${tgt}${label ? ` : ${label}` : ''}`);
    }

    // Wildcard transitions — can't fan out cleanly, so emit as comments.
    if (wilds.length > 0) {
      lines.push('');
      lines.push(`${indent}%% Wildcard transitions (triggered from any active state):`);
      for (const t of wilds) {
        const tgt   = mid(leafOf(t.target!));
        const label = transitionLabel(t);
        lines.push(`${indent}%% any --> ${tgt}${label ? ` : ${label}` : ''}`);
      }
    }

    // Periodic transitions — no arrow since they stay in the same state.
    if (periodics.length > 0) {
      lines.push('');
      lines.push(`${indent}%% Periodic transitions (every N ms, no state change):`);
      for (const t of periodics) {
        const src   = mid(leafOf(t.source));
        const dur   = typeof t.every === 'string' ? `{${t.every}}` : `${t.every}ms`;
        const guard = t.guard ? ` [${t.guard.name}]` : '';
        lines.push(`${indent}%% ${src} every ${dur}${guard}: ${(t.actions || []).map(a => a.name).join(', ')}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Emit the diagram wrapped in a fenced Markdown code block.
   * Suitable for writing to a .md file.
   */
  toMarkdown(project: PulseProject): string {
    return '```mermaid\n' + this.emit(project) + '```\n';
  }

  private emitState(state: State, lines: string[], indent: string): void {
    if (!state.regions || state.regions.length === 0) return;

    // Composite state: declare a named block with its initial child.
    const id  = mid(state.name);
    const sub = `${indent}    `;
    lines.push(`${indent}state ${id} {`);
    for (const region of state.regions) {
      lines.push(`${sub}[*] --> ${mid(leafOf(region.initial))}`);
      for (const child of region.states) {
        this.emitState(child, lines, sub);
      }
    }
    lines.push(`${indent}}`);
  }
}

/** Last segment of a hierarchical path: "running/heating" → "heating". */
function leafOf(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Sanitize a name to a valid Mermaid node identifier. */
function mid(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '_');
}

/** Build a label string from a transition's event/after/guard. */
function transitionLabel(t: Transition): string {
  let label = '';

  if (t.event) {
    label = t.event;
  } else if (t.after !== undefined) {
    const dur = typeof t.after === 'string' ? `{${t.after}}` : `${t.after}ms`;
    label = `after ${dur}`;
  }

  if (t.guard) {
    label = label ? `${label} [${t.guard.name}]` : `[${t.guard.name}]`;
  }

  return label;
}

export default DiagramEmitter;
