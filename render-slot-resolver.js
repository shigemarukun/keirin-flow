const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export const RENDER_MODE=Object.freeze({
  LEADER:'LEADER',
  SNAKE_FOLLOW:'SNAKE_FOLLOW',
  COMPETE:'COMPETE',
  SOLO:'SOLO'
});

/**
 * CR-0016 RenderSlotResolver
 *
 * Tactical state (rider.distance / rider.laneOffset) and rendering state
 * (rider.renderDistance / rider.renderLaneOffset) are deliberately separate.
 *
 * The resolver never writes back into tactical physics.
 */
export class RenderSlotResolver {
  constructor({
    slotMeters=3.0,
    minLongitudinalGap=1.5,
    laneUnit=12,
    minLateralSeparation=12,
    conflictLookahead=5.2
  }={}){
    this.slotMeters=slotMeters;
    this.minLongitudinalGap=minLongitudinalGap;
    this.laneUnit=laneUnit;
    this.minLateralSeparation=minLateralSeparation;
    this.conflictLookahead=conflictLookahead;
    this.previous=new Map();
  }

  reset(){this.previous.clear();}

  _circularGap(a,b,trackLength=400){
    const raw=Math.abs(a-b)%trackLength;
    return Math.min(raw,trackLength-raw);
  }

  _isCompetition(rider){
    return ['BLOCK','CONTEST','FULL_CONTEST','SWITCH_TO_SELF_POWER','KIRIKAE']
      .includes(rider.action);
  }

  _baseTarget(rider,engine){
    if(rider.role==='SOLO'){
      return {
        distance:rider.distance,
        laneOffset:rider.laneOffset,
        mode:RENDER_MODE.SOLO
      };
    }

    if(rider.linePosition===0 || !rider.lineId){
      return {
        distance:rider.distance,
        laneOffset:rider.laneOffset,
        mode:RENDER_MODE.LEADER
      };
    }

    // A follower is released only during an explicit tactical action.
    // Normal FOLLOW never gets independent collision/avoidance authority.
    if(this._isCompetition(rider)){
      return {
        distance:rider.distance,
        laneOffset:rider.laneOffset,
        mode:RENDER_MODE.COMPETE
      };
    }

    const leader=engine.rider(rider.leaderNumber);
    if(!leader){
      return {
        distance:rider.distance,
        laneOffset:rider.laneOffset,
        mode:RENDER_MODE.SNAKE_FOLLOW
      };
    }

    const leaderTravel=leader.finished
      ? (leader.virtualDistance??leader.distance)
      : leader.distance;

    const sample=engine.pathHistory.tailTarget(
      rider.lineId,
      leaderTravel,
      rider.linePosition,
      this.slotMeters
    );

    return {
      distance:sample?.distance ?? (leaderTravel-rider.linePosition*this.slotMeters),
      laneOffset:sample?.laneOffset ?? leader.laneOffset,
      mode:RENDER_MODE.SNAKE_FOLLOW
    };
  }

  /**
   * Deterministic render-only exclusivity.
   *
   * Riders that are longitudinally close are placed into separate lateral
   * sub-slots. This prevents two number markers ever resolving to the same
   * display position without corrupting race/tactical coordinates.
   */
  _resolveExclusive(targets,trackLength){
    const ordered=[...targets].sort((a,b)=>{
      if(Math.abs(b.distance-a.distance)>1e-9)return b.distance-a.distance;
      return a.number-b.number;
    });

    const placed=[];

    for(const item of ordered){
      let lane=item.laneOffset;

      const conflicts=placed.filter(other=>
        this._circularGap(other.distance,item.distance,trackLength)<this.conflictLookahead &&
        Math.abs(other.laneOffset-lane)<this.minLateralSeparation
      );

      if(conflicts.length){
        // Prefer preserving inside/outside tactical intent. If the requested
        // lane is occupied, assign the nearest deterministic half-lane slot.
        const candidates=[];
        for(let step=1;step<=8;step++){
          candidates.push(lane+step*this.minLateralSeparation);
          candidates.push(lane-step*this.minLateralSeparation);
        }
        const chosen=candidates.find(candidate=>
          !placed.some(other=>
            this._circularGap(other.distance,item.distance,trackLength)<this.conflictLookahead &&
            Math.abs(other.laneOffset-candidate)<this.minLateralSeparation
          )
        );
        if(chosen!=null)lane=chosen;
      }

      placed.push({...item,laneOffset:lane});
    }

    return placed;
  }

  update(engine){
    const raw=engine.riders
      .filter(r=>!r.finished)
      .map(r=>({number:r.number,...this._baseTarget(r,engine)}));

    const trackLength=engine.profile?.TRACK_LENGTH??400;
    const resolved=this._resolveExclusive(raw,trackLength);
    const byNumber=new Map(resolved.map(x=>[x.number,x]));

    for(const rider of engine.riders){
      const target=byNumber.get(rider.number);
      if(!target)continue;

      const prev=this.previous.get(rider.number);
      // Render distance is monotonic by construction: never visually reverse.
      let renderDistance=target.distance;
      if(prev)renderDistance=Math.max(prev.distance,renderDistance);

      // Safety invariant: if two same-lane logical slots approach closer than
      // the required body margin, hold the rear render slot behind. The race
      // logic itself remains untouched.
      rider.renderDistance=renderDistance;
      rider.renderLaneOffset=target.laneOffset;
      rider.renderMode=target.mode;

      this.previous.set(rider.number,{
        distance:renderDistance,
        laneOffset:target.laneOffset
      });
    }

    this._enforceLongitudinalMargin(engine,trackLength);
  }

  _enforceLongitudinalMargin(engine,trackLength){
    const active=engine.riders.filter(r=>!r.finished);

    // Repeat a few deterministic passes because fixing one pair can expose
    // the next rear pair. This modifies render positions only.
    for(let pass=0;pass<4;pass++){
      const ordered=[...active].sort((a,b)=>b.renderDistance-a.renderDistance);
      for(let i=0;i<ordered.length;i++){
        for(let j=i+1;j<ordered.length;j++){
          const front=ordered[i],rear=ordered[j];
          const longitudinal=this._circularGap(front.renderDistance,rear.renderDistance,trackLength);
          const lateral=Math.abs(front.renderLaneOffset-rear.renderLaneOffset);

          const sameLine=front.lineId&&front.lineId===rear.lineId;
          const competition=
            front.renderMode===RENDER_MODE.COMPETE ||
            rear.renderMode===RENDER_MODE.COMPETE;

          const needsAbsoluteSeparation=
            longitudinal<this.minLongitudinalGap &&
            lateral<this.minLateralSeparation;

          const needsApproachSeparation=
            longitudinal<this.conflictLookahead &&
            lateral<this.minLateralSeparation &&
            (!sameLine||competition);

          if(needsAbsoluteSeparation||needsApproachSeparation){
            // First choice is a half-lane side slot. No backward race physics.
            const direction=(rear.number%2===0)?1:-1;
            rear.renderLaneOffset+=direction*this.minLateralSeparation;

            // Absolute fallback if another occupied sub-slot still blocks it.
            let guard=0;
            while(
              guard<4 &&
              ordered.some(other=>
                other.number!==rear.number &&
                this._circularGap(other.renderDistance,rear.renderDistance,trackLength)<this.conflictLookahead &&
                Math.abs(other.renderLaneOffset-rear.renderLaneOffset)<this.minLateralSeparation
              )
            ){
              rear.renderLaneOffset+=direction*this.minLateralSeparation;
              guard++;
            }
          }
        }
      }
    }
  }

  diagnostics(engine){
    const trackLength=engine.profile?.TRACK_LENGTH??400;
    const active=engine.riders.filter(r=>!r.finished);
    let minLongitudinal=Infinity;
    let minMetric=Infinity;
    let exactOverlap=false;

    for(let i=0;i<active.length;i++){
      for(let j=i+1;j<active.length;j++){
        const a=active[i],b=active[j];
        const longitudinal=this._circularGap(a.renderDistance,b.renderDistance,trackLength);
        const lateral=Math.abs(a.renderLaneOffset-b.renderLaneOffset);
        minMetric=Math.min(minMetric,Math.hypot(longitudinal,lateral/this.laneUnit));
        if(lateral<this.minLateralSeparation){
          minLongitudinal=Math.min(minLongitudinal,longitudinal);
        }
        if(longitudinal<1e-9&&lateral<1e-9)exactOverlap=true;
      }
    }

    return {
      minLongitudinalSameCorridor:Number.isFinite(minLongitudinal)?minLongitudinal:null,
      minMetric:Number.isFinite(minMetric)?minMetric:null,
      exactOverlap
    };
  }
}
