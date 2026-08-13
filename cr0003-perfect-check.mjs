import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';

const groups = new AIModel().getInitialLineGroups();
assert.deepEqual(groups, [[1,2,3],[4,5,6],[7,8,9]]);

function run(scale){
  const e = new PhysicsEngine(groups, [-18,-6,6,18], undefined, structuredClone(DEFAULT_RACE_PLAN));
  e.setSpeedScale(scale);
  let bellCount = 0;
  e.onBell(() => bellCount++);
  e.start();

  let frames = 0;
  let firstContestSeconds = 0;
  let secondContestSeconds = 0;
  let firstMinGap = Infinity;
  let secondMinGap = Infinity;
  let max789Gap = 0;
  let orderBroken = false;
  let sawRetreat = false;
  let sawResetBeforeFinalLap = false;
  let sawSecondAttack = false;
  let sawRealBlock = false;
  let sawFourBlockedReaction = false;
  let sawFiveDive = false;
  let sawSwitch = false;
  let maxFadeGap87 = 0;
  let maxFadeGap98 = 0;
  let minSevenFadeSpeed = Infinity;
  let minSpatial = Infinity;
  let previousRemaining = 800;
  let monotonic = true;

  while(e.isStarted && frames < 140000){
    e.update(1/60);
    const s = e.getState();
    const r = n => s.riders.find(x => x.number === n);
    const ph = s.scenario.phase;
    const rem = s.timeline.remainingDistance;

    if(rem > previousRemaining + 1e-8) monotonic = false;
    previousRemaining = rem;

    const g17 = Math.abs(r(1).distance - r(7).distance);
    if(ph === 'FIRST_CONTEST'){
      firstMinGap = Math.min(firstMinGap, g17);
      if(g17 <= 5.5) firstContestSeconds += (1/60) * scale;
    }
    if(ph === 'SECOND_CONTEST'){
      secondMinGap = Math.min(secondMinGap, g17);
      if(g17 <= 5.5) secondContestSeconds += (1/60) * scale;
    }

    if(['FIRST_MOVE','FIRST_CONTEST','FIRST_RETREAT','RESET_LINEUP','SECOND_MOVE','SECOND_CONTEST'].includes(ph)){
      const g78 = r(7).distance - r(8).distance;
      const g89 = r(8).distance - r(9).distance;
      max789Gap = Math.max(max789Gap, g78, g89);
      if(!(r(7).distance > r(8).distance && r(8).distance > r(9).distance)) orderBroken = true;
    }

    if(ph === 'FIRST_RETREAT' && r(7).action === 'RETREAT' && r(8).action.includes('RETREAT') && r(9).action.includes('RETREAT')) sawRetreat = true;
    if(ph === 'RESET_LINEUP' && rem >= 390){
      const o=[...s.riders].sort((a,b)=>b.distance-a.distance).map(x=>x.number).join('-');
      if(o === '1-2-3-4-5-6-7-8-9') sawResetBeforeFinalLap = true;
    }
    if(ph === 'SECOND_MOVE' && r(7).action === 'ATTACK' && r(8).action.includes('ATTACK') && r(9).action.includes('ATTACK')) sawSecondAttack = true;

    if(ph === 'BANTE_BLOCK' && r(2).action === 'BLOCK' && r(2).laneOffset > 8 && Math.abs(r(2).distance-r(4).distance) < 22) sawRealBlock = true;
    if(['BANTE_BLOCK','FIVE_DIVE','FINAL'].includes(ph) && r(4).action === 'BLOCKED' && r(4).speed < 18) sawFourBlockedReaction = true;
    if(['FIVE_DIVE','FINAL'].includes(ph) && r(5).action === 'DIVE' && r(5).laneOffset < 20 && r(5).speed > r(4).speed + 3) sawFiveDive = true;
    if([8,9].some(n => r(n).action === 'SWITCH_TO_SELF_POWER')) sawSwitch = true;

    if(['LINE7_FADE','LINE4_MAKURI','BANTE_BLOCK','FIVE_DIVE','FINAL'].includes(ph)){
      maxFadeGap87 = Math.max(maxFadeGap87, r(8).distance-r(7).distance);
      maxFadeGap98 = Math.max(maxFadeGap98, r(9).distance-r(8).distance);
      minSevenFadeSpeed = Math.min(minSevenFadeSpeed, r(7).speed);
    }

    const active=s.riders.filter(x=>!x.finished);
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      const a=active[i], b=active[j];
      minSpatial=Math.min(minSpatial,Math.hypot(a.distance-b.distance,(a.laneOffset-b.laneOffset)*0.45));
    }
    frames++;
  }

  const s=e.getState();
  return {s,frames,bellCount,firstContestSeconds,secondContestSeconds,firstMinGap,secondMinGap,max789Gap,orderBroken,sawRetreat,sawResetBeforeFinalLap,sawSecondAttack,sawRealBlock,sawFourBlockedReaction,sawFiveDive,sawSwitch,maxFadeGap87,maxFadeGap98,minSevenFadeSpeed,minSpatial,monotonic};
}

for(const scale of [0.5,1,2,3]){
  const x=run(scale);
  assert.ok(x.frames < 140000, `${scale}x timeout`);
  assert.equal(x.bellCount,1,`${scale}x bell once`);
  assert.equal(x.monotonic,true,`${scale}x remaining distance monotonic`);
  assert.deepEqual(x.s.timeline.firedEventSequence,['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);

  assert.ok(x.firstMinGap <= 5.5, `${scale}x first contest never became side-by-side: ${x.firstMinGap}`);
  assert.ok(x.secondMinGap <= 5.5, `${scale}x second contest never became side-by-side: ${x.secondMinGap}`);
  assert.ok(x.firstContestSeconds >= 0.85, `${scale}x first contest too short: ${x.firstContestSeconds}`);
  assert.ok(x.secondContestSeconds >= 2.45, `${scale}x second contest too short: ${x.secondContestSeconds}`);

  assert.equal(x.orderBroken,false,`${scale}x 7-8-9 order broken`);
  assert.ok(x.max789Gap < 22,`${scale}x 7-8-9 cohesion too loose: ${x.max789Gap}`);
  assert.ok(x.sawRetreat,`${scale}x full 7-8-9 retreat missing`);
  assert.ok(x.sawResetBeforeFinalLap,`${scale}x 1-2-3 / 4-5-6 / 7-8-9 reset not established near final lap`);
  assert.ok(x.sawSecondAttack,`${scale}x full 7-8-9 second attack missing`);

  assert.ok(x.sawRealBlock,`${scale}x 2->4 real block missing`);
  assert.ok(x.sawFourBlockedReaction,`${scale}x 4 did not react physically to 2 block`);
  assert.ok(x.sawFiveDive,`${scale}x 5 dive after block missing`);
  assert.ok(x.sawSwitch,`${scale}x failed-line switch/self-power missing`);

  assert.ok(x.minSevenFadeSpeed >= 12.5,`${scale}x 7 fade unnaturally slow: ${x.minSevenFadeSpeed}`);
  assert.ok(x.maxFadeGap87 < 18,`${scale}x 7 fell unnaturally far behind 8: ${x.maxFadeGap87}`);
  assert.ok(x.maxFadeGap98 < 12,`${scale}x 8/9 separation unnatural: ${x.maxFadeGap98}`);
  assert.ok(x.minSpatial > 0.05,`${scale}x same-slot collapse: ${x.minSpatial}`);

  assert.deepEqual(x.s.ranking.map(x=>x.number),[1,2,5,3,6,4,9,8,7],`${scale}x reference finish`);
  console.log(`PASS ${scale}x sideBySide=${x.firstMinGap.toFixed(2)}/${x.secondMinGap.toFixed(2)} contest=${x.firstContestSeconds.toFixed(2)}s/${x.secondContestSeconds.toFixed(2)}s max789=${x.max789Gap.toFixed(2)} fadeGap=${x.maxFadeGap87.toFixed(2)} finish=${x.s.ranking.map(x=>x.number).join('-')}`);
}

console.log('CR-0003 PERFECT FIX: all strict movement / interaction / timeline checks passed');
