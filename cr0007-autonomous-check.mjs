import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { DEFAULT_RACE_SETUP, MINDSET, SOLO_MINDSET, ACTION } from './race-plan.js';

function run(setup, scale=1) {
  const e = new PhysicsEngine(setup);
  e.setSpeedScale(scale);
  e.start();
  let frames = 0;
  const seen = new Map();
  const firstActionTime = new Map();

  while (e.isStarted && frames++ < 150000) {
    e.update(1/60);
    for (const rider of e.riders) {
      if (!seen.has(rider.number)) seen.set(rider.number, new Set());
      seen.get(rider.number).add(rider.action);
      const key = `${rider.number}:${rider.action}`;
      if (!firstActionTime.has(key)) firstActionTime.set(key, e.elapsedTime);
    }
  }
  return { e, state: e.getState(), frames, seen, firstActionTime };
}

const dynamicSetup = {
  trackProfile: 'PROFILE_400',
  lines: [
    { id: 'A', members: [1, 2], leader: 1 },
    { id: 'B', members: [3, 4, 5], leader: 3 },
    { id: 'C', members: [6, 7], leader: 6 }
  ],
  riders: {
    1: { mindset: MINDSET.TSUPPARI, power: .90, acceleration: .90, endurance: .83, tacticalIQ: .80 },
    3: { mindset: MINDSET.YIELD_AND_ROLL, power: .88, acceleration: .92, endurance: .87, tacticalIQ: .85 },
    6: { mindset: MINDSET.CONTAIN, power: .84, acceleration: .82, endurance: .91, tacticalIQ: .88 },
    8: { solo: true, soloMindset: SOLO_MINDSET.ATTACH_AND_STRIKE },
    9: { solo: true, soloMindset: SOLO_MINDSET.SAVE_AND_SPRINT }
  }
};

const fourSplitSetup = {
  trackProfile: 'PROFILE_400',
  lines: [
    { id: 'A', members: [1, 2], leader: 1 },
    { id: 'B', members: [3, 4], leader: 3 },
    { id: 'C', members: [5, 6], leader: 5 },
    { id: 'D', members: [7,8], leader: 7 }
  ],
  riders: {
    1: { mindset: MINDSET.TSUPPARI },
    3: { mindset: MINDSET.CONTAIN },
    5: { mindset: MINDSET.YIELD_AND_ROLL },
    7: { mindset: MINDSET.CONTAIN },
    9: { solo: true, soloMindset: SOLO_MINDSET.SAVE_AND_SPRINT }
  }
};

for (const [label, setup] of [
  ['default', DEFAULT_RACE_SETUP],
  ['dynamic+solo', dynamicSetup],
  ['4split+solo', fourSplitSetup]
]) {
  for (const scale of [.5, 1, 2, 3]) {
    const x = run(setup, scale);
    assert.ok(x.frames < 150000, `${label} ${scale}x timeout`);
    assert.equal(x.state.ranking.length, 9, `${label} ${scale}x ranking`);
    assert.equal(new Set(x.state.riders.map(r => r.number)).size, 9, `${label} ${scale}x unique riders`);
    assert.ok(x.state.riders.every(r => r.finished), `${label} ${scale}x all finish`);
    console.log(`PASS ${label} ${scale}x finish=${x.state.ranking.map(x=>x.number).join('-')}`);
  }
}

{
  const e = new PhysicsEngine(dynamicSetup);
  const s = e.getState();
  const eight = s.riders.find(r => r.number === 8);
  const nine = s.riders.find(r => r.number === 9);
  assert.equal(eight.role, 'SOLO');
  assert.equal(eight.lineId, null);
  assert.equal(nine.role, 'SOLO');
  assert.equal(nine.lineId, null);
  assert.deepEqual(s.lines.map(line => line.members), [[1,2],[3,4,5],[6,7]]);
  console.log('PASS solo abstraction + arbitrary line lengths');
}

{
  const e = new PhysicsEngine(DEFAULT_RACE_SETUP);
  e.applyRaceSetup(dynamicSetup);
  assert.equal(e.getState().lines[1].members.join('-'), '3-4-5');
  assert.equal(e.rider(8).role, 'SOLO');
  e.reset();
  assert.equal(e.getState().ranking.length, 0);
  assert.equal(e.getState().isStarted, false);
  console.log('PASS applyRaceSetup + reset interface');
}

// Regression-teacher check: no script/phase is used, yet the default parameter set
// must autonomously produce key racing behaviors.
{
  const x = run(DEFAULT_RACE_SETUP, 1);
  const has = (n, action) => x.seen.get(n)?.has(action);
  assert.ok(has(1, ACTION.DEFEND), 'front TSUPPARI leader must autonomously defend');
  assert.ok(has(7, ACTION.ATTACK), 'a rear leader must autonomously attack');
  assert.ok(has(7, ACTION.RETREAT), 'failed challenger must be able to autonomously retreat');
  assert.ok(has(4, ACTION.ATTACK), 'another line leader must be able to counter-attack');
  assert.ok(has(2, ACTION.BLOCK) || has(5, ACTION.BLOCK) || has(8, ACTION.BLOCK), 'a bante must autonomously block an incoming threat');
  assert.ok(
    [...x.seen.values()].some(set => set.has(ACTION.SWITCH_TO_SELF_POWER)),
    'line member/bante self-power switch must occur when situation requires'
  );
  console.log('PASS autonomous Scenario-B-like tactical branch coverage');
}

{
  assert.throws(
    () => new PhysicsEngine({ lines:[{id:'BAD',members:[8],leader:8}], riders:{8:{solo:true}} }),
    /Single-rider line/,
    'single rider must be represented as SOLO, not as a one-rider line'
  );
  console.log('PASS one-rider line rejected; SOLO abstraction enforced');
}
console.log('CR-0007 AUTONOMOUS ENGINE: all checks passed');
