/**
 * Embeds deps/PulseHSM.{h,cpp} into web/pulsehsm-sources.ts.
 *
 * The editor is a static page with no server, so it cannot read repo files at
 * runtime. Generating a TypeScript module with the source embedded as strings
 * lets downloadProjectZip() bundle PulseHSM as a local library in the output
 * zip — no external lib_deps required.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { writeIfChanged, readText } from './write-if-changed.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const hSrc   = readText(path.join(repoRoot, 'deps/PulseHSM.h'));
const cppSrc = readText(path.join(repoRoot, 'deps/PulseHSM.cpp'));

function escape(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const output = `// Auto-generated from deps/PulseHSM.{h,cpp} — do not edit.
export const PULSEHSM_H: string = \`${escape(hSrc)}\`;
export const PULSEHSM_CPP: string = \`${escape(cppSrc)}\`;
`;

const outPath = path.join(repoRoot, 'web/pulsehsm-sources.ts');
const changed = writeIfChanged(outPath, output);
console.log(changed
  ? '✓ Generated web/pulsehsm-sources.ts'
  : '· web/pulsehsm-sources.ts already current');
