/**
 * Write a file only when its contents would actually change.
 *
 * web/app.js and web/examples.ts are generated but committed, so that the
 * editor opens from a clone with no install. The cost of that is real: an
 * ordinary `npm run web` rewrites them, git sees local modifications, and the
 * next `git pull` refuses to run even though nothing meaningful changed.
 *
 * Writing only on a real change keeps a rebuild a no-op when the output already
 * matches, so a clean checkout stays clean.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Returns true if the file was written. */
export function writeIfChanged(target, contents) {
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === contents) {
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return true;
}
