/**
 * Filesystem-backed source resolution.
 *
 * Kept out of the parser itself so that importing the parser never pulls Node
 * built-ins into a browser bundle. Only the CLI and tests import this.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SourceResolver } from './resolver.js';

export class FileResolver implements SourceResolver {
  constructor(private baseDir: string = process.cwd()) {}

  resolve(ref: string, from: string | null): string {
    const base = from ? path.dirname(from) : this.baseDir;
    return path.resolve(base, ref);
  }

  read(id: string): string {
    return fs.readFileSync(id, 'utf8');
  }
}
