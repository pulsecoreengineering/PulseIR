/**
 * State-hierarchy analysis shared by IR consumers.
 *
 * Anything that needs to know the shape of the state tree - which states are
 * leaves, what a composite state descends into - can use this instead of
 * re-walking `regions` itself. Codegen keeps its own richer walk because it
 * also assigns C symbols and runtime indices.
 */

import type { State, StateRef } from '../model/index.js';

export interface FlatStateInfo {
  state: State;
  /** Full path, e.g. "running/heating". */
  path: string;
  /** Enclosing state's path, or null at the top level. */
  parentPath: string | null;
  /** 0 for top-level states. */
  depth: number;
  /** True when the state has no children. */
  isLeaf: boolean;
  /** Path of the initial child, or null for leaves. */
  initialChildPath: string | null;
}

/** The direct children of a state, across all its regions. */
export function childrenOf(state: State): State[] {
  return (state.regions || []).flatMap(region => region.states);
}

/**
 * Walk the tree in pre-order, so a parent always precedes its children -
 * the order PulseHSM requires for registration.
 */
export function flattenStates(states: State[]): FlatStateInfo[] {
  const out: FlatStateInfo[] = [];

  const walk = (nodes: State[], parentPath: string | null, depth: number): void => {
    for (const state of nodes) {
      const path = parentPath ? `${parentPath}/${state.name}` : state.name;
      const children = childrenOf(state);

      out.push({
        state,
        path,
        parentPath,
        depth,
        isLeaf: children.length === 0,
        initialChildPath: initialChildPathOf(state, path),
      });

      walk(children, path, depth + 1);
    }
  };

  walk(states, null, 0);
  return out;
}

/** Paths of every leaf - the only states a machine actually rests in. */
export function leafPaths(states: State[]): string[] {
  return flattenStates(states).filter(s => s.isLeaf).map(s => s.path);
}

/**
 * Follow a composite state's initial children down to the leaf that becomes
 * active when it is entered. Returns the input path unchanged for a leaf, and
 * null if the chain is broken or cyclic.
 */
export function resolveEntryLeaf(states: State[], path: StateRef): string | null {
  const byPath = new Map(flattenStates(states).map(s => [s.path, s]));

  let current = byPath.get(path);
  if (!current) return null;

  const seen = new Set<string>();
  while (!current.isLeaf) {
    if (seen.has(current.path) || !current.initialChildPath) return null;
    seen.add(current.path);

    const next = byPath.get(current.initialChildPath);
    if (!next) return null;
    current = next;
  }

  return current.path;
}

/**
 * Resolve a reference that may be a full path or a bare leaf name. Returns
 * null when the name is unknown or matches more than one state.
 */
export function resolvePath(states: State[], ref: StateRef): string | null {
  const flat = flattenStates(states);

  if (flat.some(s => s.path === ref)) return ref;

  const matches = flat.filter(s => s.state.name === ref);
  return matches.length === 1 ? matches[0].path : null;
}

/**
 * A composite state's initial child, taken from the state or its first region.
 * The reference is relative to the parent, so it is qualified here.
 */
function initialChildPathOf(state: State, path: string): string | null {
  const children = childrenOf(state);
  if (children.length === 0) return null;

  const ref = state.initial
    ?? (state.regions?.[0]?.initial !== 'INVALID' ? state.regions?.[0]?.initial : undefined);
  if (!ref) return null;

  // "initial: heating" names a child, but a full path is accepted too.
  const qualified = `${path}/${ref}`;
  if (children.some(c => `${path}/${c.name}` === qualified)) return qualified;
  if (children.some(c => `${path}/${c.name}` === ref)) return ref;

  return null;
}
