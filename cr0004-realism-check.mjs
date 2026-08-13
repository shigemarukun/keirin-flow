import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';

const groups=new AIModel().getInitialLineGroups();

function run(scale){
 const e=new PhysicsEngine(groups);e.setSpeedScale(scale);let bell=0;e.onBell(()=>bell++);e.start();
 let frames=0,lastPhase='';
 const M={
  pacerStart:null,bellAt:null,resetAt:null,
  retreatMin78:Infinity,retreatMin89:Infinity,retreatMax78:0,retreatMax89:0,maxRetreatDecel:0,
  attackMax78:0,attackMax89:0,
  blockStart:null,blockLane10:null,reactionStart:null,diveStart:null,feintSeen:false,
  gapMin:Infinity,gapMax:-Infinity,minSpatial:Infinity,finalOverTop:0,finished:false
 };
 let prev7=10.5,prevT=0;
 while(e.isStarted&&frames++<120000){
  e.update(1/60);const s=e.getState(),r=n=>s.riders.find(x=>x.number===n),ph=s.scenario.phase;
  if(s.pacer.state==='EXITING'&&M.pacerStart==null)M.pacerStart={rem:s.raceClock.remainingDistance,gap:r(1).distance-r(7).distance,lane7:r(7).laneOffset};
  if(s.bellRung&&M.bellAt==null)M.bellAt=s.raceClock.remainingDistance;
  if(ph==='RESET_LINEUP'&&M.resetAt==null)M.resetAt=s.raceClock.remainingDistance;
  const g78=r(7).distance-r(8).distance,g89=r(8).distance-r(9).distance;
  if(['FIRST_MOVE','FIRST_CONTEST','SECOND_MOVE','SECOND_CONTEST'].includes(ph)){
   M.attackMax78=Math.max(M.attackMax78,g78);M.attackMax89=Math.max(M.attackMax89,g89);M.gapMin=Math.min(M.gapMin,g78);M.gapMax=Math.max(M.gapMax,g78);
  }
  if(ph==='FIRST_RETREAT'){
   M.retreatMin78=Math.min(M.retreatMin78,g78);M.retreatMin89=Math.min(M.retreatMin89,g89);M.retreatMax78=Math.max(M.retreatMax78,g78);M.retreatMax89=Math.max(M.retreatMax89,g89);
   const dt=s.elapsedTime-prevT;if(dt>0)M.maxRetreatDecel=Math.max(M.maxRetreatDecel,(prev7-r(7).speed)/dt);
  }
  if(ph==='BANTE_BLOCK'&&M.blockStart==null)M.blockStart=s.elapsedTime;
  if(ph==='BANTE_BLOCK'&&r(2).laneOffset>=10&&M.blockLane10==null)M.blockLane10=s.elapsedTime;
  if(ph==='FIVE_REACTION'){
   if(M.reactionStart==null)M.reactionStart=s.elapsedTime;
   if(r(5).action==='DIVE_FEINT'&&r(5).laneOffset>0)M.feintSeen=true;
  }
  if(ph==='FIVE_DIVE'&&M.diveStart==null)M.diveStart=s.elapsedTime;
  if(ph==='FINAL'){
   for(const rr of s.riders){if(rr.action==='FINAL_SPRINT'&&rr.speed>(rr.plan.topSpeed??21)+0.5)M.finalOverTop++;}
  }
  const active=s.riders.filter(x=>!x.finished);
  for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
   const a=active[i],b=active[j];const spatial=Math.hypot(a.distance-b.distance,(a.laneOffset-b.laneOffset)*0.45);M.minSpatial=Math.min(M.minSpatial,spatial);
  }
  prev7=r(7).speed;prevT=s.elapsedTime;lastPhase=ph;
 }
 M.finished=e.getState().ranking.length===9;
 return {e,s:e.getState(),M,bell,frames};
}

for(const scale of [0.5,1,2,3]){
 const {s,M,bell,frames}=run(scale);
 assert.ok(frames<120000,`${scale}x timeout`);assert.equal(M.finished,true,`${scale}x all finish`);assert.equal(bell,1,`${scale}x bell once`);
 assert.ok(M.pacerStart,`${scale}x pacer exit start`);
 assert.ok(M.pacerStart.gap<=18.3&&M.pacerStart.gap>=-4.5,`${scale}x pacer must react to front pressure gap=${M.pacerStart.gap}`);
 assert.ok(M.pacerStart.lane7>10,`${scale}x challenger must be outside`);
 assert.ok(M.retreatMin78>10&&M.retreatMin89>10,`${scale}x no retreat pile-up ${M.retreatMin78}/${M.retreatMin89}`);
 assert.ok(M.retreatMax78<22&&M.retreatMax89<22,`${scale}x retreat cohesion ${M.retreatMax78}/${M.retreatMax89}`);
 assert.ok(M.maxRetreatDecel<=4.35,`${scale}x retreat braking too harsh ${M.maxRetreatDecel}`);
 assert.ok(M.resetAt<=405&&M.resetAt>=370,`${scale}x line should be reformed around final lap ${M.resetAt}`);
 assert.ok(M.attackMax78<23&&M.attackMax89<22,`${scale}x attack line stretched ${M.attackMax78}/${M.attackMax89}`);
 assert.ok(M.gapMax-M.gapMin>1.5,`${scale}x accordion breathing absent`);
 assert.ok(M.blockStart!=null&&M.blockLane10!=null,`${scale}x block must physically move out`);
 assert.ok(M.blockLane10-M.blockStart>=0.70,`${scale}x block slide too robotic ${(M.blockLane10-M.blockStart)}`);
 assert.ok(M.reactionStart!=null&&M.diveStart!=null&&M.diveStart-M.reactionStart>=0.20,`${scale}x dive reaction delay`);
 assert.equal(M.feintSeen,true,`${scale}x 5 must show feint before dive`);
 assert.ok(M.finalOverTop>0,`${scale}x final sprint must exceed normal top speed for riders with reserve`);
 assert.ok(M.minSpatial>3.8,`${scale}x same-slot overlap ${M.minSpatial}`);
 console.log(`PASS ${scale}x pacerGap=${M.pacerStart.gap.toFixed(1)} retreat=${M.retreatMin78.toFixed(1)}-${M.retreatMax78.toFixed(1)} blockSlide=${(M.blockLane10-M.blockStart).toFixed(2)} reaction=${(M.diveStart-M.reactionStart).toFixed(2)} minSpatial=${M.minSpatial.toFixed(2)} finish=${s.ranking.map(x=>x.number).join('-')}`);
}
console.log('CR-0004 REALISM: all checks passed');
