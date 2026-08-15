import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
const css=await readFile(new URL('./style.css',import.meta.url),'utf8');
const ui=await readFile(new URL('./ui.js',import.meta.url),'utf8');
const engine=await readFile(new URL('./engine.js',import.meta.url),'utf8');

assert.match(main,/cancelAnimationFrame\(rafId\)/,'RESET/PAUSE must cancel RAF');
assert.match(main,/const fullReset=\(\)=>\{/,'fullReset missing');
assert.match(main,/stopAnimationLoop\(\);\s*physics\.reset\(\)/s,'fullReset must stop loop before engine reset');
assert.match(main,/btn-reset[^;]*fullReset/s,'RESET button not bound to fullReset');
assert.match(main,/physics\.start\(\);\s*startAnimationLoop\(\)/s,'START must own RAF loop');

assert.match(engine,/renderSlots\.reset\(\)/,'render slots must reset');
assert.match(engine,/pathHistory\.reset\(\)/,'path history must reset');
assert.match(engine,/laneTransition\.reset\(-18\)/,'rider lane transitions must reset');
assert.match(engine,/pacer=\{[\s\S]*laneTransition:new LaneTransition\(-18\)/,'pacer transition state must reset');
assert.match(engine,/remaining<=760&&remaining>=560/,'pacer exit race window missing');
assert.match(engine,/laneTransition\.setTarget\(82,\{duration:1\.75\}\)/,'pacer smooth outer exit missing');

assert.match(ui,/rider\.renderDistance \?\? rider\.distance/,'renderer must use render-only distance');
assert.match(ui,/rider\.renderLaneOffset \?\? rider\.laneOffset/,'renderer must use render-only lane');
assert.match(ui,/\n\s*5\.2,\n\s*rider\.style\.background/,'rider marker scale not restored');
assert.match(css,/#app \{ width: min\(1240px, 100%\)/,'desktop app scale not restored');
assert.match(css,/grid-template-columns: minmax\(760px, 800px\) minmax\(340px, 380px\)/,'desktop bank scale not restored');

console.log('CR-0016 UI CONTROL / SCALE STATIC CHECK: PASS');
