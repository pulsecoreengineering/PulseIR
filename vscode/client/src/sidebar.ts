import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import * as os     from 'os';

// ---------------------------------------------------------------------------
// Models tree — lists every *.pulse.yaml in the workspace
// ---------------------------------------------------------------------------

export class PulseIRModelsProvider implements vscode.TreeDataProvider<ModelItem> {
  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  constructor(context: vscode.ExtensionContext) {
    const w    = vscode.workspace.createFileSystemWatcher('**/*.pulse.{yaml,yml}');
    const fire = () => this._onChange.fire();
    context.subscriptions.push(w, w.onDidCreate(fire), w.onDidDelete(fire));
  }

  refresh(): void { this._onChange.fire(); }

  getTreeItem(el: ModelItem): vscode.TreeItem { return el; }

  async getChildren(): Promise<ModelItem[]> {
    const uris = await vscode.workspace.findFiles('**/*.pulse.{yaml,yml}', '**/node_modules/**');
    return uris
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
      .map(u => new ModelItem(u));
  }
}

export class ModelItem extends vscode.TreeItem {
  constructor(public readonly uri: vscode.Uri) {
    const base = path.basename(uri.fsPath).replace(/\.pulse\.(yaml|yml)$/, '');
    super(base, vscode.TreeItemCollapsibleState.None);
    this.resourceUri  = uri;
    this.contextValue = 'pulseirModel';
    this.tooltip      = vscode.workspace.asRelativePath(uri);
    this.description  = vscode.workspace.asRelativePath(path.dirname(uri.fsPath));
    this.iconPath     = new vscode.ThemeIcon('symbol-event');
    this.command      = { command: 'vscode.open', title: 'Open', arguments: [uri] };
  }
}

// ---------------------------------------------------------------------------
// Project tree — shows current target, output dir, generate-on-save toggle
// ---------------------------------------------------------------------------

export class PulseIRProjectProvider implements vscode.TreeDataProvider<ProjectItem> {
  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('pulseir')) this._onChange.fire();
      }),
    );
  }

  refresh(): void { this._onChange.fire(); }

  getTreeItem(el: ProjectItem): vscode.TreeItem { return el; }

  getChildren(): ProjectItem[] {
    const cfg    = vscode.workspace.getConfiguration('pulseir');
    const target = cfg.get<string>('target', 'arduino');
    const outDir = cfg.get<string>('outputDirectory', '') || '(model directory)';
    const onSave = cfg.get<boolean>('generateOnSave', false);

    return [
      new ProjectItem('Target',           target,              'circuit-board', 'pulseir.selectTarget'),
      new ProjectItem('Output',           outDir,              'folder',        undefined),
      new ProjectItem('Generate on save', onSave ? 'on' : 'off', 'sync',       'pulseir.toggleGenerateOnSave'),
    ];
  }
}

class ProjectItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string, cmd?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath    = new vscode.ThemeIcon(icon);
    if (cmd) this.command = { command: cmd, title: label };
  }
}

// ---------------------------------------------------------------------------
// Drivers tree — lists plugins installed in ~/.pulseir/drivers/
// ---------------------------------------------------------------------------

function globalDriversDir(): string {
  return path.join(os.homedir(), '.pulseir', 'drivers');
}

export class PulseIRDriversProvider implements vscode.TreeDataProvider<DriverItem | NoDriversItem> {
  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  refresh(): void { this._onChange.fire(); }

  getTreeItem(el: DriverItem | NoDriversItem): vscode.TreeItem { return el; }

  getChildren(): (DriverItem | NoDriversItem)[] {
    const dir = globalDriversDir();
    if (!fs.existsSync(dir)) return [new NoDriversItem()];
    const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/i.test(f));
    if (files.length === 0) return [new NoDriversItem()];
    return files.map(f => new DriverItem(path.join(dir, f)));
  }
}

export class DriverItem extends vscode.TreeItem {
  readonly filePath: string;
  readonly driverName: string;

  constructor(filePath: string) {
    const base = path.basename(filePath).replace(/\.ya?ml$/i, '');
    super(base, vscode.TreeItemCollapsibleState.None);
    this.filePath   = filePath;
    this.driverName = base;
    this.iconPath   = new vscode.ThemeIcon('plug');
    this.contextValue = 'pulseirDriver';
    this.tooltip    = filePath;

    // Try to add platform list as description
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const platforms = [...text.matchAll(/^  (\w+):/gm)].map(m => m[1]).filter(p => p !== 'description' && p !== 'driver');
      if (platforms.length) this.description = platforms.join(', ');
    } catch { /* ignore */ }

    this.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(filePath)] };
  }
}

class NoDriversItem extends vscode.TreeItem {
  constructor() {
    super('No plugins installed', vscode.TreeItemCollapsibleState.None);
    this.description = 'Use "Install Plugin" to add one';
    this.iconPath    = new vscode.ThemeIcon('info');
  }
}
