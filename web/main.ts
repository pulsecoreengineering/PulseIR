/**
 * PulseIR web editor.
 *
 * This runs the *real* pipeline - the same Parser, Codegen and TopicEmitter
 * the CLI uses - compiled to a browser bundle. Nothing here reimplements the
 * IR, so the editor cannot drift from what `pulse-ir` produces on disk.
 *
 * Everything happens in the page: no server, no upload, no network. The bundle
 * opens from a file:// URL and keeps working offline.
 */

import { Parser, ParseError } from '../src/parser/index.js';
import { Codegen } from '../src/codegen/index.js';
import { TopicEmitter } from '../src/emit/topics.js';
import { flattenStates, resolveEntryLeaf, resolvePath } from '../src/analysis/states.js';
import type { PulseProject } from '../src/model/index.js';
import { EXAMPLES } from './examples.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const source = $<HTMLTextAreaElement>('source');
const status = $<HTMLDivElement>('status');
const panes = {
  sketch: $<HTMLElement>('pane-sketch'),
  topics: $<HTMLElement>('pane-topics'),
  structure: $<HTMLElement>('pane-structure'),
};
const exampleSelect = $<HTMLSelectElement>('example');
const namespaceInput = $<HTMLInputElement>('namespace');
const staleNote = $<HTMLDivElement>('stale-note');
const downloadSketch = $<HTMLButtonElement>('download-sketch');
const downloadTopics = $<HTMLButtonElement>('download-topics');

/** Last successful render, so downloads never hand over a stale-but-broken file. */
let current: { project: PulseProject; sketch: string; topics: string } | null = null;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * On failure the panes keep their last good content so the student still has
 * something to edit against - but that content is now a lie about the current
 * source, so it has to be labelled rather than just dimmed.
 */
function setStale(stale: boolean): void {
  staleNote.hidden = !stale;
  for (const pane of Object.values(panes)) pane.classList.toggle('stale', stale);
}

function setStatus(kind: 'ok' | 'error', title: string, detail = ''): void {
  status.className = `status ${kind}`;
  status.innerHTML = `<strong>${escapeHtml(title)}</strong>${
    detail ? `<span>${escapeHtml(detail)}</span>` : ''
  }`;
}

/**
 * The structure pane exists to make the two rules students get wrong visible:
 * entering a composite state descends to its initial child, and a transition
 * on an enclosing state applies to everything inside it.
 */
function renderStructure(project: PulseProject): string {
  const states = project.system.states;
  const flat = flattenStates(states);

  const tree = flat
    .filter(s => s.depth === 0)
    .map(s => renderStateNode(s.path, flat))
    .join('');

  const rows = project.system.transitions.map(t => {
    const targetPath = resolvePath(states, t.target);
    const leaf = targetPath ? resolveEntryLeaf(states, targetPath) : null;

    // Spelling out the descent is the point: "running" is not where you land.
    const descends = leaf && targetPath && leaf !== targetPath;
    const target = descends
      ? `${escapeHtml(t.target)} <span class="arrow">↳</span> <code>${escapeHtml(leaf)}</code>`
      : escapeHtml(t.target);

    const guard = t.guard ? `<code>${escapeHtml(t.guard.name)}</code>` : '<span class="dim">—</span>';
    const actions = t.actions?.length
      ? t.actions.map(a => `<code>${escapeHtml(a.driver)}</code>`).join(' ')
      : '<span class="dim">—</span>';
    const src = t.source === '*'
      ? '<span class="tag wild">any state</span>'
      : `<code>${escapeHtml(t.source)}</code>`;

    return `<tr>
      <td>${src}</td>
      <td><code>${escapeHtml(t.event)}</code></td>
      <td>${target}</td>
      <td>${guard}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  return `
    <h3>State hierarchy</h3>
    <p class="hint">A machine only ever rests in a <em>leaf</em>. Entering a
    composite state descends to its initial child, marked ▸.</p>
    <div class="tree">${tree || '<p class="dim">No states defined.</p>'}</div>

    <h3>Transitions</h3>
    <p class="hint">A transition on an enclosing state also applies to its
    children, and an inner transition on the same event wins.</p>
    <table>
      <thead><tr><th>From</th><th>On</th><th>To</th><th>Guard</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="dim">No transitions defined.</td></tr>'}</tbody>
    </table>`;
}

function renderStateNode(path: string, flat: ReturnType<typeof flattenStates>): string {
  const node = flat.find(s => s.path === path)!;
  const children = flat.filter(s => s.parentPath === path);

  const label = escapeHtml(node.state.name);
  const isInitial = flat.some(s => s.initialChildPath === path);
  const marker = isInitial ? '<span class="initial" title="initial child">▸</span>' : '';

  if (node.isLeaf) {
    return `<div class="state leaf">${marker}<span>${label}</span></div>`;
  }

  return `<div class="state composite">
    <div class="state-name">${marker}<span>${label}</span>
      <span class="tag">composite</span></div>
    <div class="children">${children.map(c => renderStateNode(c.path, flat)).join('')}</div>
  </div>`;
}

function render(): void {
  const text = source.value;
  localStorage.setItem('pulseir.source', text);

  let project: PulseProject;
  try {
    project = new Parser().parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const where = error instanceof ParseError && error.line !== undefined
      ? ` (line ${error.line + 1})`
      : '';
    setStatus('error', `Model error${where}`, message);
    setStale(true);
    return;
  }

  let sketch: string;
  let topics: string;
  try {
    sketch = new Codegen().generate(project);
    topics = new TopicEmitter().toJSON(project, namespaceInput.value.trim() || undefined);
  } catch (error) {
    setStatus('error', 'Generation error', error instanceof Error ? error.message : String(error));
    setStale(true);
    return;
  }

  setStale(false);

  panes.sketch.innerHTML = `<pre><code>${escapeHtml(sketch)}</code></pre>`;
  panes.topics.innerHTML = `<pre><code>${escapeHtml(topics)}</code></pre>`;
  panes.structure.innerHTML = renderStructure(project);

  const counts = [
    `${project.system.states.length} top-level states`,
    `${project.system.events.length} events`,
    `${project.system.transitions.length} transitions`,
    `${sketch.split('\n').length} lines generated`,
  ].join(' · ');
  setStatus('ok', project.name, counts);

  current = { project, sketch, topics };
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function debounce(fn: () => void, ms: number): () => void {
  let handle: number | undefined;
  return () => {
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(fn, ms) as unknown as number;
  };
}

function download(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function selectTab(name: keyof typeof panes): void {
  for (const [key, pane] of Object.entries(panes)) {
    pane.hidden = key !== name;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    button.classList.toggle('active', button.dataset.tab === name);
  }
  localStorage.setItem('pulseir.tab', name);
}

function init(): void {
  for (const key of Object.keys(EXAMPLES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    exampleSelect.append(option);
  }

  // Restore the last edit so a refresh does not throw work away.
  const saved = localStorage.getItem('pulseir.source');
  source.value = saved ?? EXAMPLES[Object.keys(EXAMPLES)[0]];

  const rerender = debounce(render, 150);
  source.addEventListener('input', rerender);
  namespaceInput.addEventListener('input', rerender);

  exampleSelect.addEventListener('change', () => {
    const example = EXAMPLES[exampleSelect.value];
    if (!example) return;

    // Only interrupt when there is actual work to lose. Switching between
    // untouched examples should be free.
    const untouched = !source.value.trim()
      || Object.values(EXAMPLES).some(text => text === source.value);

    if (!untouched && !confirm('Replace the current model with this example?')) {
      exampleSelect.value = '';
      return;
    }
    source.value = example;
    render();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    button.addEventListener('click', () => selectTab(button.dataset.tab as keyof typeof panes));
  }

  downloadSketch.addEventListener('click', () => {
    if (!current) return;
    download(`${current.project.name}.ino`, current.sketch, 'text/plain');
  });
  downloadTopics.addEventListener('click', () => {
    if (!current) return;
    download('topics.json', current.topics, 'application/json');
  });

  // Tab in a textarea should indent, not escape to the next control.
  source.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = source;
    source.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    source.selectionStart = source.selectionEnd = selectionStart + 2;
    rerender();
  });

  selectTab((localStorage.getItem('pulseir.tab') as keyof typeof panes) || 'sketch');
  render();
}

init();
