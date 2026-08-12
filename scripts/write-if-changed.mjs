/**
 * Write a file only when its contents would actually change, always with LF.
 *
 * web/app.js and web/examples.ts are generated but committed, so that the
 * editor opens from a clone with no install. The cost of that is real: if an
 * ordinary `npm run web` rewrites them, git sees local modifications and the
 * next `git pull` refuses to run even though nothing meaningful changed.
 *
 * Two things are needed to keep a rebuild a genuine no-op:
 *
 *  1. Only write on a real change - the obvious half.
 *  2. Write LF regardless of the platform. On a Windows checkout the sources
 *     arrive as CRLF, esbuild carries that into the bundle, and the output then
 *     really *is* different from the committed file. Write-if-changed does the
 *     right thing and rewrites it, and the pull is blocked anyway. Normalising
 *     here makes the artefacts identical on every platform.
 *
 * `.gitattributes` pins the working tree to LF too, which stops the problem at
 * source; this is the belt to that pair of braces, and covers a tree that was
 * already checked out with CRLF before those attributes existed.
 */

import * as fs from 'fs';
import * as path from 'path';

/** CRLF (and lone CR) to LF, so generated text is byte-identical everywhere. */
export function toLf(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Read a text file with line endings normalised.
 *
 * Use this whenever the *contents* are embedded in generated output. Escaping
 * happens after this point - `JSON.stringify` turns a stray CRLF into a literal
 * `\r\n` inside the string, which no amount of normalising the finished file
 * would undo.
 */
export function readText(source) {
  return toLf(fs.readFileSync(source, 'utf8'));
}

/** Returns true if the file was written. */
export function writeIfChanged(target, contents) {
  const normalised = toLf(contents);

  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === normalised) {
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, normalised);
  return true;
}
