/**
 * A small YAML highlighter for the editor.
 *
 * No library, because the page has to stay self-contained: it opens from a
 * file:// URL with no network, and pulling in CodeMirror to colour a few
 * hundred lines would cost more than it gives.
 *
 * The output is rendered *behind* a transparent textarea, so it has one
 * absolute obligation: the visible text must be byte-identical to the input.
 * Drop a character, or add one, and every line below drifts out of alignment
 * with the caret. `stripTags(highlight(x)) === x` is asserted in the tests and
 * is the property that makes the overlay safe.
 *
 * It is a real tokenizer rather than a pile of regexes over the whole document,
 * because the traps in YAML are all about context:
 *
 *   - `on:` and `off:` are *keys* in our models (event names, state names), not
 *     the YAML 1.1 booleans they look like
 *   - `#` inside a quoted string is not a comment
 *   - a `|` block scalar's body is text, and must not be tokenized at all
 */

export type TokenKind =
  | 'plain'
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'comment'
  | 'punct'
  | 'anchor'
  | 'tag';

const BOOLEANS = new Set(['true', 'false', 'yes', 'no', 'on', 'off']);
const NULLS = new Set(['null', '~']);

/** Characters that end a bare scalar inside a flow collection. */
const FLOW_DELIMITERS = new Set([',', '{', '}', '[', ']']);

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Recover the plain text from highlighted HTML. Used by the tests. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

class Emitter {
  private out: string[] = [];

  push(kind: TokenKind, text: string): void {
    if (!text) return;
    this.out.push(kind === 'plain' ? escapeHtml(text) : `<span class="y-${kind}">${escapeHtml(text)}</span>`);
  }

  toString(): string {
    return this.out.join('');
  }
}

/**
 * Classify a bare (unquoted) scalar. Anything unrecognised stays plain, which
 * is the right default: an event name is not a keyword.
 */
function classifyScalar(text: string): TokenKind {
  const lower = text.toLowerCase();
  if (NULLS.has(lower)) return 'null';
  if (BOOLEANS.has(lower)) return 'boolean';
  // Ints, floats, exponents and hex - the forms a model actually uses.
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return 'number';
  if (/^0x[0-9a-fA-F]+$/.test(text)) return 'number';
  return 'plain';
}

/** Read a quoted scalar starting at `i`. Returns the index just past it. */
function readQuoted(line: string, i: number): number {
  const quote = line[i];
  let j = i + 1;

  while (j < line.length) {
    if (quote === '"' && line[j] === '\\') {
      j += 2;
      continue;
    }
    // In single quotes, '' is an escaped quote rather than the end.
    if (line[j] === quote) {
      if (quote === "'" && line[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }

  // Unterminated: the rest of the line is the string. Colouring it as one is
  // more useful than bailing out, because that is what you see while typing.
  return line.length;
}

/**
 * Is there a `:` that ends a key starting at `i`? Returns its index, or -1.
 *
 * A key's colon must be followed by whitespace or end-of-input (or, in a flow
 * collection, by a delimiter). `http://x` is therefore not a key, and neither
 * is a time like `12:30`.
 */
function findKeyColon(line: string, i: number, inFlow: boolean): number {
  let j = i;

  while (j < line.length) {
    const ch = line[j];

    if (ch === '"' || ch === "'") {
      j = readQuoted(line, j);
      continue;
    }
    if (ch === '#' && j > i && /\s/.test(line[j - 1])) return -1;
    if (inFlow && FLOW_DELIMITERS.has(ch)) return -1;

    if (ch === ':') {
      const next = line[j + 1];
      if (next === undefined || /\s/.test(next) || (inFlow && FLOW_DELIMITERS.has(next))) return j;
    }
    j++;
  }

  return -1;
}

/**
 * Tokenize the value part of a line - everything after `key:`, or the whole
 * line when there is no key.
 *
 * `flowDepth` tracks nesting in `{}`/`[]`, because `{a: 1}` contains keys and a
 * bare `a: 1` at top level has already been handled by the caller.
 */
function emitValue(out: Emitter, line: string, from: number, flowDepth: number): void {
  let i = from;
  let depth = flowDepth;

  while (i < line.length) {
    const ch = line[i];

    // Whitespace is structural for alignment, so it is emitted verbatim.
    if (/\s/.test(ch)) {
      const start = i;
      while (i < line.length && /\s/.test(line[i])) i++;
      out.push('plain', line.slice(start, i));
      continue;
    }

    // A comment needs whitespace before it, or to start the token.
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      out.push('comment', line.slice(i));
      return;
    }

    if (ch === '"' || ch === "'") {
      const end = readQuoted(line, i);
      out.push('string', line.slice(i, end));
      i = end;
      continue;
    }

    if (ch === '{' || ch === '[') {
      out.push('punct', ch);
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ']') {
      out.push('punct', ch);
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (ch === ',') {
      out.push('punct', ch);
      i++;
      continue;
    }

    if (ch === '&' || ch === '*') {
      const start = i++;
      while (i < line.length && !/[\s,{}[\]]/.test(line[i])) i++;
      out.push('anchor', line.slice(start, i));
      continue;
    }
    if (ch === '!') {
      const start = i++;
      while (i < line.length && !/[\s,{}[\]]/.test(line[i])) i++;
      out.push('tag', line.slice(start, i));
      continue;
    }

    // Inside a flow collection, a bare word followed by ": " is a key.
    if (depth > 0) {
      const colon = findKeyColon(line, i, true);
      if (colon !== -1) {
        out.push('key', line.slice(i, colon));
        out.push('punct', ':');
        i = colon + 1;
        continue;
      }
    }

    // A bare scalar runs to the next delimiter. Outside a flow collection only
    // a comment ends it, so `a b c` stays one plain scalar, as YAML says.
    const start = i;
    while (i < line.length) {
      const c = line[i];
      if (depth > 0 && (FLOW_DELIMITERS.has(c) || /\s/.test(c))) break;
      if (c === '#' && /\s/.test(line[i - 1] ?? ' ')) break;
      i++;
    }

    const text = line.slice(start, i);
    out.push(depth > 0 ? classifyScalar(text) : classifyScalar(text.trimEnd()), text);
  }
}

/**
 * Highlight a whole document.
 *
 * Line-based, with one piece of carried state: whether we are inside a block
 * scalar, whose body must be left as text.
 */
export function highlight(source: string): string {
  const lines = source.split('\n');
  const rendered: string[] = [];

  // -1 when not in a block scalar; otherwise the indent its body must exceed.
  let blockIndent = -1;

  for (const line of lines) {
    const out = new Emitter();
    const indentLength = line.length - line.trimStart().length;

    if (blockIndent !== -1) {
      // A blank line stays inside the block; anything indented past the
      // introducing key does too.
      if (line.trim() === '' || indentLength > blockIndent) {
        out.push('string', line);
        rendered.push(out.toString());
        continue;
      }
      blockIndent = -1;
    }

    // Emitted verbatim, not as '': a line of nothing but spaces still has to
    // occupy them, or the caret sits to the left of where the text is drawn.
    if (line.trim() === '') {
      rendered.push(escapeHtml(line));
      continue;
    }

    const indent = line.slice(0, indentLength);
    out.push('plain', indent);
    let i = indentLength;

    // Document markers.
    if (line.slice(i) === '---' || line.slice(i) === '...') {
      out.push('punct', line.slice(i));
      rendered.push(out.toString());
      continue;
    }

    // A whole-line comment.
    if (line[i] === '#') {
      out.push('comment', line.slice(i));
      rendered.push(out.toString());
      continue;
    }

    // Sequence entries, possibly nested: "- - item".
    while (line[i] === '-' && (line[i + 1] === ' ' || line[i + 1] === undefined)) {
      out.push('punct', '-');
      i++;
      const start = i;
      while (i < line.length && line[i] === ' ') i++;
      out.push('plain', line.slice(start, i));
    }

    // A key, if this line has one.
    const colon = findKeyColon(line, i, false);
    if (colon !== -1) {
      const rawKey = line.slice(i, colon);
      // A quoted key keeps its string colour; anything else reads as a key.
      out.push(/^["']/.test(rawKey.trim()) ? 'string' : 'key', rawKey);
      out.push('punct', ':');
      i = colon + 1;
    }

    // A block scalar introducer: everything more-indented below is its body.
    const rest = line.slice(i);
    const block = /^(\s*)([|>][+-]?\d*)(\s*)(#.*)?$/.exec(rest);
    if (block) {
      out.push('plain', block[1]);
      out.push('punct', block[2]);
      out.push('plain', block[3]);
      if (block[4]) out.push('comment', block[4]);
      blockIndent = indentLength;
      rendered.push(out.toString());
      continue;
    }

    emitValue(out, line, i, 0);
    rendered.push(out.toString());
  }

  return rendered.join('\n');
}
