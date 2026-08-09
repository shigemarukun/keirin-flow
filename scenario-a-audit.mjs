import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';
const groups=new AIModel().getInitialLineGroups();
const e=new PhysicsEngine(groups,[-18,-6,6,18],undefined,structuredClone(DEFAULT_RACE_PLAN));
e.start();
const marks=[650,600,500,400,315,250,200,155,100,50,0]; let mi=0; let frames=0; let minPair=999;
while(e.isStarted&&frames<90000){
 e.update(1/60); const s=e.getState();
 for(let i=0;i<s.riders.length;i++)for(let j=i+1;j<s.riders.length;j++){
  const a=s.riders[i],b=s.riders[j]; const metric=Math.hypot((a.distance-b.distance), (a.laneOffset-b.laneOffset)*0.35); minPair=Math.min(minPair,metric);
 }
 if(mi<marks.length&&s.raceClock.remainingDistance<=marks[mi]){
  const order=[...s.riders].sort((a,b)=>b.distance-a.distance).map(r=>`${r.number}[${r.action},L${r.laneOffset.toFixed(0)},E${r.energy.toFixed(2)}]`).join(' ');
  console.log(`R${marks[mi]} ${order}`); mi++;
 }
 frames++;
}
console.log('FINISH',e.getState().ranking.map(x=>x.number).join('-'));
console.log('EVENTS',e.getState().raceEvents.map(x=>`${x.type}:${x.rider??''}->${x.target??''}@${x.remaining.toFixed(0)}`).join(' | '));
console.log('MINPAIR',minPair.toFixed(2));
