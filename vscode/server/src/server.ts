import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  TextDocumentPositionParams,
  CodeActionParams,
} from 'vscode-languageserver/node';
import { getCompletions, getHover, getCodeActions, EMPTY_MODEL, type ModelNames } from './providers.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'path';
import * as fs from 'fs';
import { Parser, ParseError } from '../../../src/parser/index.js';
import { FileResolver } from '../../../src/parser/fs-resolver.js';
import { MemoryResolver } from '../../../src/parser/resolver.js';
import { Validator } from '../../../src/analysis/validate.js';
import { Codegen } from '../../../src/codegen/index.js';
import { ArduinoBackend } from '../../../src/codegen/arduino.js';
import { EspIdfBackend } from '../../../src/codegen/espidf.js';
import { ZephyrBackend } from '../../../src/codegen/zephyr.js';
import { DiagramEmitter } from '../../../src/emit/diagram.js';
import type { PlatformBackend } from '../../../src/codegen/backend.js';
import type { State } from '../../../src/model/types.js';

const connection = createConnection(ProposedFeatures.all);
const documents  = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { resolveProvider: false, triggerCharacters: [' ', ':'] },
    hoverProvider: true,
    codeActionProvider: true,
  },
}));

// ---------------------------------------------------------------------------
// Diagnostics — parse + validate on every change
// ---------------------------------------------------------------------------

documents.onDidChangeContent(change => {
  validateDocument(change.document);
});

documents.onDidOpen(e => {
  validateDocument(e.document);
});

function validateDocument(textDocument: TextDocument): void {
  const text = textDocument.getText();
  const uri  = textDocument.uri;
  const diagnostics: Diagnostic[] = [];

  try {
    const parser  = new Parser();
    // Use MemoryResolver keyed by the document URI so single-file models work
    // without filesystem access; imports resolve via FileResolver fallback.
    const fsPath  = uriToFsPath(uri);
    const resolver = fsPath ? new FileResolver(path.dirname(fsPath)) : undefined;
    const project = resolver
      ? parser.parse(text, { origin: fsPath, resolver })
      : parser.parse(text);

    const result = new Validator().validate(project, parser.warnings);
    for (const d of result.diagnostics) {
      diagnostics.push({
        severity: d.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        // Validator diagnostics don't carry positions yet — surface them at line 0.
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: Number.MAX_SAFE_INTEGER } },
        message: d.message,
        code: d.code,
        source: 'pulseir',
      });
    }
  } catch (err) {
    if (err instanceof ParseError) {
      // YAML syntax errors carry a 1-based line from js-yaml; semantic errors
      // (thrown after a successful parse) don't have one, so we search the
      // document text for quoted identifiers mentioned in the message.
      const line = err.line != null
        ? Math.max(0, err.line - 1)
        : findLineForError(text, err.message) ?? 0;
      const col  = err.column ?? 0;
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line, character: col },
          end:   { line, character: Number.MAX_SAFE_INTEGER },
        },
        message: err.message.replace(/^.*\n/, '').trim(),
        source: 'pulseir',
      });
    }
  }

  connection.sendDiagnostics({ uri, diagnostics });
}

// ---------------------------------------------------------------------------
// Intelligence providers — completions, hover, code actions
// ---------------------------------------------------------------------------

function tryGetModelNames(doc: ReturnType<typeof documents.get>): ModelNames {
  if (!doc) return EMPTY_MODEL;
  const text   = doc.getText();
  const uri    = doc.uri;
  const fsPath = uriToFsPath(uri);
  try {
    const parser   = new Parser();
    const resolver = fsPath ? new FileResolver(path.dirname(fsPath)) : undefined;
    const project  = resolver
      ? parser.parse(text, { origin: fsPath, resolver })
      : parser.parse(text);
    const params = project.system.parameters ?? [];
    return {
      states:      getAllStateLeafNames(project.system.states),
      events:      project.system.events.map(e => e.name),
      allParams:   params.map(p => p.name),
      intParams:   params.filter(p => p.type === 'int').map(p => p.name),
      busNames:    (project.system.resources ?? []).map(r => r.name),
      actionNames: [...new Map(
        (project.system.transitions ?? [])
          .flatMap(t => t.actions ?? [])
          .map(a => [a.name, a.name])
      ).values()],
    };
  } catch {
    return EMPTY_MODEL;
  }
}

function getAllStateLeafNames(states: State[], prefix = ''): string[] {
  const names: string[] = [];
  for (const s of states) {
    const fullPath = prefix ? `${prefix}/${s.name}` : s.name;
    names.push(s.name);
    if (fullPath !== s.name) names.push(fullPath);
    for (const r of s.regions ?? []) {
      names.push(...getAllStateLeafNames(r.states, fullPath));
    }
  }
  return [...new Set(names)];
}

connection.onCompletion((params: TextDocumentPositionParams) => {
  const doc   = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const model = tryGetModelNames(doc);
  return getCompletions(doc, params.position, model);
});

connection.onHover((params: TextDocumentPositionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return getHover(doc, params.position);
});

connection.onCodeAction((params: CodeActionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return getCodeActions(doc, params.range, params.context.diagnostics);
});

// ---------------------------------------------------------------------------
// Custom request: generate code
// ---------------------------------------------------------------------------

interface GenerateParams {
  uri:    string;
  target: string;
  outDir: string;
}

interface GenerateResult {
  files?: Array<{ name: string; content: string }>;
  error?: string;
}

connection.onRequest('pulseir/generate', async (params: GenerateParams): Promise<GenerateResult> => {
  try {
    const fsPath = uriToFsPath(params.uri);
    if (!fsPath) return { error: 'Cannot resolve file path from URI.' };

    const text    = documents.get(params.uri)?.getText() ?? fs.readFileSync(fsPath, 'utf8');
    const parser  = new Parser();
    const project = parser.parse(text, { origin: fsPath, resolver: new FileResolver(path.dirname(fsPath)) });
    const backend = resolveBackend(params.target);

    const gen   = new Codegen(backend);
    const gp    = gen.generateFiles(project);
    const files = gp.generated.map(f => ({ name: f.filename, content: f.content }));

    if (gp.scaffolds) {
      for (const s of gp.scaffolds) {
        const dest = path.join(params.outDir, s.filename);
        if (!fs.existsSync(dest)) {
          files.push({ name: s.filename, content: s.content });
        }
      }
    }

    return { files };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// ---------------------------------------------------------------------------
// Custom request: state diagram
// ---------------------------------------------------------------------------

interface DiagramParams { uri: string }
interface DiagramResult { mermaid?: string; error?: string }

connection.onRequest('pulseir/diagram', async (params: DiagramParams): Promise<DiagramResult> => {
  try {
    const fsPath = uriToFsPath(params.uri);
    const text   = documents.get(params.uri)?.getText()
                ?? (fsPath ? fs.readFileSync(fsPath, 'utf8') : null);
    if (!text) return { error: 'Cannot read document.' };

    const parser   = new Parser();
    const resolver = fsPath ? new FileResolver(path.dirname(fsPath)) : undefined;
    const project  = resolver
      ? parser.parse(text, { origin: fsPath, resolver })
      : parser.parse(text);

    if (project.system.states.length === 0) {
      return { error: 'No state machine defined in this model.' };
    }

    const mermaid = new DiagramEmitter().generate(project);
    return { mermaid };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * When a ParseError has no source position (semantic errors thrown after
 * YAML parsing succeeds), try to find the relevant line by searching the
 * document text for quoted identifiers extracted from the error message.
 *
 * Returns a 0-based line index, or undefined if nothing matched.
 */
function findLineForError(text: string, message: string): number | undefined {
  const lines = text.split('\n');
  // Pull out every "quoted" token from the error message.
  const tokens = [...message.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  if (tokens.length === 0) return undefined;

  // Try each token from last to first — the final quoted token is usually the
  // bad value (e.g. the undeclared parameter name), which is more specific than
  // the entity that references it.
  for (let qi = tokens.length - 1; qi >= 0; qi--) {
    const token = tokens[qi];
    if (token.length < 2) continue;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(token)) return i;
    }
  }
  return undefined;
}

function uriToFsPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null;
  // file:///c:/path (Windows) → strip 3 slashes → /c:/path → strip leading slash → c:/path
  // file:///path    (Unix)    → strip 3 slashes → /path   (correct)
  // file://host/path          → strip 2 slashes → /path   (UNC — strip the host part)
  const decoded = decodeURIComponent(uri.replace(/^file:\/\/\//, '/').replace(/^file:\/\/[^/]*/, ''));
  return decoded.replace(/^\/([a-zA-Z]:[\\/])/, '$1');
}

function resolveBackend(target: string): PlatformBackend {
  switch (target) {
    case 'espidf':      return new EspIdfBackend();
    case 'zephyr':      return new ZephyrBackend();
    default:            return new ArduinoBackend();
  }
}

documents.listen(connection);
connection.listen();
