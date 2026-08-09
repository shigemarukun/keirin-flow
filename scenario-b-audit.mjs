import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';
const e=new PhysicsEngine(new AIModel().getInitialLineGroups(),[-18,-6,6,18],undefined,structuredClone(DEFAULT_RACE_PLAN));
e.start();const marks=[650,600,555,500,410,400,350,300,250,205,150,100,85,50,0];let mi=0,frames=0;
while(e.isStarted&&frames++<90000){
 e.update(1/60);const s=e.getState();
 if(mi<marks.length&&s.raceClock.remainingDistance<=marks[mi]){
  console.log(`R${marks[mi]} `+[...s.riders].sort((a,b)=>b.distance-a.distance).map(r=>`${r.number}[${r.action},L${r.laneOffset.toFixed(0)},E${r.energy.toFixed(2)}]`).join(' '));mi++;
 }
}
const s=e.getState();console.log('FINISH',s.ranking.map(x=>x.number).join('-'));
console.log('EVENTS',s.raceEvents.map(x=>`${x.type}:${x.rider??''}->${x.target??''}@${x.remaining.toFixed(0)}`).join(' | '));
