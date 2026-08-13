/**
 * A minimal C++ / Arduino sketch highlighter for the generated-code pane.
 *
 * Same architecture as highlight.ts: a linear pass over the text with one
 * piece of carried state (whether we are inside a block comment). The
 * invariant `stripTags(highlightCpp(x)) === x` must hold — every character
 * of the input appears in the output, no more and no less.
 */

type CppTokenKind =
  | 'plain'
  | 'keyword'
  | 'type'
  | 'preproc'
  | 'string'
  | 'number'
  | 'comment'
  | 'punct';

const CPP_KEYWORDS = new Set([
  'auto', 'break', 'case', 'catch', 'class', 'const', 'constexpr', 'continue',
  'default', 'delete', 'do', 'else', 'enum', 'explicit', 'extern', 'false',
  'for', 'friend', 'goto', 'if', 'inline', 'namespace', 'new', 'nullptr',
  'operator', 'private', 'protected', 'public', 'return', 'sizeof', 'static',
  'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef',
  'typename', 'union', 'using', 'virtual', 'void', 'volatile', 'while',
  // Arduino / AVR constants that behave like keywords
  'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN',
  'NULL', 'PROGMEM', 'ISR', 'F',
]);

const CPP_TYPES = new Set([
  'bool', 'char', 'double', 'float', 'int', 'long', 'short', 'signed',
  'unsigned', 'wchar_t',
  // Fixed-width integer types
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'size_t', 'ptrdiff_t', 'uintptr_t', 'intptr_t',
  // Arduino / C++ stdlib types
  'String', 'boolean', 'byte', 'word',
]);

function escapeCpp(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class CppEmitter {
  private out: string[] = [];

  push(kind: CppTokenKind, text: string): void {
    if (!text) return;
    this.out.push(
      kind === 'plain'
        ? escapeCpp(text)
        : `<span class="c-${kind}">${escapeCpp(text)}</span>`,
    );
  }

  toString(): string { return this.out.join(''); }
}

export function highlightCpp(source: string): string {
  const lines = source.split('\n');
  const rendered: string[] = [];
  let inBlockComment = false;

  for (const line of lines) {
    const out = new CppEmitter();
    let i = 0;

    // ── Continuation of a multi-line block comment ───────────────────────────
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) {
        out.push('comment', line);
        rendered.push(out.toString());
        continue;
      }
      out.push('comment', line.slice(0, end + 2));
      i = end + 2;
      inBlockComment = false;
    }

    // ── Blank line ───────────────────────────────────────────────────────────
    if (line.slice(i).trim() === '') {
      out.push('plain', line.slice(i));
      rendered.push(out.toString());
      continue;
    }

    // ── Preprocessor directive ───────────────────────────────────────────────
    // A line starting with optional whitespace then '#' is a preprocessor line.
    // We colour '#directive' as preproc and tokenize the rest normally, so
    // `#include "Wire.h"` still gives the string a string colour.
    let isInclude = false;
    const ppMatch = /^(\s*)(#\s*[a-z]+)/i.exec(line.slice(i));
    if (ppMatch) {
      out.push('plain', ppMatch[1]);          // leading whitespace
      out.push('preproc', ppMatch[2]);        // #include / #define / …
      i += ppMatch[0].length;
      isInclude = ppMatch[2].replace(/\s/g, '') === '#include';
    }

    // ── Token loop ───────────────────────────────────────────────────────────
    while (i < line.length) {
      const ch = line[i];

      // Whitespace — must be preserved as-is for indentation.
      if (ch === ' ' || ch === '\t') {
        const start = i;
        while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
        out.push('plain', line.slice(start, i));
        continue;
      }

      // Line comment.
      if (ch === '/' && line[i + 1] === '/') {
        out.push('comment', line.slice(i));
        i = line.length;
        continue;
      }

      // Block comment (may start and end on the same line).
      if (ch === '/' && line[i + 1] === '*') {
        const end = line.indexOf('*/', i + 2);
        if (end === -1) {
          out.push('comment', line.slice(i));
          i = line.length;
          inBlockComment = true;
        } else {
          out.push('comment', line.slice(i, end + 2));
          i = end + 2;
        }
        continue;
      }

      // Double-quoted string literal.
      if (ch === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') {
          if (line[j] === '\\') j++; // skip escaped character
          j++;
        }
        out.push('string', line.slice(i, j + 1));
        i = j + 1;
        continue;
      }

      // Single-quoted character literal.
      if (ch === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== "'") {
          if (line[j] === '\\') j++;
          j++;
        }
        out.push('string', line.slice(i, j + 1));
        i = j + 1;
        continue;
      }

      // Angle-bracket include path: `<Wire.h>` — only in #include context.
      if (isInclude && ch === '<') {
        const end = line.indexOf('>', i + 1);
        if (end !== -1) {
          out.push('string', line.slice(i, end + 1));
          i = end + 1;
          continue;
        }
      }

      // Numeric literal: decimal, float, hex (0x…), binary (0b…).
      if (/\d/.test(ch) || (ch === '.' && /\d/.test(line[i + 1] ?? ''))) {
        const start = i;
        if (ch === '0' && /[xX]/.test(line[i + 1] ?? '')) {
          i += 2;
          while (i < line.length && /[0-9a-fA-F]/.test(line[i])) i++;
        } else if (ch === '0' && /[bB]/.test(line[i + 1] ?? '')) {
          i += 2;
          while (i < line.length && /[01]/.test(line[i])) i++;
        } else {
          while (i < line.length && /\d/.test(line[i])) i++;
          // Optional decimal part.
          if (line[i] === '.' && /\d/.test(line[i + 1] ?? '')) {
            i++;
            while (i < line.length && /\d/.test(line[i])) i++;
          }
          // Optional exponent.
          if (/[eE]/.test(line[i] ?? '')) {
            i++;
            if (/[+\-]/.test(line[i] ?? '')) i++;
            while (i < line.length && /\d/.test(line[i])) i++;
          }
        }
        // Integer / float suffix: u, l, f, ul, ll, ull, …
        while (i < line.length && /[uUlLfF]/.test(line[i])) i++;
        out.push('number', line.slice(start, i));
        continue;
      }

      // Identifier: keyword, type, or user name.
      if (/[a-zA-Z_]/.test(ch)) {
        const start = i;
        while (i < line.length && /[a-zA-Z0-9_]/.test(line[i])) i++;
        const word = line.slice(start, i);
        if (CPP_KEYWORDS.has(word)) {
          out.push('keyword', word);
        } else if (CPP_TYPES.has(word)) {
          out.push('type', word);
        } else {
          out.push('plain', word);
        }
        continue;
      }

      // Punctuation and operators.
      if (/[{}()[\];,.<>=!&|+\-*/%^~?:]/.test(ch)) {
        out.push('punct', ch);
        i++;
        continue;
      }

      // Anything unrecognised goes out verbatim.
      out.push('plain', ch);
      i++;
    }

    rendered.push(out.toString());
  }

  return rendered.join('\n');
}
