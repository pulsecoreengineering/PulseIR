/**
 * Stub navigation: CodeLens and go-to-definition for generated action/guard
 * functions.
 *
 * Generated layout (relative to the model file's directory):
 *   src/actions.cpp  — void action_<name>(SystemContext* ctx) { ... }
 *   src/guards.cpp   — bool guard_<name>(const SystemContext* ctx) { ... }
 */

import * as fs   from 'fs';
import * as path from 'path';
import { CodeLens, Location, Range, Position } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ModelNames } from './providers.js';

// ---------------------------------------------------------------------------
// Naming helpers (must match codegen/index.ts sanitize())
// ---------------------------------------------------------------------------

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

export function actionFn(name: string): string {
  return `action_${sanitize(name)}`;
}

export function guardFn(name: string): string {
  return `guard_${sanitize(name)}`;
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

export function stubFilePath(modelFsPath: string, kind: 'action' | 'guard'): string {
  const dir   = path.dirname(modelFsPath);
  const file  = kind === 'action' ? 'actions.cpp' : 'guards.cpp';
  return path.join(dir, 'src', file);
}

/**
 * Scan a C++ file for a function definition line.
 * Returns a 0-based line index, or -1 if not found.
 */
export function findFunctionLine(filePath: string, fnName: string): number {
  let src: string;
  try {
    src = fs.readFileSync(filePath, 'utf8');
  } catch {
    return -1;
  }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Match the function definition — avoids matching declarations in a header.
    // Patterns:  `void action_foo(SystemContext* ctx) {`
    //            `bool guard_foo(const SystemContext* ctx) {`
    if (new RegExp(`\\b${escRe(fnName)}\\s*\\(`).test(lines[i])) {
      return i;
    }
  }
  return -1;
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Scanning the YAML text for positions of action / guard references
// ---------------------------------------------------------------------------

interface NameRef {
  name:    string;
  fnName:  string;
  kind:    'action' | 'guard';
  line:    number;   // 0-based
  col:     number;   // 0-based, start of the name
}

/**
 * Walk the YAML text line-by-line and return every position where an action
 * or guard name appears as a value (not as a YAML key).
 *
 * We track two contexts:
 *  - After a `guard:` key → next bare word is a guard name
 *  - Under the `actions:` section at depth 1 → bare key names are actions
 *  - `do:`, `entry:`, `exit:`, `response:` values → action names
 */
export function findNameRefs(text: string, model: ModelNames): NameRef[] {
  const lines  = text.split('\n');
  const refs: NameRef[] = [];

  const actionSet = new Set(model.actionNames);
  const guardSet  = new Set(model.guardNames ?? []);

  // Track indentation depth to detect the `actions:` block.
  let inActionsBlock = false;
  let actionsIndent  = -1;

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = (line.match(/^(\s*)/) ?? ['', ''])[1].length;

    // ── Detect entry into / exit from the `actions:` map ──
    if (/^(\s*)actions\s*:/.test(line)) {
      inActionsBlock = true;
      actionsIndent  = indent;
      continue;
    }
    if (inActionsBlock && indent <= actionsIndent && /^\S/.test(line[actionsIndent] ?? '')) {
      inActionsBlock = false;
    }

    // ── Keys directly under `actions:` are action definitions ──
    if (inActionsBlock && indent === actionsIndent + 2) {
      const keyMatch = trimmed.match(/^([\w][\w_-]*):/);
      if (keyMatch) {
        const name = keyMatch[1];
        const col  = line.indexOf(name);
        refs.push({ name, fnName: actionFn(name), kind: 'action', line: i, col });
        continue;
      }
    }

    // ── `guard:` values ──
    const guardVal = trimmed.match(/^-?\s*guard\s*:\s*(\w[\w_-]*)$/);
    if (guardVal) {
      const name = guardVal[1];
      const col  = line.lastIndexOf(name);
      refs.push({ name, fnName: guardFn(name), kind: 'guard', line: i, col });
      continue;
    }
    // Long guard form:  `guard:\n  name: my_guard`
    const guardLong = trimmed.match(/^name\s*:\s*(\w[\w_-]*)$/) ;
    // (only when previous meaningful line was `guard:`)
    if (guardLong && i > 0) {
      const prev = getPrevMeaningfulLine(lines, i);
      if (prev && prev.trim().match(/^-?\s*guard\s*:/)) {
        const name = guardLong[1];
        const col  = line.lastIndexOf(name);
        refs.push({ name, fnName: guardFn(name), kind: 'guard', line: i, col });
        continue;
      }
    }

    // ── `do:`, `entry:`, `exit:`, `response:` values (inline or list) ──
    const actionKey = trimmed.match(/^-?\s*(do|entry|exit|response)\s*:\s*(.*)/);
    if (actionKey) {
      const rest = actionKey[2].trim();
      // Inline single: `do: toggle_led`
      const single = rest.match(/^(\w[\w_-]*)$/);
      if (single && actionSet.has(single[1])) {
        const name = single[1];
        const col  = line.lastIndexOf(name);
        refs.push({ name, fnName: actionFn(name), kind: 'action', line: i, col });
      }
      // Inline list: `do: [a, b, c]`
      const inlineList = rest.match(/^\[([^\]]+)\]/);
      if (inlineList) {
        for (const part of inlineList[1].split(',')) {
          const n = part.trim();
          if (actionSet.has(n)) {
            const col = line.indexOf(n, line.indexOf('['));
            refs.push({ name: n, fnName: actionFn(n), kind: 'action', line: i, col });
          }
        }
      }
      continue;
    }

    // List item action: `  - toggle_led`
    const listItem = trimmed.match(/^-\s+(\w[\w_-]*)$/);
    if (listItem && actionSet.has(listItem[1])) {
      const name = listItem[1];
      const col  = line.lastIndexOf(name);
      refs.push({ name, fnName: actionFn(name), kind: 'action', line: i, col });
    }
  }

  return refs;
}

function getPrevMeaningfulLine(lines: string[], from: number): string | null {
  for (let i = from - 1; i >= 0; i--) {
    if (lines[i].trim() && !lines[i].trim().startsWith('#')) return lines[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// CodeLens
// ---------------------------------------------------------------------------

/**
 * One lens per name reference in the YAML.  Shows:
 *   "→ action_toggle_led  (src/actions.cpp:42)"  — click to jump
 *   "○ action_toggle_led  (run Generate first)"  — no-op command
 */
export function buildCodeLenses(
  doc:          TextDocument,
  model:        ModelNames,
  modelFsPath:  string,
): CodeLens[] {
  const text = doc.getText();
  const refs = findNameRefs(text, model);
  const lenses: CodeLens[] = [];

  for (const ref of refs) {
    const stubPath = stubFilePath(modelFsPath, ref.kind);
    const fnLine   = findFunctionLine(stubPath, ref.fnName);
    const range: Range = {
      start: { line: ref.line, character: ref.col },
      end:   { line: ref.line, character: ref.col + ref.name.length },
    };

    if (fnLine >= 0) {
      const relPath = path.relative(path.dirname(modelFsPath), stubPath).replace(/\\/g, '/');
      lenses.push({
        range,
        command: {
          title:     `→ ${ref.fnName}  (${relPath}:${fnLine + 1})`,
          command:   'pulseir.jumpToStub',
          arguments: [stubPath, fnLine],
        },
      });
    } else {
      lenses.push({
        range,
        command: {
          title:   `○ ${ref.fnName}  (run Generate to create stub)`,
          command: 'pulseir.generate',
        },
      });
    }
  }

  return lenses;
}

// ---------------------------------------------------------------------------
// Go-to-definition
// ---------------------------------------------------------------------------

/**
 * If the cursor is on a word that matches a known action or guard name, return
 * its Location in the stub file.
 */
export function findStubDefinition(
  doc:          TextDocument,
  position:     Position,
  model:        ModelNames,
  modelFsPath:  string,
): Location | null {
  const line     = doc.getText().split('\n')[position.line] ?? '';
  const wordRe   = /\b\w[\w_-]*\b/g;
  let m: RegExpExecArray | null;
  let word: string | null = null;

  while ((m = wordRe.exec(line)) !== null) {
    if (m.index <= position.character && position.character <= m.index + m[0].length) {
      word = m[0];
      break;
    }
  }
  if (!word) return null;

  const actionSet = new Set(model.actionNames);
  const guardSet  = new Set(model.guardNames ?? []);

  let kind: 'action' | 'guard' | null = null;
  let fnName: string;
  if (actionSet.has(word)) { kind = 'action'; fnName = actionFn(word); }
  else if (guardSet.has(word)) { kind = 'guard';  fnName = guardFn(word); }
  else return null;

  const stubPath = stubFilePath(modelFsPath, kind);
  const fnLine   = findFunctionLine(stubPath, fnName);
  if (fnLine < 0) return null;

  const fileUri = 'file:///' + stubPath.replace(/\\/g, '/').replace(/^\//, '');
  return {
    uri: fileUri,
    range: {
      start: { line: fnLine, character: 0 },
      end:   { line: fnLine, character: 999 },
    },
  };
}
