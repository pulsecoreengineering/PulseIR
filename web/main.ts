/**
 * PulseIR web editor.
 *
 * This runs the *real* pipeline - the same Parser, Codegen and TopicEmitter
 * the CLI uses - compiled to a browser bundle. Nothing here reimplements the
 * IR, so the editor cannot drift from what `pulse-ir` produces on disk.
 *
 * Models can span several files. The parser never touches a filesystem; it
 * asks a SourceResolver, so here the open buffers *are* the filesystem and
 * `include` resolves between tabs exactly as it does on disk.
 *
 * Everything happens in the page: no server, no upload, no network. The bundle
 * opens from a file:// URL and keeps working offline.
 */

import { Parser, ParseError } from '../src/parser/index.js';
import { MemoryResolver } from '../src/parser/resolver.js';
import { Codegen } from '../src/codegen/index.js';
import { TopicEmitter } from '../src/emit/topics.js';
import { LibraryEmitter } from '../src/emit/libraries.js';
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
const fileBar = $<HTMLDivElement>('file-bar');
const panes = {
  sketch: $<HTMLElement>('pane-sketch'),
  topics: $<HTMLElement>('pane-topics'),
  libraries: $<HTMLElement>('pane-libraries'),
  structure: $<HTMLElement>('pane-structure'),
};
const exampleSelect = $<HTMLSelectElement>('example');
const namespaceInput = $<HTMLInputElement>('namespace');
const staleNote = $<HTMLDivElement>('stale-note');

// ---------------------------------------------------------------------------
// Model state
// ---------------------------------------------------------------------------

interface Workspace {
  /** Open buffers, keyed by the path an `include` would use. */
  files: Record<string, string>;
  /** File the parser starts from. */
  entry: string;
  /** File shown in the textarea. */
  active: string;
}

const STORAGE_KEY = 'pulseir.workspace';

let workspace: Workspace = { files: {}, entry: '', active: '' };

/** Last successful render, so downloads never hand over a broken file. */
let current: { project: PulseProject; sketch: string; topics: string; libraries: string } | null = null;

function fileNames(): string[] {
  // Entry first, then the rest alphabetically - a stable order that puts the
  // file you start reading from where you expect it.
  const rest = Object.keys(workspace.files).filter(n => n !== workspace.entry).sort();
  return workspace.entry ? [workspace.entry, ...rest] : rest;
}

function loadExample(label: string): void {
  const example = EXAMPLES[label];
  if (!example) return;
  workspace = {
    files: { ...example.files },
    entry: example.entry,
    active: example.entry,
  };
}

function restore(): void {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Workspace;
      if (parsed.files && Object.keys(parsed.files).length && parsed.files[parsed.entry]) {
        workspace = {
          files: parsed.files,
          entry: parsed.entry,
          active: parsed.files[parsed.active] !== undefined ? parsed.active : parsed.entry,
        };
        return;
      }
    } catch {
      // Corrupt state should not brick the editor; fall through to a default.
    }
  }

  // Migrate the single-buffer layout this editor used before multi-file.
  const legacy = localStorage.getItem('pulseir.source');
  if (legacy && legacy.trim()) {
    workspace = { files: { 'model.yaml': legacy }, entry: 'model.yaml', active: 'model.yaml' };
    localStorage.removeItem('pulseir.source');
    return;
  }

  loadExample(Object.keys(EXAMPLES)[0]);
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

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

function setStatus(kind: 'ok' | 'warn' | 'error', title: string, detail = ''): void {
  status.className = `status ${kind}`;
  status.innerHTML = `<strong>${escapeHtml(title)}</strong>${
    detail ? `<span>${escapeHtml(detail)}</span>` : ''
  }`;
}

function renderFileBar(): void {
  const names = fileNames();

  fileBar.innerHTML = names.map(name => {
    const isEntry = name === workspace.entry;
    const isActive = name === workspace.active;
    // The entry file is where parsing starts, so it is worth marking: an
    // include in any other file is only reachable through it.
    const badge = isEntry ? '<span class="entry-badge" title="entry file">▶</span>' : '';
    const close = !isEntry
      ? `<span class="close" data-close="${escapeHtml(name)}" title="Delete ${escapeHtml(name)}">×</span>`
      : '';
    return `<button class="filetab${isActive ? ' active' : ''}" data-file="${escapeHtml(name)}"
      title="${escapeHtml(name)} (double-click to rename)">${badge}${escapeHtml(name)}${close}</button>`;
  }).join('');

  for (const tab of fileBar.querySelectorAll<HTMLButtonElement>('.filetab')) {
    const name = tab.dataset.file!;

    tab.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.dataset.close) {
        event.stopPropagation();
        deleteFile(target.dataset.close);
        return;
      }
      selectFile(name);
    });

    tab.addEventListener('dblclick', () => renameFile(name));
  }
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
      ? t.actions.map(a => `<code>${escapeHtml(a.name)}</code>`).join(' ')
      : '<span class="dim">—</span>';
    const src = t.source === '*'
      ? '<span class="tag wild">any state</span>'
      : `<code>${escapeHtml(t.source)}</code>`;

    // A timed transition has no event; show what it waits for instead, so the
    // table stays a complete picture of what makes the machine move.
    const trigger = t.event !== undefined
      ? `<code>${escapeHtml(t.event)}</code>`
      : `<span class="tag timer">after</span> <code>${escapeHtml(String(t.after))}</code>`;

    return `<tr>
      <td>${src}</td>
      <td>${trigger}</td>
      <td>${target}</td>
      <td>${guard}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  const resources = (project.system.resources || []).map(r => `<tr>
      <td><code>${escapeHtml(r.name)}</code></td>
      <td><span class="tag">${escapeHtml(String(r.interface))}</span></td>
      <td>${Object.entries(r.binding || {})
        .map(([k, v]) => `<code>${escapeHtml(k)}=${escapeHtml(String(v))}</code>`)
        .join(' ') || '<span class="dim">—</span>'}</td>
    </tr>`).join('');

  return `
    <h3>State hierarchy</h3>
    <p class="hint">A machine only ever rests in a <em>leaf</em>. Entering a
    composite state descends to its initial child, marked ▸.</p>
    <div class="tree">${tree || '<p class="dim">No states defined.</p>'}</div>

    <h3>Transitions</h3>
    <p class="hint">A transition on an enclosing state also applies to its
    children, and an inner transition on the same event wins.</p>
    <table>
      <thead><tr><th>From</th><th>Trigger</th><th>To</th><th>Guard</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="dim">No transitions defined.</td></tr>'}</tbody>
    </table>

    <h3>Interfaces</h3>
    <table>
      <thead><tr><th>Resource</th><th>Interface</th><th>Binding</th></tr></thead>
      <tbody>${resources || '<tr><td colspan="3" class="dim">No resources declared.</td></tr>'}</tbody>
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
  persist();

  let project: PulseProject;
  const parser = new Parser();
  try {
    // The open buffers are the filesystem, so an import between tabs resolves
    // the same way it does on disk.
    const resolver = new MemoryResolver(workspace.files);
    project = parser.parseFrom(workspace.entry, resolver);
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
  let libraries: string;
  try {
    sketch = new Codegen().generate(project);
    topics = new TopicEmitter().toJSON(project, namespaceInput.value.trim() || undefined);
    libraries = new LibraryEmitter().toJSON(project);
  } catch (error) {
    setStatus('error', 'Generation error', error instanceof Error ? error.message : String(error));
    setStale(true);
    return;
  }

  setStale(false);

  panes.sketch.innerHTML = `<pre><code>${escapeHtml(sketch)}</code></pre>`;
  panes.topics.innerHTML = `<pre><code>${escapeHtml(topics)}</code></pre>`;
  panes.libraries.innerHTML = `<pre><code>${escapeHtml(libraries)}</code></pre>`;
  panes.structure.innerHTML = renderStructure(project);

  const fileCount = Object.keys(workspace.files).length;
  const counts = [
    fileCount > 1 ? `${fileCount} files` : null,
    `${project.system.events.length} events`,
    `${project.system.transitions.length} transitions`,
    `${(project.system.resources || []).length} resources`,
    `${sketch.split('\n').length} lines generated`,
  ].filter(Boolean).join(' · ');
  // A retired schema still generates, but the student should be told.
  if (parser.warnings.length > 0) {
    setStatus('warn', project.name, `${counts}\n${parser.warnings.join('\n')}`);
  } else {
    setStatus('ok', project.name, counts);
  }

  current = { project, sketch, topics, libraries };
}

// ---------------------------------------------------------------------------
// File actions
// ---------------------------------------------------------------------------

function selectFile(name: string): void {
  if (workspace.files[name] === undefined) return;
  workspace.active = name;
  source.value = workspace.files[name];
  renderFileBar();
  persist();
}

function addFile(): void {
  const name = prompt('New file name', 'part.yaml');
  if (!name) return;

  const clean = name.trim();
  if (!clean.endsWith('.yaml') && !clean.endsWith('.yml')) {
    alert('Model files must end in .yaml or .yml');
    return;
  }
  if (workspace.files[clean] !== undefined) {
    alert(`"${clean}" already exists`);
    return;
  }

  workspace.files[clean] = `# ${clean}\n#\n# Add this to the entry file's include list:\n#   include:\n#     - ${clean}\n\nsystem:\n`;
  selectFile(clean);
  render();
}

function renameFile(name: string): void {
  const next = prompt(`Rename "${name}" to`, name);
  if (!next || next === name) return;

  const clean = next.trim();
  if (workspace.files[clean] !== undefined) {
    alert(`"${clean}" already exists`);
    return;
  }

  workspace.files[clean] = workspace.files[name];
  delete workspace.files[name];

  if (workspace.entry === name) workspace.entry = clean;
  if (workspace.active === name) workspace.active = clean;

  // Renaming does not rewrite include lists - the model will now fail to
  // parse, and the error says which file is missing. That is clearer than
  // silently editing YAML the user did not ask us to touch.
  selectFile(workspace.active);
  render();
}

function deleteFile(name: string): void {
  if (name === workspace.entry) {
    alert('The entry file cannot be deleted. Make another file the entry first.');
    return;
  }
  if (!confirm(`Delete "${name}"?`)) return;

  delete workspace.files[name];
  if (workspace.active === name) workspace.active = workspace.entry;
  selectFile(workspace.active);
  render();
}

function setEntry(): void {
  if (workspace.active === workspace.entry) return;
  workspace.entry = workspace.active;
  renderFileBar();
  render();
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

  restore();
  source.value = workspace.files[workspace.active] ?? '';
  renderFileBar();

  const rerender = debounce(render, 150);

  source.addEventListener('input', () => {
    workspace.files[workspace.active] = source.value;
    rerender();
  });
  namespaceInput.addEventListener('input', rerender);

  exampleSelect.addEventListener('change', () => {
    const example = EXAMPLES[exampleSelect.value];
    if (!example) return;

    // Only interrupt when there is actual work to lose. Switching between
    // untouched examples should be free.
    const untouched = Object.values(EXAMPLES).some(
      candidate => JSON.stringify(candidate.files) === JSON.stringify(workspace.files)
    );
    if (!untouched && !confirm('Replace the current model with this example?')) {
      exampleSelect.value = '';
      return;
    }

    loadExample(exampleSelect.value);
    source.value = workspace.files[workspace.active];
    renderFileBar();
    render();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    button.addEventListener('click', () => selectTab(button.dataset.tab as keyof typeof panes));
  }

  $<HTMLButtonElement>('add-file').addEventListener('click', addFile);
  $<HTMLButtonElement>('set-entry').addEventListener('click', setEntry);

  $<HTMLButtonElement>('download-sketch').addEventListener('click', () => {
    if (!current) return;
    download(`${current.project.name}.ino`, current.sketch, 'text/plain');
  });
  $<HTMLButtonElement>('download-topics').addEventListener('click', () => {
    if (!current) return;
    download('topics.json', current.topics, 'application/json');
  });
  $<HTMLButtonElement>('download-libraries').addEventListener('click', () => {
    if (!current) return;
    download('libraries.json', current.libraries, 'application/json');
  });

  // Tab in a textarea should indent, not escape to the next control.
  source.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = source;
    source.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    source.selectionStart = source.selectionEnd = selectionStart + 2;
    workspace.files[workspace.active] = source.value;
    rerender();
  });

  selectTab((localStorage.getItem('pulseir.tab') as keyof typeof panes) || 'sketch');
  render();
}

init();
