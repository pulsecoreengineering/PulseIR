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
 * Currently active passes (in order):
 *   1. Dead Code Elimination — removes unused components and parameters
 */

import type { PulseProject } from '../model/types.js';
import { eliminateDeadCode } from './dce.js';

export interface OptimizeResult {
  project: PulseProject;
  /** All warnings emitted across every pass, in order. */
  warnings: string[];
}

/**
 * Run all optimizer passes on the given project and return the optimized IR.
 *
 * @param project  The parsed IR from the frontend.
 * @param opts     Fine-grained pass toggles — all enabled by default.
 */
export function optimize(
  project: PulseProject,
  opts: { dce?: boolean } = {},
): OptimizeResult {
  const { dce = true } = opts;
  const warnings: string[] = [];

  let current = project;

  if (dce) {
    const result = eliminateDeadCode(current);
    current = result.project;
    warnings.push(...result.warnings);
  }

  return { project: current, warnings };
}
