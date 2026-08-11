/**
 * Codegen test - verify code generation works
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Parser } from '../src/parser/index.js';
import { FileResolver } from '../src/parser/fs-resolver.js';
import { Codegen } from '../src/codegen/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const yamlPath = path.join(__dirname, '../../examples/boiler/pulse.yaml');
const outputPath = path.join(__dirname, '../../dist/boiler_generated.ino');

console.log('📖 Testing codegen with boiler.yaml...\n');

try {
  // Parse
  const parser = new Parser();
  const project = parser.parseFrom(yamlPath, new FileResolver());
  console.log(`✓ Parsed: ${project.name}`);

  // Generate
  const codegen = new Codegen();
  const cppCode = codegen.generate(project);
  console.log('✓ Generated C++ code');

  // Write
  fs.writeFileSync(outputPath, cppCode);
  console.log(`✓ Written to ${outputPath}`);

  // Stats
  const lines = cppCode.split('\n').length;
  const size = cppCode.length;
  console.log(`\n📊 Generated code statistics:`);
  console.log(`   Lines: ${lines}`);
  console.log(`   Size: ${Math.round(size / 1024 * 100) / 100} KB`);

  // Show preview
  console.log('\n📝 Preview (first 50 lines):\n');
  const preview = cppCode.split('\n').slice(0, 50).join('\n');
  console.log(preview);
  console.log('\n... (see full file at ' + outputPath + ')');

  console.log('\n✨ Codegen test passed!');
} catch (error) {
  if (error instanceof Error) {
    console.error(`❌ Error: ${error.message}`);
    console.error(error.stack);
  } else {
    console.error(error);
  }
  process.exit(1);
}
