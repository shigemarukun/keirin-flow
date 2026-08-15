import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { SCENARIO_TYPE,MINDSET,RUN_STYLE } from './race-plan.js';
const setup={scenarioId:SCENARIO_TYPE.YIELD_KAMASI,trackProfile:'PROFILE_400',lines:[{id:'LINE_A',members:[1,2,3],leader:1},{id:'LINE_B',members:[4,5,6],leader:4},{id:'LINE_C',members:[7,8,9],leader:7}],riders:{1:{mindset:MINDSET.YIELD_AND_ROLL},2:{},3:{},4:{runStyle:RUN_STYLE.NIGE},5:{},6:{},7:{mindset:MINDSET.CONTAIN},8:{},9:{}}};
for(const scale of [.5,1,2,3]){
 const e=new PhysicsEngine(setup);e.setSpeedScale(scale);e.start();
 const prev=new Map(e.riders.map(r=>[r.number,r.distance]));let minPair=Infinity,maxSlotErr=0,maxSnakeBend=0,saw789=false,saw456=false,sawOrder=false,frames=0;
 while(e.isStarted&&frames<300000){e.update(1/60);const s=e.getState(),R=n=>s.riders.find(r=>r.number===n);
  for(const r of s.riders){assert.ok(r.distance+1e-8>=prev.get(r.number),`${scale}x reverse rider ${r.number}`);prev.set(r.number,r.distance);}
  if(s.scenario.currentPhase!=='FINISH_ACTION')for(const [a,b,pos] of [[1,2,1],[1,3,2],[4,5,1],[4,6,2],[7,8,1],[7,9,2]]){const A=R(a),B=R(b);if(!A.finished&&!B.finished){maxSlotErr=Math.max(maxSlotErr,Math.abs((A.distance-B.distance)-1.5*pos));maxSnakeBend=Math.max(maxSnakeBend,Math.abs(A.laneOffset-B.laneOffset));}}
  for(let i=0;i<s.riders.length;i++)for(let j=i+1;j<s.riders.length;j++){const a=s.riders[i],b=s.riders[j];if(a.finished||b.finished)continue;const metric=Math.hypot((a.distance-b.distance)*4.0,(a.laneOffset-b.laneOffset));minPair=Math.min(minPair,metric);assert.ok(Math.abs(a.distance-b.distance)>.01||Math.abs(a.laneOffset-b.laneOffset)>.01,`${scale} exact coordinate overlap ${a.number}/${b.number}`);}
  if(R(7).distance>R(1).distance+2)saw789=true;
  if(R(6).distance>R(7).distance+1)saw456=true;
  if(s.scenario.currentPhase==='MIDDLE_ACTION'&&R(4).distance>R(7).distance&&R(7).distance>R(1).distance)sawOrder=true;
  frames++;
 }
 assert.ok(saw789,`${scale} 789 never rose ahead`);assert.ok(saw456,`${scale} whole 456 never cleared 789`);assert.ok(sawOrder,`${scale} 456/789/123 order never formed`);assert.ok(maxSlotErr<.04,`${scale} slot error ${maxSlotErr}`);assert.ok(maxSnakeBend>.08,`${scale} no visible path-history bend ${maxSnakeBend}`);
 console.log(`PASS ${scale}x maxSlotErr=${maxSlotErr.toFixed(4)} snakeBend=${maxSnakeBend.toFixed(3)} minSeparationMetric=${minPair.toFixed(3)} phases=${e.getState().scenario.phaseHistory.join('>')}`);
}
console.log('CR-0015 SLOT/PATH HISTORY: ALL CHECKS PASSED');
