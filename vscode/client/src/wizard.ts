import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import * as os     from 'os';

// ---------------------------------------------------------------------------
// Board catalogue
// ---------------------------------------------------------------------------

interface Board {
  label:      string;
  id:         string;
  target:     'arduino' | 'espidf' | 'zephyr' | 'micropython';
  defines:    string[];
  coreGlobs:  string[];   // relative to arduino15 base dir
  intelliSenseMode: string;
}

const BOARDS: Board[] = [
  {
    label: 'Arduino Uno',       id: 'uno',     target: 'arduino',
    defines:  ['ARDUINO=10819', '__AVR_ATmega328P__'],
    coreGlobs: ['packages/arduino/hardware/avr/*/cores/arduino',
                'packages/arduino/hardware/avr/*/variants/standard'],
    intelliSenseMode: 'linux-gcc-avr',
  },
  {
    label: 'Arduino Mega 2560', id: 'mega',    target: 'arduino',
    defines:  ['ARDUINO=10819', '__AVR_ATmega2560__'],
    coreGlobs: ['packages/arduino/hardware/avr/*/cores/arduino',
                'packages/arduino/hardware/avr/*/variants/mega'],
    intelliSenseMode: 'linux-gcc-avr',
  },
  {
    label: 'Arduino Nano',      id: 'nano',    target: 'arduino',
    defines:  ['ARDUINO=10819', '__AVR_ATmega328P__'],
    coreGlobs: ['packages/arduino/hardware/avr/*/cores/arduino',
                'packages/arduino/hardware/avr/*/variants/eightanaloginputs'],
    intelliSenseMode: 'linux-gcc-avr',
  },
  {
    label: 'ESP32 — Arduino',   id: 'esp32-arduino', target: 'arduino',
    defines:  ['ARDUINO=10819', 'ESP32', 'ESP_PLATFORM'],
    coreGlobs: ['packages/esp32/hardware/esp32/*/cores/esp32',
                'packages/esp32/hardware/esp32/*/variants/esp32'],
    intelliSenseMode: 'linux-gcc-xtensa',
  },
  {
    label: 'ESP32 — ESP-IDF',   id: 'esp32-espidf', target: 'espidf',
    defines:  ['ESP32', 'ESP_PLATFORM', 'IDF_VER'],
    coreGlobs: [],
    intelliSenseMode: 'linux-gcc-arm',
  },
  {
    label: 'ESP8266',           id: 'esp8266', target: 'arduino',
    defines:  ['ARDUINO=10819', 'ESP8266'],
    coreGlobs: ['packages/esp8266/hardware/esp8266/*/cores/esp8266',
                'packages/esp8266/hardware/esp8266/*/variants/generic'],
    intelliSenseMode: 'linux-gcc-xtensa',
  },
  {
    label: 'Raspberry Pi Pico', id: 'pico',    target: 'arduino',
    defines:  ['ARDUINO=10819', 'ARDUINO_ARCH_RP2040'],
    coreGlobs: ['packages/rp2040/hardware/rp2040/*/cores/rp2040'],
    intelliSenseMode: 'linux-gcc-arm',
  },
  {
    label: 'Zephyr (generic)',  id: 'zephyr',  target: 'zephyr',
    defines:  ['CONFIG_ZEPHYR=1'],
    coreGlobs: [],
    intelliSenseMode: 'linux-gcc-arm',
  },
];

// ---------------------------------------------------------------------------
// Wizard entry point
// ---------------------------------------------------------------------------

export async function runNewProjectWizard(): Promise<void> {
  // Step 1 — project name
  const name = await vscode.window.showInputBox({
    title:         'New PulseIR Project (1/3) — Name',
    prompt:        'Project name (used as folder name and model ID)',
    placeHolder:   'my_state_machine',
    validateInput: v => /^[\w][\w_-]*$/.test(v) ? null : 'Letters, digits, _ or - only',
  });
  if (!name) return;

  // Step 2 — parent directory
  const parentDir = await pickDirectory();
  if (!parentDir) return;

  // Step 3 — board
  const boardPick = await vscode.window.showQuickPick(
    BOARDS.map(b => ({ label: b.label, description: b.target, board: b })),
    { title: 'New PulseIR Project (2/3) — Board', placeHolder: 'Select target board' },
  );
  if (!boardPick) return;

  // Step 4 — confirm / warn if folder exists
  const projectDir = path.join(parentDir, name);
  if (fs.existsSync(projectDir)) {
    const ok = await vscode.window.showWarningMessage(
      `Folder "${name}" already exists in that location. Continue and add files?`,
      { modal: true }, 'Continue',
    );
    if (!ok) return;
  }

  scaffoldProject(projectDir, name, boardPick.board);

  const action = await vscode.window.showInformationMessage(
    `PulseIR project "${name}" created.`,
    'Open', 'Open in New Window',
  );
  if (action) {
    vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(projectDir),
      action === 'Open in New Window',
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pickDirectory(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const items = [
    ...folders.map(f => ({ label: `$(folder) ${f.name}`, description: f.uri.fsPath, fsPath: f.uri.fsPath })),
    { label: '$(folder-opened) Browse…', description: 'Choose a folder on disk', fsPath: '' },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: 'New PulseIR Project (3/3) — Location',
    placeHolder: 'Where should the project folder be created?',
  });
  if (!pick) return undefined;
  if (pick.fsPath) return pick.fsPath;

  const chosen = await vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false, openLabel: 'Select Folder',
  });
  return chosen?.[0]?.fsPath;
}

function arduino15Dir(): string {
  const h = os.homedir();
  if (process.platform === 'win32') return path.join(process.env['APPDATA'] ?? h, 'Arduino15');
  if (process.platform === 'darwin') return path.join(h, 'Library', 'Arduino15');
  return path.join(h, '.arduino15');
}

function buildIncludePaths(board: Board): string[] {
  if (board.target === 'espidf') {
    const idf = process.env['IDF_PATH'] ?? '${env:IDF_PATH}';
    return ['${workspaceFolder}/**', `${idf}/components/*/include`];
  }
  const base = arduino15Dir();
  return [
    '${workspaceFolder}/**',
    ...board.coreGlobs.map(g => path.join(base, g)),
  ];
}

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------

function scaffoldProject(dir: string, name: string, board: Board): void {
  fs.mkdirSync(path.join(dir, 'src'),     { recursive: true });
  fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });

  const modelId = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  // Model template
  fs.writeFileSync(
    path.join(dir, `${modelId}.pulse.yaml`),
    modelTemplate(modelId),
    'utf8',
  );

  // c_cpp_properties.json
  const cppProps = {
    configurations: [{
      name:             board.label,
      includePath:      buildIncludePaths(board),
      defines:          board.defines,
      cStandard:        'c17',
      cppStandard:      'c++17',
      intelliSenseMode: board.intelliSenseMode,
    }],
    version: 4,
  };
  fs.writeFileSync(
    path.join(dir, '.vscode', 'c_cpp_properties.json'),
    JSON.stringify(cppProps, null, 2),
    'utf8',
  );

  // Workspace settings: pre-select the matching PulseIR target
  const settings = { 'pulseir.target': board.target };
  fs.writeFileSync(
    path.join(dir, '.vscode', 'settings.json'),
    JSON.stringify(settings, null, 2),
    'utf8',
  );
}

function modelTemplate(id: string): string {
  return `pulseir:
  name: ${id}
  version: "1.0"

parameters:
  - name: interval_ms
    type: int
    default: 500

states:
  - name: idle
    entry: [on_enter_idle]

  - name: active
    entry: [on_enter_active]
    exit:  [on_exit_active]

transitions:
  - from: idle
    to:   active
    on:   start

  - from: active
    to:   idle
    on:   stop

events:
  - name: start
  - name: stop

actions:
  on_enter_idle:
  on_enter_active:
  on_exit_active:
`;
}
