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
import { highlight } from './highlight.js';
import { ProjectStore, foldImport, findEntry, importedName, nameFromModel } from './projects.js';
import type { Project } from './projects.js';
import { zip, unzip, ZipError } from './zip.js';
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
const highlightLayer = $<HTMLPreElement>('highlight');
const gutter = $<HTMLDivElement>('gutter');
const gutterLines = $<HTMLDivElement>('gutter-lines');
const highlightCode = $<HTMLElement>('highlight-code');
const status = $<HTMLDivElement>('status');
const fileBar = $<HTMLDivElement>('file-bar');
const panes = {
  sketch: $<HTMLElement>('pane-sketch'),
  topics: $<HTMLElement>('pane-topics'),
  libraries: $<HTMLElement>('pane-libraries'),
  structure: $<HTMLElement>('pane-structure'),
};
const exampleSelect = $<HTMLSelectElement>('example');
const projectButton = $<HTMLButtonElement>('project-button');
const projectName = $<HTMLSpanElement>('project-name');
const projectMenu = $<HTMLDivElement>('project-menu');
const importZipInput = $<HTMLInputElement>('import-zip');
const importFolderInput = $<HTMLInputElement>('import-folder');
const copyYamlButton = $<HTMLButtonElement>('copy-yaml');
const copyOutputButton = $<HTMLButtonElement>('copy-output');
const snippetButton = $<HTMLButtonElement>('snippet-button');
const snippetMenu = $<HTMLDivElement>('snippet-menu');
const namespaceInput = $<HTMLInputElement>('namespace');
const namespaceLabel = $<HTMLLabelElement>('namespace-label');
const boardSelect = $<HTMLSelectElement>('board');
const staleNote = $<HTMLDivElement>('stale-note');
const downloadButton = $<HTMLButtonElement>('download-button');
const downloadMenu = $<HTMLDivElement>('download-menu');

// ---------------------------------------------------------------------------
// Model state
// ---------------------------------------------------------------------------

const store = new ProjectStore(localStorage);

/**
 * The open project.
 *
 * Everything below still calls it `workspace`, because that is what it is from
 * the editor's point of view: the files on screen. The difference is that there
 * are now many of them and this one has a name.
 */
let workspace: Project = { id: '', name: '', files: {}, entry: '', active: '', updatedAt: 0 };

/** Last successful render, so downloads never hand over a broken file. */
let current: { project: PulseProject; sketch: string; topics: string; libraries: string } | null = null;

function fileNames(): string[] {
  // Entry first, then the rest alphabetically - a stable order that puts the
  // file you start reading from where you expect it.
  const rest = Object.keys(workspace.files).filter(n => n !== workspace.entry).sort();
  return workspace.entry ? [workspace.entry, ...rest] : rest;
}

/** Open a project, replacing whatever is on screen. */
function openProject(project: Project): void {
  workspace = project;
  store.setCurrent(project.id);
  source.value = workspace.files[workspace.active] ?? '';
  projectName.textContent = project.name;
  renderFileBar();
  paint();
  clearOutput();
  render();
}

/** The project to show on load: the last one open, or a starting point. */
function restore(): Project {
  // Anything left in the pre-projects single workspace comes across first, so
  // upgrading the editor never costs someone their model.
  const migrated = store.migrateLegacy();
  if (migrated) return migrated;

  const existing = store.current();
  if (existing) return existing;

  const label = Object.keys(EXAMPLES)[0];
  const example = EXAMPLES[label];
  return store.create(nameFromModel(example.files[example.entry], 'My model'), example.files, example.entry);
}

function persist(): void {
  if (workspace.id) store.save(workspace);
}

// ---------------------------------------------------------------------------
// Syntax highlighting
// ---------------------------------------------------------------------------

/**
 * Above this many characters, stop colouring and show the plain text instead.
 *
 * Re-highlighting on every keystroke is fine for a model - the largest here is
 * a few kilobytes - but a pasted-in monster should degrade to a working editor
 * rather than a laggy one.
 */
/**
 * What "New project" starts from — just enough to be valid YAML, with a board
 * already set so the selector is not amber. The user builds up from here using
 * the Insert menu: hardware, devices, tasks, commands, state machine...
 */
const BLANK_MODEL = `# A new PulseIR model.
# Use Insert ▾ in the toolbar to add hardware, devices, tasks and logic.
pulseir: "1"

project:
  name: untitled
  version: "1.0"

target:
  board: esp32
`;

const HIGHLIGHT_LIMIT = 200_000;

let highlightingOn = true;

/**
 * Redraw the colour layer under the textarea.
 *
 * Not debounced: the text you see *is* this layer, so any delay would show the
 * caret moving over stale characters. It is a linear pass over a few kilobytes,
 * which is far cheaper than the parse and codegen that follow it.
 */
function paint(): void {
  const text = source.value;

  // Numbers first, and unconditionally: they stay useful on a file too big to
  // colour, and building them is trivial next to tokenizing the whole document.
  paintGutter();

  if (text.length > HIGHLIGHT_LIMIT) {
    if (highlightingOn) {
      highlightingOn = false;
      // Hand the text back to the textarea, or the editor would look empty.
      source.style.color = 'var(--text)';
      highlightLayer.hidden = true;
    }
    syncScroll();
    return;
  }

  if (!highlightingOn) {
    highlightingOn = true;
    source.style.color = '';
    highlightLayer.hidden = false;
  }

  // A trailing newline needs a line to sit on, or the last line of a
  // scrolled-to-the-bottom document has nothing beneath the caret.
  highlightCode.innerHTML = `${highlight(text)}\n`;
  syncScroll();
}

/**
 * Keep the colour layer and the numbers under the same part of the document as
 * the caret.
 *
 * By transform, not by setting scrollTop on them. scrollTop is clamped to the
 * element's own `scrollHeight - clientHeight`, and the textarea's client box is
 * shorter than the overlays' whenever it shows a scrollbar that consumes layout
 * space - which classic Windows scrollbars do and overlay ones do not. The
 * textarea could then scroll about 15px further than the layers beneath it
 * could follow, so near the bottom of a long file the text sat almost a line
 * away from the caret. A transform has no clamp.
 */
function syncScroll(): void {
  const x = source.scrollLeft;
  const y = source.scrollTop;
  highlightCode.style.transform = `translate(${-x}px, ${-y}px)`;
  // The gutter follows vertically only: numbers stay put while a long line
  // scrolls sideways past them.
  gutterLines.style.transform = `translateY(${-y}px)`;
}

/**
 * Line number of a parse failure in the *open* file, or null.
 *
 * A model can span several files and the parser reports against whichever one
 * failed, so a line number is only meaningful when that file is the one on
 * screen. Marking line 12 of machine.yaml while hardware.yaml is open would be
 * worse than marking nothing.
 */
let badLine: number | null = null;

/** Redraw the numbers. Cheap, and only the count and the bad line can change. */
function paintGutter(): void {
  const lines = source.value.split('\n').length;

  // Wide enough for the highest number, in a monospace font where 1ch is one
  // character exactly. A floor of two digits stops a short file from jittering
  // sideways as it crosses from 9 to 10 lines.
  const digits = Math.max(2, String(lines).length);
  document.documentElement.style.setProperty('--gutter-width', `calc(${digits}ch + 22px)`);

  const numbers: string[] = [];
  for (let n = 1; n <= lines; n++) {
    numbers.push(`<span class="ln${n === badLine ? ' bad' : ''}">${n}</span>`);
  }
  gutterLines.innerHTML = numbers.join('');
}

/** Mark, or clear, the line the parser objected to. */
function setBadLine(line: number | null): void {
  if (badLine === line) return;
  badLine = line;
  paintGutter();
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

function clearOutput(): void {
  current = null;
  for (const pane of Object.values(panes)) pane.innerHTML = '';
  setStale(false);
  setDownloadReady(false);
}

function setDownloadReady(ready: boolean): void {
  downloadButton.disabled = !ready;
  downloadButton.classList.toggle('ready', ready);
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
    const line = error instanceof ParseError && error.line !== undefined
      ? error.line + 1
      : null;

    // The parser reports against whichever file failed. Only mark a line when
    // that is the file on screen - the entry file is the one it starts from.
    setBadLine(line !== null && workspace.active === workspace.entry ? line : null);

    setStatus('error', `Model error${line !== null ? ` (line ${line})` : ''}`, message);
    if (current !== null) setStale(true);
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
    if (current !== null) setStale(true);
    return;
  }

  setBadLine(null);
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
  setDownloadReady(true);

  // Keep the board selector in sync with what the model actually declares.
  syncBoard(project.target?.board ?? '');
}

/**
 * Reflect the model's declared board in the selector UI without triggering a
 * re-render (the selector is read-only here — it follows the YAML, not vice versa).
 */
function syncBoard(board: string): void {
  boardSelect.value = board;
  boardSelect.classList.toggle('unset', board === '');
}

/**
 * Write a board selection back into the active file's YAML text.
 *
 * Three cases, handled in order:
 *   1. A `board:` line already exists → replace its value (or remove the line
 *      when clearing the selection, rather than leaving `board: `).
 *   2. A `target:` block exists but has no `board:` → inject after it.
 *   3. No `target:` block at all → inject one before `project:`.
 *
 * Text manipulation preserves comments and user formatting; re-serialising YAML
 * would silently erase them.
 */
function applyBoardToYaml(board: string): void {
  let text = source.value;

  if (/^[ \t]*board:/m.test(text)) {
    if (board === '') {
      // Remove the line entirely when clearing — an empty `board:` would warn.
      text = text.replace(/^[ \t]*board:.*\n?/m, '');
    } else {
      text = text.replace(/^([ \t]*board:).*$/m, `$1 ${board}`);
    }
  } else if (/^target:/m.test(text)) {
    // Target block exists, no board line — add one as the first item.
    text = text.replace(/^(target:.*)$/m, `$1\n  board: ${board}`);
  } else {
    // No target block at all — inject one just before `project:`.
    const m = /^project:/m.exec(text);
    if (m) {
      text = text.slice(0, m.index) + `target:\n  board: ${board}\n\n` + text.slice(m.index);
    } else {
      text = `target:\n  board: ${board}\n\n` + text;
    }
  }

  source.value = text;
  workspace.files[workspace.active] = text;
  paint();
}

// ---------------------------------------------------------------------------
// File actions
// ---------------------------------------------------------------------------

function selectFile(name: string): void {
  if (workspace.files[name] === undefined) return;
  workspace.active = name;
  source.value = workspace.files[name];
  paint();
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

  workspace.files[clean] = `# ${clean}
#
# Add this to the entry file's import list:
#   imports:
#     - ${clean}
`;
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
// Projects
// ---------------------------------------------------------------------------

function newProject(label?: string): void {
  const template = label ? EXAMPLES[label] : null;

  const files: Record<string, string> = template
    ? { ...template.files }
    : { 'pulse.yaml': BLANK_MODEL };
  const entry = template ? template.entry : 'pulse.yaml';
  const suggested = nameFromModel(files[entry], template ? label! : 'untitled');

  const name = prompt('Project name', store.uniqueName(suggested));
  if (!name?.trim()) return;

  openProject(store.create(name.trim(), files, entry));
}

function renameProject(): void {
  const name = prompt('Rename project', workspace.name);
  if (!name?.trim() || name.trim() === workspace.name) return;

  const renamed = store.rename(workspace.id, name.trim());
  if (renamed) openProject(renamed);
}

function duplicateProject(): void {
  persist();
  const copy = store.duplicate(workspace.id);
  if (copy) openProject(copy);
}

function deleteProject(): void {
  if (!confirm(`Delete the project "${workspace.name}"? This cannot be undone.`)) return;

  const next = store.remove(workspace.id);
  // Deleting the last project would leave nothing to edit, so start one.
  openProject(next ?? freshProject());
}

function freshProject(): Project {
  return store.create('untitled', { 'pulse.yaml': BLANK_MODEL }, 'pulse.yaml');
}

/** Export the open project as a folder, zipped. */
function exportProject(): void {
  persist();
  // Entries are prefixed with the project name so unzipping gives a folder
  // rather than scattering files into wherever it was unzipped.
  const folder = safeFolderName(workspace.name);
  const entries: Record<string, string> = {};
  for (const [name, text] of Object.entries(workspace.files)) {
    entries[`${folder}/${name}`] = text;
  }

  download(`${folder}.zip`, zip(entries), 'application/zip');
}

/** A name safe on every filesystem, and never empty. */
function safeFolderName(name: string): string {
  const clean = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return clean || 'model';
}

/**
 * Take a set of imported paths and open them as a new project.
 *
 * Shared by every import route - zip, folder picker, drag and drop - so they
 * cannot drift apart.
 */
function importFiles(paths: Record<string, string>, fallbackName: string): void {
  const { files, folder } = foldImport(paths);

  if (Object.keys(files).length === 0) {
    alert('No .yaml files in there. A PulseIR project is a folder of YAML models.');
    return;
  }

  const entry = findEntry(files)!;
  openProject(store.create(importedName(files, entry, folder, fallbackName), files, entry));

  if (!/^project:/m.test(files[entry])) {
    // Not fatal - it opens, and the status bar will say what is wrong - but
    // worth saying plainly, because the entry file was a guess.
    alert(
      `None of the imported files declares "project:", so "${entry}" was opened as the ` +
      'entry file. Use "Set entry" if that is the wrong one.'
    );
  }
}

async function importZipFile(file: File): Promise<void> {
  try {
    const entries = await unzip(new Uint8Array(await file.arrayBuffer()));
    const decoder = new TextDecoder();
    const paths: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(entries)) {
      paths[name] = decoder.decode(bytes);
    }
    importFiles(paths, file.name.replace(/\.zip$/i, ''));
  } catch (error) {
    alert(error instanceof ZipError ? error.message : `Could not read that zip: ${error}`);
  }
}

async function importFileList(list: FileList | File[], fallbackName: string): Promise<void> {
  const files = [...list];

  // A single zip is the export format; anything else is a set of loose files.
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    await importZipFile(files[0]);
    return;
  }

  const paths: Record<string, string> = {};
  for (const file of files) {
    // webkitRelativePath carries the folder structure a directory pick has;
    // a plain multi-file selection has only names.
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    paths[relative || file.name] = await file.text();
  }
  importFiles(paths, fallbackName);
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

/**
 * Put text on the clipboard and say so on the button itself.
 *
 * navigator.clipboard needs a secure context, which a file:// page is not, so
 * there is a fallback - otherwise Copy would silently do nothing for anyone who
 * opened index.html by double-clicking it.
 */
async function copyText(button: HTMLButtonElement, text: string): Promise<void> {
  const done = (ok: boolean) => {
    const original = button.textContent;
    button.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    button.classList.toggle('copied', ok);
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
    }, 1400);
  };

  try {
    await navigator.clipboard.writeText(text);
    done(true);
    return;
  } catch {
    // Fall through to the selection-based route below.
  }

  // Select it in a throwaway textarea so the keyboard shortcut works, and try
  // the legacy command in case the browser still honours it.
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  scratch.style.position = 'fixed';
  scratch.style.opacity = '0';
  document.body.append(scratch);
  scratch.select();

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  scratch.remove();
  done(ok);
}

/** What the visible output pane is showing, as text. */
function visibleOutput(): string {
  if (!current) return '';
  const showing = (Object.keys(panes) as (keyof typeof panes)[]).find(key => !panes[key].hidden);

  switch (showing) {
    case 'topics': return current.topics;
    case 'libraries': return current.libraries;
    // The structure pane is a rendered table, so copy what it is derived from.
    case 'structure': return panes.structure.innerText;
    default: return current.sketch;
  }
}

// ---------------------------------------------------------------------------
// Snippet menu
// ---------------------------------------------------------------------------

interface Snippet { label: string; group: string; yaml: string; }

const SNIPPETS: Snippet[] = [
  // ── Serial ───────────────────────────────────────────────────────────────
  { group: 'Serial', label: 'Console (UART 0 — USB serial monitor)',
    yaml:
`hardware:
  buses:
    console: { interface: uart, port: 0, baud: 115200 }

commands:
  source: console
  map:
    help: show_help`
  },
  { group: 'Serial', label: 'Extra UART (port 1)',
    yaml:
`hardware:
  buses:
    uart1: { interface: uart, port: 1, baud: 9600 }`
  },

  // ── Protocol ─────────────────────────────────────────────────────────────
  { group: 'Protocol', label: 'I²C bus',
    yaml:
`hardware:
  buses:
    i2c_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }`
  },
  { group: 'Protocol', label: 'SPI bus',
    yaml:
`hardware:
  buses:
    spi_bus: { interface: spi, sck: GPIO18, miso: GPIO19, mosi: GPIO23, cs: GPIO5 }`
  },
  { group: 'Protocol', label: 'Wi-Fi',
    yaml:
`hardware:
  buses:
    wifi: { interface: wifi, ssid: "YourSSID" }`
  },
  { group: 'Protocol', label: 'MQTT (over Wi-Fi)',
    yaml:
`hardware:
  buses:
    wifi: { interface: wifi, ssid: "YourSSID" }
    mqtt_bus: { interface: mqtt, host: "broker.example.com", port: 1883, prefix: "device" }`
  },

  // ── Device ───────────────────────────────────────────────────────────────
  { group: 'Device', label: 'Digital output  (LED, relay)',
    yaml:
`hardware:
  devices:
    led: { type: digital_output, pin: GPIO2 }`
  },
  { group: 'Device', label: 'Digital input  (button, switch)',
    yaml:
`hardware:
  devices:
    button: { type: digital_input, pin: GPIO0 }`
  },
  { group: 'Device', label: 'PWM output  (fan, motor, servo)',
    yaml:
`hardware:
  devices:
    fan: { type: pwm_output, pin: GPIO27, channel: 0, frequency: 25000 }`
  },
  { group: 'Device', label: 'Analog input  (sensor, potentiometer)',
    yaml:
`hardware:
  devices:
    sensor: { type: analog_input, pin: GPIO34, unit: V }`
  },

  // ── Logic ────────────────────────────────────────────────────────────────
  { group: 'Logic', label: 'Parameter  (tunable value)',
    yaml:
`parameters:
  interval_ms: { type: int, default: 1000, range: [100, 60000], unit: ms }`
  },
  { group: 'Logic', label: 'Task  (repeating work)',
    yaml:
`tasks:
  heartbeat:
    every: interval_ms
    do: my_action
    log: "running"
    description: Runs on a timer`
  },
  { group: 'Logic', label: 'Command table  (serial dispatch)',
    yaml:
`commands:
  source: console
  map:
    on:   led_on
    off:  led_off
    help: show_help`
  },
  { group: 'Logic', label: 'State machine  (basic toggle)',
    yaml:
`events:
  PRESS: { source: external }

machine:
  states:
    idle:
    active:
  transitions:
    - { from: idle,   on: PRESS, to: active }
    - { from: active, on: PRESS, to: idle }`
  },
];

/**
 * Insert a snippet at the end of the line the cursor is on, separated from
 * existing content by a blank line on each side. Inserts into the active file.
 */
function insertSnippet(yaml: string): void {
  const text = source.value;
  const pos = source.selectionStart ?? text.length;

  // End of the current line (or end of file).
  const lineEnd = text.indexOf('\n', pos);
  const insertAt = lineEnd === -1 ? text.length : lineEnd + 1;

  const before = text.slice(0, insertAt);
  const after  = text.slice(insertAt);

  const pad = (s: string) => (s.length > 0 && !s.endsWith('\n\n') ? '\n' : '');
  const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
  const inserted = pad(before) + yaml + '\n' + suffix;

  source.value = before + inserted + after;
  paint();
  const newPos = insertAt + inserted.length;
  source.selectionStart = source.selectionEnd = newPos;
  workspace.files[workspace.active] = source.value;
}

function closeSnippetMenu(): void {
  snippetMenu.hidden = true;
  snippetButton.setAttribute('aria-expanded', 'false');
}

function openSnippetMenu(): void {
  snippetMenu.replaceChildren();

  let lastGroup = '';
  for (const s of SNIPPETS) {
    if (s.group !== lastGroup) {
      if (lastGroup !== '') snippetMenu.append(separator());
      snippetMenu.append(heading(s.group));
      lastGroup = s.group;
    }
    snippetMenu.append(item(s.label, '', () => {
      closeSnippetMenu();
      insertSnippet(s.yaml);
      render();
      source.focus();
    }));
  }

  snippetMenu.hidden = false;
  snippetButton.setAttribute('aria-expanded', 'true');
}

// Project menu
// ---------------------------------------------------------------------------

function closeMenu(): void {
  projectMenu.hidden = true;
  projectButton.setAttribute('aria-expanded', 'false');
}

function item(label: string, sub: string, run: () => void, extra = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  if (extra) button.className = extra;
  button.innerHTML = `<span>${escapeHtml(label)}</span>${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ''}`;
  button.addEventListener('click', () => {
    closeMenu();
    run();
  });
  return button;
}

function separator(): HTMLDivElement {
  const line = document.createElement('div');
  line.className = 'sep';
  return line;
}

function heading(text: string): HTMLDivElement {
  const label = document.createElement('div');
  label.className = 'heading';
  label.textContent = text;
  return label;
}

function openMenu(): void {
  persist();
  projectMenu.replaceChildren();

  projectMenu.append(
    item('New project…', '', () => newProject()),
    item('Rename…', '', renameProject),
    item('Duplicate', '', duplicateProject),
    separator(),
    item('Import folder…', '', () => importFolderInput.click()),
    item('Import .zip…', '', () => importZipInput.click()),
    item('Export as .zip', '', exportProject),
    separator(),
  );

  const projects = store.list();
  projectMenu.append(heading(projects.length > 1 ? 'Recent projects' : 'Projects'));

  for (const project of projects) {
    projectMenu.append(item(
      project.name,
      project.id === workspace.id ? 'open' : `${Object.keys(project.files).length} file${
        Object.keys(project.files).length === 1 ? '' : 's'
      }`,
      () => { if (project.id !== workspace.id) openProject(project); },
      project.id === workspace.id ? 'current' : ''
    ));
  }

  projectMenu.append(separator(), item('Delete this project', '', deleteProject, 'danger'));

  projectMenu.hidden = false;
  projectButton.setAttribute('aria-expanded', 'true');
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

function download(filename: string, contents: string | Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([contents as BlobPart], { type }));
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
  // MQTT namespace input is only meaningful for the Topics pane.
  const showNs = name === 'topics';
  namespaceInput.hidden = !showNs;
  namespaceLabel.hidden = !showNs;
  localStorage.setItem('pulseir.tab', name);
}

function init(): void {
  for (const key of Object.keys(EXAMPLES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    exampleSelect.append(option);
  }

  openProject(restore());

  const rerender = debounce(render, 150);

  source.addEventListener('input', () => {
    workspace.files[workspace.active] = source.value;
    paint();
    rerender();
  });

  source.addEventListener('scroll', syncScroll, { passive: true });
  namespaceInput.addEventListener('input', rerender);

  boardSelect.addEventListener('change', () => {
    applyBoardToYaml(boardSelect.value);
    rerender();
  });

  // Picking a template starts a *new* project rather than overwriting the open
  // one, so browsing the examples can no longer cost someone their work.
  exampleSelect.addEventListener('change', () => {
    const label = exampleSelect.value;
    exampleSelect.value = '';
    if (EXAMPLES[label]) newProject(label);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    button.addEventListener('click', () => selectTab(button.dataset.tab as keyof typeof panes));
  }

  copyYamlButton.addEventListener('click', () => {
    void copyText(copyYamlButton, source.value);
  });
  copyOutputButton.addEventListener('click', () => {
    void copyText(copyOutputButton, visibleOutput());
  });

  $<HTMLButtonElement>('add-file').addEventListener('click', addFile);
  $<HTMLButtonElement>('set-entry').addEventListener('click', setEntry);

  // Download dropdown
  function closeDownloadMenu(): void {
    downloadMenu.hidden = true;
    downloadButton.setAttribute('aria-expanded', 'false');
  }

  downloadButton.addEventListener('click', event => {
    event.stopPropagation();
    if (downloadMenu.hidden) {
      downloadMenu.hidden = false;
      downloadButton.setAttribute('aria-expanded', 'true');
    } else {
      closeDownloadMenu();
    }
  });

  $<HTMLButtonElement>('download-sketch').addEventListener('click', () => {
    closeDownloadMenu();
    if (!current) return;
    download(`${current.project.name}.ino`, current.sketch, 'text/plain');
  });
  $<HTMLButtonElement>('download-topics').addEventListener('click', () => {
    closeDownloadMenu();
    if (!current) return;
    download('topics.json', current.topics, 'application/json');
  });
  $<HTMLButtonElement>('download-libraries').addEventListener('click', () => {
    closeDownloadMenu();
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
    paint();
    rerender();
  });

  projectButton.addEventListener('click', event => {
    event.stopPropagation();
    if (projectMenu.hidden) openMenu();
    else closeMenu();
  });

  snippetButton.addEventListener('click', event => {
    event.stopPropagation();
    if (snippetMenu.hidden) openSnippetMenu();
    else closeSnippetMenu();
  });

  // Clicking anywhere else, or pressing Escape, dismisses all menus.
  document.addEventListener('click', event => {
    if (!projectMenu.hidden && !projectMenu.contains(event.target as Node)) closeMenu();
    if (!snippetMenu.hidden && !snippetMenu.contains(event.target as Node)) closeSnippetMenu();
    if (!downloadMenu.hidden && !downloadMenu.contains(event.target as Node) &&
        event.target !== downloadButton) closeDownloadMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !projectMenu.hidden) closeMenu();
    if (event.key === 'Escape' && !snippetMenu.hidden) closeSnippetMenu();
    if (event.key === 'Escape' && !downloadMenu.hidden) closeDownloadMenu();
  });

  importZipInput.addEventListener('change', () => {
    const file = importZipInput.files?.[0];
    // Reset first, so picking the same file twice still fires a change event.
    importZipInput.value = '';
    if (file) void importZipFile(file);
  });

  importFolderInput.addEventListener('change', () => {
    const files = importFolderInput.files;
    const picked = files ? [...files] : [];
    importFolderInput.value = '';
    if (picked.length) void importFileList(picked, 'imported');
  });

  // Dropping a folder or a zip on the page imports it - the shortest route
  // from "I have a model on disk" to "it is open".
  let dragDepth = 0;
  document.addEventListener('dragenter', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragDepth++;
    document.body.classList.add('dropping');
  });
  document.addEventListener('dragover', event => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  document.addEventListener('dragleave', () => {
    // dragleave fires for every child element, so count rather than clear.
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('dropping');
  });
  document.addEventListener('drop', event => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    void importFileList(event.dataTransfer.files, 'dropped');
  });

  selectTab((localStorage.getItem('pulseir.tab') as keyof typeof panes) || 'sketch');
}

init();
