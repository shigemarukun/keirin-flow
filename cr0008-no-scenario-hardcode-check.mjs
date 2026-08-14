import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
for(const file of ['engine.js','tactical-ai.js','tactical-sensor.js','autonomous-decision-engine.js','line-manager.js','keirin-protocol-controller.js','tenkai-predictor.js']){
  const src=await readFile(new URL(`./${file}`,import.meta.url),'utf8');
  assert.doesNotMatch(src,/rider\.number\s*===\s*[1-9]/,`${file}: rider number hardcode`);
  assert.doesNotMatch(src,/LINE7_FADE|LINE4_MAKURI|FIRST_CONTEST|SECOND_CONTEST|Scenario B/i,`${file}: old scenario phase leaked into production`);
  console.log(`PASS no scenario hardcode: ${file}`);
}
console.log('CR-0008 production hardcode ban passed');
