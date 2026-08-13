import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';

const groups=new AIModel().getInitialLineGroups();
for(const scale of [0.5,1,2,3]){
 const e=new PhysicsEngine(groups); e.setSpeedScale(scale); e.start();
 let frames=0, sawAttack=false,sawRetreat=false,sawSecond=false,sawContest=false,sawSwitch=false;
 let maxAttackGap=0,minSpatial=Infinity; let orderBroken=false;
 while(e.isStarted&&frames<120000){
  e.update(1/60); const s=e.getState(); const r=n=>s.riders.find(x=>x.number===n);
  const ph=s.scenario.phase;
  if(['FIRST_MOVE','FIRST_CONTEST','SECOND_MOVE','SECOND_CONTEST'].includes(ph)){
   sawAttack=true; if(ph==='SECOND_MOVE'||ph==='SECOND_CONTEST')sawSecond=true;
   if(ph.includes('CONTEST'))sawContest=true;
   const g78=r(7).distance-r(8).distance,g89=r(8).distance-r(9).distance;
   maxAttackGap=Math.max(maxAttackGap,g78,g89);
   if(!(r(7).distance>r(8).distance&&r(8).distance>r(9).distance))orderBroken=true;
  }
  if(['FIRST_RETREAT','RESET_LINEUP'].includes(ph)) sawRetreat=true;
  if([8,9].some(n=>r(n).action==='SWITCH_TO_SELF_POWER'))sawSwitch=true;
  const active=s.riders.filter(x=>!x.finished);
  for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)minSpatial=Math.min(minSpatial,Math.hypot(active[i].distance-active[j].distance,(active[i].laneOffset-active[j].laneOffset)*0.45));
  frames++;
 }
 const s=e.getState();
 assert.ok(frames<120000,`${scale}x timeout`);
 assert.ok(sawAttack&&sawRetreat&&sawSecond&&sawContest,`${scale}x tactical phases missing`);
 assert.equal(orderBroken,false,`${scale}x 7-8-9 order broken`);
 assert.ok(maxAttackGap<28,`${scale}x line cohesion too loose: ${maxAttackGap}`);
 assert.ok(minSpatial>0.02,`${scale}x same-slot collapse`);
 assert.deepEqual(s.raceClock.firedEventSequence,['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
 assert.equal(s.ranking.length,9,`${scale}x all riders finish`);
 console.log(`PASS ${scale}x tacticalAI attack/retreat/re-attack cohesion maxGap=${maxAttackGap.toFixed(2)} switch=${sawSwitch}`);
}
console.log('CR-0003 Dynamic Tactical Interaction: all checks passed');
