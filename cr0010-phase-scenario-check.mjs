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
  let maxAbsAcceleration=0;
  let minSameCorridorGap=Infinity;
  let phase3MaxSideBySideSeconds=0;

  const phaseEntries=new Map();
  let fourOutsideAt=null;
  let fiveOutsideAt=null;
  let sixOutsideAt=null;

  while(engine.isStarted && frames<200000){
    engine.update(1/60);
    const state=engine.getState();

    if(!phaseEntries.has(state.scenario.currentPhase)){
      phaseEntries.set(
        state.scenario.currentPhase,
        state.riders.map(r=>({
          n:r.number,d:r.distance,l:r.laneOffset,v:r.speed,finished:r.finished
        }))
      );
    }

    phase3MaxSideBySideSeconds=Math.max(
      phase3MaxSideBySideSeconds,
      state.scenario.phase3SideBySideSeconds??0
    );

    for(const rider of state.riders){
      if(!rider.finished)maxAbsAcceleration=Math.max(maxAbsAcceleration,Math.abs(rider.acceleration));
    }

    const active=state.riders.filter(r=>!r.finished);
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j];
      if(Math.abs(a.laneOffset-b.laneOffset)<7){
        minSameCorridorGap=Math.min(minSameCorridorGap,Math.abs(a.distance-b.distance));
      }
    }

    if(state.scenario.currentPhase===SCENARIO_PHASE.MAKURI){
      for(const number of [4,5,6]){
        const r=state.riders.find(x=>x.number===number);
        if(r && r.laneOffset>0){
          if(number===4 && fourOutsideAt==null)fourOutsideAt=state.elapsedTime;
          if(number===5 && fiveOutsideAt==null)fiveOutsideAt=state.elapsedTime;
          if(number===6 && sixOutsideAt==null)sixOutsideAt=state.elapsedTime;
        }
      }
    }

    frames++;
  }

  const state=engine.getState();
  assert.ok(frames<200000,`${scale}x timed out`);
  assert.deepEqual(state.scenario.phaseHistory,expectedPhases,`${scale}x phase order`);

  // Phase 2 must visibly restore all three lines to the inner corridor before Phase 3.
  const p3=phaseEntries.get(SCENARIO_PHASE.SECOND_ATTACK);
  assert.ok(p3,`${scale}x Phase 3 missing`);
  for(const n of [1,2,3,4,5,6,7,8,9]){
    const r=p3.find(x=>x.n===n);
    assert.ok(Math.abs(r.l-TRACK_LANE.INNER)<=8,`${scale}x reset-to-inner rider ${n}: lane=${r.l}`);
  }
  for(const group of [[1,2,3],[4,5,6],[7,8,9]]){
    for(let i=1;i<group.length;i++){
      const front=p3.find(x=>x.n===group[i-1]);
      const rear=p3.find(x=>x.n===group[i]);
      const gap=front.d-rear.d;
      assert.ok(gap>=13&&gap<=22,`${scale}x line gap ${group[i-1]}-${group[i]}=${gap}`);
    }
  }

  // Phase 3 must prove a real outside side-by-side contest, not merely "move up".
  assert.ok(
    phase3MaxSideBySideSeconds>=0.69,
    `${scale}x side-by-side contest too short: ${phase3MaxSideBySideSeconds}`
  );
  const p4=phaseEntries.get(SCENARIO_PHASE.MAKURI);
  const p4r1=p4.find(r=>r.n===1),p4r7=p4.find(r=>r.n===7);
  assert.ok(Math.abs(p4r1.d-p4r7.d)<=6,`${scale}x Phase 3 contest gap=${Math.abs(p4r1.d-p4r7.d)}`);
  assert.ok(Math.abs(p4r1.l-p4r7.l)>=35,`${scale}x Phase 3 lanes not parallel-separated`);

  // Phase 4 line flex: 4 initiates, then 5, then 6. No simultaneous sideways teleport.
  assert.ok(fourOutsideAt!=null&&fiveOutsideAt!=null&&sixOutsideAt!=null,`${scale}x makuri lane transition missing`);
  assert.ok(fourOutsideAt<fiveOutsideAt,`${scale}x 4 must move outside before 5`);
  assert.ok(fiveOutsideAt<sixOutsideAt,`${scale}x 5 must move outside before 6`);
  assert.ok(fiveOutsideAt-fourOutsideAt>=0.20,`${scale}x 4->5 flex delay too small`);
  assert.ok(sixOutsideAt-fiveOutsideAt>=0.20,`${scale}x 5->6 flex delay too small`);

  // Inertia: scenario target jumps never become speed jumps.
  assert.ok(maxAbsAcceleration<=6.51,`${scale}x acceleration discontinuity ${maxAbsAcceleration}`);

  // Except for intentionally separated two-lane contesting, same-corridor riders remain apart.
  assert.ok(minSameCorridorGap>=13.0,`${scale}x dango/overlap gap=${minSameCorridorGap}`);

  // Teacher outcome and finish dramaturgy.
  assert.deepEqual(state.ranking.map(x=>x.number),[4,5,2,6,1,3,7,8,9],`${scale}x teacher finish`);
  const r2=state.ranking.find(x=>x.number===2);
  const r6=state.ranking.find(x=>x.number===6);
  assert.ok(Math.abs(r2.time-r6.time)<=0.12,`${scale}x 2/6 third-place duel not close: ${Math.abs(r2.time-r6.time)}`);

  return {
    scale,
    frames,
    ranking:state.ranking.map(x=>x.number),
    minSameCorridorGap,
    maxAbsAcceleration,
    sideBySide:phase3MaxSideBySideSeconds,
    flex:[fourOutsideAt,fiveOutsideAt,sixOutsideAt],
    duelGap:Math.abs(r2.time-r6.time)
  };
}

for(const scale of [.5,1,2,3]){
  const r=run(scale);
  console.log(
    `PASS ${scale}x ranking=${r.ranking.join('-')} `+
    `minGap=${r.minSameCorridorGap.toFixed(2)}m `+
    `maxAcc=${r.maxAbsAcceleration.toFixed(2)}m/s2 `+
    `sideBySide=${r.sideBySide.toFixed(2)}s `+
    `flex=${r.flex.map(x=>x.toFixed(2)).join('>')} `+
    `duel=${r.duelGap.toFixed(3)}s`
  );
}
console.log('CR-0010 TSUPPARI_MAKURI: ALL STRICT CHECKS PASSED');
