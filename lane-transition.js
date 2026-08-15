const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const easeInOutSine=t=>-(Math.cos(Math.PI*clamp(t,0,1))-1)/2;

export class LaneTransition {
  constructor(initialLane=-18){this.current=initialLane;this.start=initialLane;this.target=initialLane;this.elapsed=0;this.duration=0;}
  reset(lane=-18){this.current=this.start=this.target=lane;this.elapsed=0;this.duration=0;}
  setTarget(target,{duration=1.1}={}){
    if(Math.abs(target-this.target)<0.05)return;
    this.start=this.current;this.target=target;this.elapsed=0;this.duration=Math.max(.25,duration);
  }
  update(dt){
    if(Math.abs(this.current-this.target)<0.02){this.current=this.target;return this.current;}
    this.elapsed=Math.min(this.duration,this.elapsed+dt);
    const e=easeInOutSine(this.elapsed/this.duration);
    this.current=this.start+(this.target-this.start)*e;
    if(this.elapsed>=this.duration)this.current=this.target;
    return this.current;
  }
}
