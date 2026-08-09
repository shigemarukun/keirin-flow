import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';

const groups=new AIModel().getInitialLineGroups();
assert.deepEqual(groups,[[1,2,3],[4,5,6],[7,8,9]]);

function activeOrder(s){return [...s.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance).map(r=>r.number);}
function run(scale){
 const e=new PhysicsEngine(groups,[-18,-6,6,18],undefined,structuredClone(DEFAULT_RACE_PLAN));
 e.setSpeedScale(scale);let bell=0;e.onBell(()=>bell++);e.start();
 let frames=0;
 const seen={first789Outside:false,tsuppari:false,retreat:false,finalLapReset:false,second789Outside:false,halfLap789Rear:false,middleMakuri:false,block2on4:false,twoOutside:false,fiveDive:false};
 let minSpatial=Infinity;
 while(e.isStarted&&frames++<100000){
   e.update(1/60);const s=e.getState(),rem=s.raceClock.remainingDistance;const r=n=>s.riders.find(x=>x.number===n);
   if(rem<650&&rem>585&&r(7).laneOffset>20&&r(7).action==='MOVE_UP')seen.first789Outside=true;
   if(rem<650&&rem>560&&r(1).action==='DEFEND'&&r(1).speed>r(7).speed)seen.tsuppari=true;
   if(rem<520&&rem>420&&r(7).action==='RETREAT'&&r(7).speed<12)seen.retreat=true;
   if(rem<=405&&rem>=395&&activeOrder(s).slice(0,9).join('-')==='1-2-3-4-5-6-7-8-9')seen.finalLapReset=true;
   if(rem<360&&rem>230&&r(7).laneOffset>25&&r(7).action==='ATTACK')seen.second789Outside=true;
   if(rem<=210&&rem>=195&&activeOrder(s).slice(0,9).join('-')==='1-2-3-4-5-6-7-8-9'&&r(7).action==='FADE')seen.halfLap789Rear=true;
   if(rem<150&&rem>95&&r(4).action==='ATTACK'&&r(4).laneOffset>15)seen.middleMakuri=true;
   if(r(2).action==='BLOCK'&&r(2).blockTargetNumber===4){seen.block2on4=true;if(r(2).laneOffset>5)seen.twoOutside=true;}
   if(r(5).action==='DIVE'&&r(5).laneOffset<20)seen.fiveDive=true;
   const active=s.riders.filter(x=>!x.finished);
   for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
     const a=active[i],b=active[j];
     const spatial=Math.hypot(a.distance-b.distance,(a.laneOffset-b.laneOffset)*0.45);
     minSpatial=Math.min(minSpatial,spatial);
   }
 }
 return {e,s:e.getState(),frames,bell,seen,minSpatial};
}

for(const scale of [0.5,1,2,3]){
 const x=run(scale);
 assert.ok(x.frames<100000,`${scale}x timeout`);
 assert.equal(x.bell,1,`${scale}x bell`);
 assert.deepEqual(x.s.raceClock.firedEventSequence,['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
 for(const [k,v] of Object.entries(x.seen))assert.ok(v,`${scale}x missing ${k}`);
 assert.deepEqual(x.s.ranking.map(r=>r.number),[1,2,5,3,6,4,9,8,7],`${scale}x exact scenario finish`);
 assert.ok(x.minSpatial>0.02,`${scale}x active riders collapsed into same slot: ${x.minSpatial}`);
 console.log(`PASS ${scale}x finish=${x.s.ranking.map(r=>r.number).join('-')} minSpatial=${x.minSpatial.toFixed(3)}`);
}
console.log('BASE SCENARIO B: all tactical and movement checkpoints passed');
