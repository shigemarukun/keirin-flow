export const TACTICAL_MODE = Object.freeze({
  FOLLOW:'FOLLOW', ATTACK:'ATTACK', CONTEST:'CONTEST', RETREAT:'RETREAT',
  DEFEND:'DEFEND', BLOCK:'BLOCK', SWITCH:'SWITCH', SELF_POWER:'SELF_POWER',
  RECOVER:'RECOVER', FINAL_SPRINT:'FINAL_SPRINT', OVERTAKE:'OVERTAKE'
});

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export class TacticalAI {
  constructor(){ this.reset(); }
  reset(){ this.memory=new Map(); }

  mem(rider){
    if(!this.memory.has(rider.number)){
      this.memory.set(rider.number,{
        perceivedFrontSpeed:null,
        accordionPhase:rider.number*0.83,
        lastFrontAction:'',
        lastOvertakeLane:null,
        overtakeHoldUntil:0
      });
    }
    return this.memory.get(rider.number);
  }

  sense(rider, engine){
    const others=engine.riders.filter(x=>x!==rider&&!x.finished);
    const ahead=others.filter(x=>x.distance>=rider.distance).sort((a,b)=>(a.distance-rider.distance)-(b.distance-rider.distance));
    const behind=others.filter(x=>x.distance<rider.distance).sort((a,b)=>(rider.distance-b.distance)-(rider.distance-a.distance));
    const sameLine=engine.riders.filter(x=>x.lineId===rider.lineId&&!x.finished).sort((a,b)=>a.lineOrder-b.lineOrder);
    const lineLeader=sameLine[0]??rider;
    const lineFront=rider.lineOrder>0?sameLine.find(x=>x.lineOrder===rider.lineOrder-1)??null:null;
    const nearestAhead=ahead[0]??null;
    const nearestBehind=behind[0]??null;
    const corridorAhead=ahead
      .filter(x=>x.distance-rider.distance<=34 && Math.abs(x.laneOffset-rider.laneOffset)<=12)
      .sort((a,b)=>(a.distance-rider.distance)-(b.distance-rider.distance));
    const slowObstacle=corridorAhead.find(x=>(rider.speed-x.speed)>=2.0)??null;
    const lateralThreat=others
      .filter(x=>Math.abs(x.distance-rider.distance)<=7 && Math.abs(x.laneOffset-rider.laneOffset)<=22)
      .sort((a,b)=>Math.abs(a.distance-rider.distance)-Math.abs(b.distance-rider.distance))[0]??null;
    return {
      remaining:engine.raceClock.remainingDistance,
      pacerState:engine.pacer.state,
      lineLeader,lineFront,nearestAhead,nearestBehind,lateralThreat,corridorAhead,slowObstacle,
      gapToFront:lineFront?lineFront.distance-rider.distance:Infinity,
      speedDeltaToFront:lineFront?lineFront.speed-rider.speed:0,
      lineCohesion:sameLine.length<2?1:Math.min(...sameLine.slice(1).map((x,i)=>{
        const f=sameLine[i]; const g=f.distance-x.distance; return clamp(1-Math.abs(g-9.8)/18,0,1);
      })),
      energy:rider.energy,
      phase:engine.scenario.phase
    };
  }

  laneDensity(rider,engine,lane,lookahead=30){
    let score=0;
    for(const other of engine.riders){
      if(other===rider||other.finished)continue;
      const longitudinal=other.distance-rider.distance;
      if(longitudinal<-7||longitudinal>lookahead)continue;
      const lateral=Math.abs(other.laneOffset-lane);
      const lateralWeight=Math.max(0,1-lateral/15);
      if(lateralWeight<=0)continue;
      const forwardWeight=longitudinal>=0?1.2+Math.max(0,lookahead-longitudinal)/lookahead:0.65;
      const speedPenalty=longitudinal>=0&&other.speed<rider.speed-1.5?1.4:0.35;
      const overlapPenalty=Math.abs(longitudinal)<6&&lateral<9?5.5:0;
      score += lateralWeight*(forwardWeight+speedPenalty)+overlapPenalty;
    }
    return score;
  }

  chooseOvertakeLane(rider,engine,{preferOutside=true}={}){
    const p=rider.plan??{};
    const minLane=p.laneSearchMin??-12;
    const maxLane=p.laneSearchMax??46;
    const step=p.laneSearchStep??6;
    const lookahead=p.overtakeLookahead??30;
    const mem=this.mem(rider);
    const candidates=[];
    for(let lane=minLane;lane<=maxLane+1e-9;lane+=step)candidates.push(lane);
    if(!candidates.some(x=>Math.abs(x-rider.laneOffset)<1)) candidates.push(rider.laneOffset);

    let best={lane:rider.laneOffset,score:Infinity,density:Infinity};
    for(const lane of candidates){
      const density=this.laneDensity(rider,engine,lane,lookahead);
      const laneChangePenalty=Math.abs(lane-rider.laneOffset)*0.028;
      // A makuri normally wants to keep momentum outside, but this is only a weak
      // preference. A genuinely open inner/middle course will beat a crowded outside.
      const directionBias=preferOutside&&lane>rider.laneOffset?-0.22*(lane-rider.laneOffset)/12:0;
      const edgePenalty=(lane<=minLane+1||lane>=maxLane-1)?0.18:0;
      const score=density+laneChangePenalty+directionBias+edgePenalty;
      if(score<best.score)best={lane,score,density};
    }

    // Hysteresis prevents left-right flicker while threading a fading line.
    const now=engine.elapsedTime??0;
    if(mem.lastOvertakeLane!=null && now<mem.overtakeHoldUntil){
      const oldDensity=this.laneDensity(rider,engine,mem.lastOvertakeLane,lookahead);
      if(oldDensity<=best.density+0.9)return {lane:mem.lastOvertakeLane,density:oldDensity};
    }
    mem.lastOvertakeLane=best.lane;
    mem.overtakeHoldUntil=now+0.34;
    return best;
  }

  followerCommand(rider, sensor, leaderCommand, idealGap=9.8, engine=null){
    const front=sensor.lineFront;
    if(!front) return {...leaderCommand};
    const mem=this.mem(rider);
    const retreatIntent=front.action.includes('RETREAT')||front.action.includes('FADE');
    const attackIntent=front.action.includes('MOVE_UP')||front.action.includes('ATTACK')||front.action.includes('CONTEST')||front.action.includes('OVERTAKE');

    const dt=engine?.lastSubstepDt??(1/120);
    const tau=retreatIntent?0.055:attackIntent?0.10:0.26;
    const alpha=1-Math.exp(-dt/Math.max(0.02,tau));
    if(mem.perceivedFrontSpeed==null) mem.perceivedFrontSpeed=front.speed;
    mem.perceivedFrontSpeed += (front.speed-mem.perceivedFrontSpeed)*alpha;

    const t=engine?.elapsedTime??0;
    const breathing=0.55*Math.sin(t*2.0+mem.accordionPhase);
    const accelerationStretch=clamp((front.acceleration??0)*0.32,0,1.45);
    const tacticalStretch=attackIntent?0.55:0;
    const liveIdealGap=idealGap+breathing+accelerationStretch+tacticalStretch;

    const gap=front.distance-rider.distance;
    const gapError=gap-liveIdealGap;
    const rel=mem.perceivedFrontSpeed-rider.speed;
    let speed=mem.perceivedFrontSpeed + gapError*(attackIntent?0.40:0.22) + rel*(attackIntent?0.62:0.38);

    if(retreatIntent){
      // Intent feed-forward: the follower rolls off immediately when the front rider
      // declares fade/retreat; it does not wait for the wheel gap to disappear.
      speed=Math.min(speed,front.speed-0.45);
      speed=clamp(speed,Math.max(0,front.speed-2.0),front.speed+0.2);
    }else if(attackIntent){
      speed=clamp(speed,Math.max(0,front.speed-1.4),front.speed+5.8);
    }else{
      speed=clamp(speed,Math.max(0,front.speed-2.2),front.speed+3.6);
    }

    let lane=front.laneOffset;
    // When a spent line deliberately drifts outside, keep the three riders slightly
    // staggered outward instead of stacking them onto one radial coordinate.
    if(retreatIntent && rider.plan?.collapseWithLeader){
      lane=rider.plan.fadeLane??clamp(front.laneOffset+2,-18,46);
    }

    let mode=TACTICAL_MODE.FOLLOW;
    if(front.action.includes('MOVE_UP')||front.action.includes('ATTACK')||front.action.includes('OVERTAKE')) mode=TACTICAL_MODE.ATTACK;
    else if(front.action.includes('CONTEST')) mode=TACTICAL_MODE.CONTEST;
    else if(retreatIntent) mode=TACTICAL_MODE.RETREAT;
    mem.lastFrontAction=front.action;
    return {mode,action:`${mode}_FOLLOW`,speed,lane,followTargetNumber:front.number,idealGap:liveIdealGap};
  }

  finalSprintSpeed(rider){
    const p=rider.plan??{};
    const e=clamp(rider.energy??0,0,1);
    const base=p.topSpeed??21;
    if(e<0.18)return base*(0.78+e*1.05);
    return base+1.8+(e*4.2);
  }

  leaderIsSpent(rider,engine){
    const p=rider.plan??{};
    const rem=engine.raceClock.remainingDistance;
    const energyGate=p.finalFadeEnergy??0.30;
    const distanceGate=p.finalFadeRemaining??55;
    return rem<=distanceGate && (rider.energy??1)<=energyGate;
  }

  leaderFadeSpeed(rider){
    const p=rider.plan??{};
    const e=clamp(rider.energy??0,0,1);
    // A spent leader still pedals; the fade is progressive rather than a brake-to-zero.
    return Math.max(12.8,(p.finalFadeSpeed??15.0)+(e-0.20)*2.2);
  }

  decide(rider, engine){
    const s=this.sense(rider,engine), ph=s.phase, p=rider.plan??{};
    const phase=(...xs)=>xs.includes(ph);

    if(rider.isLeader){
      if(rider.number===1){
        const seven=engine.rider(7); const pressure=seven?Math.max(0,20-(rider.distance-seven.distance)):0;
        if(phase('FIRST_CONTEST','SECOND_CONTEST')) return {mode:TACTICAL_MODE.DEFEND,action:'DEFEND',speed:phase('FIRST_CONTEST')?p.defend1:p.defend2,lane:-18,followTargetNumber:null};

        // CR-0006: the long tsuppari is not free. Once the leader reaches the
        // final corner with depleted energy, he goes "ippai" and progressively
        // loses speed. This gives the bante and the incoming makuri a real chance
        // to pass instead of preserving an immortal 20 m/s leader to the line.
        if(phase('BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE','FINAL') && this.leaderIsSpent(rider,engine)){
          return {mode:TACTICAL_MODE.RECOVER,action:'LEAD_FADE',speed:this.leaderFadeSpeed(rider),lane:-18,followTargetNumber:null};
        }

        const leadSpeed=phase('FIRST_RETREAT')?21.4:phase('RESET_LINEUP')?15.8:phase('SECOND_MOVE')?12.6:phase('LINE7_FADE','LINE4_MAKURI','BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE')?p.final:phase('FINAL')?this.finalSprintSpeed(rider):10.5+Math.min(.3,pressure*.01);
        return {mode:TACTICAL_MODE.FOLLOW,action:'LEAD',speed:leadSpeed,lane:-18,followTargetNumber:null};
      }

      if(rider.number===7){
        if(phase('FIRST_MOVE')) return {mode:TACTICAL_MODE.ATTACK,action:'MOVE_UP',speed:p.attack1,lane:36,followTargetNumber:null};
        if(phase('FIRST_CONTEST')) return {mode:TACTICAL_MODE.CONTEST,action:'CONTEST',speed:p.contest1,lane:36,followTargetNumber:null};
        if(phase('FIRST_RETREAT')) return {mode:TACTICAL_MODE.RETREAT,action:'RETREAT',speed:p.retreat,lane:34,followTargetNumber:null};
        if(phase('RESET_LINEUP')) return {mode:TACTICAL_MODE.RECOVER,action:'RECOVER_LINE',speed:p.resetSpeed??15.0,lane:-18,followTargetNumber:null};
        if(phase('SECOND_MOVE')) return {mode:TACTICAL_MODE.ATTACK,action:'ATTACK',speed:p.attack2,lane:38,followTargetNumber:null};
        if(phase('SECOND_CONTEST')) return {mode:TACTICAL_MODE.CONTEST,action:'CONTEST',speed:Math.max(p.contest2,24.0),lane:38,followTargetNumber:null};
        if(phase('LINE7_FADE','LINE4_MAKURI','BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE')) return {mode:TACTICAL_MODE.RECOVER,action:'FADE',speed:p.fade,lane:p.fadeLane??42,followTargetNumber:null};
        if(phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:p.fadeLane??42,followTargetNumber:null};
        return {mode:TACTICAL_MODE.FOLLOW,action:'FORMATION',speed:10.5,lane:30,followTargetNumber:null};
      }

      if(rider.number===4){
        if(phase('LINE4_MAKURI','BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE','FINAL')){
          const blocker=engine.rider(2);
          const liveBlock=blocker && blocker.laneOffset>4 && Math.abs(blocker.distance-rider.distance)<14;
          const completedBlock=engine.scenario.flags.blockContactCompleted && phase('FIVE_REACTION','FIVE_DIVE');
          const blockActive=liveBlock||completedBlock;
          if(blockActive){
            return {mode:TACTICAL_MODE.RECOVER,action:'BLOCKED',speed:p.blocked,lane:rider.laneOffset,followTargetNumber:null};
          }
          if(phase('FINAL')){
            // The block checks 4's momentum but does not delete his legs.
            // If energy remains, he re-accelerates into the straight.
            const kick=Math.max(p.postBlockKick??0,this.finalSprintSpeed(rider)*(p.blockRecoveryFactor??0.88));
            return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:kick,lane:rider.laneOffset,followTargetNumber:null};
          }

          const threshold=p.overtakeSpeedDelta??2.2;
          const slow=s.slowObstacle && (rider.speed-s.slowObstacle.speed)>=threshold;
          const route=this.chooseOvertakeLane(rider,engine,{preferOutside:true});
          return {
            mode:slow?TACTICAL_MODE.OVERTAKE:TACTICAL_MODE.ATTACK,
            action:slow?'OVERTAKE':'ATTACK',
            speed:p.makuri,
            lane:route.lane,
            followTargetNumber:null,
            avoidNumber:slow?s.slowObstacle.number:null,
            laneDensity:route.density
          };
        }
        const three=engine.rider(3);
        if(three&&!three.finished){
          const idealGap=17,gap=three.distance-rider.distance,gapError=gap-idealGap,relative=three.speed-rider.speed;
          const speed=clamp(three.speed+gapError*0.25+relative*0.38,Math.max(0,three.speed-2.0),three.speed+4.2);
          return {mode:TACTICAL_MODE.FOLLOW,action:'FOLLOW',speed,lane:three.laneOffset,followTargetNumber:3,idealGap};
        }
      }
    }

    if(rider.number===2){
      const four=engine.rider(4);
      const one=engine.rider(1);
      // Entering BANTE_BLOCK already means 4 crossed the real proximity gate in the
      // scenario controller. Once 2 commits to the block, he carries the move through.
      if(phase('BANTE_BLOCK')&&four) return {mode:TACTICAL_MODE.BLOCK,action:'BLOCK',speed:Math.max(one?.speed??0,19.4),lane:p.blockTargetLane??28,followTargetNumber:1};

      // Once the long-leading 1 goes ippai, the bante must not remain chained to
      // his rear wheel. 2 releases into self power and becomes part of the finish.
      const leaderSpent=one && ((one.action==='LEAD_FADE') || ((one.energy??1)<=(p.leaderReleaseEnergy??0.38) && engine.raceClock.remainingDistance<=58));
      if(phase('FIVE_REACTION','FIVE_DIVE','FINAL')&&leaderSpent){
        const kick=phase('FINAL')?Math.max(p.finalKick??0,this.finalSprintSpeed(rider)):(p.finalKick??24.2);
        return {mode:TACTICAL_MODE.SELF_POWER,action:'SWITCH_TO_SELF_POWER',speed:kick,lane:Math.min(rider.laneOffset,6),followTargetNumber:null};
      }
      if(phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:rider.laneOffset,followTargetNumber:null};
    }

    if(rider.number===3&&phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:rider.laneOffset,followTargetNumber:null};

    if(rider.number===5){
      if(phase('FIVE_REACTION')) return {mode:TACTICAL_MODE.FOLLOW,action:'DIVE_FEINT',speed:Math.min(p.dive,(engine.rider(4)?.speed??p.dive)+0.8),lane:p.diveFeintLane??18,followTargetNumber:4};
      if(phase('FIVE_DIVE')) return {mode:TACTICAL_MODE.SELF_POWER,action:'DIVE',speed:p.dive,lane:-2,followTargetNumber:null};
      if(phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:-2,followTargetNumber:null};
    }

    if(rider.number===6&&phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:10,followTargetNumber:null};

    // A line that has genuinely gone "ippai" does not magically re-form and attack
    // again in the same corner. 8/9 read 7's collapse and fade with him to the outer
    // side; only the final straight gives them a small independent kick if any energy remains.
    if([8,9].includes(rider.number) && rider.plan?.collapseWithLeader && phase('LINE7_FADE','LINE4_MAKURI','BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE')){
      const front=s.lineFront;
      if(front){
        const cmd=this.followerCommand(rider,s,{mode:TACTICAL_MODE.RETREAT,action:'FADE_FOLLOW',speed:front.speed,lane:rider.plan.fadeLane,followTargetNumber:front.number},17,engine);
        cmd.mode=TACTICAL_MODE.RETREAT; cmd.action='FADE_FOLLOW'; cmd.lane=rider.plan.fadeLane??cmd.lane;
        return cmd;
      }
    }
    if([8,9].includes(rider.number)&&phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:rider.plan.fadeLane??rider.laneOffset,followTargetNumber:null};

    const front=s.lineFront;
    if(front){
      const leaderCommand={mode:TACTICAL_MODE.FOLLOW,action:'FOLLOW',speed:front.speed,lane:front.laneOffset,followTargetNumber:front.number};
      const cmd=this.followerCommand(rider,s,leaderCommand,17,engine);
      if(rider.number===4&&!phase('LINE4_MAKURI','BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE','FINAL')) cmd.followTargetNumber=3;
      return cmd;
    }
    return {mode:TACTICAL_MODE.FOLLOW,action:'FORMATION',speed:10.5,lane:rider.laneOffset,followTargetNumber:null};
  }
}
