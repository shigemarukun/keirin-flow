import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { SCENARIO_PHASE, TRACK_LANE } from './race-plan.js';

const expectedPhases=[
  SCENARIO_PHASE.PACER_CUT,
  SCENARIO_PHASE.TSUPPARI_RESET,
  SCENARIO_PHASE.SECOND_ATTACK,
  SCENARIO_PHASE.MAKURI,
  SCENARIO_PHASE.FINISH
];

function run(scale){
  const engine=new PhysicsEngine();
  engine.setSpeedScale(scale);
  engine.start();

  let frames=0;
  let p3Entry=null,p4Entry=null,p5Entry=null;
  let maxSideBySide=0;
  let squeezeSeen=false;
  let squeezeMinLane7=Infinity;
  let squeezeMaxGap=Infinity;
  let minSameCorridorGap=Infinity;
  let maxAbsAcc=0;
  let blockStart=null,blockEnd=null,blockRemaining=null,blockGap=null;
  let blockLane2Max=-Infinity;
  let fourOutsideAt=null,fiveOutsideAt=null,sixOutsideAt=null;

  while(engine.isStarted&&frames++<200000){
    engine.update(1/60);
    const s=engine.getState();
    const r=n=>s.riders.find(x=>x.number===n);

    if(s.scenario.currentPhase===SCENARIO_PHASE.SECOND_ATTACK){
      if(p3Entry==null)p3Entry=s.raceClock.remainingDistance;
      const one=r(1),seven=r(7);
      const gap=Math.abs(one.distance-seven.distance);
      const sep=Math.abs(one.laneOffset-seven.laneOffset);
      maxSideBySide=Math.max(maxSideBySide,s.scenario.phase3SideBySideSeconds??0);
      if(gap<=5&&sep>=24){
        squeezeSeen=true;
        squeezeMinLane7=Math.min(squeezeMinLane7,seven.laneOffset);
        squeezeMaxGap=Math.min(squeezeMaxGap,gap);
        assert.ok(Math.abs(one.laneOffset-TRACK_LANE.INNER)<=1.0,`${scale}x 1 left inner lane during defense`);
      }
    }

    if(s.scenario.currentPhase===SCENARIO_PHASE.MAKURI){
      if(p4Entry==null)p4Entry=s.raceClock.remainingDistance;
      for(const n of [4,5,6]){
        const rr=r(n);
        if(rr.laneOffset>0){
          if(n===4&&fourOutsideAt==null)fourOutsideAt=s.elapsedTime;
          if(n===5&&fiveOutsideAt==null)fiveOutsideAt=s.elapsedTime;
          if(n===6&&sixOutsideAt==null)sixOutsideAt=s.elapsedTime;
        }
      }
      if(s.scenario.phase4BlockActive){
        if(blockStart==null){
          blockStart=s.elapsedTime;
          blockRemaining=s.raceClock.remainingDistance;
          blockGap=r(2).distance-r(4).distance;
        }
        blockLane2Max=Math.max(blockLane2Max,r(2).laneOffset);
      } else if(blockStart!=null&&s.scenario.phase4BlockCompleted&&blockEnd==null){
        blockEnd=s.elapsedTime;
      }
    }

    if(s.scenario.currentPhase===SCENARIO_PHASE.FINISH&&p5Entry==null)p5Entry=s.raceClock.remainingDistance;

    const active=s.riders.filter(x=>!x.finished);
    for(const rr of active)maxAbsAcc=Math.max(maxAbsAcc,Math.abs(rr.acceleration));
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j];
      if(Math.abs(a.laneOffset-b.laneOffset)<7){
        minSameCorridorGap=Math.min(minSameCorridorGap,Math.abs(a.distance-b.distance));
      }
    }
  }

  const s=engine.getState();
  assert.ok(frames<200000,`${scale}x timeout`);
  assert.deepEqual(s.scenario.phaseHistory,expectedPhases,`${scale}x phase order`);
  assert.ok(p3Entry<=510&&p3Entry>=430,`${scale}x phase3 timing ${p3Entry}`);
  assert.ok(p4Entry<=200.5&&p4Entry>=198.5,`${scale}x phase4 must start at final back: ${p4Entry}`);
  assert.ok(squeezeSeen,`${scale}x squeeze battle never visible`);
  assert.ok(maxSideBySide>=3.0,`${scale}x contest too short ${maxSideBySide}`);
  assert.ok(squeezeMinLane7<=12,`${scale}x 7 never squeezed inward enough: ${squeezeMinLane7}`);
  assert.ok(squeezeMaxGap<=1.5,`${scale}x no tight longitudinal contest: ${squeezeMaxGap}`);
  assert.ok(blockStart!=null&&blockEnd!=null,`${scale}x bante block missing`);
  assert.ok(blockRemaining<=113&&blockRemaining>=100,`${scale}x block not near 100m: ${blockRemaining}`);
  assert.ok(blockGap>=-2&&blockGap<=28,`${scale}x block proximity ${blockGap}`);
  assert.ok(blockEnd-blockStart>=0.55&&blockEnd-blockStart<=0.65,`${scale}x block duration ${blockEnd-blockStart}`);
  assert.ok(blockLane2Max>=-11,`${scale}x 2 did not visibly move outside: ${blockLane2Max}`);
  assert.ok(fourOutsideAt<fiveOutsideAt&&fiveOutsideAt<sixOutsideAt,`${scale}x 456 flex order`);
  assert.ok(fiveOutsideAt-fourOutsideAt>=0.20,`${scale}x 4->5 flex too short`);
  assert.ok(sixOutsideAt-fiveOutsideAt>=0.20,`${scale}x 5->6 flex too short`);
  assert.ok(maxAbsAcc<=6.51,`${scale}x acceleration discontinuity ${maxAbsAcc}`);
  assert.ok(minSameCorridorGap>=13.0,`${scale}x dango overlap ${minSameCorridorGap}`);
  assert.deepEqual(s.ranking.map(x=>x.number),[4,5,2,6,1,3,7,8,9],`${scale}x finish`);
  const t2=s.ranking.find(x=>x.number===2).time;
  const t6=s.ranking.find(x=>x.number===6).time;
  assert.ok(Math.abs(t2-t6)<=0.15,`${scale}x 2/6 duel too wide ${Math.abs(t2-t6)}`);

  return {scale,p3Entry,p4Entry,p5Entry,maxSideBySide,squeezeMinLane7,blockRemaining,blockGap,blockDuration:blockEnd-blockStart,blockLane2Max,minSameCorridorGap,maxAbsAcc,duel:Math.abs(t2-t6)};
}

for(const scale of [.5,1,2,3]){
  const x=run(scale);
  console.log(`PASS ${scale}x P3=${x.p3Entry.toFixed(1)} P4=${x.p4Entry.toFixed(1)} squeezeLane7=${x.squeezeMinLane7.toFixed(1)} contest=${x.maxSideBySide.toFixed(2)}s block=${x.blockRemaining.toFixed(1)}m/${x.blockDuration.toFixed(2)}s minGap=${x.minSameCorridorGap.toFixed(2)} duel=${x.duel.toFixed(3)}s`);
}
console.log('CR-0011 BATTLE / BLOCK: ALL STRICT CHECKS PASSED');
