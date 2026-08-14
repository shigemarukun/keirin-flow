import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { SCENARIO_TYPE, MINDSET } from './race-plan.js';

const setup={
  scenarioId: SCENARIO_TYPE.YIELD_KAMASI,
  trackProfile:'PROFILE_400',
  lines:[
    {id:'LINE_A',members:[1,2,3],leader:1},
    {id:'LINE_B',members:[4,5],leader:4},
    {id:'SOLO_6',members:[6],leader:6},
    {id:'LINE_C',members:[7,8,9],leader:7}
  ],
  riders:{
    1:{mindset:MINDSET.YIELD_AND_ROLL},2:{},3:{},4:{},5:{},
    6:{solo:true},7:{mindset:MINDSET.CONTAIN},8:{},9:{}
  }
};

for(const scale of [.5,1,2,3]){
  const e=new PhysicsEngine(setup); e.setSpeedScale(scale); e.start();
  let frames=0, kirikae=false, kamasi=false, established=false;
  while(e.isStarted && frames<240000){
    e.update(1/60);
    const st=e.getState();
    const r6=st.riders.find(r=>r.number===6);
    const r1=st.riders.find(r=>r.number===1);
    if(r6?.action==='KIRIKAE' && r6.followTargetNumber) kirikae=true;
    if(r1?.action==='ATTACK' && st.scenario.currentPhase==='MIDDLE_ACTION') kamasi=true;
    if(st.scenario.currentPhase==='FRONT_ESTABLISHED') established=true;
    frames++;
  }
  const st=e.getState();
  assert.ok(frames<240000,`${scale} timeout phase=${st.scenario.currentPhase} rem=${st.raceClock.remainingDistance}`);
  assert.equal(st.setup.scenarioId,SCENARIO_TYPE.YIELD_KAMASI);
  assert.equal(st.riders.find(r=>r.number===6).role,'SOLO');
  assert.ok(kirikae,`${scale} solo KIRIKAE missing`);
  assert.ok(kamasi,`${scale} KAMASI missing`);
  assert.ok(established,`${scale} front establishment missing`);
  assert.deepEqual(st.scenario.phaseHistory,['PACER_CUT','START_RESOLUTION','MIDDLE_ACTION','FRONT_ESTABLISHED','FINISH_ACTION']);
  assert.ok(st.ranking.length===9,`${scale} finish count`);
  assert.ok([1,2].includes(st.ranking[0].number),`${scale} expected 1/2 line winner, got ${st.ranking[0].number}`);
  console.log(`PASS ${scale}x phases=${st.scenario.phaseHistory.join('>')} rank=${st.ranking.map(x=>x.number).join('-')} kirikae=${kirikae}`);
}
console.log('CR-0012 DYNAMIC YIELD_KAMASI: ALL CHECKS PASSED');
