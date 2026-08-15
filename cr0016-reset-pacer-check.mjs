import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { SCENARIO_TYPE, MINDSET, RUN_STYLE } from './race-plan.js';

const setup={
  scenarioId:SCENARIO_TYPE.YIELD_KAMASI,
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
  const e=new PhysicsEngine(setup);
  e.setSpeedScale(scale);
  const initial=e.getState();
  const initialRiders=initial.riders.map(r=>({
    n:r.number,d:r.distance,l:r.laneOffset,rd:r.renderDistance,rl:r.renderLaneOffset
  }));

  e.start();
  let frames=0;
  let sawExitStart=false,sawExited=false;
  let exitStartRemaining=null;
  let previousPacerLane=-18;
  let previousPacerSpeed=e.pacer.speed;
  let maxPacerSpeedStep=0;
  let pacerLaneReversed=false;

  while(e.isStarted&&frames<100000){
    e.update(1/60);
    const s=e.getState();

    if(s.pacer.state==='EXITING'&&!sawExitStart){
      sawExitStart=true;
      exitStartRemaining=s.raceClock.remainingDistance;
    }

    if(sawExitStart&&s.pacer.state==='EXITING'){
      if(s.pacer.laneOffset<previousPacerLane-1e-6)pacerLaneReversed=true;
      maxPacerSpeedStep=Math.max(maxPacerSpeedStep,Math.abs(s.pacer.speed-previousPacerSpeed));
    }

    previousPacerLane=s.pacer.laneOffset;
    previousPacerSpeed=s.pacer.speed;

    if(s.pacer.state==='EXITED'){
      sawExited=true;
      break;
    }
    frames++;
  }

  assert.ok(sawExitStart,`${scale} pacer never started exiting`);
  assert.ok(sawExited,`${scale} pacer never completed exit`);
  assert.ok(exitStartRemaining<=760&&exitStartRemaining>=560,`${scale} pacer exit outside race window: ${exitStartRemaining}`);
  assert.equal(pacerLaneReversed,false,`${scale} pacer lane reversed while exiting`);
  assert.ok(maxPacerSpeedStep<0.25,`${scale} pacer speed jumped: ${maxPacerSpeedStep}`);

  // Dirty state before reset.
  for(let i=0;i<120;i++)e.update(1/60);

  e.reset();
  const reset=e.getState();

  assert.equal(reset.isStarted,false,`${scale} reset must stop engine`);
  assert.equal(reset.elapsedTime,0,`${scale} elapsed not reset`);
  assert.equal(reset.ranking.length,0,`${scale} ranking not reset`);
  assert.equal(reset.bellRung,false,`${scale} bell flag not reset`);
  assert.equal(reset.raceClock.remainingDistance,800,`${scale} race clock not reset`);
  assert.equal(reset.raceClock.owner,'PACER',`${scale} clock owner not reset`);
  assert.equal(reset.pacer.state,'LEADING',`${scale} pacer state not reset`);
  assert.equal(reset.pacer.distance,0,`${scale} pacer distance not reset`);
  assert.equal(reset.pacer.laneOffset,-18,`${scale} pacer lane not reset`);
  assert.equal(reset.pacer.exitProgress,0,`${scale} pacer exit progress not reset`);

  for(const before of initialRiders){
    const r=reset.riders.find(x=>x.number===before.n);
    assert.ok(r,`${scale} rider ${before.n} missing`);
    assert.equal(r.distance,before.d,`${scale} rider ${before.n} distance reset`);
    assert.equal(r.laneOffset,before.l,`${scale} rider ${before.n} lane reset`);
    assert.equal(r.renderDistance,before.rd,`${scale} rider ${before.n} render distance reset`);
    assert.equal(r.renderLaneOffset,before.rl,`${scale} rider ${before.n} render lane reset`);
    assert.equal(r.finished,false,`${scale} rider ${before.n} finish flag reset`);
    assert.equal(r.energy,1,`${scale} rider ${before.n} energy reset`);
  }

  console.log(`PASS ${scale}x pacerExitRemaining=${exitStartRemaining.toFixed(1)} reset=clean`);
}

console.log('CR-0016 RESET / PACER: ALL CHECKS PASSED');
