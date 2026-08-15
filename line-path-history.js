const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smoothstep=t=>{const x=clamp(t,0,1);return x*x*(3-2*x);};

/**
 * CR-0015 LinePathHistory
 * Authoritative history is strictly 1D track distance + lane offset.
 * Canvas x/y are derived later by UIRenderer; never written back into physics.
 */
export class LinePathHistory {
  constructor({maxSamples=24000}={}){this.maxSamples=maxSamples;this.lines=new Map();}
  reset(){this.lines.clear();}
  _list(lineId){if(!this.lines.has(lineId))this.lines.set(lineId,[]);return this.lines.get(lineId);}
  seed(lineId,distance,laneOffset,speed=0){
    const list=this._list(lineId);list.length=0;
    // Seed enough tail so followers have a path immediately at START.
    for(let d=distance-12;d<=distance;d+=0.25)list.push({distance:d,laneOffset,speed});
  }
  push(lineId,{distance,laneOffset,speed=0}){
    if(!lineId)return;
    const list=this._list(lineId),last=list[list.length-1];
    if(last&&distance<last.distance-1e-7)throw new Error(`PathHistory reverse movement: ${lineId}`);
    if(last&&Math.abs(distance-last.distance)<0.02){last.laneOffset=laneOffset;last.speed=speed;return;}
    list.push({distance,laneOffset,speed});
    if(list.length>this.maxSamples)list.splice(0,list.length-this.maxSamples);
  }
  sampleAtDistance(lineId,targetDistance){
    const list=this._list(lineId);if(!list.length)return null;
    if(targetDistance<=list[0].distance)return {...list[0]};
    if(targetDistance>=list[list.length-1].distance){const last=list[list.length-1];return {distance:targetDistance,laneOffset:last.laneOffset,speed:last.speed};}
    let lo=0,hi=list.length-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(list[mid].distance<=targetDistance)lo=mid;else hi=mid;}
    const a=list[lo],b=list[hi],span=Math.max(1e-6,b.distance-a.distance);
    const t=smoothstep((targetDistance-a.distance)/span);
    return {distance:targetDistance,laneOffset:a.laneOffset+(b.laneOffset-a.laneOffset)*t,speed:a.speed+(b.speed-a.speed)*t};
  }
  tailTarget(lineId,leaderDistance,linePosition,slotMeters=1.5){
    return this.sampleAtDistance(lineId,leaderDistance-linePosition*slotMeters);
  }
  snapshot(){return Object.fromEntries([...this.lines].map(([id,list])=>[id,list.slice(-120).map(x=>({...x}))]));}
}
