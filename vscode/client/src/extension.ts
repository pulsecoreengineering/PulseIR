import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

  const serverOptions: ServerOptions = {
    run:   { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'pulseir' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{yaml,yml}'),
    },
  };

  client = new LanguageClient('pulseir', 'PulseIR Language Server', serverOptions, clientOptions);
  client.start();

  // Auto-detect PulseIR files that VS Code opened as plain YAML.
  // The firstLine grammar rule only fires when `pulseir:` is literally on line 1;
  // most real models start with comments, so we scan the first 3 KB here instead.
  const promoteLanguage = (doc: vscode.TextDocument) => {
    if (doc.languageId === 'yaml' || doc.languageId === 'yml' || doc.languageId === 'plaintext') {
      // getText() takes an optional Range, not a number — slice the string instead.
      if (/^pulseir\s*:/m.test(doc.getText().slice(0, 3000))) {
        vscode.languages.setTextDocumentLanguage(doc, 'pulseir');
      }
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(promoteLanguage),
    vscode.commands.registerCommand('pulseir.generate', () => generateCode(context)),
    vscode.commands.registerCommand('pulseir.showDiagram', () => showDiagram(context)),
    vscode.commands.registerCommand('pulseir.jumpToStub', jumpToStub),
  );

  // Promote any documents already open when the extension activates.
  vscode.workspace.textDocuments.forEach(promoteLanguage);
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

// ---------------------------------------------------------------------------
// Jump-to-stub command  (invoked by CodeLens / go-to-definition)
// ---------------------------------------------------------------------------

async function jumpToStub(filePath: string, lineIndex: number): Promise<void> {
  const uri    = vscode.Uri.file(filePath);
  const doc    = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const pos    = new vscode.Position(lineIndex, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

// ---------------------------------------------------------------------------
// Generate command
// ---------------------------------------------------------------------------

async function generateCode(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'pulseir') {
    vscode.window.showErrorMessage('Open a PulseIR (.pulse.yaml) file first.');
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const config   = vscode.workspace.getConfiguration('pulseir');
  const target   = config.get<string>('target', 'arduino');
  const outDir   = config.get<string>('outputDirectory', '') || path.dirname(filePath);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'PulseIR: Generating code…' },
    async () => {
      const result = await client.sendRequest<GenerateResult>('pulseir/generate', {
        uri:    editor.document.uri.toString(),
        target,
        outDir,
      });

      if (result.error) {
        vscode.window.showErrorMessage(`PulseIR generate failed: ${result.error}`);
        return;
      }

      for (const file of result.files ?? []) {
        const dest = path.join(outDir, file.name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, file.content, 'utf8');
      }

      vscode.window.showInformationMessage(
        `PulseIR: Generated ${result.files?.length ?? 0} file(s) in ${outDir}`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Diagram panel
// ---------------------------------------------------------------------------

let diagramPanel: vscode.WebviewPanel | undefined;

async function showDiagram(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'pulseir') {
    vscode.window.showErrorMessage('Open a PulseIR (.pulse.yaml) file first.');
    return;
  }

  const result = await client.sendRequest<DiagramResult>('pulseir/diagram', {
    uri: editor.document.uri.toString(),
  });

  if (result.error || !result.mermaid) {
    vscode.window.showErrorMessage(result.error ?? 'No state machine in this model.');
    return;
  }

  if (!diagramPanel) {
    diagramPanel = vscode.window.createWebviewPanel(
      'pulseir.diagram',
      'PulseIR Diagram',
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );
    diagramPanel.onDidDispose(() => { diagramPanel = undefined; });
  }

  diagramPanel.title   = `Diagram: ${path.basename(editor.document.uri.fsPath)}`;
  diagramPanel.webview.html = diagramHtml(result.mermaid);
  diagramPanel.reveal(vscode.ViewColumn.Beside, true);
}

function diagramHtml(mermaid: string): string {
  const escaped = mermaid.replace(/`/g, '\\`');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PulseIR Diagram</title>
  <style>
    body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 16px; font-family: var(--vscode-font-family); }
    #diagram { display: flex; justify-content: center; }
    .mermaid svg { max-width: 100%; }
  </style>
</head>
<body>
  <div id="diagram" class="mermaid">${mermaid}</div>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Types for custom LSP requests
// ---------------------------------------------------------------------------

interface GenerateResult {
  files?: Array<{ name: string; content: string }>;
  error?: string;
}

interface DiagramResult {
  mermaid?: string;
  error?: string;
}
