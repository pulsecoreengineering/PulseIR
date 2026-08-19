/**
 * Task Merging optimizer pass.
 *
 * If two or more tasks share the same `every:` interval, they each generate a
 * separate millis()-based timer loop in the output. That means N independent
 * dueAt_ variables and N runTask_*() checks per loop() pass for work that
 * could share one clock.
 *
 * This pass groups tasks by interval and fuses each group into a single merged
 * task. The merged task runs every action from every member task in declaration
 * order, then emits every log line from the merged tasks in the same order.
 *
 * Merging is skipped for a group that contains only one task — no change is
 * made and no warning is emitted.
 *
 * Never mutates the input — always returns a fresh object.
 */

import type { PulseProject, PulseSystem, Task } from '../model/types.js';

export interface MergeTasksResult {
  project: PulseProject;
  warnings: string[];
}

export function mergeTasks(project: PulseProject): MergeTasksResult {
  const sys = project.system;
  const tasks = sys.tasks ?? [];

  if (tasks.length < 2) return { project, warnings: [] };

  // Group tasks by interval.  Map preserves insertion order so merged actions
  // always appear in the order the user declared the tasks.
  const groups = new Map<number | string, Task[]>();
  for (const task of tasks) {
    const key = task.every;
    const slot = groups.get(key);
    if (slot) slot.push(task);
    else groups.set(key, [task]);
  }

  const warnings: string[] = [];
  const mergedTasks: Task[] = [];

  for (const [interval, group] of groups) {
    if (group.length === 1) {
      // Nothing to merge; keep the original.
      mergedTasks.push(group[0]);
      continue;
    }

    // Collect all actions and all log strings from the group.
    const allActions = group.flatMap(t => t.actions);
    const logs = group.map(t => t.log).filter((l): l is string => l !== undefined);
    const mergedLog = logs.length > 0 ? logs.join(' | ') : undefined;

    // Give the merged task a stable, recognisable name.
    const intervalLabel = typeof interval === 'number' ? `${interval}ms` : String(interval);
    const mergedName    = `_merged_${intervalLabel}`;

    mergedTasks.push({
      name:    mergedName,
      every:   interval,
      actions: allActions,
      log:     mergedLog,
    });

    const names = group.map(t => `"${t.name}"`).join(', ');
    warnings.push(
      `[Optimizer] Tasks ${names} all fire every ${intervalLabel} — ` +
      `merged into one timer loop "${mergedName}" (${allActions.length} action(s)).`,
    );
  }

  // If the set of tasks didn't change in size, nothing was actually merged.
  if (mergedTasks.length === tasks.length) return { project, warnings };

  const mergedSystem: PulseSystem = { ...sys, tasks: mergedTasks };
  return {
    project:  { ...project, system: mergedSystem },
    warnings,
  };
}
