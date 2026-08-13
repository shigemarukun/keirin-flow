import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';

const groups=new AIModel().getInitialLineGroups();

function run(scale){
 const e=new PhysicsEngine(groups);e.setSpeedScale(scale);let bell=0;e.onBell(()=>bell++);e.start();
 let frames=0;
 const M={
  fadeStartRem:null,makuriStartRem:null,blockStartRem:null,
  fadeStartSpeeds:null,makuriStartSpeeds:null,blockStartSpeeds:null,
  maxFadeLaneMin:-Infinity,minFadeLane7:Infinity,minFadeLane8:Infinity,minFadeLane9:Infinity,
  sawFullFade:false,sawOvertake:false,sawDynamicLaneChange:false,sawBlock:false,sawBlockOut:false,
  min4vsSpent:Infinity,minSpatial:Infinity,max789AtBlock:0,
  blockGap:null,blockSlide:null,blockStartTime:null,blockOutTime:null,
  reactionStart:null,diveStart:null,finished:false
 };
 let initialMakuriLane=null;
 while(e.isStarted&&frames++<140000){
  e.update(1/60);const s=e.getState(),r=n=>s.riders.find(x=>x.number===n),ph=s.scenario.phase;
  if(ph==='LINE7_FADE'){
   if(M.fadeStartRem==null){M.fadeStartRem=s.raceClock.remainingDistance;M.fadeStartSpeeds=[r(7).speed,r(8).speed,r(9).speed];}
   M.minFadeLane7=Math.min(M.minFadeLane7,r(7).laneOffset);M.minFadeLane8=Math.min(M.minFadeLane8,r(8).laneOffset);M.minFadeLane9=Math.min(M.minFadeLane9,r(9).laneOffset);
   if(r(7).action==='FADE'&&r(8).action==='FADE_FOLLOW'&&r(9).action==='FADE_FOLLOW')M.sawFullFade=true;
  }
  if(ph==='LINE4_MAKURI'){
   if(M.makuriStartRem==null){M.makuriStartRem=s.raceClock.remainingDistance;M.makuriStartSpeeds=[r(7).speed,r(8).speed,r(9).speed];initialMakuriLane=r(4).laneOffset;}
  }
  if(['LINE4_MAKURI','BANTE_BLOCK'].includes(ph)){
   if(r(4).action==='OVERTAKE')M.sawOvertake=true;
   if(initialMakuriLane!=null&&Math.abs(r(4).laneOffset-initialMakuriLane)>8)M.sawDynamicLaneChange=true;
  }
  if(ph==='BANTE_BLOCK'){
   if(M.blockStartRem==null){M.blockStartRem=s.raceClock.remainingDistance;M.blockStartSpeeds=[r(7).speed,r(8).speed,r(9).speed];M.blockGap=r(2).distance-r(4).distance;M.blockStartTime=s.elapsedTime;}
   if(r(2).action==='BLOCK')M.sawBlock=true;
   if(r(2).laneOffset>=10&&M.blockOutTime==null){M.sawBlockOut=true;M.blockOutTime=s.elapsedTime;}
   M.max789AtBlock=Math.max(M.max789AtBlock,r(7).speed,r(8).speed,r(9).speed);
  }
  if(ph==='FIVE_REACTION'&&M.reactionStart==null)M.reactionStart=s.elapsedTime;
  if(ph==='FIVE_DIVE'&&M.diveStart==null)M.diveStart=s.elapsedTime;

  if(['LINE4_MAKURI','BANTE_BLOCK'].includes(ph)){
   for(const n of [7,8,9]){
    const o=r(n);M.min4vsSpent=Math.min(M.min4vsSpent,Math.hypot(r(4).distance-o.distance,(r(4).laneOffset-o.laneOffset)*0.45));
   }
  }
  const active=s.riders.filter(x=>!x.finished);
  for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
   const a=active[i],b=active[j];M.minSpatial=Math.min(M.minSpatial,Math.hypot(a.distance-b.distance,(a.laneOffset-b.laneOffset)*0.45));
  }
 }
 if(M.blockStartTime!=null&&M.blockOutTime!=null)M.blockSlide=M.blockOutTime-M.blockStartTime;
 M.finished=e.getState().ranking.length===9;
 return {s:e.getState(),M,bell,frames};
}

for(const scale of [0.5,1,2,3]){
 const {s,M,bell,frames}=run(scale);
 assert.ok(frames<140000,`${scale}x timeout`);assert.equal(M.finished,true,`${scale}x all riders finish`);assert.equal(bell,1,`${scale}x bell once`);
 assert.ok(M.fadeStartRem>105,`${scale}x fade starts too late ${M.fadeStartRem}`);
 assert.equal(M.sawFullFade,true,`${scale}x 7-8-9 full fade missing`);
 assert.ok(M.makuriStartRem<M.fadeStartRem-5,`${scale}x 4 launches before fade is visible`);
 assert.ok(Math.max(...M.makuriStartSpeeds)<=17.0,`${scale}x 7-8-9 not spent before 4 launch ${M.makuriStartSpeeds}`);
 assert.ok(M.blockStartRem<M.makuriStartRem-25,`${scale}x block occurs before 4 has actually advanced`);
 assert.ok(Math.max(...M.blockStartSpeeds)<=13.5,`${scale}x 7-8-9 still racing alongside at block ${M.blockStartSpeeds}`);
 assert.equal(M.sawOvertake,true,`${scale}x dynamic overtake state missing`);
 assert.equal(M.sawDynamicLaneChange,true,`${scale}x 4 did not choose a new route`);
 assert.ok(M.min4vsSpent>4.2,`${scale}x 4 collided with spent 7-8-9 line ${M.min4vsSpent}`);
 assert.ok(M.blockGap<=24.5&&M.blockGap>=-4.5,`${scale}x block not triggered in late proximity window ${M.blockGap}`);
 assert.equal(M.sawBlock,true,`${scale}x 2 block action missing`);assert.equal(M.sawBlockOut,true,`${scale}x 2 did not physically move out`);
 assert.ok(M.blockSlide>=0.80,`${scale}x block still too robotic ${M.blockSlide}`);
 assert.ok(M.reactionStart!=null&&M.diveStart!=null&&M.diveStart-M.reactionStart>=0.18,`${scale}x 5 reaction delay missing`);
 assert.ok(M.minSpatial>3.8,`${scale}x same-slot / billiard collision ${M.minSpatial}`);
 console.log(`PASS ${scale}x fade@${M.fadeStartRem.toFixed(1)} makuri@${M.makuriStartRem.toFixed(1)} block@${M.blockStartRem.toFixed(1)} blockGap=${M.blockGap.toFixed(1)} spent=${M.blockStartSpeeds.map(x=>x.toFixed(1)).join('/')} avoid=${M.min4vsSpent.toFixed(2)} blockSlide=${M.blockSlide.toFixed(2)} finish=${s.ranking.map(x=>x.number).join('-')}`);
}
console.log('CR-0005 FINAL CORNER / DYNAMIC OVERTAKE: all strict checks passed');
