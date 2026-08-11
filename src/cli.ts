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
import { Parser } from './parser/index.js';
import { FileResolver } from './parser/fs-resolver.js';
import { Codegen } from './codegen/index.js';
import { TopicEmitter } from './emit/topics.js';
import { LibraryEmitter } from './emit/libraries.js';

const USAGE = `Usage: pulse-ir <input.yaml> [options]

Options:
  --output <file>      Write the generated Arduino sketch
  --topics <file>      Write the MQTT topic manifest (JSON)
  --libraries <file>   Write the library manifest (JSON)
  --namespace <name>   Topic namespace (defaults to the project name)

A model may "include" other files; paths are resolved relative to the file
that lists them.

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

    // Generate the sketch unless the run only asked for manifests
    if (outputFile || !(topicsFile || librariesFile)) {
      console.log('🔨 Generating C++ code...');
      const codegen = new Codegen();
      const cppCode = codegen.generate(project);

      if (outputFile) {
        const outputPath = path.resolve(outputFile);
        fs.writeFileSync(outputPath, cppCode);
        console.log(`✓ Written to ${outputPath}`);
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

main();
