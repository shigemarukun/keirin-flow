import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { SCENARIO_TYPE, MINDSET, RUN_STYLE } from './race-plan.js';

const setup={
  scenarioId: SCENARIO_TYPE.YIELD_KAMASI,
  trackProfile:'PROFILE_400',
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
  const e=new PhysicsEngine(setup); e.setSpeedScale(scale); e.start();
  let frames=0, saw789Front=false, saw456789123=false, saw123Kamasi=false;
  let snapshot=null;
  while(e.isStarted && frames<260000){
    e.update(1/60);
    const st=e.getState();
    const by=n=>st.riders.find(r=>r.number===n);
    if(st.scenario.currentPhase==='START_RESOLUTION'){
      if(by(7).distance>by(4).distance && by(4).distance>by(1).distance) saw789Front=true;
    }
    if(st.scenario.currentPhase==='MIDDLE_ACTION' && !snapshot){
      snapshot=st.riders.map(r=>({n:r.number,d:r.distance,l:r.laneOffset}));
      const L=n=>Math.max(...setup.lines.find(x=>x.id===n).members.map(k=>by(k).distance));
      if(L('LINE_B')>L('LINE_C') && L('LINE_C')>L('LINE_A')) saw456789123=true;
    }
    if(st.scenario.currentPhase==='MIDDLE_ACTION' && by(1).action==='ATTACK') saw123Kamasi=true;
    frames++;
  }
  const st=e.getState();
  assert.ok(frames<260000,`${scale} timeout ${st.scenario.currentPhase}`);
  assert.ok(saw789Front,`${scale} 789 never took front`);
  assert.ok(saw456789123,`${scale} 456/789/123 formation missing: ${JSON.stringify(snapshot)}`);
  assert.ok(saw123Kamasi,`${scale} 123 kamasi missing`);
  assert.deepEqual(st.scenario.phaseHistory,['PACER_CUT','START_RESOLUTION','MIDDLE_REACTION','MIDDLE_ACTION','FRONT_ESTABLISHED','FINISH_ACTION']);
  assert.ok([1,2].includes(st.ranking[0].number),`${scale} expected kamasi line winner`);
  assert.ok([1,2].includes(st.ranking[1].number),`${scale} expected kamasi line one-two`);
  console.log(`PASS ${scale}x phases=${st.scenario.phaseHistory.join('>')} rank=${st.ranking.map(x=>x.number).join('-')}`);
}
console.log('CR-0013 YIELD + MIDDLE NIGE REACTION: ALL CHECKS PASSED');
