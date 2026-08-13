import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { DEFAULT_RACE_SETUP, ACTION } from './race-plan.js';

// Scenario B is now a teacher/regression concept only.
// There is NO scenario phase/controller in the production path.
const engine = new PhysicsEngine(DEFAULT_RACE_SETUP);
engine.start();

const seen = new Map();
const first = new Map();
let frames = 0;
while (engine.isStarted && frames++ < 150000) {
  engine.update(1/60);
  for (const rider of engine.riders) {
    if (!seen.has(rider.number)) seen.set(rider.number, new Set());
    seen.get(rider.number).add(rider.action);
    const key = `${rider.number}:${rider.action}`;
    if (!first.has(key)) first.set(key, engine.elapsedTime);
  }
}

const has = (n, action) => seen.get(n)?.has(action);
assert.ok(frames < 150000, 'timeout');
assert.equal(engine.getState().ranking.length, 9);

// Equivalent tactical motifs must emerge without a script:
assert.ok(has(1, ACTION.DEFEND), 'TSUPPARI front leader never defended');
assert.ok(has(7, ACTION.ATTACK), 'rear leader never initiated attack');
assert.ok(has(7, ACTION.RETREAT), 'challenger never abandoned a losing contest');
assert.ok(first.get(`7:${ACTION.ATTACK}`) < first.get(`7:${ACTION.RETREAT}`), 'retreat occurred before attack');
assert.ok(has(4, ACTION.ATTACK), 'another leader never generated a counter attack');
assert.ok([2,5,8].some(n => has(n, ACTION.BLOCK)), 'no bante generated a defensive block');
assert.ok([...seen.values()].some(actions => actions.has(ACTION.SWITCH_TO_SELF_POWER)), 'no self-power switch occurred');

console.log('PASS Scenario-B teacher motifs emerged autonomously');
console.log('finish=' + engine.getState().ranking.map(x => x.number).join('-'));
