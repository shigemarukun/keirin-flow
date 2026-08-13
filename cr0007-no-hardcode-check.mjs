import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const production = [
  'engine.js',
  'tactical-ai.js',
  'tactical-sensor.js',
  'autonomous-decision-engine.js',
  'line-manager.js'
];

for (const file of production) {
  const src = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(src, /rider\.number\s*===\s*\d/);
  assert.doesNotMatch(src, /rider\.number\s*!==\s*\d/);
  assert.doesNotMatch(src, /if\s*\(\s*phase\s*===/);
  assert.doesNotMatch(src, /LINE7_FADE|LINE4_MAKURI|FIRST_CONTEST|SECOND_CONTEST|ScenarioBController/);
  console.log(`PASS no production scenario hardcode: ${file}`);
}
console.log('CR-0007 hardcode ban passed');
