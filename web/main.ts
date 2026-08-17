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
import type { GeneratedProject } from '../src/codegen/index.js';
import { TopicEmitter } from '../src/emit/topics.js';
import { LibraryEmitter } from '../src/emit/libraries.js';
import { flattenStates, resolveEntryLeaf, resolvePath } from '../src/analysis/states.js';
import { Validator } from '../src/analysis/validate.js';
import type { ValidationResult } from '../src/analysis/validate.js';
import { highlight, DEFAULT_KEYWORDS } from './highlight.js';
import { highlightCpp } from './highlight-cpp.js';
import { ProjectStore, foldImport, findEntry, importedName, nameFromModel } from './projects.js';
import type { Project } from './projects.js';
import { zip, unzip, ZipError } from './zip.js';
import { PULSEHSM_H, PULSEHSM_CPP } from './pulsehsm-sources.js';
import type { PulseProject, Resource } from '../src/model/index.js';
import { EXAMPLES } from './examples.js';

/**
 * Auto-correct the common typo of omitting the space after a colon in a
 * mapping entry, e.g. `board:esp32` → `board: esp32`.
 *
 * Applied both to the textarea (so the user sees the correction) and before
 * parsing. Cursor position is restored by measuring how many spaces were
 * inserted before the selection endpoints.
 *
 * Safe guards:
 *  - Only matches `letter/underscore word : non-space` (keys can't start
 *    with a digit, so `12:30` timestamps are skipped).
 *  - The non-space character after the colon must not be `/` (avoids
 *    mangling `://` in URLs) or `:` itself.
 *  - Applied line by line; lines that start with `#` after trimming
 *    (whole-line comments) are skipped entirely.
 */
function normalizeYaml(source: string): string {
  return source
    .split('\n')
    .map(line => {
      if (line.trimStart().startsWith('#')) return line;
      return line.replace(/([a-zA-Z_]\w*):([^\s\n:/])/g, '$1: $2');
    })
    .join('\n');
}

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
const themeButton = $<HTMLButtonElement>('theme-button');
const mqttTab = $<HTMLButtonElement>('tab-topics');
const settingsButton = $<HTMLButtonElement>('settings-button');
const settingsModal = $<HTMLDivElement>('settings-modal');
const keywordChips = $<HTMLDivElement>('keyword-chips');
const keywordInput = $<HTMLInputElement>('keyword-input');
const modeModelBtn = $<HTMLButtonElement>('mode-model');
const modeCodeBtn = $<HTMLButtonElement>('mode-code');
const setEntryButton = $<HTMLButtonElement>('set-entry');
const genStubsButton = $<HTMLButtonElement>('gen-stubs');

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

/**
 * Which set of files the editor is showing.
 *
 * 'model' — the YAML files the parser consumes.
 * 'code'  — the user's hand-written C++ files (.cpp / .h / .c).
 *
 * The two families live together in workspace.files, distinguished purely by
 * extension. The parser never sees the C++ files; the code editor never touches
 * the YAML ones. Switching mode just changes which tabs are visible and which
 * highlighter is used.
 */
let currentMode: 'model' | 'code' = 'model';

/** Last successful render, so downloads never hand over a broken file. */
let current: { project: PulseProject; sketch: string; topics: string; libraries: string; generatedProject: GeneratedProject } | null = null;

function fileNames(): string[] {
  if (currentMode === 'code') {
    return Object.keys(workspace.files).filter(n => /\.(cpp|h|c)$/i.test(n)).sort();
  }
  // Model mode: YAML files only, entry first.
  const rest = Object.keys(workspace.files)
    .filter(n => n !== workspace.entry && /\.(ya?ml)$/i.test(n))
    .sort();
  return workspace.entry ? [workspace.entry, ...rest] : rest;
}

/** Open a project, replacing whatever is on screen. */
function openProject(project: Project): void {
  workspace = project;
  currentMode = 'model';
  store.setCurrent(project.id);
  projectName.textContent = project.name;
  modeModelBtn.classList.add('active');
  modeCodeBtn.classList.remove('active');
  setEntryButton.hidden = false;
  snippetButton.hidden = false;
  genStubsButton.hidden = true;
  source.value = workspace.files[workspace.active] ?? '';
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
  const isCpp = /\.(cpp|h|c)$/i.test(workspace.active);
  highlightCode.innerHTML = isCpp
    ? `${highlightCpp(text)}\n`
    : `${highlight(text, activeKeywords)}\n`;
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
 * Prepend right-aligned line numbers to already-highlighted HTML.
 *
 * Each number is wrapped in a span with user-select:none so copy-paste
 * gives clean code without numbers in the clipboard.
 */
function withLineNumbers(html: string): string {
  const lines = html.split('\n');
  const width = String(lines.length).length;
  return lines
    .map((line, i) => `<span class="ln-num">${String(i + 1).padStart(width)}</span> ${line}`)
    .join('\n');
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
  setMqttTabVisible(false);
}

function setDownloadReady(ready: boolean): void {
  downloadButton.disabled = !ready;
  downloadButton.classList.toggle('ready', ready);
}

/**
 * Show or hide the MQTT topics tab.
 *
 * The tab is only relevant when the model declares an MQTT bus. Hiding it
 * when MQTT is absent avoids confusing users who haven't added it yet —
 * an empty topics document looks like an error, but it just means
 * "nothing to emit".
 */
function setMqttTabVisible(visible: boolean): void {
  const wasActive = !panes.topics.hidden;
  mqttTab.hidden = !visible;

  // If the tab was active and is now hidden, fall back to the Sketch tab
  // so the user is not left looking at a hidden pane.
  if (wasActive && !visible) {
    selectTab('sketch');
  }
  // If just made visible and nothing else is active, make it active.
  if (visible && !wasActive && panes.sketch.hidden) {
    selectTab('topics');
  }
}

/**
 * Render a getting-started guide in the Sketch pane when the model is valid
 * but has no machine/tasks/commands yet. This replaces the generic red error
 * with actionable next steps.
 */
function showGuide(): void {
  // Monochromatic SVG icons — use currentColor so they follow the card's text colour.
  const machineIcon = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="5" cy="11" r="3.5"/>
    <circle cx="17" cy="11" r="3.5"/>
    <path d="M8.5 11h5"/>
    <path d="M12 8.5l2.5 2.5-2.5 2.5"/>
  </svg>`;
  const tasksIcon = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 11A7 7 0 1 1 11 4"/>
    <path d="M11 1.5l3.5 3.5-3.5 3.5"/>
  </svg>`;
  const commandsIcon = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="4 6 10 11 4 16"/>
    <line x1="13" y1="16" x2="18" y2="16"/>
  </svg>`;

  const cards: { icon: string; label: string; desc: string }[] = [
    {
      icon: machineIcon,
      label: 'machine:',
      desc: 'State machine — define states and the events that move between them. Use Insert ▾ → Logic → State machine.',
    },
    {
      icon: tasksIcon,
      label: 'tasks:',
      desc: 'Repeating background work — read a sensor, blink an LED, publish MQTT. Use Insert ▾ → Logic → Task.',
    },
    {
      icon: commandsIcon,
      label: 'commands:',
      desc: 'Serial command dispatch — map text commands arriving over UART to actions. Use Insert ▾ → Logic → Command table.',
    },
  ];

  const cardHtml = cards.map(c => `
    <div class="guide-card">
      <div class="guide-card-icon">${c.icon}</div>
      <div class="guide-card-label"><code>${escapeHtml(c.label)}</code></div>
      <p class="guide-card-desc">${escapeHtml(c.desc)}</p>
    </div>`).join('');

  panes.sketch.innerHTML = `
    <div class="guide">
      <p class="guide-title">✓ Project setup complete</p>
      <p class="guide-sub">Your project, board, and version are configured. Add at least one of these sections to generate code:</p>
      <div class="guide-cards">${cardHtml}</div>
      <p class="guide-hint">
        Tip: use the <kbd>Insert ▾</kbd> button in the toolbar to add any of these with a single click.
      </p>
    </div>`;
}

function setStatus(kind: 'ok' | 'warn' | 'error' | 'info', title: string, detail = ''): void {
  status.className = `status ${kind}`;
  const detailHtml = detail
    ? `<span>${escapeHtml(detail).replace(/\n/g, '<br>')}</span>`
    : '';
  status.innerHTML = `<strong>${escapeHtml(title)}</strong>${detailHtml}`;
}

function renderFileBar(): void {
  const names = fileNames();

  if (names.length === 0 && currentMode === 'code') {
    fileBar.innerHTML = '<span class="filebar-hint">No C++ files yet — click + File to add one</span>';
  } else {
    fileBar.innerHTML = names.map(name => {
      // In model mode the entry file cannot be closed; in code mode every file can be.
      const isEntry = currentMode === 'model' && name === workspace.entry;
      const isActive = name === workspace.active;
      const badge = isEntry ? '<span class="entry-badge" title="entry file">▶</span>' : '';
      const close = !isEntry
        ? `<span class="close" data-close="${escapeHtml(name)}" title="Delete ${escapeHtml(name)}">×</span>`
        : '';
      return `<button class="filetab${isActive ? ' active' : ''}" data-file="${escapeHtml(name)}"
        title="${escapeHtml(name)} (double-click to rename)">${badge}${escapeHtml(name)}${close}</button>`;
    }).join('');
  }

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

// ---------------------------------------------------------------------------
// Hardware diagram
// ---------------------------------------------------------------------------

const IFACE_COLOR: Record<string, string> = {
  i2c:      '#3b82f6',
  spi:      '#7c3aed',
  uart:     '#059669',
  gpio:     '#d97706',
  pwm:      '#ea580c',
  adc:      '#dc2626',
  wifi:     '#0891b2',
  ethernet: '#0284c7',
  ble:      '#6d28d9',
  mqtt:     '#0ea5e9',
  can:      '#b45309',
  onewire:  '#15803d',
  eeprom:   '#4f46e5',
  littlefs: '#0f766e',
  custom:   '#6b7280',
};

const PIN_KEYS: Record<string, string[]> = {
  i2c:      ['sda', 'scl', 'frequency', 'address'],
  spi:      ['sck', 'miso', 'mosi', 'cs'],
  uart:     ['port', 'rx', 'tx', 'baud'],
  gpio:     ['pin', 'mode'],
  pwm:      ['pin', 'channel', 'frequency'],
  adc:      ['pin'],
  wifi:     ['ssid', 'hostname'],
  ethernet: ['cs', 'mac'],
  ble:      ['name'],
  mqtt:     ['host', 'port', 'prefix'],
  can:      ['tx', 'rx', 'bitrate'],
  onewire:  ['pin'],
  eeprom:   ['size'],
  littlefs: ['format_on_fail'],
  custom:   [],
};

function pinSummary(resource: Resource): string {
  const kind = String(resource.interface);
  const keys = PIN_KEYS[kind] ?? [];
  const binding = resource.binding ?? {};
  return keys
    .filter(k => binding[k] !== undefined)
    .slice(0, 4)
    .map(k => `${k.toUpperCase()}:${String(binding[k])}`)
    .join('  ');
}

/**
 * Inline SVG wiring diagram: buses (resources) on the left, the board in the
 * centre, components on the right. Line colour encodes interface type.
 * Returns an empty string when there is nothing to draw.
 */
function renderHardwareDiagram(project: PulseProject): string {
  const resources = project.system.resources ?? [];
  const components = project.system.components ?? [];
  if (resources.length === 0 && components.length === 0) return '';

  const ROW = 80, NH = 60, NW = 195, PAD = 20;
  const BX = 270, BW = 180;
  const CX = 515;
  const SVG_W = 720;
  const rows = Math.max(resources.length, components.length, 1);
  const SVG_H = rows * ROW + PAD * 2;
  const boardLabel = escapeHtml(project.target?.board ?? 'Board');
  const resMap = new Map(resources.map((r, i) => [r.name, i]));

  const p: string[] = [];

  // Board rect
  p.push(
    `<rect x="${BX}" y="${PAD / 2}" width="${BW}" height="${SVG_H - PAD / 2}" rx="8"` +
    ` style="fill:var(--panel);stroke:var(--border);stroke-width:1.5"/>`
  );
  p.push(
    `<text x="${BX + BW / 2}" y="${PAD / 2 + 16}" text-anchor="middle"` +
    ` style="font-size:11px;font-weight:600;fill:var(--dim)">${boardLabel}</text>`
  );

  // Resources (left column)
  for (let i = 0; i < resources.length; i++) {
    const r = resources[i];
    const kind = String(r.interface);
    const color = IFACE_COLOR[kind] ?? '#6b7280';
    const ny = PAD + i * ROW;
    const cy = ny + NH / 2;

    p.push(
      `<rect x="10" y="${ny}" width="${NW}" height="${NH}" rx="6"` +
      ` style="fill:var(--bg);stroke:${color};stroke-width:1.5"/>`
    );
    p.push(
      `<text x="18" y="${ny + 20}"` +
      ` style="font-size:12px;font-weight:600;fill:var(--text)">${escapeHtml(r.name)}</text>`
    );
    p.push(
      `<text x="18" y="${ny + 36}"` +
      ` style="font-size:10px;font-weight:500;fill:${color}">${kind}</text>`
    );
    const pins = pinSummary(r);
    if (pins) {
      p.push(
        `<text x="18" y="${ny + 52}"` +
        ` style="font-size:9px;font-family:monospace,monospace;fill:var(--dim)">${escapeHtml(pins)}</text>`
      );
    }

    // Connector: resource right edge → board left edge
    p.push(`<line x1="${10 + NW}" y1="${cy}" x2="${BX}" y2="${cy}" style="stroke:${color};stroke-width:1.5"/>`);
    p.push(`<circle cx="${BX}" cy="${cy}" r="3" style="fill:${color}"/>`);
  }

  // Components (right column)
  for (let j = 0; j < components.length; j++) {
    const c = components[j];
    const ny = PAD + j * ROW;
    const cy = ny + NH / 2;

    // Inherit colour from the bus this component sits on, if declared
    let color: string | null = null;
    if (c.bus) {
      const ri = resMap.get(c.bus);
      if (ri !== undefined) {
        const kind = String(resources[ri].interface);
        color = IFACE_COLOR[kind] ?? null;
      }
    }
    const strokeColor = color ?? 'var(--border)';
    const lineColor   = color ?? 'var(--dim)';

    p.push(
      `<rect x="${CX}" y="${ny}" width="${NW}" height="${NH}" rx="6"` +
      ` style="fill:var(--bg);stroke:${strokeColor};stroke-width:1.5"/>`
    );
    p.push(
      `<text x="${CX + NW - 12}" y="${ny + 20}" text-anchor="end"` +
      ` style="font-size:12px;font-weight:600;fill:var(--text)">${escapeHtml(c.name)}</text>`
    );
    const sub = c.bus ? `bus: ${c.bus}` : (c.driver ?? '');
    if (sub) {
      p.push(
        `<text x="${CX + NW - 12}" y="${ny + 36}" text-anchor="end"` +
        ` style="font-size:10px;fill:var(--dim)">${escapeHtml(sub)}</text>`
      );
    }
    if (c.type) {
      p.push(
        `<text x="${CX + NW - 12}" y="${ny + 52}" text-anchor="end"` +
        ` style="font-size:9px;font-family:monospace,monospace;fill:var(--dim)">${escapeHtml(c.type)}</text>`
      );
    }

    // Connector: board right edge → component left edge (dashed when no bus match)
    const dash = color ? '' : ' stroke-dasharray="4 3"';
    p.push(`<line x1="${BX + BW}" y1="${cy}" x2="${CX}" y2="${cy}" style="stroke:${lineColor};stroke-width:1.5"${dash}/>`);
    p.push(`<circle cx="${BX + BW}" cy="${cy}" r="3" style="fill:${lineColor}"/>`);
  }

  return `
    <h3>Hardware diagram</h3>
    <p class="hint">Resources (buses) on the left connect to the board. Components on the right inherit their line colour from the bus they sit on.</p>
    <div style="overflow-x:auto">
      <svg viewBox="0 0 ${SVG_W} ${SVG_H}" role="img"
           aria-label="Hardware wiring diagram for ${boardLabel}"
           style="max-width:100%;height:auto;display:block;min-width:480px">
        ${p.join('\n        ')}
      </svg>
    </div>`;
}

function renderDiagnostics(result: ValidationResult): string {
  if (result.diagnostics.length === 0) return '';

  const items = result.diagnostics.map(d => {
    const cls = d.severity === 'error' ? 'error' : 'warn';
    return (
      `<li class="${cls}">` +
      `<span class="diag-code">${escapeHtml(d.code)}</span>` +
      `<span>${escapeHtml(d.message)}</span>` +
      `</li>`
    );
  }).join('');

  const title = [
    result.errorCount > 0 ? `${result.errorCount} error${result.errorCount !== 1 ? 's' : ''}` : '',
    result.warningCount > 0 ? `${result.warningCount} warning${result.warningCount !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ');

  return `<h3>Problems <span style="text-transform:none;letter-spacing:0;font-size:11px">(${title})</span></h3><ul class="problems">${items}</ul>`;
}

/**
 * The structure pane exists to make the two rules students get wrong visible:
 * entering a composite state descends to its initial child, and a transition
 * on an enclosing state applies to everything inside it.
 */
function renderStructure(project: PulseProject, validation: ValidationResult): string {
  const { system } = project;
  const flat = flattenStates(system.states);
  const sections: string[] = [];

  const problems = renderDiagnostics(validation);
  if (problems) sections.push(problems);

  const diagram = renderHardwareDiagram(project);
  if (diagram) sections.push(diagram);

  // ── State hierarchy ──────────────────────────────────────────────────────
  if (flat.length > 0) {
    const tree = flat
      .filter(s => s.depth === 0)
      .map(s => renderStateNode(s.path, flat))
      .join('');
    sections.push(`
      <h3>State hierarchy</h3>
      <p class="hint">A machine only ever rests in a <em>leaf</em>. Entering a
      composite state descends to its initial child, marked ▸.</p>
      <div class="tree">${tree}</div>`);
  }

  // ── Transitions ──────────────────────────────────────────────────────────
  if (system.transitions.length > 0) {
    const rows = system.transitions.map(t => {
      const targetPath = t.target !== undefined ? resolvePath(system.states, t.target) : null;
      const leaf = targetPath ? resolveEntryLeaf(system.states, targetPath) : null;
      const descends = leaf && targetPath && leaf !== targetPath;
      const target = t.target === undefined
        ? '<span class="tag">stays</span>'
        : descends
          ? `${escapeHtml(t.target)} <span class="arrow">↳</span> <code>${escapeHtml(leaf!)}</code>`
          : escapeHtml(t.target);
      const guard = t.guard ? `<code>${escapeHtml(t.guard.name)}</code>` : '<span class="dim">—</span>';
      const actions = t.actions?.length
        ? t.actions.map(a => `<code>${escapeHtml(a.name)}</code>`).join(' ')
        : '<span class="dim">—</span>';
      const src = t.source === '*'
        ? '<span class="tag wild">any state</span>'
        : `<code>${escapeHtml(t.source)}</code>`;
      const trigger = t.event !== undefined
        ? `<code>${escapeHtml(t.event)}</code>`
        : t.every !== undefined
          ? `<span class="tag timer">every</span> <code>${escapeHtml(String(t.every))}</code>`
          : `<span class="tag timer">after</span> <code>${escapeHtml(String(t.after))}</code>`;
      return `<tr><td>${src}</td><td>${trigger}</td><td>${target}</td><td>${guard}</td><td>${actions}</td></tr>`;
    }).join('');
    sections.push(`
      <h3>Transitions</h3>
      <p class="hint">A transition on an enclosing state also applies to its
      children, and an inner transition on the same event wins.</p>
      <table>
        <thead><tr><th>From</th><th>Trigger</th><th>To</th><th>Guard</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  // ── Interfaces (buses / hardware) ────────────────────────────────────────
  const resources = system.resources ?? [];
  if (resources.length > 0) {
    const rows = resources.map(r => `<tr>
        <td><code>${escapeHtml(r.name)}</code></td>
        <td><span class="tag">${escapeHtml(String(r.interface))}</span></td>
        <td>${Object.entries(r.binding ?? {})
          .map(([k, v]) => `<code>${escapeHtml(k)}=${escapeHtml(String(v))}</code>`)
          .join(' ') || '<span class="dim">—</span>'}</td>
      </tr>`).join('');
    sections.push(`
      <h3>Interfaces</h3>
      <table>
        <thead><tr><th>Resource</th><th>Interface</th><th>Binding</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  // ── Commands ─────────────────────────────────────────────────────────────
  const cmdSet = system.commands;
  if (cmdSet?.commands?.length) {
    const rows = cmdSet.commands.map(c => {
      const acts = c.actions?.length
        ? c.actions.map(a => `<code>${escapeHtml(a.name)}</code>`).join(' ')
        : '<span class="dim">—</span>';
      const ev = c.event ? `<code>${escapeHtml(c.event)}</code>` : '<span class="dim">—</span>';
      const reply = c.log ? `<code>${escapeHtml(c.log)}</code>` : '<span class="dim">—</span>';
      return `<tr><td><code>${escapeHtml(c.match)}</code></td><td>${acts}</td><td>${ev}</td><td>${reply}</td></tr>`;
    }).join('');
    const src = cmdSet.source
      ? ` <span class="dim">— source: <code>${escapeHtml(cmdSet.source)}</code></span>`
      : '';
    sections.push(`
      <h3>Commands${src}</h3>
      <table>
        <thead><tr><th>Command</th><th>Actions</th><th>Event</th><th>Reply</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  const tasks = system.tasks ?? [];
  if (tasks.length > 0) {
    const rows = tasks.map(t => {
      const acts = t.actions.length
        ? t.actions.map(a => `<code>${escapeHtml(a.name)}</code>`).join(' ')
        : '<span class="dim">—</span>';
      const log = t.log ? `<code>${escapeHtml(t.log)}</code>` : '<span class="dim">—</span>';
      return `<tr><td><code>${escapeHtml(t.name)}</code></td><td><code>${escapeHtml(String(t.every))}</code> ms</td><td>${acts}</td><td>${log}</td></tr>`;
    }).join('');
    sections.push(`
      <h3>Tasks</h3>
      <table>
        <thead><tr><th>Name</th><th>Interval</th><th>Actions</th><th>Log</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  // ── Parameters ───────────────────────────────────────────────────────────
  const parameters = system.parameters ?? [];
  if (parameters.length > 0) {
    const rows = parameters.map(p => {
      const range = p.min !== undefined && p.max !== undefined
        ? `<code>${escapeHtml(String(p.min))}–${escapeHtml(String(p.max))}</code>`
        : '<span class="dim">—</span>';
      const unit = p.unit ? `<code>${escapeHtml(p.unit)}</code>` : '<span class="dim">—</span>';
      return `<tr><td><code>${escapeHtml(p.name)}</code></td><td><span class="tag">${escapeHtml(p.type)}</span></td><td><code>${escapeHtml(String(p.default))}</code></td><td>${range}</td><td>${unit}</td></tr>`;
    }).join('');
    sections.push(`
      <h3>Parameters</h3>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Range</th><th>Unit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  if (sections.length === 0) {
    return '<p class="dim" style="padding:16px 20px">Nothing to show yet — add hardware:, tasks:, commands:, or machine: to populate this view.</p>';
  }

  return sections.join('\n');
}

function renderStateNode(path: string, flat: ReturnType<typeof flattenStates>): string {
  const node = flat.find(s => s.path === path)!;
  const children = flat.filter(s => s.parentPath === path);

  const label = escapeHtml(node.state.name);
  const isInitial = flat.some(s => s.initialChildPath === path);
  const marker = isInitial ? '<span class="initial" title="initial child">▸</span>' : '';

  const entryActions = (node.state.entry ?? []).map(a =>
    `<span class="tag" title="entry action">↳ ${escapeHtml(a.name)}</span>`).join(' ');
  const exitActions  = (node.state.exit  ?? []).map(a =>
    `<span class="tag" title="exit action">↱ ${escapeHtml(a.name)}</span>`).join(' ');
  const hooks = entryActions || exitActions
    ? `<span class="state-hooks">${entryActions}${exitActions}</span>`
    : '';

  if (node.isLeaf) {
    return `<div class="state leaf">${marker}<span>${label}</span>${hooks}</div>`;
  }

  return `<div class="state composite">
    <div class="state-name">${marker}<span>${label}</span>
      <span class="tag">composite</span>${hooks}</div>
    <div class="children">${children.map(c => renderStateNode(c.path, flat)).join('')}</div>
  </div>`;
}

function render(): void {
  persist();

  // Sync the board selector from raw text so it stays correct even when the
  // model has validation errors (e.g. a blank new project that hasn't been
  // built yet). The accurate post-parse sync at the end of this function
  // still runs on success.
  const entryText = workspace.files[workspace.entry] ?? '';
  const rawBoard = /^[ \t]*board:\s*(\S+)/m.exec(entryText)?.[1] ?? '';
  syncBoard(rawBoard);

  let project: PulseProject;
  const parser = new Parser();
  try {
    // The open buffers are the filesystem, so an import between tabs resolves
    // the same way it does on disk. Normalize first so a missing space after
    // a colon (board:esp32) is silently corrected before the YAML parser sees it.
    const normalizedFiles = Object.fromEntries(
      Object.entries(workspace.files).map(([k, v]) => [k, normalizeYaml(v)])
    );
    const resolver = new MemoryResolver(normalizedFiles);
    project = parser.parseFrom(workspace.entry, resolver);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const line = error instanceof ParseError && error.line !== undefined
      ? error.line + 1
      : null;

    // An empty-model error means the project is structurally valid but has no
    // content to generate yet. Show a guide rather than a red error message.
    if (error instanceof ParseError && error.kind === 'empty-model') {
      setBadLine(null);
      clearOutput();
      showGuide();
      setStatus('info', `${workspace.name} — project ready`, 'Add machine:, tasks:, or commands: to generate code.');
      return;
    }

    // The parser reports against whichever file failed. Only mark a line when
    // that is the file on screen - the entry file is the one it starts from.
    setBadLine(line !== null && workspace.active === workspace.entry ? line : null);

    // ParseError = semantic problem our parser caught; anything else is a raw
    // YAML syntax error from js-yaml (bad indentation, unexpected token, etc.).
    const kind = error instanceof ParseError ? 'Model error' : 'YAML syntax error';
    setStatus('error', `${kind}${line !== null ? ` (line ${line})` : ''}`, message);
    if (current !== null) setStale(true);
    return;
  }

  let sketch: string;
  let generatedProject: GeneratedProject;
  let topics: string;
  let libraries: string;
  try {
    sketch = new Codegen().generate(project);
    generatedProject = new Codegen().generateFiles(project);
    topics = new TopicEmitter().toJSON(project, namespaceInput.value.trim() || undefined);
    libraries = new LibraryEmitter().toJSON(project);
  } catch (error) {
    setStatus('error', 'Generation error', error instanceof Error ? error.message : String(error));
    if (current !== null) setStale(true);
    return;
  }

  setBadLine(null);
  setStale(false);

  const validation = new Validator().validate(project, parser.warnings);

  panes.sketch.innerHTML = `<pre><code>${withLineNumbers(highlightCpp(sketch))}</code></pre>`;
  panes.topics.innerHTML = `<pre><code>${withLineNumbers(escapeHtml(topics))}</code></pre>`;
  panes.libraries.innerHTML = `<pre><code>${withLineNumbers(escapeHtml(libraries))}</code></pre>`;
  panes.structure.innerHTML = renderStructure(project, validation);

  const fileCount = Object.keys(workspace.files).length;
  const counts = [
    fileCount > 1 ? `${fileCount} files` : null,
    `${project.system.events.length} events`,
    `${project.system.transitions.length} transitions`,
    `${(project.system.resources || []).length} resources`,
    `${sketch.split('\n').length} lines generated`,
  ].filter(Boolean).join(' · ');

  const wc = validation.warningCount;
  if (wc > 0) {
    setStatus('warn', project.name, `${counts} · ${wc} warning${wc !== 1 ? 's' : ''} — see Structure tab`);
  } else {
    setStatus('ok', project.name, counts);
  }

  current = { project, sketch, topics, libraries, generatedProject };
  setDownloadReady(true);

  // MQTT topics tab is only meaningful when the model has an MQTT bus.
  const hasMqtt = (project.system.resources ?? []).some(r => String(r.interface) === 'mqtt');
  setMqttTabVisible(hasMqtt);

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

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

type Theme = 'auto' | 'light' | 'dark';

const THEME_KEY = 'pulseir.theme';

const THEME_ICONS: Record<Theme, string> = {
  auto: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <path d="M8 2v12M2 8h12" opacity=".35"/>
    <path fill="currentColor" stroke="none" d="M8 2a6 6 0 0 1 0 12V2z"/>
    <circle cx="8" cy="8" r="6"/>
  </svg>`,
  light: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <circle cx="8" cy="8" r="3"/>
    <line x1="8" y1="1" x2="8" y2="2.5"/>
    <line x1="8" y1="13.5" x2="8" y2="15"/>
    <line x1="1" y1="8" x2="2.5" y2="8"/>
    <line x1="13.5" y1="8" x2="15" y2="8"/>
    <line x1="3.05" y1="3.05" x2="4.1" y2="4.1"/>
    <line x1="11.9" y1="11.9" x2="12.95" y2="12.95"/>
    <line x1="12.95" y1="3.05" x2="11.9" y2="4.1"/>
    <line x1="4.1" y1="11.9" x2="3.05" y2="12.95"/>
  </svg>`,
  dark: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <path d="M13.5 10A6 6 0 0 1 6 2.5a5.5 5.5 0 1 0 7.5 7.5z"/>
  </svg>`,
};

const THEME_LABELS: Record<Theme, string> = {
  auto: 'Theme: auto (follows system)',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
  themeButton.innerHTML = THEME_ICONS[theme];
  themeButton.title = THEME_LABELS[theme];
}

function cycleTheme(): void {
  const current = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'auto';
  const next: Theme = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ---------------------------------------------------------------------------
// Keyword registry
// ---------------------------------------------------------------------------

const KEYWORD_STORAGE_KEY = 'pulseir.keywords';

function loadKeywords(): Set<string> {
  const raw = localStorage.getItem(KEYWORD_STORAGE_KEY);
  if (!raw) return new Set(DEFAULT_KEYWORDS);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
      return new Set(parsed as string[]);
    }
  } catch { /* fall through */ }
  return new Set(DEFAULT_KEYWORDS);
}

function saveKeywords(): void {
  localStorage.setItem(KEYWORD_STORAGE_KEY, JSON.stringify([...activeKeywords].sort()));
}

let activeKeywords: Set<string> = loadKeywords();

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------

function renderKeywordChips(): void {
  keywordChips.replaceChildren();
  for (const word of [...activeKeywords].sort()) {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    const label = document.createElement('code');
    label.textContent = word;
    const remove = document.createElement('button');
    remove.className = 'chip-remove';
    remove.title = `Remove '${word}'`;
    remove.setAttribute('aria-label', `Remove ${word}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      activeKeywords.delete(word);
      saveKeywords();
      renderKeywordChips();
      paint();
    });
    chip.append(label, remove);
    keywordChips.append(chip);
  }
}

function addKeyword(): void {
  const word = keywordInput.value.trim();
  if (!word) return;
  activeKeywords.add(word);
  saveKeywords();
  renderKeywordChips();
  keywordInput.value = '';
  keywordInput.focus();
  paint();
}

function openSettings(): void {
  renderKeywordChips();
  settingsModal.hidden = false;
  keywordInput.value = '';
  keywordInput.focus();
}

function closeSettings(): void {
  settingsModal.hidden = true;
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

/**
 * Splice `filename` into the entry file's `imports:` list.
 *
 * Three cases:
 *   1. `imports:` list already exists → append a new item.
 *   2. No list but `project:` block exists → insert `imports:` after it.
 *   3. Neither → prepend at the top.
 *
 * Text-manipulation only — comments and formatting are preserved.
 */
function addImportToYaml(text: string, filename: string): string {
  const entry = `  - ${filename}`;

  // Case 1: existing imports block — append after the last item in the list.
  const block = /^([ \t]*imports:[ \t]*\n(?:[ \t]+-[^\n]*\n)*)/m.exec(text);
  if (block) {
    const at = block.index + block[0].length;
    return text.slice(0, at) + entry + '\n' + text.slice(at);
  }

  // Case 2: no imports block — add one after the project: block.
  const proj = /^project:[^\n]*\n(?:[ \t]+[^\n]*\n?)*/m.exec(text);
  if (proj) {
    const at = proj.index + proj[0].length;
    return text.slice(0, at) + `\nimports:\n${entry}\n` + text.slice(at);
  }

  // Case 3: prepend.
  return `imports:\n${entry}\n\n` + text;
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
  if (currentMode === 'code') {
    const name = prompt('New file name', 'user.cpp');
    if (!name) return;
    const clean = name.trim();
    if (!/\.(cpp|h|c)$/i.test(clean)) {
      alert('User code files must end in .cpp, .h, or .c');
      return;
    }
    if (workspace.files[clean] !== undefined) {
      alert(`"${clean}" already exists`);
      return;
    }
    workspace.files[clean] = `// ${clean}\n`;
    selectFile(clean);
    persist();
    return;
  }

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

  workspace.files[clean] = `# ${clean}\n`;

  // Automatically wire the new file into the entry file's imports list so
  // the parser can reach it without the user having to edit it manually.
  const entryText = workspace.files[workspace.entry] ?? '';
  const wired = addImportToYaml(entryText, clean);
  workspace.files[workspace.entry] = wired;
  if (workspace.active === workspace.entry) source.value = wired;

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

  // Keep the file in its language family to prevent accidental cross-type renames.
  if (/\.(ya?ml)$/i.test(name) && !/\.(ya?ml)$/i.test(clean)) {
    alert('Model files must end in .yaml or .yml');
    return;
  }
  if (/\.(cpp|h|c)$/i.test(name) && !/\.(cpp|h|c)$/i.test(clean)) {
    alert('C++ files must end in .cpp, .h, or .c');
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
  if (currentMode === 'model') render();
}

function deleteFile(name: string): void {
  if (currentMode === 'model' && name === workspace.entry) {
    alert('The entry file cannot be deleted. Make another file the entry first.');
    return;
  }
  if (!confirm(`Delete "${name}"?`)) return;

  delete workspace.files[name];

  if (workspace.active === name) {
    const remaining = fileNames(); // already filtered for current mode
    workspace.active = remaining[0] ?? (currentMode === 'model' ? workspace.entry : '');
  }

  if (workspace.active && workspace.files[workspace.active] !== undefined) {
    selectFile(workspace.active);
  } else {
    source.value = '';
    renderFileBar();
    paint();
    persist();
  }

  if (currentMode === 'model') render();
}

function setEntry(): void {
  if (workspace.active === workspace.entry) return;
  workspace.entry = workspace.active;
  renderFileBar();
  render();
}

// ---------------------------------------------------------------------------
// Mode switching (Model ↔ C++)
// ---------------------------------------------------------------------------

function setMode(mode: 'model' | 'code'): void {
  currentMode = mode;
  modeModelBtn.classList.toggle('active', mode === 'model');
  modeCodeBtn.classList.toggle('active', mode === 'code');
  setEntryButton.hidden = mode === 'code';
  snippetButton.hidden = mode === 'code';
  genStubsButton.hidden = mode === 'model';

  // If the currently active file does not belong to the new mode, switch to
  // the first file in the new mode (or clear the editor when there are none).
  const names = fileNames();
  if (!names.includes(workspace.active)) {
    workspace.active = names[0] ?? '';
    source.value = workspace.active ? (workspace.files[workspace.active] ?? '') : '';
  }

  renderFileBar();
  paint();
}

/**
 * Generate stub .cpp files from the last successful codegen run.
 *
 * Scaffolds are "write once" — if the file already exists in the workspace it
 * is left untouched. Only missing files are created, then the editor switches
 * to Code mode so the user can edit them immediately.
 */
function genStubs(): void {
  if (!current) {
    alert('Fix any model errors first — stubs are generated from a valid model.');
    return;
  }
  const { generatedProject } = current;
  if (generatedProject.scaffolds.length === 0) {
    alert('No stubs to generate for this model.\n\nStubs appear when the model has actions or guards that need C++ implementations.');
    return;
  }

  let created = 0;
  let skipped = 0;
  let firstName = '';

  for (const scaffold of generatedProject.scaffolds) {
    // Use only the basename so it sits alongside the YAML files in the editor.
    const name = scaffold.path.split('/').pop()!;
    if (!name || !/\.(cpp|h|c)$/i.test(name)) continue;
    if (workspace.files[name] !== undefined) {
      skipped++;
    } else {
      workspace.files[name] = scaffold.contents;
      if (!firstName) firstName = name;
      created++;
    }
  }

  if (created > 0) {
    setMode('code');
    if (firstName) selectFile(firstName);
    persist();
  }

  const msg = created > 0 && skipped > 0
    ? `Created ${created} stub file${created !== 1 ? 's' : ''}, skipped ${skipped} that already exist.`
    : created > 0
    ? `Created ${created} stub file${created !== 1 ? 's' : ''}.`
    : `All stub files already exist — nothing new was created.`;
  alert(msg);
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

/**
 * Write a new project name into the `project: name:` field of the entry file.
 *
 * Text-manipulation preserves comments and formatting. Only the block form
 * (`project:\n  name: value`) is handled; inline form is left untouched.
 */
function applyNameToYaml(name: string): void {
  const text = workspace.files[workspace.entry];
  if (!text) return;

  const updated = text.replace(
    /^(project:[^\S\n]*\n)((?:[ \t]+[^\n]*\n)*?)([ \t]+name:)[^\n]*/m,
    (_match, header, before, nameKey) => `${header}${before}${nameKey} ${name}`
  );
  if (updated === text) return;

  workspace.files[workspace.entry] = updated;
  if (workspace.active === workspace.entry) {
    source.value = updated;
    paint();
  }
}

function renameProject(): void {
  const name = prompt('Rename project', workspace.name);
  if (!name?.trim() || name.trim() === workspace.name) return;

  // Sync the YAML before touching the store so persist() captures the new name.
  applyNameToYaml(name.trim());
  persist();
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

/**
 * Generate a platformio.ini for the project.
 *
 * Board names used in PulseIR models map to PlatformIO board IDs. Unknown
 * boards fall back to the raw string so the user can correct it themselves.
 * Libraries with a version use the `name@version` form; git-sourced libs use
 * their URL directly. Interface-implied libraries (e.g. DallasTemperature for
 * a ds18b20 sensor) are appended after the user-declared ones.
 */
function generatePlatformioIni(project: PulseProject, generatedProject: GeneratedProject): string {
  const board = project.target?.board ?? '';

  // PulseIR board name → [platformio platform, platformio board id]
  const BOARD_MAP: Record<string, [string, string]> = {
    esp32:    ['espressif32',    'esp32dev'],
    esp32s3:  ['espressif32',    'esp32-s3-devkitc-1'],
    esp32c3:  ['espressif32',    'esp32-c3-devkitm-1'],
    esp8266:  ['espressif8266',  'nodemcuv2'],
    uno:      ['atmelavr',       'uno'],
    mega:     ['atmelavr',       'megaatmega2560'],
    nano:     ['atmelavr',       'nanoatmega328'],
    nano33ble:['nordicnrf52',    'nano33ble'],
    rp2040:   ['raspberrypi',    'rpipico'],
    teensy41: ['teensy',         'teensy41'],
  };

  const [platform, boardId] = BOARD_MAP[board] ?? ['# unknown platform', board || '# set board in target:'];

  const { libDeps } = generatedProject;
  const libSection = libDeps.length > 0
    ? `lib_deps =\n${libDeps.map(l => `    ${l}`).join('\n')}`
    : '# lib_deps =';

  return `[env:${boardId}]
platform = ${platform}
board     = ${boardId}
framework = arduino
${libSection}
`;
}

/**
 * Package the split project output as a zip.
 *
 * All source files (generated and scaffolds) go under `src/` so unzipping
 * gives a single coherent PlatformIO project. `platformio.ini` is placed at
 * the folder root so the IDE can open it directly. Scaffold paths from
 * `generateFiles()` already include the `src/` prefix; generated file paths
 * do not, so we add it here without touching codegen.
 */
function downloadProjectZip(): void {
  if (!current) return;
  const { project, generatedProject } = current;
  const folder = safeFolderName(project.name);
  const entries: Record<string, string> = {};

  // Priority order (lowest to highest): scaffolds → user edits → generated.
  // Writing in this order means each layer silently wins over the one before.

  // 1. Scaffold stubs — the starting template, lowest priority.
  for (const file of generatedProject.scaffolds) {
    entries[`${folder}/${file.path}`] = file.contents;
  }

  // 2. User-authored C++ files override scaffold stubs.
  //    The user edited these in the C++ editor; their content must win.
  for (const [name, contents] of Object.entries(workspace.files)) {
    if (/\.(cpp|h|c)$/i.test(name)) {
      entries[`${folder}/src/${name}`] = contents;
    }
  }

  // 3. Generated files are always derived fresh from the model — highest priority.
  entries[`${folder}/platformio.ini`] = generatePlatformioIni(project, generatedProject);
  for (const file of generatedProject.generated) {
    // PulseHSM_config.h goes in include/ so PlatformIO adds it to the global
    // include path — library code in lib/ can then find it via __has_include.
    const dest = file.path === 'PulseHSM_config.h'
      ? `${folder}/include/${file.path}`
      : `${folder}/src/${file.path}`;
    entries[dest] = file.contents;
  }

  // 4. Bundle PulseHSM as a local library so the project builds with no
  //    external lib_deps. The lib/ directory is auto-scanned by PlatformIO.
  if (generatedProject.needsRuntime) {
    entries[`${folder}/lib/PulseHSM/PulseHSM.h`]   = PULSEHSM_H;
    entries[`${folder}/lib/PulseHSM/PulseHSM.cpp`] = PULSEHSM_CPP;
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
  // ── Project ───────────────────────────────────────────────────────────────
  { group: 'Project', label: 'Import another file',
    yaml: `imports:\n  - part.yaml`
  },

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
    i2c_bus: { interface: i2c, sda: I2C_SDA, scl: I2C_SCL }`
  },
  { group: 'Protocol', label: 'SPI bus',
    yaml:
`hardware:
  buses:
    spi_bus: { interface: spi, sck: SPI_SCK, miso: SPI_MISO, mosi: SPI_MOSI, cs: SPI_CS }`
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
    led: { type: digital_output, pin: LED_BUILTIN }`
  },
  { group: 'Device', label: 'Digital input  (button, switch)',
    yaml:
`hardware:
  devices:
    # mode defaults to INPUT when omitted.
    # Use INPUT_PULLUP for active-low buttons (no external resistor needed).
    # Use INPUT_PULLDOWN for active-high buttons (ESP32 only).
    button: { type: digital_input, pin: GPIO0, mode: INPUT_PULLUP }`
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
  { group: 'Device', label: 'Analog input  (with conversion formula)',
    yaml:
`hardware:
  devices:
    temp:
      type: analog_input
      pin: GPIO34
      unit: degC
      conversion: "analogRead({pin}) * (3.3 / 4095.0) * 100.0"`
  },
  { group: 'Device', label: 'DS18B20  (1-Wire temperature)',
    yaml:
`# Requires: DallasTemperature + OneWire — install via Arduino Library Manager
hardware:
  buses:
    probe_bus: { interface: onewire, pin: GPIO4 }
  devices:
    water_temp:
      type: ds18b20
      bus: probe_bus
      unit: degC

actions:
  read_temp: { driver: ds18b20, params: { device: water_temp } }

tasks:
  sensor_poll: { every: 2000, do: read_temp }`
  },
  { group: 'Device', label: 'DHT22  (temperature + humidity)',
    yaml:
`# Requires: DHT sensor library by Adafruit — install via Arduino Library Manager
hardware:
  devices:
    air_temp:
      type: dht22
      pin: GPIO4
      measure: temperature   # or: humidity
      unit: degC

actions:
  read_dht: { driver: dht22, params: { device: air_temp } }

tasks:
  sensor_poll: { every: 2000, do: read_dht }`
  },
  { group: 'Device', label: 'BME280  (temp / humidity / pressure)',
    yaml:
`# Requires: Adafruit BME280 Library + Adafruit Unified Sensor — Library Manager
hardware:
  buses:
    sensor_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    air_temp:
      type: bme280
      bus: sensor_bus
      address: 0x76
      measure: temperature   # temperature | humidity | pressure
      unit: degC

actions:
  read_bme: { driver: bme280, params: { device: air_temp } }

tasks:
  sensor_poll: { every: 2000, do: read_bme }`
  },
  { group: 'Device', label: 'Digital input with interrupt (ISR)',
    yaml:
`# Interrupt-driven input: generates an ISR + attachInterrupt() call.
# Add "raises: EVENT_NAME" to fire a state-machine event from the ISR.
hardware:
  devices:
    button:
      type: digital_input
      pin: GPIO0
      interrupt: FALLING   # RISING | FALLING | CHANGE
      raises: BUTTON_PRESSED

events:
  BUTTON_PRESSED: { source: external }

machine:
  states:
    idle:
    active:
  transitions:
    - { from: idle,   on: BUTTON_PRESSED, to: active }
    - { from: active, on: BUTTON_PRESSED, to: idle }`
  },
  { group: 'Device', label: 'LCD I2C  (character display)',
    yaml:
`# Requires: LiquidCrystal_I2C by Frank de Brabander — Arduino Library Manager
hardware:
  buses:
    i2c_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    display:
      type: lcd_i2c
      bus: i2c_bus
      address: 0x27   # scan with I2C scanner if unsure
      cols: 16
      rows: 2

actions:
  show_status: { driver: lcd_print, params: { device: display, row: 0, col: 0 } }
  clear_screen: { driver: lcd_clear, params: { device: display } }

tasks:
  update_display: { every: 1000, do: [clear_screen, show_status] }`
  },
  { group: 'Device', label: 'OLED I2C  (SSD1306 display)',
    yaml:
`# Requires: Adafruit SSD1306 + Adafruit GFX Library — Arduino Library Manager
hardware:
  buses:
    i2c_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    screen:
      type: oled_i2c
      bus: i2c_bus
      address: 0x3C   # 0x3C most boards; 0x3D if SA0 is HIGH
      width: 128
      height: 64

actions:
  draw_status: { driver: oled_print, params: { device: screen, x: 0, y: 0, size: 1 } }

tasks:
  refresh: { every: 500, do: draw_status }`
  },
  { group: 'Device', label: 'DS3231 RTC  (real-time clock)',
    yaml:
`# Requires: RTClib by Adafruit — install via Arduino Library Manager
hardware:
  buses:
    i2c_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }
  devices:
    clock:
      type: ds3231
      bus: i2c_bus

actions:
  read_time: { driver: rtc_read, params: { device: clock } }

tasks:
  tick: { every: 1000, do: read_time }`
  },

  // ── Power / connectivity ─────────────────────────────────────────────────
  { group: 'Device', label: 'Deep sleep  (ESP32 power-down)',
    yaml:
`# Uses the ESP32 Arduino core sleep API — no extra library needed.
events:
  wake_up: { source: external }

hardware:
  devices:
    wake_btn: { type: digital_input, pin: GPIO0 }

actions:
  go_to_sleep:
    driver: sleep_control
    params:
      mode: deep_sleep
      duration_ms: 30000   # wake after 30 s, or on GPIO0 LOW
      wake_pin: GPIO0
      wake_level: 0

machine:
  states:
    awake:
    sleeping:
      entry: go_to_sleep
  transitions:
    - { from: awake,    on: wake_up, to: sleeping }
    - { from: sleeping, on: wake_up, to: awake }`
  },
  { group: 'Device', label: 'OTA update  (ArduinoOTA over Wi-Fi)',
    yaml:
`# Requires: ArduinoOTA — bundled with the ESP32/ESP8266 Arduino core.
# WiFi must be connected before ArduinoOTA.begin() runs.
hardware:
  buses:
    net:
      interface: wifi
      ssid: \${WIFI_SSID}
      password: \${WIFI_PASSWORD}
    updater:
      interface: ota
      hostname: "my-esp32"
      port: 3232

tasks:
  heartbeat: { every: 1000, do: blink_led }`
  },
  { group: 'Device', label: 'HTTP GET / POST  (ESP32/ESP8266)',
    yaml:
`# Requires: HTTPClient — bundled with the ESP32/ESP8266 Arduino core.
hardware:
  buses:
    net:
      interface: wifi
      ssid: \${WIFI_SSID}
      password: \${WIFI_PASSWORD}

events:
  data_ready: { source: external }

actions:
  fetch_sensor:
    driver: http_get
    params:
      url: "http://api.example.com/sensor/1"
  post_reading:
    driver: http_post
    params:
      url: "http://api.example.com/readings"
      body: '{"value":42}'
      content_type: "application/json"

tasks:
  poll: { every: 10000, do: fetch_sensor }`
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
  { group: 'Logic', label: 'State with entry / exit actions',
    yaml:
`actions:
  on_enter: { driver: my_driver }
  on_exit:  { driver: my_driver }

machine:
  states:
    active:
      entry: on_enter
      exit:  on_exit`
  },
];

import { mergeSnippetIntoYaml } from './snippet-merge.js';

/**
 * Insert a snippet into the active file, merging into existing top-level
 * sections rather than duplicating keys. Falls back to appending for keys
 * that are not yet present in the document.
 */
function insertSnippet(yaml: string): void {
  source.value = mergeSnippetIntoYaml(source.value, yaml);
  paint();
  source.selectionStart = source.selectionEnd = source.value.length;
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
  // Apply saved theme before anything renders to avoid a flash of wrong colours.
  applyTheme((localStorage.getItem(THEME_KEY) as Theme | null) ?? 'auto');
  themeButton.addEventListener('click', cycleTheme);

  settingsButton.addEventListener('click', openSettings);
  $<HTMLButtonElement>('settings-close').addEventListener('click', closeSettings);
  $<HTMLButtonElement>('keyword-add-btn').addEventListener('click', addKeyword);
  keywordInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') addKeyword();
  });
  $<HTMLButtonElement>('keyword-reset-btn').addEventListener('click', () => {
    activeKeywords = new Set(DEFAULT_KEYWORDS);
    saveKeywords();
    renderKeywordChips();
    paint();
  });
  settingsModal.addEventListener('click', event => {
    if (event.target === settingsModal) closeSettings();
  });

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

    // C++ files don't go through the parser — just save and stop.
    if (currentMode === 'code') {
      persist();
      return;
    }

    rerender();
    // Normalize tabs → spaces and other fixups. Done after the first paint so
    // the overlay is never stale, even when normalization is skipped.
    const raw = source.value;
    const fixed = normalizeYaml(raw);
    if (fixed === raw) return;
    // Preserve cursor: count how many characters were inserted before each end
    // of the selection by normalizing only the text up to that point.
    const ss = source.selectionStart ?? raw.length;
    const se = source.selectionEnd ?? raw.length;
    const shiftStart = normalizeYaml(raw.slice(0, ss)).length - ss;
    const shiftEnd   = normalizeYaml(raw.slice(0, se)).length - se;
    source.value = fixed;
    source.setSelectionRange(ss + shiftStart, se + shiftEnd);
    workspace.files[workspace.active] = fixed;
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
  setEntryButton.addEventListener('click', setEntry);
  genStubsButton.addEventListener('click', genStubs);

  modeModelBtn.addEventListener('click', () => setMode('model'));
  modeCodeBtn.addEventListener('click', () => setMode('code'));

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
  $<HTMLButtonElement>('download-project').addEventListener('click', () => {
    closeDownloadMenu();
    downloadProjectZip();
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
  $<HTMLButtonElement>('download-platformio').addEventListener('click', () => {
    closeDownloadMenu();
    if (!current) return;
    download('platformio.ini', generatePlatformioIni(current.project, current.generatedProject), 'text/plain');
  });

  // Tab and Enter — keep the editor from escaping focus and add auto-indent.
  source.addEventListener('keydown', event => {
    const { selectionStart, selectionEnd, value } = source;

    if (event.key === 'Tab') {
      event.preventDefault();
      if (selectionStart === selectionEnd) {
        // No selection: insert two spaces at the cursor.
        source.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
        source.selectionStart = source.selectionEnd = selectionStart + 2;
        workspace.files[workspace.active] = source.value;
        paint();
        if (currentMode === 'model') rerender();
      } else {
        // Selection: indent every touched line by two spaces.
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
        const block = value.slice(lineStart, selectionEnd);
        const indented = block.replace(/^/gm, '  ');
        source.value = value.slice(0, lineStart) + indented + value.slice(selectionEnd);
        source.selectionStart = lineStart;
        source.selectionEnd = lineStart + indented.length;
        workspace.files[workspace.active] = source.value;
        paint();
        if (currentMode === 'model') rerender();
      }
      return;
    }

    // Enter: auto-indent to match the current line, deepening by two spaces
    // when the line ends with ':' (block key with no inline value — YAML only).
    // Shift+Enter inserts a plain newline — useful to escape auto-indent.
    if (event.key === 'Enter' && !event.shiftKey) {
      if (selectionStart !== selectionEnd) return; // let default handle range selections

      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const currentLine = value.slice(lineStart, selectionStart);

      // Leading whitespace of the current line.
      const indent = /^[ \t]*/.exec(currentLine)![0];

      // Deepen after ':' in YAML only — not meaningful in C++.
      const deeper = currentMode === 'model' && /:\s*$/.test(currentLine);

      event.preventDefault();
      const insertion = '\n' + indent + (deeper ? '  ' : '');
      source.value = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
      source.selectionStart = source.selectionEnd = selectionStart + insertion.length;
      workspace.files[workspace.active] = source.value;
      paint();
      if (currentMode === 'model') rerender();
    }
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
    if (event.key === 'Escape' && !settingsModal.hidden) closeSettings();
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
