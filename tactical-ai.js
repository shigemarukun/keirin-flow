export const TACTICAL_MODE = Object.freeze({
  FOLLOW:'FOLLOW', ATTACK:'ATTACK', CONTEST:'CONTEST', RETREAT:'RETREAT',
  DEFEND:'DEFEND', BLOCK:'BLOCK', SWITCH:'SWITCH', SELF_POWER:'SELF_POWER',
  RECOVER:'RECOVER', FINAL_SPRINT:'FINAL_SPRINT'
});

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export class TacticalAI {
  constructor(){ this.reset(); }
  reset(){ this.memory=new Map(); }

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

  followerCommand(rider, sensor, leaderCommand, idealGap=9.8){
    const front=sensor.lineFront;
    if(!front) return {...leaderCommand};
    const gap=front.distance-rider.distance;
    const gapError=gap-idealGap;
    const rel=front.speed-rider.speed;
    // Feed-forward leader intent plus bounded PD correction. Followers react to
    // acceleration/retreat immediately instead of waiting for a large position error.
    let speed=front.speed + gapError*0.34 + rel*0.55;
    speed=clamp(speed, Math.max(0,front.speed-3.0), front.speed+4.2);
    const lane=front.laneOffset;
    let mode=TACTICAL_MODE.FOLLOW;
    // Propagate tactical intent through the whole line. A third rider follows
    // the second rider's ATTACK_FOLLOW / RETREAT_FOLLOW state instead of losing
    // the leader's intent one hop down the chain.
    if(front.action.includes('MOVE_UP')||front.action.includes('ATTACK')) mode=TACTICAL_MODE.ATTACK;
    else if(front.action.includes('CONTEST')) mode=TACTICAL_MODE.CONTEST;
    else if(front.action.includes('RETREAT')||front.action.includes('FADE')) mode=TACTICAL_MODE.RETREAT;
    return {mode,action:`${mode}_FOLLOW`,speed,lane,followTargetNumber:front.number,idealGap};
  }

  decide(rider, engine){
    const s=this.sense(rider,engine), ph=s.phase, p=rider.plan??{};
    const phase=(...xs)=>xs.includes(ph);

    // Leaders decide from race situation. The reference controller supplies the
    // current tactical objective; movement itself is generated from sensed rivals.
    if(rider.isLeader){
      if(rider.number===1){
        const seven=engine.rider(7); const pressure=seven?Math.max(0,20-(rider.distance-seven.distance)):0;
        if(phase('FIRST_CONTEST','SECOND_CONTEST')) return {mode:TACTICAL_MODE.DEFEND,action:'DEFEND',speed:phase('FIRST_CONTEST')?p.defend1:p.defend2,lane:-18,followTargetNumber:null};
        return {mode:TACTICAL_MODE.FOLLOW,action:'LEAD',speed:phase('SECOND_MOVE')?12.6:phase('LINE7_FADE','LINE4_MAKURI','BANTE_BLOCK','FIVE_DIVE','FINAL')?p.final:10.5+Math.min(.3,pressure*.01),lane:-18,followTargetNumber:null};
      }
      if(rider.number===7){
        if(phase('FIRST_MOVE')) return {mode:TACTICAL_MODE.ATTACK,action:'MOVE_UP',speed:p.attack1,lane:36,followTargetNumber:null};
        if(phase('FIRST_CONTEST')) return {mode:TACTICAL_MODE.CONTEST,action:'CONTEST',speed:p.contest1,lane:36,followTargetNumber:null};
        if(phase('FIRST_RETREAT','RESET_LINEUP')) return {mode:TACTICAL_MODE.RETREAT,action:'RETREAT',speed:p.retreat,lane:ph==='RESET_LINEUP'?-18:34,followTargetNumber:null};
        if(phase('SECOND_MOVE')) return {mode:TACTICAL_MODE.ATTACK,action:'ATTACK',speed:p.attack2,lane:38,followTargetNumber:null};
        if(phase('SECOND_CONTEST')) return {mode:TACTICAL_MODE.CONTEST,action:'CONTEST',speed:Math.max(p.contest2,24.4),lane:38,followTargetNumber:null};
        if(phase('LINE7_FADE','LINE4_MAKURI','BANTE_BLOCK','FIVE_DIVE','FINAL')) return {mode:TACTICAL_MODE.RECOVER,action:'FADE',speed:p.fade,lane:ph==='FINAL'?-8:38,followTargetNumber:null};
        return {mode:TACTICAL_MODE.FOLLOW,action:'FORMATION',speed:10.5,lane:30,followTargetNumber:null};
      }
      if(rider.number===4){
        if(phase('LINE4_MAKURI','BANTE_BLOCK','FIVE_DIVE','FINAL')){
          const blocker=engine.rider(2);
          const liveBlock=blocker && blocker.laneOffset>4 && Math.abs(blocker.distance-rider.distance)<14;
          const completedBlock=engine.scenario.flags.blockContactCompleted && phase('FIVE_DIVE','FINAL');
          const blockActive=liveBlock||completedBlock;
          return {mode:blockActive?TACTICAL_MODE.RECOVER:TACTICAL_MODE.ATTACK,action:blockActive?'BLOCKED':'ATTACK',speed:blockActive?p.blocked:p.makuri,lane:blockActive?42:36,followTargetNumber:null};
        }
        // Middle-line leader: keep a real tactical middle position behind the
        // front line instead of idling at formation speed. This is a sensed
        // target, not a timer: 4 follows the current third rider of the front line.
        const three=engine.rider(3);
        if(three&&!three.finished){
          const idealGap=17;
          const gap=three.distance-rider.distance;
          const gapError=gap-idealGap;
          const relative=three.speed-rider.speed;
          const speed=clamp(three.speed+gapError*0.30+relative*0.45,Math.max(0,three.speed-2.2),three.speed+4.8);
          return {mode:TACTICAL_MODE.FOLLOW,action:'FOLLOW',speed,lane:three.laneOffset,followTargetNumber:3,idealGap};
        }
      }
    }

    // Special tactical reactions are triggered by sensed movement, not a clock-only slide.
    if(rider.number===2){
      const four=engine.rider(4); const threat=four && four.distance>rider.distance-18 && four.distance<rider.distance+8 && four.laneOffset>8;
      if(phase('BANTE_BLOCK')&&threat) return {mode:TACTICAL_MODE.BLOCK,action:'BLOCK',speed:Math.max(engine.rider(1)?.speed??0,19.4),lane:30,followTargetNumber:1};
    }
    if(rider.number===5&&phase('FIVE_DIVE','FINAL')) return {mode:TACTICAL_MODE.SELF_POWER,action:'DIVE',speed:p.dive,lane:-2,followTargetNumber:null};
    if(rider.number===6&&phase('FINAL')) return {mode:TACTICAL_MODE.FINAL_SPRINT,action:'FINAL_SPRINT',speed:p.final,lane:10,followTargetNumber:null};
    if([8,9].includes(rider.number)&&phase('BANTE_BLOCK','FIVE_DIVE','FINAL')){
      // When the leader has collapsed, followers are allowed to detach and ride for themselves.
      const leader=engine.rider(7); const leaderCollapsed=leader && (leader.action==='FADE'||leader.energy<0.22||leader.speed+2<rider.speed);
      if(leaderCollapsed) return {mode:TACTICAL_MODE.SWITCH,action:'SWITCH_TO_SELF_POWER',speed:p.final,lane:rider.number===9?36:16,followTargetNumber:null};
    }

    const front=s.lineFront;
    if(front){
      const leaderCommand={mode:TACTICAL_MODE.FOLLOW,action:'FOLLOW',speed:front.speed,lane:front.laneOffset,followTargetNumber:front.number};
      const cmd=this.followerCommand(rider,s,leaderCommand,17);
      if(rider.number===4&&!phase('LINE4_MAKURI','BANTE_BLOCK','FIVE_DIVE','FINAL')) cmd.followTargetNumber=3;
      return cmd;
    }
    return {mode:TACTICAL_MODE.FOLLOW,action:'FORMATION',speed:10.5,lane:rider.laneOffset,followTargetNumber:null};
  }
}
