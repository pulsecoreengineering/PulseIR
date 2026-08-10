/**
 * Source resolution for multi-file models.
 *
 * The parser must stay free of Node imports so the web editor can run it in a
 * browser, so it never touches a filesystem itself - it asks a resolver. The
 * CLI supplies a filesystem-backed one; the editor can supply a map of open
 * buffers, or none at all, in which case `include` is rejected with a clear
 * message instead of silently doing nothing.
 */

export interface SourceResolver {
  /**
   * Turn a reference into a stable id, relative to the file that mentioned it.
   * `from` is null for the entry document.
   */
  resolve(ref: string, from: string | null): string;

  /** Read a previously resolved id. Throws if it cannot be read. */
  read(id: string): string;
}

/**
 * Resolver over an in-memory map, keyed by path. Used by the tests and
 * available to any host that already has the files in hand.
 */
export class MemoryResolver implements SourceResolver {
  constructor(private files: Record<string, string>) {}

  resolve(ref: string, from: string | null): string {
    // Interpret a relative ref against the directory of the referring file, so
    // a map keyed by realistic paths behaves like a filesystem.
    if (ref.startsWith('/') || !from) return normalize(ref);

    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    return normalize(dir ? `${dir}/${ref}` : ref);
  }

  read(id: string): string {
    const content = this.files[id];
    if (content === undefined) {
      throw new Error(`no such file "${id}"`);
    }
    return content;
  }
}

/** Collapse "." and ".." without needing path from Node. */
export function normalize(input: string): string {
  const absolute = input.startsWith('/');
  const parts: string[] = [];

  for (const segment of input.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
      continue;
    }
    parts.push(segment);
  }

  return (absolute ? '/' : '') + parts.join('/');
}
