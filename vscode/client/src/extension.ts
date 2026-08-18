import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
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
  _extensionPath = context.extensionPath;
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

    vscode.commands.registerCommand('pulseir.pluginBrowse', async () => {
      const driversDir = path.join(context.extensionPath, 'drivers');
      if (!fs.existsSync(driversDir)) {
        vscode.window.showErrorMessage('Bundled drivers not found in this extension installation.');
        return;
      }
      const files = fs.readdirSync(driversDir).filter(f => /\.ya?ml$/i.test(f));
      if (files.length === 0) {
        vscode.window.showInformationMessage('No bundled driver plugins found.');
        return;
      }

      // Parse each plugin to show name + description in the QuickPick
      const items = files.flatMap(f => {
        try {
          const content = fs.readFileSync(path.join(driversDir, f), 'utf8');
          const lines = content.split('\n');
          const driver = (lines.find(l => l.startsWith('driver:')) ?? '').replace('driver:', '').trim();
          const desc   = (lines.find(l => l.startsWith('description:')) ?? '').replace('description:', '').trim();
          const plats  = lines.filter(l => /^  \w+:/.test(l) && !['  description:', '  driver:'].some(x => l.startsWith(x))).map(l => l.trim().replace(':', ''));
          if (!driver) return [];
          return [{ label: driver, description: desc, detail: `platforms: ${plats.join(', ')}`, filePath: path.join(driversDir, f) }];
        } catch { return []; }
      });

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a bundled plugin to install globally',
        matchOnDescription: true,
      });
      if (!pick) return;
      await runPluginCommand(['plugin', 'install', pick.filePath]);
      driversProvider.refresh();
      vscode.window.showInformationMessage(`Plugin "${pick.label}" installed globally.`);
    }),

    vscode.commands.registerCommand('pulseir.pluginNew', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Driver name for your plugin (e.g. my_sensor)',
        placeHolder: 'my_sensor',
        validateInput: v => /^[a-z][a-z0-9_]*$/.test(v) ? undefined : 'Use lowercase letters, digits, and underscores',
      });
      if (!name) return;

      const template = [
        `driver: ${name}`,
        `description: Describe what this driver does`,
        ``,
        `# Action params: list the params: keys your action uses`,
        `# Template variables in code:`,
        `#   {key}      → param value (device name)`,
        `#   {key_pin}  → generated pin macro (e.g. TRIG_PIN)`,
        `#   {driver}   → the driver name`,
        ``,
        `platforms:`,
        `  arduino: |`,
        `    // TODO: Arduino implementation`,
        `    (void)ctx;`,
        ``,
        `  espidf: |`,
        `    // TODO: ESP-IDF implementation`,
        `    (void)ctx;`,
        ``,
        `  default: |`,
        `    // TODO: implement {driver} for this platform`,
        `    (void)ctx;`,
      ].join('\n');

      const doc = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content: template,
      });
      await vscode.window.showTextDocument(doc);

      const action = await vscode.window.showInformationMessage(
        `Edit the plugin, then install it globally.`,
        'Install from this file…',
      );
      if (action !== 'Install from this file…') return;

      // Ask where to save it first
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), `${name}.yaml`)),
        filters: { 'PulseIR Driver Plugin': ['yaml'] },
        title: 'Save plugin YAML',
      });
      if (!saveUri) return;
      fs.writeFileSync(saveUri.fsPath, doc.getText());
      await runPluginCommand(['plugin', 'install', saveUri.fsPath]);
      driversProvider.refresh();
    }),
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

/**
 * Locate the pulse-ir CLI. Tried in order:
 *
 *  1. dist/src/cli.js bundled inside the installed extension package
 *     (extensionPath/dist/src/cli.js — set by vsce when packaging)
 *  2. dist/src/cli.js relative to __dirname for dev/source installs
 *     (__dirname is vscode/client/out/, three levels up is the repo root)
 *  3. 'pulse-ir' on PATH  (npm install -g pulse-ir)
 */
let _extensionPath = '';  // set in activate()

function findCli(): { cmd: string; isNode: boolean } {
  // 1. Packaged extension: extensionPath/dist/src/cli.js
  if (_extensionPath) {
    const p = path.join(_extensionPath, 'dist', 'src', 'cli.js');
    if (fs.existsSync(p)) return { cmd: p, isNode: true };
  }

  // 2. Dev / source install: repo-root/dist/src/cli.js
  //    __dirname = vscode/client/out/  →  ../../../ = repo root
  const devPath = path.resolve(__dirname, '..', '..', '..', 'dist', 'src', 'cli.js');
  if (fs.existsSync(devPath)) return { cmd: devPath, isNode: true };

  // 3. Global npm install
  return { cmd: 'pulse-ir', isNode: false };
}

async function runPluginCommand(args: string[]): Promise<void> {
  const { cmd, isNode } = findCli();
  const invocation = isNode
    ? `node "${cmd}" ${args.map(a => JSON.stringify(a)).join(' ')}`
    : `pulse-ir ${args.map(a => JSON.stringify(a)).join(' ')}`;

  const terminal = vscode.window.createTerminal({ name: 'PulseIR Plugins' });
  terminal.show(true);
  terminal.sendText(invocation);
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
