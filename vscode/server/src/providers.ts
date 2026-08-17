/**
 * LSP intelligence providers: completions, hover, and quick-fix code actions.
 */

import {
  CompletionItem,
  CompletionItemKind,
  Hover,
  MarkupKind,
  CodeAction,
  CodeActionKind,
  TextEdit,
} from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Position, Range, Diagnostic } from 'vscode-languageserver-types';

// ---------------------------------------------------------------------------
// Model names extracted from a successful parse
// ---------------------------------------------------------------------------

export interface ModelNames {
  states:        string[];
  events:        string[];
  allParams:     string[];
  intParams:     string[];
  busNames:      string[];
  actionNames:   string[];
  guardNames:    string[];
}

export const EMPTY_MODEL: ModelNames = {
  states: [], events: [], allParams: [], intParams: [], busNames: [], actionNames: [], guardNames: [],
};

// ---------------------------------------------------------------------------
// Static completion data
// ---------------------------------------------------------------------------

const mk = (label: string, detail: string, doc?: string): CompletionItem => ({
  label,
  kind: CompletionItemKind.EnumMember,
  detail,
  documentation: doc ? { kind: MarkupKind.Markdown, value: doc } : undefined,
});

const BOARD_ITEMS: CompletionItem[] = [
  mk('esp32',     'Espressif ESP32'),
  mk('esp8266',   'Espressif ESP8266'),
  mk('uno',       'Arduino Uno (ATmega328P)'),
  mk('mega',      'Arduino Mega (ATmega2560)'),
  mk('mega2560',  'Arduino Mega 2560'),
  mk('nano',      'Arduino Nano (ATmega328P)'),
  mk('nano33iot', 'Arduino Nano 33 IoT'),
  mk('rp2040',    'Raspberry Pi Pico (RP2040)'),
  mk('teensy40',  'Teensy 4.0 (iMXRT1062)'),
  mk('stm32f4',   'STM32F4 Discovery'),
];

const DEVICE_TYPE_ITEMS: CompletionItem[] = [
  mk('digital_input',  'GPIO digital input',                   'Reads HIGH/LOW from a GPIO pin.'),
  mk('digital_output', 'GPIO digital output',                  'Drives a GPIO pin HIGH or LOW.'),
  mk('pwm_output',     'PWM output',                           'Drives a pin with pulse-width modulation.'),
  mk('analog_input',   'ADC analog input',                     'Reads a voltage level via ADC.'),
  mk('dht22',          'DHT22 temperature + humidity sensor',  'Requires the DHT library.'),
  mk('dht11',          'DHT11 temperature + humidity sensor',  'Lower accuracy than DHT22.'),
  mk('bme280',         'BME280 temp + humidity + pressure',    'I2C or SPI. Requires the BME280 library.'),
  mk('ds18b20',        'DS18B20 1-Wire temperature sensor',    'Requires OneWire + DallasTemperature.'),
  mk('lcd_i2c',        'LCD character display via I2C',        'e.g. 16x2 with PCF8574 backpack.'),
  mk('oled_i2c',       'OLED display via I2C',                 'e.g. SSD1306 128x64.'),
  mk('ds3231',         'DS3231 RTC module',                    'High-accuracy I2C real-time clock.'),
  mk('ds1307',         'DS1307 RTC module',                    'Basic I2C real-time clock.'),
];

const INTERFACE_ITEMS: CompletionItem[] = [
  mk('gpio',     'General Purpose I/O'),
  mk('pwm',      'Pulse Width Modulation'),
  mk('adc',      'Analog to Digital Converter'),
  mk('uart',     'Universal Async Receiver-Transmitter'),
  mk('i2c',      'I²C / TWI bus',      'Requires `sda:` and `scl:` pin bindings.'),
  mk('spi',      'SPI bus',            'Requires `sck:`, `miso:`, `mosi:` pin bindings.'),
  mk('can',      'CAN bus'),
  mk('onewire',  '1-Wire bus',         'Requires `pin:` binding.'),
  mk('wifi',     'Wi-Fi interface'),
  mk('ethernet', 'Ethernet interface'),
  mk('ble',      'Bluetooth Low Energy'),
  mk('mqtt',     'MQTT protocol layer'),
  mk('eeprom',   'EEPROM storage'),
  mk('littlefs', 'LittleFS flash filesystem'),
  mk('ota',      'Over-the-air update'),
  mk('custom',   'Custom / user-defined interface'),
];

const PARAM_TYPE_ITEMS: CompletionItem[] = [
  mk('int',    'Integer (milliseconds, counts, pin numbers)'),
  mk('float',  'Floating-point (thresholds, factors)'),
  mk('bool',   'Boolean flag'),
  mk('string', 'String value'),
];

const CLASS_ITEMS: CompletionItem[] = [
  mk('sensor',   'Reads data (temperature, humidity, GPIO state)'),
  mk('actuator', 'Controls an output (LED, motor, relay, display)'),
  mk('service',  'Background service (network, filesystem)'),
];

const EVENT_SOURCE_ITEMS: CompletionItem[] = [
  mk('external', 'Raised from outside the HSM (sensors, MQTT, buttons)'),
  mk('internal', 'Raised by state actions or tasks'),
  mk('timer',    'Raised by a timer tick'),
];

const STATE_TYPE_ITEMS: CompletionItem[] = [
  mk('simple',     'Leaf state — no child states'),
  mk('composite',  'Contains child states with one active at a time'),
  mk('orthogonal', 'Contains parallel regions, all active simultaneously'),
];

const COMMAND_SOURCE_ITEMS: CompletionItem[] = [
  mk('console', 'USB/Serial console (Arduino Serial)'),
  mk('uart',    'Hardware UART serial port'),
  mk('serial',  'Arduino Serial object alias'),
];

const BOOL_ITEMS: CompletionItem[] = [
  mk('true', 'Boolean true'),
  mk('false', 'Boolean false'),
];

// ---------------------------------------------------------------------------
// Key documentation
// ---------------------------------------------------------------------------

const KEY_DOCS: Record<string, string> = {
  // Top-level
  pulseir:       'Schema version. Use `"1"` for the current schema.',
  project:       'Project metadata: name, version, author, description.',
  target:        'Target platform — selects a board, enables pin validation.',
  hardware:      'Physical hardware: buses (I2C, SPI, …) and devices (sensors, actuators).',
  parameters:    'Tunable runtime values (intervals, thresholds). Can reference them in `every:` / `after:` fields.',
  events:        'Named signals the state machine can react to.',
  machine:       'The hierarchical state machine: states and transitions.',
  actions:       'Named side-effect catalogue. Transitions reference entries here with `do:`.',
  tasks:         'Periodic background work that runs on a fixed interval without a state machine.',
  commands:      'Command dispatch table — a line of text in, a named action out.',
  libraries:     'Third-party Arduino/C++ libraries to `#include`.',
  telemetry:     'Sensor telemetry publishing (e.g. to MQTT).',
  communication: 'MQTT publish / subscribe wiring.',
  safety:        'Safety rules checked every loop iteration.',
  diagnostics:   'Watchdog, heartbeat LED, and log-level settings.',
  imports:       'File paths to merge into this model (e.g. `- hardware.yaml`).',

  // project.*
  name:        'Human-readable project name.',
  version:     'Semantic version string, e.g. `"1.0.0"`.',
  description: 'One-sentence summary of what this model does.',
  author:      'Author name or email.',

  // target.*
  board:   'Target board ID. Enables pin-number validation and board-specific code paths.',
  verbose: 'Emit extra comments in generated C++ for easier reading.',

  // hardware.devices.*
  type:    'Device type — determines driver and default class (sensor / actuator).',
  class:   'Device class: `sensor`, `actuator`, or `service`.',
  bus:     'Bus name this device is wired to (must be declared under `hardware.buses`).',
  pin:     'GPIO pin number (for single-pin devices).',
  driver:  'Override the generated driver function name.',
  channels:'Sensor channels for multi-value devices (e.g. temperature + humidity).',

  // hardware.buses.*
  interface: 'Bus protocol — determines which driver and which pin fields are required.',
  sda:       'I²C data pin number.',
  scl:       'I²C clock pin number.',
  sck:       'SPI clock pin.',
  miso:      'SPI MISO pin.',
  mosi:      'SPI MOSI pin.',
  tx:        'UART transmit pin.',
  rx:        'UART receive pin.',
  speed:     'Bus speed in Hz (e.g. `400000` for 400 kHz I²C).',

  // parameters.*
  default: 'Default value used at boot.',
  min:     'Minimum allowed value (for range validation).',
  max:     'Maximum allowed value. Pair with `min:` as a `range: [min, max]` list.',
  unit:    'Physical unit, e.g. `"ms"`, `"°C"`, `"%"`.',
  persist: 'Survive reboot — store in EEPROM / NVS. Requires a supported interface.',
  range:   'Shorthand for `[min, max]`, e.g. `range: [10, 90]`.',

  // events.*
  source:  'Who raises this event: `external`, `internal`, or `timer`.',
  payload: 'Optional data payload schema (key → type mapping).',

  // machine.*
  states:      'Map of named states. Values are state definitions.',
  transitions: 'Ordered list of transition rules. First match wins.',
  initial:     'Which child state to enter first in a composite state.',
  entry:       'Action(s) to run when entering this state.',
  exit:        'Action(s) to run when leaving this state.',
  regions:     'Parallel regions for orthogonal (concurrent) states.',

  // transitions[].*
  from:  'Source state name, or `"*"` to match any state.',
  to:    'Target state name to transition into.',
  on:    'Event name that triggers this transition, or `"*"` for any event.',
  after: 'Fire once after this many milliseconds, or a parameter name.',
  every: 'Fire repeatedly every N ms (or parameter name). Stays in the source state.',
  guard: 'C function name — must return `bool`. Transition fires only when it returns `true`.',
  do:    'Action name(s) to execute when the transition fires.',

  // tasks.*
  log: 'Printf-style log template, e.g. `"temp={temperature}°C"`. `{name}` refers to a parameter or sensor.',

  // commands.*
  map:            'Command-to-action mapping. Keys are exact command strings.',
  report_unknown: 'Log a warning when an unrecognised command arrives. Default: `true`.',
};

// ---------------------------------------------------------------------------
// YAML context detection
// ---------------------------------------------------------------------------

function getIndent(line: string): number {
  return (line.match(/^(\s*)/) ?? ['', ''])[1].length;
}

/**
 * Walk backward from `lineIndex` and collect ancestor key names.
 * List items (`- key:`) contribute a `[]` pseudo-segment.
 */
function getAncestorPath(lines: string[], lineIndex: number): string[] {
  const currentLine = lines[lineIndex] ?? '';
  let targetIndent  = getIndent(currentLine);

  // If the current line is itself a list item, its parent indent is its own
  // indent (the `-` is at `targetIndent`, not inside it).
  const isListItem = currentLine.trimStart().startsWith('-');
  if (isListItem) targetIndent = getIndent(currentLine);

  const path: string[] = [];

  for (let i = lineIndex - 1; i >= 0 && targetIndent > 0; i--) {
    const line    = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = getIndent(line);
    if (indent >= targetIndent) continue;

    if (trimmed.startsWith('-')) {
      // List item boundary
      path.unshift('[]');
      targetIndent = indent;
      continue;
    }

    const m = trimmed.match(/^([\w][\w_-]*):/);
    if (m) {
      path.unshift(m[1]);
      targetIndent = indent;
    }
  }

  return path;
}

function pathContains(path: string[], ...keys: string[]): boolean {
  return keys.every(k => path.includes(k));
}

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

function nameItems(names: string[], kind: CompletionItemKind, detail?: string): CompletionItem[] {
  return names.map(n => ({ label: n, kind, detail }));
}

function getValueCompletions(
  valueKey: string,
  ancestorPath: string[],
  model: ModelNames,
): CompletionItem[] {
  // `board:` anywhere
  if (valueKey === 'board') return BOARD_ITEMS;

  // `interface:` under buses
  if (valueKey === 'interface' && pathContains(ancestorPath, 'hardware', 'buses')) {
    return INTERFACE_ITEMS;
  }

  // `type:` — context-dependent
  if (valueKey === 'type') {
    if (pathContains(ancestorPath, 'hardware', 'devices')) return DEVICE_TYPE_ITEMS;
    if (pathContains(ancestorPath, 'parameters'))          return PARAM_TYPE_ITEMS;
    if (pathContains(ancestorPath, 'machine', 'states'))   return STATE_TYPE_ITEMS;
  }

  // `class:` under devices
  if (valueKey === 'class' && pathContains(ancestorPath, 'hardware', 'devices')) {
    return CLASS_ITEMS;
  }

  // `bus:` under devices — offer declared bus names
  if (valueKey === 'bus' && pathContains(ancestorPath, 'hardware', 'devices')) {
    return nameItems(model.busNames, CompletionItemKind.Reference, 'declared bus');
  }

  // `source:` — context-dependent
  if (valueKey === 'source') {
    if (pathContains(ancestorPath, 'events'))    return EVENT_SOURCE_ITEMS;
    if (pathContains(ancestorPath, 'commands'))  return COMMAND_SOURCE_ITEMS;
  }

  // State machine references
  if ((valueKey === 'from' || valueKey === 'to' || valueKey === 'initial') &&
      pathContains(ancestorPath, 'machine')) {
    const items = nameItems(model.states, CompletionItemKind.EnumMember, 'state');
    if (valueKey === 'from') items.push(mk('*', 'Any state (wildcard)'));
    return items;
  }

  // Event reference
  if (valueKey === 'on' && pathContains(ancestorPath, 'machine', 'transitions')) {
    const items = nameItems(model.events, CompletionItemKind.Event, 'event');
    items.push(mk('*', 'Any event (wildcard)'));
    return items;
  }

  // Interval fields → int parameter names
  if (valueKey === 'every' || valueKey === 'after') {
    return nameItems(model.intParams, CompletionItemKind.Variable, 'int parameter');
  }

  // Action references (`do:`, `entry:`, `exit:`, `response:`)
  if (valueKey === 'do' || valueKey === 'entry' || valueKey === 'exit' || valueKey === 'response') {
    return nameItems(model.actionNames, CompletionItemKind.Function, 'action');
  }

  // Boolean fields
  if (valueKey === 'verbose' || valueKey === 'persist' || valueKey === 'report_unknown') {
    return BOOL_ITEMS;
  }

  return [];
}

function getKeyCompletions(ancestorPath: string[]): CompletionItem[] {
  const kw = (label: string, snippet?: string): CompletionItem => ({
    label: label + ':',
    insertText: snippet ?? label,
    filterText: label,
    kind: CompletionItemKind.Keyword,
    documentation: KEY_DOCS[label]
      ? { kind: MarkupKind.Markdown, value: KEY_DOCS[label] }
      : undefined,
  });

  // Top-level — no ancestors
  if (ancestorPath.length === 0) {
    return ['pulseir', 'project', 'target', 'hardware', 'parameters', 'events',
            'machine', 'actions', 'tasks', 'commands', 'libraries', 'imports',
            'telemetry', 'communication', 'safety', 'diagnostics'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'project')) {
    return ['name', 'version', 'description', 'author'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'target')) {
    return ['board', 'verbose', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'hardware') && !pathContains(ancestorPath, 'devices', 'buses')) {
    return ['devices', 'buses'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'hardware', 'devices')) {
    return ['type', 'class', 'bus', 'pin', 'driver', 'channels', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'hardware', 'buses')) {
    return ['interface', 'sda', 'scl', 'sck', 'miso', 'mosi', 'tx', 'rx',
            'pin', 'speed', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'parameters') && !pathContains(ancestorPath, 'hardware')) {
    return ['type', 'default', 'min', 'max', 'range', 'unit', 'persist', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'events') && !pathContains(ancestorPath, 'machine')) {
    return ['source', 'description', 'payload'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'machine') && !pathContains(ancestorPath, 'transitions', 'states')) {
    return ['states', 'transitions', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'machine', 'transitions')) {
    return ['from', 'to', 'on', 'after', 'every', 'guard', 'do', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'machine', 'states')) {
    return ['type', 'initial', 'entry', 'exit', 'states', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'tasks') && !pathContains(ancestorPath, 'machine')) {
    return ['every', 'do', 'log', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'actions')) {
    return ['type', 'driver', 'params', 'description'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'commands')) {
    return ['source', 'map', 'report_unknown'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'diagnostics')) {
    return ['watchdog', 'heartbeat', 'log_level'].map(k => kw(k));
  }

  if (pathContains(ancestorPath, 'safety')) {
    return ['check', 'severity', 'response', 'to', 'latching', 'reset_when', 'restore', 'description'].map(k => kw(k));
  }

  return [];
}

export function getCompletions(
  doc: TextDocument,
  position: Position,
  model: ModelNames,
): CompletionItem[] {
  const text  = doc.getText();
  const lines = text.split('\n');
  const line  = lines[position.line] ?? '';
  const before = line.slice(0, position.character);

  // Are we completing a value?  Match `  key: <cursor>` or `  - key: <cursor>`
  const valueMatch = before.match(/^[\s-]*(\w[\w_-]*):\s*(\S*)$/);
  if (valueMatch) {
    const valueKey    = valueMatch[1];
    const ancestors   = getAncestorPath(lines, position.line);
    return getValueCompletions(valueKey, ancestors, model);
  }

  // Are we completing a key?  Match whitespace + optional partial word, no colon yet.
  const keyMatch = before.match(/^(\s*)([\w_-]*)$/);
  if (keyMatch) {
    const ancestors = getAncestorPath(lines, position.line);
    return getKeyCompletions(ancestors);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export function getHover(doc: TextDocument, position: Position): Hover | null {
  const line  = doc.getText().split('\n')[position.line] ?? '';
  const match = line.match(/^[\s-]*(\w[\w_-]*):/);
  if (!match) return null;

  const key = match[1];
  const doc_ = KEY_DOCS[key];
  if (!doc_) return null;

  const keyStart = line.indexOf(key);
  return {
    contents: { kind: MarkupKind.Markdown, value: `**\`${key}\`** — ${doc_}` },
    range: {
      start: { line: position.line, character: keyStart },
      end:   { line: position.line, character: keyStart + key.length },
    },
  };
}

// ---------------------------------------------------------------------------
// Code actions (quick fix)
// ---------------------------------------------------------------------------

export function getCodeActions(
  doc:         TextDocument,
  _range:      Range,
  diagnostics: Diagnostic[],
): CodeAction[] {
  const actions: CodeAction[] = [];
  const lines = doc.getText().split('\n');

  for (const diag of diagnostics) {
    // Look for "Known parameters: X, Y." pattern
    const knownMatch = diag.message.match(/Known parameters:\s*([^.]+)\./);
    // Also handle "Available: X, Y." pattern from other errors
    const availMatch = diag.message.match(/Available:\s*([^.]+)\./);
    const altsStr = knownMatch?.[1] ?? availMatch?.[1];
    if (!altsStr) continue;

    const alternatives = altsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (alternatives.length === 0) continue;

    // Find the bad value — last quoted string before "which is not"
    const badMatch = diag.message.match(/"([^"]+)"(?=[^"]*which is not)/);
    const badValue = badMatch?.[1];
    if (!badValue) continue;

    const errorLine = lines[diag.range.start.line] ?? '';
    const col = errorLine.indexOf(badValue);
    if (col === -1) continue;

    const replaceRange: Range = {
      start: { line: diag.range.start.line, character: col },
      end:   { line: diag.range.start.line, character: col + badValue.length },
    };

    for (const alt of alternatives) {
      const edit: TextEdit = { range: replaceRange, newText: alt };
      actions.push({
        title: `Change to "${alt}"`,
        kind:  CodeActionKind.QuickFix,
        diagnostics: [diag],
        edit:  { changes: { [doc.uri]: [edit] } },
        isPreferred: alternatives.length === 1,
      });
    }
  }

  return actions;
}
