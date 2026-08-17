/**
 * The `log:` template: literal text with `{name}` holes.
 *
 * Shared by the parser, which checks every hole resolves to something the model
 * declared, and by a backend, which emits the print calls. One parser for both
 * so a template can never validate one way and generate another.
 *
 * This is deliberately the least powerful thing that answers "print a label and
 * a value": named substitution, and nothing else. No arithmetic, no formatting
 * directives, no conditionals. The moment a template needs any of those it has
 * become a language, and the answer is a named action written in C
 * (FUNCTION_CONTRACT.md §6).
 */

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** Literal text, or the name of a parameter or sensor to print. */
export type LogSegment =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; name: string };

/**
 * Split a template into literals and holes.
 *
 * `{{` and `}}` are literal braces, so a template can print one.
 */
export function parseTemplate(template: string): LogSegment[] {
  const segments: LogSegment[] = [];
  let text = '';
  let at = 0;

  const flush = () => {
    if (text) segments.push({ kind: 'text', value: text });
    text = '';
  };

  while (at < template.length) {
    const ch = template[at];

    if (ch === '{' && template[at + 1] === '{') {
      text += '{';
      at += 2;
      continue;
    }
    if (ch === '}' && template[at + 1] === '}') {
      text += '}';
      at += 2;
      continue;
    }

    if (ch === '}') {
      throw new TemplateError(
        `Unmatched "}" in ${JSON.stringify(template)}. Write "}}" to print one.`
      );
    }

    if (ch === '{') {
      const close = template.indexOf('}', at + 1);
      if (close === -1) {
        throw new TemplateError(
          `Unclosed "{" in ${JSON.stringify(template)}. Write "{{" to print one.`
        );
      }

      const name = template.slice(at + 1, close).trim();
      if (!name) {
        throw new TemplateError(`Empty "{}" in ${JSON.stringify(template)}`);
      }
      // A hole names one value, optionally prefixed with a device name
      // (e.g. {clock.hour}).  No spaces, no arithmetic, no nested dots.
      if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(name)) {
        throw new TemplateError(
          `"{${name}}" is not a valid reference. Use {name} for a parameter or ` +
          'sensor, or {device.channel} for a named sensor channel.'
        );
      }

      flush();
      segments.push({ kind: 'ref', name });
      at = close + 1;
      continue;
    }

    text += ch;
    at += 1;
  }

  flush();
  return segments;
}

/** Every name a template refers to, in order, deduplicated. */
export function templateRefs(segments: LogSegment[]): string[] {
  const seen = new Set<string>();
  for (const segment of segments) {
    if (segment.kind === 'ref') seen.add(segment.name);
  }
  return [...seen];
}
