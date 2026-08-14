/**
 * YAML snippet merging — text-level only; comments and formatting are preserved.
 *
 * When the Insert menu injects a snippet whose top-level key already exists in
 * the document (e.g. a second `hardware:` block), the snippet's sub-entries are
 * merged into the existing section rather than producing a duplicate mapping key.
 *
 * Two levels of nesting are handled: top-level → child → grandchild items.
 * That covers every real case: hardware → buses/devices → named entries.
 */

export interface YBlock { key: string; lines: string[]; }

export function parseTopBlocks(text: string): YBlock[] {
  const blocks: YBlock[] = [];
  let cur: YBlock | null = null;
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_][\w-]*):/.exec(line);
    if (m) { if (cur) blocks.push(cur); cur = { key: m[1], lines: [line] }; }
    else if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

export function parseChildBlocks(lines: string[], indent: string): YBlock[] {
  const blocks: YBlock[] = [];
  let cur: YBlock | null = null;
  const re = new RegExp(`^${indent}([A-Za-z_][\\w-]*):`);
  for (const line of lines) {
    const m = re.exec(line);
    if (m) { if (cur) blocks.push(cur); cur = { key: m[1], lines: [line] }; }
    else if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

export function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return lines.slice(0, end);
}

export function findInsertionPoint(lines: string[]): number {
  let i = lines.length;
  while (i > 0 && lines[i - 1].trim() === '') i--;
  return i;
}

export function findNextTopKeyIdx(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (/^[A-Za-z_][\w-]*:/.test(lines[i])) return i;
  }
  return lines.length;
}

export function findNextChildKeyIdx(lines: string[], from: number, indent: string): number {
  const re = new RegExp(`^${indent}[A-Za-z_][\\w-]*:`);
  for (let i = from; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return lines.length;
}

export function mergeChildBlock(
  sectionLines: string[], key: string, childLines: string[], indent: string
): string[] {
  const re = new RegExp(`^${indent}${key}:`);
  const keyIdx = sectionLines.findIndex(l => re.test(l));

  if (keyIdx === -1) {
    const at = findInsertionPoint(sectionLines);
    return [
      ...sectionLines.slice(0, at),
      ...trimTrailingBlanks(childLines),
      ...sectionLines.slice(at),
    ];
  }

  const childEnd = findNextChildKeyIdx(sectionLines, keyIdx + 1, indent);
  const grandchildren = trimTrailingBlanks(childLines.slice(1));
  const sub = sectionLines.slice(keyIdx, childEnd);
  const at  = findInsertionPoint(sub);
  return [
    ...sectionLines.slice(0, keyIdx),
    ...sub.slice(0, at),
    ...grandchildren,
    ...sub.slice(at),
    ...sectionLines.slice(childEnd),
  ];
}

export function mergeTopBlock(
  docLines: string[], key: string, snippetLines: string[]
): string[] {
  const keyIdx = docLines.findIndex(l => /^([A-Za-z_][\w-]*):/.exec(l)?.[1] === key);

  if (keyIdx === -1) {
    const at = findInsertionPoint(docLines);
    return [...docLines.slice(0, at), '', ...trimTrailingBlanks(snippetLines), ...docLines.slice(at)];
  }

  const sectionEnd = findNextTopKeyIdx(docLines, keyIdx + 1);
  let merged = docLines.slice(keyIdx, sectionEnd);
  for (const child of parseChildBlocks(snippetLines.slice(1), '  ')) {
    merged = mergeChildBlock(merged, child.key, child.lines, '  ');
  }
  return [...docLines.slice(0, keyIdx), ...merged, ...docLines.slice(sectionEnd)];
}

/**
 * Merge a YAML snippet into a document at the text level.
 *
 * For each top-level key in the snippet:
 *   - Absent in the document → append the block.
 *   - Already present → merge 2nd-level sub-entries into the existing section.
 *     For 2nd-level keys that already exist, the snippet's entries are appended
 *     under them; for absent 2nd-level keys the whole sub-block is added inside
 *     the existing parent.
 */
export function mergeSnippetIntoYaml(doc: string, snippet: string): string {
  let lines = doc.split('\n');
  for (const blk of parseTopBlocks(snippet)) {
    lines = mergeTopBlock(lines, blk.key, blk.lines);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}
