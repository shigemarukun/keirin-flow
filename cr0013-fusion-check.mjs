import { PhysicsEngine } from './engine.js';
import { DEFAULT_RACE_SETUP } from './race-plan.js';

for (const scale of [0.5,1,2,3]) {
  const e=new PhysicsEngine(DEFAULT_RACE_SETUP); e.setSpeedScale(scale); e.start();
  let frames=0, minSame=Infinity, reverse=false;
  const prev=new Map(e.riders.map(r=>[r.number,r.distance]));
  while(e.isStarted && frames<20000){
    e.update(1/60); frames++;
    for(const r of e.riders){ if(r.distance+1e-9<prev.get(r.number)) reverse=true; prev.set(r.number,r.distance); }
    const active=e.riders.filter(r=>!r.finished);
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      if(Math.abs(active[i].laneOffset-active[j].laneOffset)<11){minSame=Math.min(minSame,Math.abs(active[i].distance-active[j].distance));}
    }
  }
  console.log(`${scale}x finished=${!e.isStarted} reverse=${reverse} minSame=${minSame.toFixed(2)} ranking=${e.ranking.map(x=>x.number).join('-')} reassess=${JSON.stringify(e.scenarioPhaseManager.state().reassessment)}`);
  if(reverse || minSame<13.499) process.exitCode=1;
}
