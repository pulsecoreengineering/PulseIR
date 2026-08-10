#!/usr/bin/env node

/**
 * PulseIR CLI
 * 
 * Usage:
 *   pulse-ir <input.yaml> --output <output.cpp>
 */

import * as fs from 'fs';
import * as path from 'path';
import { Parser } from './parser/index.js';
import { Codegen } from './codegen/index.js';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse CLI arguments
  const inputFile = args[0];
  const outputIndex = args.indexOf('--output');
  const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : null;

  if (!inputFile) {
    console.error('Usage: pulse-ir <input.yaml> --output <output.cpp>');
    process.exit(1);
  }

  try {
    // Read input
    console.log(`📖 Reading ${inputFile}...`);
    const yamlContent = fs.readFileSync(inputFile, 'utf8');

    // Parse
    console.log('🔍 Parsing...');
    const parser = new Parser();
    const project = parser.parse(yamlContent);
    console.log(`✓ Parsed project: ${project.name}`);

    // Validate
    console.log('✓ Validated');

    // Generate
    console.log('🔨 Generating C++ code...');
    const codegen = new Codegen();
    const cppCode = codegen.generate(project);

    // Write output
    if (outputFile) {
      const outputPath = path.resolve(outputFile);
      fs.writeFileSync(outputPath, cppCode);
      console.log(`✓ Written to ${outputPath}`);
    } else {
      console.log(cppCode);
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
