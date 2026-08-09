import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';

const groups=new AIModel().getInitialLineGroups();
assert.deepEqual(groups,[[1,2,3],[4,5,6],[7,8,9]]);

function order(state){return [...state.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance).map(r=>r.number);}
function run(scale){
 const e=new PhysicsEngine(groups,[-18,-6,6,18],undefined,structuredClone(DEFAULT_RACE_PLAN));e.setSpeedScale(scale);let bell=0;e.onBell(()=>bell++);e.start();
 let frames=0,saw7Outside=false,saw4Outside=false,sawFinalLapFormation=false,saw1Attack=false,saw7Defend=false,saw8Block1=false,saw4AttackAfterBlock=false;
 let energy1AtAttack=null,energy1AfterBlock=null;
 while(e.isStarted&&frames++<90000){
  e.update(1/60);const s=e.getState();const r=n=>s.riders.find(x=>x.number===n);const rem=s.raceClock.remainingDistance;
  if(rem<650&&rem>575&&r(7).laneOffset>10)saw7Outside=true;
  if(rem<560&&rem>410&&r(4).laneOffset>5)saw4Outside=true;
  if(rem<=405&&rem>=395){const o=order(s);if(o.slice(0,9).join('-')==='7-8-9-4-5-6-1-2-3')sawFinalLapFormation=true;}
  if(r(1).action==='ATTACK'){saw1Attack=true;if(energy1AtAttack==null)energy1AtAttack=r(1).energy;}
  if(r(7).action==='DEFEND')saw7Defend=true;
  if(r(8).action==='BLOCK'&&r(8).blockTargetNumber===1){saw8Block1=true;energy1AfterBlock=r(1).energy;}
  if(saw8Block1&&r(4).action==='ATTACK')saw4AttackAfterBlock=true;
 }
 const s=e.getState();return {e,s,frames,bell,saw7Outside,saw4Outside,sawFinalLapFormation,saw1Attack,saw7Defend,saw8Block1,saw4AttackAfterBlock,energy1AtAttack,energy1AfterBlock};
}

for(const scale of [0.5,1,2,3]){
 const x=run(scale);
 assert.ok(x.frames<90000,`${scale}x timeout`);assert.equal(x.bell,1,`${scale}x bell once`);assert.equal(x.s.ranking.length,9,`${scale}x finish`);
 assert.deepEqual(x.s.raceClock.firedEventSequence,['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
 assert.ok(x.saw7Outside,`${scale}x 7-line must rise outside`);
 assert.ok(x.saw4Outside,`${scale}x 4-line must rise with passing line`);
 assert.ok(x.sawFinalLapFormation,`${scale}x final lap formation must be 789/456/123`);
 assert.ok(x.saw1Attack,`${scale}x 1-line makuri`);assert.ok(x.saw7Defend,`${scale}x 7 resists`);assert.ok(x.saw8Block1,`${scale}x 8 blocks 1`);assert.ok(x.saw4AttackAfterBlock,`${scale}x 4 attacks after block`);
 assert.ok(x.energy1AfterBlock<x.energy1AtAttack,`${scale}x 1 must spend energy through failed makuri`);
 assert.deepEqual(x.s.ranking.slice(0,3).map(x=>x.number),[4,5,8],`${scale}x target podium`);
 console.log(`PASS ${scale}x  final=${x.s.ranking.map(x=>x.number).join('-')}  1E ${x.energy1AtAttack.toFixed(2)} -> ${x.energy1AfterBlock.toFixed(2)}`);
}
console.log('BASE SCENARIO A: all causal checkpoints passed');
