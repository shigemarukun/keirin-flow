import { ACTION, ROLE, MINDSET, SOLO_MINDSET, LINE_FOLLOW_MODE, TRACK_LANE } from './race-plan.js';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export class AutonomousDecisionEngine {
  constructor(){this.memory=new Map();}
  reset(){this.memory.clear();}
  state(rider){
    if(!this.memory.has(rider.number))this.memory.set(rider.number,{intent:'NONE',lastAction:ACTION.FORMATION,yieldArmed:false,contestSeconds:0,attachTarget:null});
    return this.memory.get(rider.number);
  }

  decide(rider,sensor,engine,dt){
    const memory=this.state(rider);
    const role=sensor.context?.role??ROLE.SOLO;
    let result;
    if(role===ROLE.LEADER)result=this.decideLeader(rider,sensor,engine,dt,memory);
    else if(role===ROLE.BANTE)result=this.decideBante(rider,sensor,engine,dt,memory);
    else if(role===ROLE.SOLO)result=this.decideSolo(rider,sensor,engine,dt,memory);
    else result=this.decideLineFollower(rider,sensor,engine,dt,memory);
    memory.lastAction=result.action;
    return result;
  }

  decideLeader(rider,s,engine,dt,memory){
    const p=rider.profile, attacker=s.nearestAttacker;

    // CR-0009: once a successful attack has cleared the field, closing to the
    // inside is a persistent state, not a one-frame action.
    if(memory.intent==='ESTABLISH_FRONT'){
      const reachedInside=Math.abs(rider.laneOffset-TRACK_LANE.INNER)<1.5;
      if(!reachedInside){
        engine.settlingLineId=rider.lineId;
        return {action:ACTION.CONTROL_PACE,intensity:.72,laneTarget:TRACK_LANE.INNER,followMode:LINE_FOLLOW_MODE.SETTLING,reason:'主導権奪取後、最イン線への収束・イン締めを継続中'};
      }
      memory.intent='HOLD_FRONT';
    }

    const justAttacked=[ACTION.ATTACK,ACTION.CONTEST,ACTION.FULL_CONTEST,ACTION.SWITCH_TO_SELF_POWER].includes(memory.lastAction);
    if(justAttacked&&engine.hasClearedField(rider,6)){
      memory.intent='ESTABLISH_FRONT';
      engine.settlingLineId=rider.lineId;
      return {action:ACTION.CONTROL_PACE,intensity:.72,laneTarget:TRACK_LANE.INNER,followMode:LINE_FOLLOW_MODE.SETTLING,reason:'他ラインを叩き切ってレース先頭へ躍り出たため、イン締めを開始'};
    }

    // Once another line has genuinely established the front, a non-attacking
    // leader docks behind the nearest preceding line tail instead of targeting
    // an arbitrary individual at the head of the race.
    if(engine.establishedFrontLineId&&engine.establishedFrontLineId!==rider.lineId&&!justAttacked){
      const target=engine.findSettleTargetForLine(rider.lineId);
      if(target){
        return {action:ACTION.FOLLOW,intensity:.48,followTargetNumber:target.number,laneTarget:target.laneOffset,followMode:LINE_FOLLOW_MODE.SETTLING,reason:'主導権ライン確立を確認し、直前ライン最後尾へライン単位で収束'};
      }
    }

    // If this rider initiated a move and has now reached a resisting opponent,
    // re-assess the contest instead of blindly holding ATTACK until a phase ends.
    const defender=s.frontRider;
    const attackInProgress=[ACTION.ATTACK,ACTION.CONTEST,ACTION.FULL_CONTEST].includes(memory.lastAction);
    const defenderResisting=defender&&defender.lineId!==rider.lineId&&[ACTION.DEFEND,ACTION.CONTEST,ACTION.FULL_CONTEST].includes(defender.action);
    if(attackInProgress&&defenderResisting&&(defender.distance-rider.distance)<14){
      const contest=this.decideContest(rider,defender,s,engine);
      if(contest===ACTION.RETREAT){
        return {action:ACTION.RETREAT,intensity:.34,laneTarget:rider.laneOffset};
      }
      return {action:contest,intensity:contest===ACTION.FULL_CONTEST?1:.80,laneTarget:rider.laneOffset};
    }

    if(attacker&&attacker.distanceGap<22&&attacker.outside){
      if(rider.mindset===MINDSET.TSUPPARI&&rider.energy>p.contestEnergyFloor)
        return {action:ACTION.DEFEND,intensity:1,laneTarget:rider.laneOffset};
      if(rider.mindset===MINDSET.YIELD_AND_ROLL&&rider.energy>p.attackEnergyFloor){
        memory.yieldArmed=true;
        return {action:ACTION.YIELD,intensity:.45,laneTarget:rider.laneOffset};
      }
      if(rider.mindset===MINDSET.CONTAIN){
        const contest=this.decideContest(rider,attacker.rider,s,engine);
        if([ACTION.CONTEST,ACTION.FULL_CONTEST].includes(contest))
          return {action:contest,intensity:contest===ACTION.FULL_CONTEST?1:.78,laneTarget:rider.laneOffset};
        return {action:ACTION.RETREAT,intensity:.35,laneTarget:rider.laneOffset};
      }
    }

    if(memory.yieldArmed&&s.remainingDistance<260&&rider.energy>p.attackEnergyFloor){
      const ahead=s.frontRider;
      if(ahead&&ahead.speed<rider.speed+1.2){
        memory.yieldArmed=false;
        return {action:ACTION.ATTACK,intensity:.88,laneTarget:engine.chooseOvertakeLane(rider)};
      }
    }

    if(this.shouldAttack(rider,s,engine))
      return {action:ACTION.ATTACK,intensity:.80+p.aggression*.18,laneTarget:engine.chooseOvertakeLane(rider)};

    if(rider.mindset===MINDSET.CONTAIN&&s.remainingDistance>260&&s.positionRank<=4)
      return {action:ACTION.CONTROL_PACE,intensity:.48,laneTarget:rider.laneOffset};

    return {action:ACTION.FOLLOW,intensity:.55,laneTarget:rider.laneOffset};
  }

  decideContest(attacker,defender,sensor,engine){
    const ap=attacker.profile, dp=defender.profile;
    const energyAdvantage=attacker.energy-defender.energy;
    const speedDelta=attacker.speed-defender.speed;
    const raw=ap.power*.34+ap.acceleration*.24+energyAdvantage*.24+clamp(speedDelta/6,-1,1)*.18-dp.power*.20;
    const winningProbability=clamp(raw,0,1);
    if(attacker.energy<ap.contestEnergyFloor)return ACTION.RETREAT;
    if(winningProbability<.28)return ACTION.RETREAT;
    if(winningProbability>.66)return ACTION.FULL_CONTEST;
    return ap.riskTolerance>.58?ACTION.CONTEST:ACTION.RETREAT;
  }

  decideBante(rider,s,engine,dt,memory){
    const leader=s.lineLeader;
    const incoming=engine.findIncomingThreat(rider);

    if(!leader||leader.finished||leader.action===ACTION.FADE||leader.energy<.20)
      return {action:ACTION.SWITCH_TO_SELF_POWER,intensity:.88,laneTarget:engine.chooseOvertakeLane(rider)};

    if(incoming&&incoming.closingSpeed>2&&incoming.distance<25&&rider.energy>.25)
      return {action:ACTION.BLOCK,intensity:.72+rider.profile.blockSkill*.20,laneTarget:incoming.rider.laneOffset-4};

    if(s.remainingDistance<70&&rider.energy>.25)
      return {action:ACTION.FINAL_SPRINT,intensity:.90,laneTarget:engine.chooseOvertakeLane(rider)};

    return {action:ACTION.FOLLOW,intensity:.58,followTargetNumber:leader.number,laneTarget:leader.laneOffset};
  }

  decideLineFollower(rider,s,engine){
    const frontNumber=s.context?.frontLineMate;
    const front=frontNumber?engine.rider(frontNumber):s.frontRider;

    if(!front||front.finished||front.action===ACTION.FADE){
      if(rider.energy>.28&&s.remainingDistance<180)
        return {action:ACTION.SWITCH_TO_SELF_POWER,intensity:.82,laneTarget:engine.chooseOvertakeLane(rider)};
      return {action:ACTION.SAVE_ENERGY,intensity:.40,laneTarget:rider.laneOffset};
    }

    if(s.remainingDistance<55&&rider.energy>.22)
      return {action:ACTION.FINAL_SPRINT,intensity:.86,laneTarget:engine.chooseOvertakeLane(rider)};

    return {action:ACTION.FOLLOW,intensity:.56,followTargetNumber:front.number,laneTarget:front.laneOffset};
  }

  decideSolo(rider,s,engine,dt,memory){
    const mindset=rider.soloMindset??SOLO_MINDSET.FLOW_RIDE;
    if(mindset===SOLO_MINDSET.SAVE_AND_SPRINT){
      if(s.remainingDistance>120)return {action:ACTION.SAVE_ENERGY,intensity:.38,laneTarget:rider.laneOffset};
      return {action:ACTION.SWITCH_TO_SELF_POWER,intensity:.92,laneTarget:engine.chooseOvertakeLane(rider)};
    }

    const best=engine.scoreBestAttachTarget(rider);
    if(best){
      memory.attachTarget=best.targetNumber;
      if(mindset===SOLO_MINDSET.ATTACH_AND_STRIKE&&s.remainingDistance<90&&rider.energy>.30)
        return {action:ACTION.SWITCH_TO_SELF_POWER,intensity:.90,laneTarget:engine.chooseOvertakeLane(rider)};
      return {action:ACTION.FOLLOW,intensity:mindset===SOLO_MINDSET.FLOW_RIDE?.58:.52,followTargetNumber:best.targetNumber,laneTarget:best.laneOffset};
    }

    return {action:ACTION.SAVE_ENERGY,intensity:.40,laneTarget:rider.laneOffset};
  }

  shouldAttack(rider,s,engine){
    const p=rider.profile;
    if(rider.energy<p.attackEnergyFloor)return false;
    if(s.remainingDistance>520&&s.positionRank<=3)return false;
    if(s.remainingDistance<55)return false;
    const ahead=s.frontRider;
    const frontSlowing=ahead&&ahead.speed<rider.speed-1.2;
    const poorPosition=s.positionRank>=5;
    const lateEnough=s.remainingDistance<360;
    const freeLane=Math.min(s.insideDensity,s.outsideDensity)<=s.currentDensity;
    return (lateEnough&&poorPosition&&freeLane)||(frontSlowing&&freeLane);
  }
}
