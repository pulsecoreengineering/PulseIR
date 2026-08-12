#!/usr/bin/env node

/**
 * PulseIR CLI
 *
 * Usage:
 *   pulse-ir <input.yaml> --output <output.ino>
 *   pulse-ir <input.yaml> --topics <topics.json> [--namespace <prefix>]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Parser } from './parser/index.js';
import { FileResolver } from './parser/fs-resolver.js';
import { Codegen } from './codegen/index.js';
import type { GeneratedProject } from './codegen/index.js';
import { TopicEmitter } from './emit/topics.js';
import { LibraryEmitter } from './emit/libraries.js';

const USAGE = `Usage: pulse-ir <input.yaml> [options]

Options:
  --outdir <dir>       Write a ready-to-build sketch folder (recommended)
  --output <file>      Write a single self-contained sketch
  --topics <file>      Write the MQTT topic manifest (JSON)
  --libraries <file>   Write the library manifest (JSON)
  --namespace <name>   Topic namespace (defaults to the project name)

A model may "include" other files; paths are resolved relative to the file
that lists them.

--outdir keeps generated code and your code apart: the sketch and header are
rewritten every run, while src/guards.cpp and src/actions.cpp are written only
if missing, so your implementations survive regeneration.

With no output flag at all, the sketch is printed to stdout.`;

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  const inputFile = args[0];
  const flag = (name: string): string | null => {
    const idx = args.indexOf(name);
    if (idx === -1) return null;
    const value = args[idx + 1];
    if (!value || value.startsWith('--')) {
      console.error(`❌ Error: ${name} requires a value`);
      process.exit(1);
    }
    return value;
  };

  const outputFile = flag('--output');
  const outDir = flag('--outdir');
  const topicsFile = flag('--topics');
  const librariesFile = flag('--libraries');
  const namespace = flag('--namespace');

  if (!inputFile || inputFile.startsWith('--')) {
    console.error(USAGE);
    process.exit(1);
  }

  try {
    // Parse. parseFrom() reads the entry file and follows any includes.
    console.log(`📖 Reading ${inputFile}...`);
    const parser = new Parser();
    const project = parser.parseFrom(inputFile, new FileResolver());
    console.log(`✓ Parsed project: ${project.name}`);

    for (const warning of parser.warnings) {
      console.warn(`⚠️  ${warning}`);
    }

    // Validate
    console.log('✓ Validated');

    // Topic manifest, when asked for
    if (topicsFile) {
      console.log('📡 Generating MQTT topic manifest...');
      const manifest = new TopicEmitter().toJSON(project, namespace ?? undefined);
      const topicsPath = path.resolve(topicsFile);
      fs.writeFileSync(topicsPath, manifest);
      console.log(`✓ Written to ${topicsPath}`);
    }

    if (librariesFile) {
      console.log('📚 Generating library manifest...');
      const manifest = new LibraryEmitter().toJSON(project);
      const librariesPath = path.resolve(librariesFile);
      fs.writeFileSync(librariesPath, manifest);
      console.log(`✓ Written to ${librariesPath}`);
    }

    if (outDir) {
      console.log('🔨 Generating sketch folder...');
      writeProject(path.resolve(outDir), new Codegen().generateFiles(project));
    }

    // Generate the sketch unless the run only asked for manifests
    if (outputFile || !(outDir || topicsFile || librariesFile)) {
      console.log('🔨 Generating C++ code...');
      const codegen = new Codegen();
      const cppCode = codegen.generate(project);

      if (outputFile) {
        const outputPath = path.resolve(outputFile);
        fs.writeFileSync(outputPath, cppCode);
        console.log(`✓ Written to ${outputPath}`);

        // The sketch is one file, but the build is not: PulseHSM.cpp is
        // compiled separately and would keep its default table sizes, silently
        // refusing states past the eighth. The config header is what stops
        // that, so it goes next to the sketch - but only for a project that
        // has a state machine at all.
        if (project.system.states.length > 0) {
          const configPath = path.join(path.dirname(outputPath), 'PulseHSM_config.h');
          fs.writeFileSync(configPath, codegen.generateConfigHeader());
          console.log(`✓ Written to ${configPath} (keep it beside PulseHSM.h)`);
        }
      } else {
        console.log(cppCode);
      }
    }

    console.log('✨ Done');
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Error: ${error.message}`);
      if ('line' in error && error.line) {
        console.error(`   at line ${error.line}`);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

/**
 * Write a sketch folder.
 *
 * Generated files are overwritten; scaffolds are written only when absent, so
 * regenerating never destroys an implementation someone filled in. The runtime
 * is vendored alongside so the folder opens and builds in the Arduino IDE with
 * nothing else to install.
 */
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

  // A project with no state machine never touches PulseHSM, and shipping a
  // copy of it anyway would claim a dependency that is not there.
  if (!project.needsRuntime) {
    console.log(`✓ Sketch folder ready at ${dir}`);
    console.log('  (no state machine in this model, so no runtime was vendored)');
    return;
  }

  // Vendored rather than assumed installed: the sketch folder owns its runtime,
  // so a library update elsewhere cannot change how this firmware behaves.
  const deps = path.resolve(fileURLToPath(import.meta.url), '../../../deps');
  for (const name of ['PulseHSM.h', 'PulseHSM.cpp']) {
    const from = path.join(deps, name);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(dir, name));
    console.log(`  ✓ ${name} (runtime)`);
  }

  console.log(`✓ Sketch folder ready at ${dir}`);
}

main();
