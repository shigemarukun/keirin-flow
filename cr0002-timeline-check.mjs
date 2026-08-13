import assert from 'node:assert/strict';
import { PhysicsEngine, RACE_PROFILES } from './engine.js';
import { AIModel } from './ai.js';

const groups=new AIModel().getInitialLineGroups();
const expectedSequence=[
 'PacerLeaveLine',
 'Bell',
 'PacerExit',
 'FinalLap',
 'FinalBack',
 'Finish'
];

function run(scale){
 const engine=new PhysicsEngine(groups);
 engine.setSpeedScale(scale);

 let bellCount=0;
 engine.onBell(()=>{bellCount+=1;});

 const initial=engine.getState();
 assert.equal(initial.timeline.redBoardMarker,800,'RedBoard must be the 800m reference marker');
 assert.equal(initial.timeline.remainingDistance,800,'Simulation must start at RedBoard / 800m remaining');
 assert.deepEqual(initial.timeline.firedEventSequence,[],'RedBoard is a marker, not an event');
 assert.equal(initial.timeline.owner,'PACER');

 engine.start();

 let frames=0;
 let previousRemaining=800;
 let monotonic=true;
 let sawLeading=true;
 let sawExitingBeforeBell=false;
 let sawBellWhileExiting=false;
 let sawExited=false;
 let ownerChangedOnlyAfterExit=true;
 let ownerBeforePhysicalExit='PACER';
 const maxFrames=100000;

 while(engine.isStarted&&frames<maxFrames){
  engine.update(1/60);
  const state=engine.getState();
  const remaining=state.timeline.remainingDistance;

  if(remaining>previousRemaining+1e-8)monotonic=false;
  previousRemaining=remaining;

  if(state.pacer.state==='LEADING')sawLeading=true;

  if(state.pacer.state==='EXITING'&&!state.timeline.events.Bell.fired){
   sawExitingBeforeBell=true;
  }

  if(state.timeline.events.Bell.fired&&state.pacer.state==='EXITING'){
   sawBellWhileExiting=true;
  }

  if(state.pacer.state!=='EXITED'&&state.timeline.owner!=='PACER'){
   ownerChangedOnlyAfterExit=false;
  }

  if(state.pacer.state==='EXITED'){
   sawExited=true;
  }else{
   ownerBeforePhysicalExit=state.timeline.owner;
  }

  frames+=1;
 }

 const state=engine.getState();

 return {
  engine,
  state,
  frames,
  bellCount,
  monotonic,
  sawLeading,
  sawExitingBeforeBell,
  sawBellWhileExiting,
  sawExited,
  ownerChangedOnlyAfterExit,
  ownerBeforePhysicalExit
 };
}

for(const scale of [0.5,1,2,3]){
 const x=run(scale);

 assert.ok(x.frames<100000,`${scale}x timed out`);
 assert.equal(x.bellCount,1,`${scale}x bell must fire exactly once`);
 assert.equal(x.monotonic,true,`${scale}x remaining distance must be monotonic`);
 assert.equal(x.sawLeading,true,`${scale}x pacer LEADING state`);
 assert.equal(x.sawExitingBeforeBell,true,`${scale}x pacer must start leaving before Bell`);
 assert.equal(x.sawBellWhileExiting,true,`${scale}x Bell must occur during pacer exit`);
 assert.equal(x.sawExited,true,`${scale}x pacer must physically exit`);
 assert.equal(x.ownerChangedOnlyAfterExit,true,`${scale}x ClockOwner cannot change before physical exit`);
 assert.equal(x.ownerBeforePhysicalExit,'PACER',`${scale}x owner must remain PACER until physical exit`);
 assert.equal(x.state.timeline.owner,'LEADER',`${scale}x final owner must be LEADER`);
 assert.deepEqual(x.state.timeline.firedEventSequence,expectedSequence,`${scale}x event order`);

 const h=x.state.timeline.eventHistory;
 assert.equal(h.length,6,`${scale}x event history count`);

 const byName=Object.fromEntries(h.map(item=>[item.name,item]));
 const p=RACE_PROFILES.PROFILE_400;

 assert.ok(byName.PacerLeaveLine.remainingDistance<=p.PacerLeaveLine+0.25);
 assert.ok(byName.Bell.remainingDistance<=p.Bell+0.25);
 assert.ok(byName.PacerExit.remainingDistance<=p.PacerExit+0.25);
 assert.ok(byName.FinalLap.remainingDistance<=p.FinalLap+0.25);
 assert.ok(byName.FinalBack.remainingDistance<=p.FinalBack+0.25);
 assert.ok(byName.Finish.remainingDistance<=0.25);

 assert.ok(
  byName.PacerLeaveLine.remainingDistance>byName.Bell.remainingDistance,
  `${scale}x PacerLeaveLine must precede Bell`
 );
 assert.ok(
  byName.Bell.remainingDistance>byName.PacerExit.remainingDistance,
  `${scale}x Bell must precede PacerExit`
 );

 console.log(
  `PASS ${scale}x `+
  `events=${x.state.timeline.firedEventSequence.join('>')} `+
  `bell=${x.bellCount} owner=${x.state.timeline.owner}`
 );
}

// RESET must restore the full CR-0002 timeline.
{
 const engine=new PhysicsEngine(groups);
 engine.start();
 for(let i=0;i<2000;i++)engine.update(1/60);
 engine.reset();
 const s=engine.getState();

 assert.equal(s.isStarted,false);
 assert.equal(s.pacer.state,'LEADING');
 assert.equal(s.pacer.exitProgress,0);
 assert.equal(s.pacer.laneOffset,-18);
 assert.equal(s.bellRung,false);
 assert.equal(s.timeline.owner,'PACER');
 assert.equal(s.timeline.remainingDistance,800);
 assert.equal(s.timeline.redBoardMarker,800);
 assert.deepEqual(s.timeline.firedEventSequence,[]);
 assert.equal(s.timeline.eventHistory.length,0);

 console.log('PASS RESET restores RedBoard / pacer / bell timeline');
}

console.log('CR-0002: all timeline checks passed');
