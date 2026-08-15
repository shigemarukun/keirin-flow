import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { SCENARIO_TYPE, MINDSET, RUN_STYLE, TRACK_LANE } from './race-plan.js';

const setup={
  scenarioId:SCENARIO_TYPE.YIELD_KAMASI,trackProfile:'PROFILE_400',
  lines:[
    {id:'LINE_A',members:[1,2,3],leader:1},
    {id:'LINE_B',members:[4,5,6],leader:4},
    {id:'LINE_C',members:[7,8,9],leader:7}
  ],
  riders:{
    1:{mindset:MINDSET.YIELD_AND_ROLL},2:{},3:{},
    4:{runStyle:RUN_STYLE.NIGE},5:{},6:{},
    7:{mindset:MINDSET.CONTAIN},8:{},9:{}
  }
};

for(const scale of [.5,1,2,3]){
  const e=new PhysicsEngine(setup);e.setSpeedScale(scale);e.start();
  let frames=0, yieldFrames=0, minYieldSpeed=Infinity, maxYieldLaneError=0;
  let saw789Ahead123=false, sawWhole456Clear789=false, sawCleanFormation=false;
  let maxRigidGapError=0, maxRigidLaneError=0;

  while(e.isStarted && frames<300000){
    e.update(1/60);
    const st=e.getState(), p=st.scenario.currentPhase;
    const R=n=>st.riders.find(r=>r.number===n);

    if(!['FINISH_ACTION'].includes(p)){
      for(const [a,b] of [[4,5],[5,6],[7,8],[8,9],[1,2],[2,3]]){
        const front=R(a),rear=R(b);
        if(!front.finished && !rear.finished){
          maxRigidGapError=Math.max(maxRigidGapError,Math.abs((front.distance-rear.distance)-16.5));
          maxRigidLaneError=Math.max(maxRigidLaneError,Math.abs(front.laneOffset-rear.laneOffset));
        }
      }
    }

    if(p==='START_RESOLUTION'){
      yieldFrames++;
      minYieldSpeed=Math.min(minYieldSpeed,R(1).speed);
      maxYieldLaneError=Math.max(maxYieldLaneError,Math.abs(R(1).laneOffset-TRACK_LANE.INNER));
      if(R(7).distance>R(1).distance+7) saw789Ahead123=true;
    }
    if(p==='MIDDLE_SETTLE'){
      if(R(6).distance>R(7).distance+6) sawWhole456Clear789=true;
    }
    if(p==='MIDDLE_ACTION'){
      const inner=[1,4,7].every(n=>Math.abs(R(n).laneOffset-TRACK_LANE.INNER)<3);
      const ordered=R(4).distance>R(7).distance+12 && R(7).distance>R(1).distance+12;
      if(inner&&ordered) sawCleanFormation=true;
    }
    frames++;
  }
  const st=e.getState();
  assert.ok(yieldFrames>20,`${scale} yield too short`);
  assert.ok(minYieldSpeed>=12.8,`${scale} receiving line braked during YIELD: ${minYieldSpeed}`);
  assert.ok(maxYieldLaneError<0.25,`${scale} receiving leader wandered lane: ${maxYieldLaneError}`);
  assert.ok(saw789Ahead123,`${scale} 789 did not naturally clear 123`);
  assert.ok(sawWhole456Clear789,`${scale} 456 did not clear 789 as a complete bundle`);
  assert.ok(sawCleanFormation,`${scale} clean 456/789/123 formation not visible`);
  assert.ok(maxRigidGapError<0.05,`${scale} rigid gap broke: ${maxRigidGapError}`);
  assert.ok(maxRigidLaneError<0.05,`${scale} rigid lane broke: ${maxRigidLaneError}`);
  assert.ok(st.scenario.phaseHistory.includes('MIDDLE_REACTION'));
  assert.ok(st.scenario.phaseHistory.includes('MIDDLE_SETTLE'));
  console.log(`PASS ${scale}x yieldMin=${minYieldSpeed.toFixed(2)} rigidGapErr=${maxRigidGapError.toFixed(3)} laneErr=${maxRigidLaneError.toFixed(3)} phases=${st.scenario.phaseHistory.join('>')}`);
}
console.log('CR-0014 VISUAL KEIRIN GRAMMAR: ALL CHECKS PASSED');
