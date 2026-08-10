/**
 * Parser test - verify boiler.yaml parses correctly
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Parser } from '../src/parser/index.js';
import type { Event, State, Transition, Region } from '../src/model/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const yamlPath = path.join(__dirname, '../../examples/boiler.yaml');
const yamlContent = fs.readFileSync(yamlPath, 'utf8');

console.log('📖 Testing parser with boiler.yaml...\n');

try {
  const parser = new Parser();
  const project = parser.parse(yamlContent);

  console.log('✓ Parsed successfully!\n');
  console.log(`Project: ${project.name} (v${project.version})`);
  console.log(`System: ${project.system.name}`);
  console.log(`  Events: ${project.system.events.length}`);
  console.log(`  States: ${project.system.states.length}`);
  console.log(`  Transitions: ${project.system.transitions.length}`);
  console.log(`  Components: ${project.system.components?.length || 0}`);
  console.log(`  Resources: ${project.system.resources?.length || 0}`);
  console.log(`  Parameters: ${project.system.parameters?.length || 0}`);

  console.log('\n--- Events ---');
  project.system.events.forEach((e: Event) => {
    console.log(`  ${e.name} (${e.source})`);
  });

  console.log('\n--- States ---');
  project.system.states.forEach((s: State) => {
    const type = s.type === 'simple' ? '' : ` [${s.type}]`;
    console.log(`  ${s.name}${type}`);
    if (s.regions) {
      s.regions.forEach((r: Region) => {
        r.states.forEach((sub: State) => {
          console.log(`    └─ ${sub.name}`);
        });
      });
    }
  });

  console.log('\n--- Transitions (sample) ---');
  project.system.transitions.slice(0, 3).forEach((t: Transition) => {
    const guard = t.guard ? ` [guard: ${t.guard.expression}]` : '';
    const actions = t.actions?.length ? ` → ${t.actions.length} action(s)` : '';
    console.log(`  ${t.source} + ${t.event} → ${t.target}${guard}${actions}`);
  });

  console.log('\n✨ Parser test passed!');
} catch (error) {
  if (error instanceof Error) {
    console.error(`❌ Parse error: ${error.message}`);
    if ('line' in error) {
      console.error(`   at line ${error.line}`);
    }
  } else {
    console.error(error);
  }
  process.exit(1);
}
