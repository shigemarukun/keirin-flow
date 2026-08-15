import { PhysicsEngine } from './engine.js';
import { DEFAULT_RACE_SETUP } from './race-plan.js';

const scales=[0.5,1,2,3];
const expected='4-5-2-6-1-3-7-8-9';
const results=[];
for(const scale of scales){
  const e=new PhysicsEngine(DEFAULT_RACE_SETUP); e.setSpeedScale(scale); e.start();
  let frames=0, minCorridor=Infinity, reverse=false, overlap=false;
  const prev=new Map(e.riders.map(r=>[r.number,r.distance]));
  while(e.isStarted && frames<30000){
    e.update(1/60); frames++;
    for(const r of e.riders){
      if(r.distance+1e-9<prev.get(r.number)) reverse=true;
      prev.set(r.number,r.distance);
      if(r.speed < -1e-9) reverse=true;
    }
    const active=e.riders.filter(r=>!r.finished);
    for(let i=0;i<active.length;i++) for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j];
      const lateral=Math.abs(a.laneOffset-b.laneOffset);
      const longitudinal=Math.abs(a.distance-b.distance);
      if(lateral<9) minCorridor=Math.min(minCorridor,longitudinal);
      if(lateral<0.01 && longitudinal<0.01) overlap=true;
    }
  }
  const ranking=e.ranking.map(x=>x.number).join('-');
  const pass=!e.isStarted&&!reverse&&!overlap&&minCorridor>=13.499&&ranking===expected;
  results.push({scale,frames,ranking,minCorridor,reverse,overlap,pass});
}
for(const r of results) console.log(`${r.scale}x pass=${r.pass} ranking=${r.ranking} minCorridor=${r.minCorridor.toFixed(3)} reverse=${r.reverse} overlap=${r.overlap}`);
if(results.some(r=>!r.pass)) process.exit(1);
