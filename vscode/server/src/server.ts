import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
} from 'vscode-languageserver/node';
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

const connection = createConnection(ProposedFeatures.all);
const documents  = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
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
      const line = Math.max(0, (err.line ?? 1) - 1); // js-yaml lines are 1-based
      const col  = err.column ?? 0;
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line, character: col },
          end:   { line, character: Number.MAX_SAFE_INTEGER },
        },
        message: err.message.replace(/^.*\n/, '').trim(), // strip yaml header line
        source: 'pulseir',
      });
    }
  }

  connection.sendDiagnostics({ uri, diagnostics });
}

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

function uriToFsPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null;
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
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
