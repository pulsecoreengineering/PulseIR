/**
 * PulseIR Middle-End Optimizer Pipeline
 *
 * Sits between the frontend parser and the backend codegen:
 *
 *   [YAML] → Parser → [PulseProject IR] → Optimizer → [PulseProject IR] → Codegen → [C++]
 *
 * Each pass is a pure function (PulseProject → PulseProject) that never mutates
 * its input. Passes are chained in order; warnings from every pass accumulate.
 *
 * Pass order:
 *   1. Dead Code Elimination — removes unused components, parameters, and events
 *   2. Task Merging          — fuses same-interval tasks into one timer loop
 *
 * DCE runs first so task merging never has to reason about actions that
 * reference already-eliminated symbols.
 */

import type { PulseProject } from '../model/types.js';
import { eliminateDeadCode } from './dce.js';
import { mergeTasks } from './merge-tasks.js';

export interface OptimizeResult {
  project: PulseProject;
  /** All warnings emitted across every pass, in order. */
  warnings: string[];
}

export interface OptimizeOptions {
  /** Dead Code Elimination: remove unused components, parameters, and events. Default: true. */
  dce?: boolean;
  /** Task Merging: fuse tasks that share the same interval into one timer loop. Default: true. */
  mergeTasks?: boolean;
}

/**
 * Run all optimizer passes on the given project and return the optimized IR.
 *
 * @param project  The parsed IR from the frontend.
 * @param opts     Fine-grained pass toggles — all enabled by default.
 */
export function optimize(
  project: PulseProject,
  opts: OptimizeOptions = {},
): OptimizeResult {
  const { dce = true, mergeTasks: doMergeTasks = true } = opts;
  const warnings: string[] = [];

  let current = project;

  if (dce) {
    const result = eliminateDeadCode(current);
    current = result.project;
    warnings.push(...result.warnings);
  }

  if (doMergeTasks) {
    const result = mergeTasks(current);
    current = result.project;
    warnings.push(...result.warnings);
  }

  return { project: current, warnings };
}
