export const TACTICAL_MODE = Object.freeze({
  FOLLOW:'FOLLOW', ATTACK:'ATTACK', CONTEST:'CONTEST', RETREAT:'RETREAT',
  DEFEND:'DEFEND', BLOCK:'BLOCK', SWITCH:'SWITCH', SELF_POWER:'SELF_POWER',
  RECOVER:'RECOVER', FINAL_SPRINT:'FINAL_SPRINT'
});

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export class TacticalAI {
  constructor(){ this.reset(); }
  reset(){ this.memory=new Map(); }

  mem(rider){
    if(!this.memory.has(rider.number)){
      this.memory.set(rider.number,{
        perceivedFrontSpeed:null,
        followLag:0,
        accordionPhase:rider.number*0.83,
        lastFrontAction:'',
        blockSeenAt:null
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
    const lateralThreat=others
      .filter(x=>Math.abs(x.distance-rider.distance)<=7 && Math.abs(x.laneOffset-rider.laneOffset)<=22)
      .sort((a,b)=>Math.abs(a.distance-rider.distance)-Math.abs(b.distance-rider.distance))[0]??null;
    return {
      remaining:engine.raceClock.remainingDistance,
      pacerState:engine.pacer.state,
      lineLeader,lineFront,nearestAhead,nearestBehind,lateralThreat,
      gapToFront:lineFront?lineFront.distance-rider.distance:Infinity,
      speedDeltaToFront:lineFront?lineFront.speed-rider.speed:0,
      lineCohesion:sameLine.length<2?1:Math.min(...sameLine.slice(1).map((x,i)=>{
        const f=sameLine[i]; const g=f.distance-x.distance; return clamp(1-Math.abs(g-9.8)/18,0,1);
      })),
      energy:rider.energy,
      phase:engine.scenario.phase
    };
  }

  followerCommand(rider, sensor, leaderCommand, idealGap=9.8, engine=null){
    const front=sensor.lineFront;
    if(!front) return {...leaderCommand};
    const mem=this.mem(rider);
    const retreatIntent=front.action.includes('RETREAT')||front.action.includes('FADE');
    const attackIntent=front.action.includes('MOVE_UP')||front.action.includes('ATTACK')||front.action.includes('CONTEST');

    // Human-like perception: normal following has a short lag. A clear retreat/fade
    // signal is recognised much faster, so the follower rolls off before the gap
    // physically collapses (predictive braking / no accordion pile-up).
    const dt=engine?.lastSubstepDt??(1/120);
    const tau=retreatIntent?0.07:attackIntent?0.10:0.26;
    const alpha=1-Math.exp(-dt/Math.max(0.02,tau));
    if(mem.perceivedFrontSpeed==null) mem.perceivedFrontSpeed=front.speed;
    mem.perceivedFrontSpeed += (front.speed-mem.perceivedFrontSpeed)*alpha;

    // Accordion effect: target gap breathes slightly and stretches when the front
    // accelerates. Deterministic oscillation keeps all playback speeds reproducible.
    const t=engine?.elapsedTime??0;
    const breathing=0.55*Math.sin(t*2.0+mem.accordionPhase);
    const accelerationStretch=clamp((front.acceleration??0)*0.32,0,1.45);
    const tacticalStretch=attackIntent?0.55:0;
    const liveIdealGap=idealGap+breathing+accelerationStretch+tacticalStretch;

    const gap=front.distance-rider.distance;
    const gapError=gap-liveIdealGap;
    const rel=mem.perceivedFrontSpeed-rider.speed;

    // Softer PD than the previous 'perfect rope' controller. This intentionally lets
    // a small gap open before the follower closes it again.
    let speed=mem.perceivedFrontSpeed + gapError*(attackIntent?0.40:0.22) + rel*(attackIntent?0.62:0.38);

    if(retreatIntent){
      // Feed-forward deceleration: react to intent, not only to a shrinking gap.
      speed=Math.min(speed, front.speed-0.35);
      speed=clamp(speed,Math.max(0,front.speed-2.4),front.speed+0.4);
    }else if(attackIntent){
      // During a coordinated line launch the followers read the leader's intent
      // quickly enough to prevent the leader from becoming a lone attacker.
      speed=clamp(speed,Math.max(0,front.speed-1.4),front.speed+5.8);
    }else{
      speed=clamp(speed,Math.max(0,front.speed-2.2),front.speed+3.6);
    }

    const lane=front.laneOffset;
    let mode=TACTICAL_MODE.FOLLOW;
    if(front.action.includes('MOVE_UP')||front.action.includes('ATTACK')) mode=TACTICAL_MODE.ATTACK;
    else if(front.action.includes('CONTEST')) mode=TACTICAL_MODE.CONTEST;
    else if(retreatIntent) mode=TACTICAL_MODE.RETREAT;
    mem.lastFrontAction=front.action;
    return {mode,action:`${mode}_FOLLOW`,speed,lane,followTargetNumber:front.number,idealGap:liveIdealGap};
  }

  finalSprintSpeed(rider){
    const p=rider.plan??{};
    const e=clamp(rider.energy??0,0,1);
    // The normal tactical top-speed limiter is intentionally exceeded in the final
    // straight. Riders with reserve can kick violently; empty riders gain little.
    const base=p.topSpeed??21;
    if(e<0.18)return base*(0.78+e*1.05);
    return base+1.8+(e*4.2);
  }

  decide(rider, engine){
    const s=this.sense(rider,engine), ph=s.phase, p=rider.plan??{};
    const phase=(...xs)=>xs.includes(ph);

    if(rider.isLeader){
      if(rider.number===1){
        const seven=engine.rider(7); const pressure=seven?Math.max(0,20-(rider.distance-seven.distance)):0;
        if(phase('FIRST_CONTEST','SECOND_CONTEST')) return {mode:TACTICAL_MODE.DEFEND,action:'DEFEND',speed:phase('FIRST_CONTEST')?p.defend1:p.defend2,lane:-18,followTargetNumber:null};
        const leadSpeed=phase('FIRST_RETREAT')?21.4:phase('RESET_LINEUP')?15.8:phase('SECOND_MOVE')?12.6:phase('LINE7_FADE','LINE4_MAKURI','BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE')?p.final:phase('FINAL')?this.finalSprintSpeed(rider):10.5+Math.min(.3,pressure*.01);
        return {mode:TACTICAL_MODE.FOLLOW,action:'LEAD',speed:leadSpeed,lane:-18,followTargetNumber:null};
      }
      if(rider.number===7){
        if(phase('FIRST_MOVE')) return {mode:TACTICAL_MODE.ATTACK,action:'MOVE_UP',speed:p.attack1,lane:36,followTargetNumber:null};
        if(phase('FIRST_CONTEST')) return {mode:TACTICAL_MODE.CONTEST,action:'CONTEST',speed:p.contest1,lane:36,followTargetNumber:null};
        if(phase('FIRST_RETREAT','RESET_LINEUP')) return {mode:TACTICAL_MODE.RETREAT,action:'RETREAT',speed:p.retreat,lane:ph==='RESET_LINEUP'?-18:34,followTargetNumber:null};
        if(phase('SECOND_MOVE')) return {mode:TACTICAL_MODE.ATTACK,action:'ATTACK',speed:p.attack2,lane:38,followTargetNumber:null};
        if(phase('SECOND_CONTEST')) return {mode:TACTICAL_MODE.CONTEST,action:'CONTEST',speed:Math.max(p.contest2,24.4),lane:38,followTargetNumber:null};
        if(phase('LINE7_FADE','LINE4_MAKURI','BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE')) return {mode:TACTICAL_MODE.RECOVER,action:'FADE',speed:p.fade,lane:38,followTargetNumber:null};
        if(phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:-8,followTargetNumber:null};
        return {mode:TACTICAL_MODE.FOLLOW,action:'FORMATION',speed:10.5,lane:30,followTargetNumber:null};
      }
      if(rider.number===4){
        if(phase('LINE4_MAKURI','BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE','FINAL')){
          const blocker=engine.rider(2);
          const liveBlock=blocker && blocker.laneOffset>4 && Math.abs(blocker.distance-rider.distance)<14;
          const completedBlock=engine.scenario.flags.blockContactCompleted && phase('FIVE_REACTION','FIVE_DIVE','FINAL');
          const blockActive=liveBlock||completedBlock;
          return {mode:blockActive?TACTICAL_MODE.RECOVER:phase('FINAL')?TACTICAL_MODE.FINAL_SPRINT:TACTICAL_MODE.ATTACK,action:blockActive?'BLOCKED':phase('FINAL')?'FINAL_SPRINT':'ATTACK',speed:blockActive?p.blocked:phase('FINAL')?this.finalSprintSpeed(rider):p.makuri,lane:blockActive?42:36,followTargetNumber:null};
        }
        const three=engine.rider(3);
        if(three&&!three.finished){
          const idealGap=17;
          const gap=three.distance-rider.distance;
          const gapError=gap-idealGap;
          const relative=three.speed-rider.speed;
          const speed=clamp(three.speed+gapError*0.25+relative*0.38,Math.max(0,three.speed-2.0),three.speed+4.2);
          return {mode:TACTICAL_MODE.FOLLOW,action:'FOLLOW',speed,lane:three.laneOffset,followTargetNumber:3,idealGap};
        }
      }
    }

    if(rider.number===2){
      const four=engine.rider(4); const threat=four && four.distance>rider.distance-39 && four.distance<rider.distance+8 && four.laneOffset>8;
      if(phase('BANTE_BLOCK')&&threat) return {mode:TACTICAL_MODE.BLOCK,action:'BLOCK',speed:Math.max(engine.rider(1)?.speed??0,19.4),lane:p.blockTargetLane??28,followTargetNumber:1};
      if(phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:rider.laneOffset,followTargetNumber:null};
    }

    if(rider.number===3&&phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:rider.laneOffset,followTargetNumber:null};

    if(rider.number===5){
      if(phase('FIVE_REACTION')){
        // The rider first reads the bante moving outward and makes a small outward
        // preparation before committing inside. This removes the 'clairvoyant' cut-in.
        return {mode:TACTICAL_MODE.FOLLOW,action:'DIVE_FEINT',speed:Math.min(p.dive,engine.rider(4)?.speed+0.8??p.dive),lane:p.diveFeintLane??18,followTargetNumber:4};
      }
      if(phase('FIVE_DIVE')) return {mode:TACTICAL_MODE.SELF_POWER,action:'DIVE',speed:p.dive,lane:-2,followTargetNumber:null};
      if(phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:-2,followTargetNumber:null};
    }

    if(rider.number===6&&phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:this.finalSprintSpeed(rider),lane:10,followTargetNumber:null};
    if([8,9].includes(rider.number)&&phase('BANTE_BLOCK','FIVE_REACTION','FIVE_DIVE','FINAL')){
      const leader=engine.rider(7); const leaderCollapsed=leader && (leader.action==='FADE'||leader.energy<0.22||leader.speed+2<rider.speed);
      if(leaderCollapsed) return {mode:phase('FINAL')?TACTICAL_MODE.FINAL_SPRINT:TACTICAL_MODE.SWITCH,action:phase('FINAL')?'FINAL_SPRINT':'SWITCH_TO_SELF_POWER',speed:phase('FINAL')?this.finalSprintSpeed(rider):p.final,lane:rider.number===9?36:16,followTargetNumber:null};
    }

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
