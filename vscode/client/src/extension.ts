import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { PulseIRModelsProvider, PulseIRProjectProvider, PulseIRDriversProvider, DriverItem, ModelItem } from './sidebar.js';
import { runNewProjectWizard } from './wizard.js';

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

  // Sidebar tree providers
  const modelsProvider  = new PulseIRModelsProvider(context);
  const projectProvider = new PulseIRProjectProvider(context);
  const driversProvider = new PulseIRDriversProvider();
  vscode.window.registerTreeDataProvider('pulseir.modelsView',  modelsProvider);
  vscode.window.registerTreeDataProvider('pulseir.projectView', projectProvider);
  vscode.window.registerTreeDataProvider('pulseir.driversView', driversProvider);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(promoteLanguage),

    // Editor commands
    vscode.commands.registerCommand('pulseir.generate',     () => generateCode(context)),
    vscode.commands.registerCommand('pulseir.showDiagram',  () => showDiagram(context)),
    vscode.commands.registerCommand('pulseir.jumpToStub',   jumpToStub),

    // Sidebar commands
    vscode.commands.registerCommand('pulseir.newProject',   runNewProjectWizard),
    vscode.commands.registerCommand('pulseir.refreshModels',() => modelsProvider.refresh()),

    vscode.commands.registerCommand('pulseir.generateForModel', (item: ModelItem) =>
      generateCode(context, item?.uri)),
    vscode.commands.registerCommand('pulseir.showDiagramForModel', (item: ModelItem) =>
      showDiagram(context, item?.uri)),

    vscode.commands.registerCommand('pulseir.selectTarget', async () => {
      const cfg   = vscode.workspace.getConfiguration('pulseir');
      const current = cfg.get<string>('target', 'arduino');
      const pick  = await vscode.window.showQuickPick(
        ['arduino', 'espidf', 'zephyr', 'micropython'].map(t => ({
          label: t, description: t === current ? '(current)' : '',
        })),
        { placeHolder: 'Select code generation target' },
      );
      if (pick) {
        await cfg.update('target', pick.label, vscode.ConfigurationTarget.Workspace);
        projectProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('pulseir.toggleGenerateOnSave', async () => {
      const cfg = vscode.workspace.getConfiguration('pulseir');
      await cfg.update('generateOnSave', !cfg.get('generateOnSave', false),
                       vscode.ConfigurationTarget.Workspace);
      projectProvider.refresh();
    }),

    // Driver / plugin commands
    vscode.commands.registerCommand('pulseir.refreshDrivers', () => driversProvider.refresh()),

    vscode.commands.registerCommand('pulseir.pluginInstall', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true, canSelectMany: false,
        filters: { 'PulseIR Driver Plugin': ['yaml', 'yml'] },
        title: 'Select a driver plugin YAML file',
      });
      if (!uris || uris.length === 0) return;
      const src = uris[0].fsPath;
      await runPluginCommand(['plugin', 'install', src]);
      driversProvider.refresh();
    }),

    vscode.commands.registerCommand('pulseir.pluginRemove', async (item?: DriverItem) => {
      const name = item?.driverName ?? await vscode.window.showInputBox({
        prompt: 'Driver name to remove', placeHolder: 'e.g. hcsr04_read',
      });
      if (!name) return;
      const confirm = await vscode.window.showWarningMessage(
        `Remove plugin "${name}"?`, { modal: true }, 'Remove',
      );
      if (confirm !== 'Remove') return;
      await runPluginCommand(['plugin', 'remove', name]);
      driversProvider.refresh();
    }),

    vscode.commands.registerCommand('pulseir.pluginList', () => runPluginCommand(['plugin', 'list'])),
  );

  // Promote any documents already open when the extension activates.
  vscode.workspace.textDocuments.forEach(promoteLanguage);
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

// ---------------------------------------------------------------------------
// Plugin CLI helper
// ---------------------------------------------------------------------------

async function runPluginCommand(args: string[]): Promise<void> {
  // The extension lives at vscode/client/out/extension.js; the CLI is three
  // levels up at dist/src/cli.js relative to the repo root.
  const cliPath = path.resolve(__dirname, '..', '..', '..', '..', 'dist', 'src', 'cli.js');
  const terminal = vscode.window.createTerminal({ name: 'PulseIR Plugins', hideFromUser: false });
  terminal.show(true);
  terminal.sendText(`node "${cliPath}" ${args.map(a => JSON.stringify(a)).join(' ')}`);
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

async function generateCode(context: vscode.ExtensionContext, modelUri?: vscode.Uri): Promise<void> {
  const uri = modelUri ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    vscode.window.showErrorMessage('Open a PulseIR (.pulse.yaml) file first.');
    return;
  }
  // Ensure the document language is PulseIR (skip check when called from sidebar with explicit URI)
  if (!modelUri) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'pulseir') {
      vscode.window.showErrorMessage('Open a PulseIR (.pulse.yaml) file first.');
      return;
    }
  }

  const filePath = uri.fsPath;
  const config   = vscode.workspace.getConfiguration('pulseir');
  const target   = config.get<string>('target', 'arduino');
  const outDir   = config.get<string>('outputDirectory', '') || path.dirname(filePath);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'PulseIR: Generating code…' },
    async () => {
      const result = await client.sendRequest<GenerateResult>('pulseir/generate', {
        uri:    uri.toString(),
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

async function showDiagram(context: vscode.ExtensionContext, modelUri?: vscode.Uri): Promise<void> {
  const uri = modelUri ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    vscode.window.showErrorMessage('Open a PulseIR (.pulse.yaml) file first.');
    return;
  }
  if (!modelUri) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'pulseir') {
      vscode.window.showErrorMessage('Open a PulseIR (.pulse.yaml) file first.');
      return;
    }
  }

  const result = await client.sendRequest<DiagramResult>('pulseir/diagram', {
    uri: uri.toString(),
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

  diagramPanel.title   = `Diagram: ${path.basename(uri.fsPath)}`;
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
