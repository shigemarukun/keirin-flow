import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';

const groups = new AIModel().getInitialLineGroups();
assert.deepEqual(groups, [[1,2,3],[4,5,6],[7,8,9]]);

function run(scale) {
  const e = new PhysicsEngine(groups, [-18,-6,6,18], undefined, structuredClone(DEFAULT_RACE_PLAN));
  e.setSpeedScale(scale);
  let bell = 0;
  e.onBell(() => bell++);
  e.start();

  let frames = 0;
  const seen = {
    firstMove: false,
    firstFrontArrival: false,
    firstSideBySide: false,
    firstRetreat: false,
    reset789Rear: false,
    secondMove: false,
    secondFrontArrival: false,
    secondSideBySide: false,
    sevenFade: false,
    fourMakuri: false,
    block2on4: false,
    fiveDive: false
  };
  let firstMoveStartGap = null;
  let secondMoveStartGap = null;
  let minSpatial = Infinity;

  while (e.isStarted && frames < 120000) {
    e.update(1/60);
    const s = e.getState();
    const r = n => s.riders.find(x => x.number === n);
    const phase = s.scenario.phase;
    const rem = s.raceClock.remainingDistance;

    if (phase === 'FIRST_MOVE') {
      seen.firstMove = true;
      if (firstMoveStartGap == null) firstMoveStartGap = r(1).distance - r(7).distance;
      if (r(7).laneOffset > 28 && (r(1).distance - r(7).distance) < 25) seen.firstFrontArrival = true;
    }
    if (phase === 'FIRST_CONTEST' && Math.abs(r(1).distance-r(7).distance) <= 5.5 && r(7).laneOffset > 28) seen.firstSideBySide = true;
    if (phase === 'FIRST_RETREAT' && r(7).speed < r(1).speed - 5) seen.firstRetreat = true;
    if (phase === 'RESET_LINEUP') {
      const o=[...s.riders].sort((a,b)=>b.distance-a.distance).map(x=>x.number).join('-');
      if (o === '1-2-3-4-5-6-7-8-9' && r(7).laneOffset < 0) seen.reset789Rear = true;
    }
    if (phase === 'SECOND_MOVE') {
      seen.secondMove = true;
      if (secondMoveStartGap == null) secondMoveStartGap = r(1).distance-r(7).distance;
      if (r(7).laneOffset > 30 && (r(1).distance-r(7).distance) < 25) seen.secondFrontArrival = true;
    }
    if (phase === 'SECOND_CONTEST' && Math.abs(r(1).distance-r(7).distance) <= 5.5 && r(7).laneOffset > 30) seen.secondSideBySide = true;
    if (['LINE7_FADE','LINE4_MAKURI'].includes(phase) && r(7).speed < r(1).speed - 3) seen.sevenFade = true;
    if (phase === 'LINE4_MAKURI' && r(4).laneOffset > 15 && r(4).speed > r(7).speed + 5) seen.fourMakuri = true;
    if (phase === 'BANTE_BLOCK' && r(2).laneOffset > 8 && r(4).laneOffset > 25) seen.block2on4 = true;
    if (phase === 'FIVE_DIVE' && r(5).laneOffset < 20 && r(5).speed > r(4).speed + 3) seen.fiveDive = true;

    const active=s.riders.filter(x=>!x.finished);
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j];
      const spatial=Math.hypot(a.distance-b.distance,(a.laneOffset-b.laneOffset)*0.45);
      minSpatial=Math.min(minSpatial,spatial);
    }
    frames++;
  }

  return { e, state:e.getState(), frames, bell, seen, firstMoveStartGap, secondMoveStartGap, minSpatial };
}

for (const scale of [0.5,1,2,3]) {
  const x=run(scale);
  assert.ok(x.frames < 120000, `${scale}x timeout`);
  assert.equal(x.bell,1,`${scale}x bell once`);
  assert.ok(x.firstMoveStartGap > 90, `${scale}x first attack must start from rear`);
  assert.ok(x.secondMoveStartGap > 65, `${scale}x second attack must start from rear`);
  for(const [key,value] of Object.entries(x.seen)) assert.ok(value, `${scale}x missing ${key}`);
  assert.deepEqual(x.state.ranking.map(x=>x.number),[1,2,5,3,6,4,9,8,7],`${scale}x exact reference finish`);
  assert.deepEqual(x.state.raceClock.firedEventSequence,['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
  assert.ok(x.minSpatial > 0.02,`${scale}x same-slot collapse ${x.minSpatial}`);
  console.log(`PASS ${scale}x finish=${x.state.ranking.map(x=>x.number).join('-')} firstGap=${x.firstMoveStartGap.toFixed(1)} secondGap=${x.secondMoveStartGap.toFixed(1)} minSpatial=${x.minSpatial.toFixed(3)}`);
}
console.log('SCENARIO B V2: all movement/contest/block checkpoints passed');
