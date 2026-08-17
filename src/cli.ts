#!/usr/bin/env node

/**
 * PulseIR CLI
 *
 * Subcommands:
 *   pulse-ir init [name]                Scaffold a new project YAML
 *   pulse-ir validate <file>            Parse + validate; no codegen
 *   pulse-ir <file> [options]           Generate C++ (default)
 *
 * Generate options:
 *   --target <name>      Target platform: arduino (default) | espidf
 *   --outdir <dir>       Write a ready-to-build sketch folder (recommended)
 *   --output <file>      Write a single self-contained sketch
 *   --topics <file>      Write the MQTT topic manifest (JSON)
 *   --libraries <file>   Write the library manifest (JSON)
 *   --namespace <name>   Topic namespace (defaults to the project name)
 *   --watch              Rebuild whenever the model file (or any include) changes
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Parser } from './parser/index.js';
import { FileResolver } from './parser/fs-resolver.js';
import type { SourceResolver } from './parser/resolver.js';
import { Codegen } from './codegen/index.js';
import type { GeneratedProject } from './codegen/index.js';
import type { PulseProject } from './model/index.js';
import type { PlatformBackend } from './codegen/backend.js';
import { ArduinoBackend } from './codegen/arduino.js';
import { EspIdfBackend } from './codegen/espidf.js';
import { ZephyrBackend } from './codegen/zephyr.js';
import { MicroPythonCodegen } from './codegen/micropython.js';
import { TopicEmitter } from './emit/topics.js';
import { LibraryEmitter } from './emit/libraries.js';
import { DiagramEmitter } from './emit/diagram.js';
import { CmakeEmitter } from './emit/cmake.js';
import { ZephyrProjectEmitter } from './emit/zephyr_project.js';
import { Validator } from './analysis/validate.js';
import { loadBoard, resolveBoard, checkFrameworkCompatibility, checkPinCapabilities } from './parser/board-resolver.js';

// ---------------------------------------------------------------------------
// TrackingFileResolver — records every file path that the parser reads so
// --watch can set up inotify watchers on all of them, including includes.
// ---------------------------------------------------------------------------

class TrackingFileResolver implements SourceResolver {
  private inner: FileResolver;
  readonly loaded = new Set<string>();

  constructor(baseDir?: string) {
    this.inner = new FileResolver(baseDir);
  }

  resolve(ref: string, from: string | null): string {
    return this.inner.resolve(ref, from);
  }

  read(id: string): string {
    this.loaded.add(id);
    return this.inner.read(id);
  }
}

// ---------------------------------------------------------------------------
// USAGE
// ---------------------------------------------------------------------------

const USAGE = `Usage: pulse-ir <command> [args] [options]

Commands:
  init [name]          Scaffold a new project YAML (name defaults to "my_project")
  validate <file>      Parse and validate; print diagnostics; no codegen
  <file>               Generate C++ from a model (default command)

Generate options:
  --target <name>      Code generation target (default: arduino)
                         arduino     Arduino / Arduino-compatible boards
                         espidf      Espressif IoT Development Framework (ESP32)
                         micropython MicroPython (generates main.py)
                         zephyr      Zephyr RTOS (west-compatible C++ project)
  --board <id>         Board profile for logical pin resolution (e.g. esp32_devkit_v4)
                         Logical names (LED, I2C_SDA) are resolved to physical pins
                         before codegen. Physical GPIO names pass through unchanged.
  --cmake              Generate CMakeLists.txt alongside the code (ESP-IDF only)
  --outdir <dir>       Write a ready-to-build sketch folder (recommended)
  --output <file>      Write a single self-contained sketch
  --topics <file>      Write the MQTT topic manifest (JSON)
  --libraries <file>   Write the library manifest (JSON)
  --diagram <file>     Write a Mermaid state machine diagram (.md or .mmd)
  --namespace <name>   Topic namespace (defaults to the project name)
  --watch              Rebuild on model file changes

A model may "include" other files; paths are resolved relative to the file
that lists them. With --watch, all included files are watched.`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const sub = args[0];

  if (sub === 'init') {
    cmdInit(args.slice(1));
    return;
  }

  if (sub === 'validate') {
    cmdValidate(args.slice(1));
    return;
  }

  // Default: generate
  await cmdGenerate(args);
}

// ---------------------------------------------------------------------------
// pulse-ir init [name]
// ---------------------------------------------------------------------------

function cmdInit(args: string[]): void {
  const name = args[0] && !args[0].startsWith('--') ? args[0] : 'my_project';
  const filename = `${name}.yaml`;
  const target = path.resolve(filename);

  if (fs.existsSync(target)) {
    console.error(`❌ ${filename} already exists. Remove it or choose a different name.`);
    process.exit(1);
  }

  const template = `pulseir: "1"

project:
  name: ${name}
  version: "1.0"
  description: ""

# Uncomment and fill in your target board:
# target:
#   board: esp32

# Hardware — declare what is wired up. Examples:
# hardware:
#   devices:
#     status_led: { type: digital_output, pin: GPIO2 }
#   buses:
#     wire0: { interface: i2c, sda: 21, scl: 22 }

# Named parameters with types and ranges:
# parameters:
#   interval_ms: { type: int, default: 1000, range: [100, 60000], unit: ms }

# Periodic tasks (no state machine needed):
# tasks:
#   heartbeat:
#     every: 1000
#     do: toggle_led

# State machine (optional):
# events:
#   START: { source: external }
#
# machine:
#   states:
#     idle:
#     running:
#   transitions:
#     - { from: idle, on: START, to: running }

# Serial command interface (optional):
# commands:
#   console: { port: 0, baud: 115200 }
#   map:
#     start: { event: START }
`;

  fs.writeFileSync(target, template, 'utf8');
  console.log(`✓ Created ${filename}`);
  console.log(`\nNext steps:`);
  console.log(`  pulse-ir validate ${filename}   # check the model`);
  console.log(`  pulse-ir ${filename} --outdir out  # generate a sketch folder`);
}

// ---------------------------------------------------------------------------
// pulse-ir validate <file>
// ---------------------------------------------------------------------------

function cmdValidate(args: string[]): void {
  const inputFile = args[0];
  if (!inputFile || inputFile.startsWith('--')) {
    console.error('Usage: pulse-ir validate <file>');
    process.exit(1);
  }

  try {
    const parser = new Parser();
    const resolver = new TrackingFileResolver();
    const project = parser.parseFrom(path.resolve(inputFile), resolver);
    const result = new Validator().validate(project, parser.warnings);

    if (result.diagnostics.length === 0) {
      console.log(`✓ ${inputFile} — no issues`);
      return;
    }

    for (const d of result.diagnostics) {
      const icon = d.severity === 'error' ? '❌' : '⚠️ ';
      console.log(`${icon} [${d.code}] ${d.message}`);
    }

    if (result.errorCount > 0) {
      console.error(`\n${result.errorCount} error(s), ${result.warningCount} warning(s)`);
      process.exit(1);
    } else {
      console.warn(`\n${result.warningCount} warning(s)`);
    }
  } catch (error) {
    printError(error);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// pulse-ir <file> [options] [--watch]
// ---------------------------------------------------------------------------

async function cmdGenerate(args: string[]): Promise<void> {
  const inputFile = args[0];
  if (!inputFile || inputFile.startsWith('--')) {
    console.error(USAGE);
    process.exit(1);
  }

  const flag = (name: string): string | null => {
    const idx = args.indexOf(name);
    if (idx === -1) return null;
    const value = args[idx + 1];
    if (!value || value.startsWith('--')) {
      console.error(`❌ ${name} requires a value`);
      process.exit(1);
    }
    return value;
  };
  const hasFlag = (name: string): boolean => args.includes(name);

  const targetName    = flag('--target') ?? 'arduino';
  const isMicroPython = /^micropython$/i.test(targetName.replace(/[-_]/g, ''));
  const isZephyr      = /^zephyr$/i.test(targetName.replace(/[-_]/g, ''));
  const backend       = isMicroPython ? null : resolveBackend(targetName);
  const boardId       = flag('--board');
  const outputFile    = flag('--output');
  const outDir        = flag('--outdir');
  const topicsFile    = flag('--topics');
  const librariesFile = flag('--libraries');
  const diagramFile   = flag('--diagram');
  const namespace     = flag('--namespace');
  const emitCmake     = hasFlag('--cmake');
  const watch         = hasFlag('--watch');

  const build = (): Set<string> => {
    const resolver = new TrackingFileResolver();
    try {
      console.log(`📖 Reading ${inputFile}...`);
      const parser = new Parser();
      let project = parser.parseFrom(path.resolve(inputFile), resolver);
      console.log(`✓ Parsed project: ${project.name}`);

      for (const warning of parser.warnings) {
        console.warn(`⚠️  ${warning}`);
      }

      // Board resolution: translate logical pin names to physical GPIO identifiers.
      const effectiveBoardId = boardId ?? project.target?.board;
      if (effectiveBoardId) {
        try {
          const board = loadBoard(effectiveBoardId);
          console.log(`📋 Board: ${board.name}`);
          const compat = checkFrameworkCompatibility(board, targetName);
          if (compat) console.warn(`⚠️  ${compat}`);
          project = resolveBoard(project, board);

          // Pin capability check — runs after resolution so physical GPIO
          // identifiers are already in place (logical names like LED_BUILTIN
          // have been rewritten to GPIO2 etc.).
          const pinViolations = checkPinCapabilities(project, board);
          for (const v of pinViolations) {
            if (v.severity === 'error') {
              console.error(`❌ [board] ${v.message}`);
            } else {
              console.warn(`⚠️  [board] ${v.message}`);
            }
          }
          if (pinViolations.some(v => v.severity === 'error')) {
            if (!watch) process.exit(1);
          }
        } catch (err) {
          if (err instanceof Error) {
            console.error(`❌ Board error: ${err.message}`);
          }
          if (!watch) process.exit(1);
        }
      }

      const validationResult = new Validator().validate(project, parser.warnings);
      for (const d of validationResult.diagnostics.filter(d => d.severity === 'error')) {
        console.error(`❌ [${d.code}] ${d.message}`);
      }
      for (const d of validationResult.diagnostics.filter(d => d.severity === 'warning')) {
        console.warn(`⚠️  [${d.code}] ${d.message}`);
      }

      // MicroPython target — Python codegen, no C++ artifacts.
      if (isMicroPython) {
        const mpCodegen = new MicroPythonCodegen();
        if (outDir) {
          console.log('🔨 Generating MicroPython project...');
          writeProject(path.resolve(outDir), mpCodegen.generateFiles(project));
        } else if (outputFile) {
          console.log('🔨 Generating main.py...');
          const py = mpCodegen.generate(project);
          const op = path.resolve(outputFile);
          fs.writeFileSync(op, py);
          console.log(`✓ Written to ${op}`);
        } else {
          console.log(mpCodegen.generate(project));
        }
        console.log('✨ Done');
        return resolver.loaded;
      }

      // C++ targets (arduino, espidf).
      if (topicsFile) {
        console.log('📡 Generating MQTT topic manifest...');
        const manifest = new TopicEmitter().toJSON(project, namespace ?? undefined);
        const tp = path.resolve(topicsFile);
        fs.writeFileSync(tp, manifest);
        console.log(`✓ Written to ${tp}`);
      }

      if (librariesFile) {
        console.log('📚 Generating library manifest...');
        const manifest = new LibraryEmitter().toJSON(project);
        const lp = path.resolve(librariesFile);
        fs.writeFileSync(lp, manifest);
        console.log(`✓ Written to ${lp}`);
      }

      if (diagramFile) {
        console.log('📊 Generating Mermaid diagram...');
        const emitter = new DiagramEmitter();
        const dp = path.resolve(diagramFile);
        // .md files get a fenced code block; raw .mmd files get the diagram body.
        const isMd = /\.md$/i.test(dp);
        const content = isMd ? emitter.toMarkdown(project) : emitter.emit(project);
        fs.writeFileSync(dp, content);
        console.log(`✓ Written to ${dp}`);
      }

      const isEspIdf = /^(espidf|idf)$/i.test(targetName.replace(/[-_]/g, ''));

      if (outDir) {
        console.log('🔨 Generating sketch folder...');
        const resolvedOutDir = path.resolve(outDir);
        writeProject(resolvedOutDir, new Codegen(backend!).generateFiles(project));

        if (emitCmake && isEspIdf) {
          writeCmake(resolvedOutDir, project);
        }

        if (isZephyr) {
          writeZephyrProject(resolvedOutDir, project);
        }
      }

      if (outputFile || !(outDir || topicsFile || librariesFile || diagramFile)) {
        console.log('🔨 Generating C++ code...');
        const codegen = new Codegen(backend!);
        const cppCode = codegen.generate(project);

        if (outputFile) {
          const op = path.resolve(outputFile);
          fs.writeFileSync(op, cppCode);
          console.log(`✓ Written to ${op}`);

          if (project.system.states.length > 0) {
            const configPath = path.join(path.dirname(op), 'PulseHSM_config.h');
            fs.writeFileSync(configPath, codegen.generateConfigHeader());
            console.log(`✓ Written to ${configPath} (keep it beside PulseHSM.h)`);
          }

          if (emitCmake && isEspIdf) {
            writeCmake(path.dirname(op), project);
          }
        } else {
          console.log(cppCode);
        }
      }

      console.log('✨ Done');
    } catch (error) {
      printError(error);
      if (!watch) process.exit(1);
    }

    return resolver.loaded;
  };

  if (!watch) {
    build();
    return;
  }

  // Watch mode: rebuild on change, re-watch the (possibly changed) file set.
  let watchers: fs.FSWatcher[] = [];

  const rebuildAndWatch = () => {
    for (const w of watchers) w.close();
    watchers = [];

    const watched = build();

    const onChange = (eventType: string, filename: string | null) => {
      console.log(`\n🔄 ${filename ?? 'file'} changed — rebuilding...`);
      rebuildAndWatch();
    };

    for (const file of watched) {
      try {
        watchers.push(fs.watch(file, { persistent: true }, onChange));
      } catch {
        // File may have been deleted; skip silently
      }
    }

    // Always watch the entry file even if the parse failed
    const entry = path.resolve(inputFile);
    if (!watched.has(entry)) {
      try {
        watchers.push(fs.watch(entry, { persistent: true }, onChange));
      } catch {
        // ignore
      }
    }

    console.log(`\n👁  Watching ${watchers.length} file(s). Ctrl-C to stop.`);
  };

  rebuildAndWatch();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeProject(dir: string, project: GeneratedProject): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  for (const file of project.generated) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.contents);
    console.log(`  ✓ ${file.path}`);
  }

  for (const file of project.scaffolds) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (fs.existsSync(target)) {
      console.log(`  · ${file.path} (kept - your code)`);
      continue;
    }
    fs.writeFileSync(target, file.contents);
    console.log(`  ✓ ${file.path} (yours to fill in)`);
  }

  if (!project.needsRuntime) {
    console.log(`✓ Sketch folder ready at ${dir}`);
    console.log('  (no state machine in this model, so no runtime was vendored)');
    return;
  }

  const deps = path.resolve(fileURLToPath(import.meta.url), '../../../deps');
  for (const name of ['PulseHSM.h', 'PulseHSM.cpp']) {
    const from = path.join(deps, name);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(dir, name));
    console.log(`  ✓ ${name} (runtime)`);
  }

  console.log(`✓ Sketch folder ready at ${dir}`);
}

function writeZephyrProject(dir: string, project: PulseProject): void {
  const files = new ZephyrProjectEmitter().generate(project);

  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), files.cmake);
  fs.writeFileSync(path.join(dir, 'prj.conf'), files.prjConf);

  console.log('  ✓ CMakeLists.txt');
  console.log('  ✓ prj.conf');

  if (files.overlay) {
    fs.writeFileSync(path.join(dir, 'app.overlay'), files.overlay);
    console.log('  ✓ app.overlay');
    console.log('  (build with: west build -b native_sim -- -DOVERLAY_CONFIG=app.overlay)');
  } else {
    console.log('  (build with: west build -b native_sim)');
  }
}

function writeCmake(dir: string, project: PulseProject): void {
  const cmake  = new CmakeEmitter().generate(project);
  const mainDir = path.join(dir, 'main');
  fs.mkdirSync(mainDir, { recursive: true });

  const topPath  = path.join(dir, 'CMakeLists.txt');
  const mainPath = path.join(mainDir, 'CMakeLists.txt');

  fs.writeFileSync(topPath,  cmake.topLevel);
  fs.writeFileSync(mainPath, cmake.mainComponent);

  console.log('  ✓ CMakeLists.txt');
  console.log('  ✓ main/CMakeLists.txt');
}

function resolveBackend(target: string): PlatformBackend {
  switch (target.toLowerCase().replace(/[-_]/g, '')) {
    case 'arduino': return new ArduinoBackend();
    case 'espidf':
    case 'idf':    return new EspIdfBackend();
    case 'zephyr': return new ZephyrBackend();
    default:
      console.error(`❌ Unknown target: "${target}". Supported: arduino, espidf, zephyr`);
      process.exit(1);
  }
}

function printError(error: unknown): void {
  if (error instanceof Error) {
    console.error(`❌ Error: ${error.message}`);
    if ('line' in error && error.line) {
      console.error(`   at line ${error.line}`);
    }
  } else {
    console.error(error);
  }
}

main();
