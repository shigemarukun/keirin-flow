import { ACTION } from './race-plan.js';
import { TacticalSensor } from './tactical-sensor.js';
import { AutonomousDecisionEngine } from './autonomous-decision-engine.js';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export class TacticalAI {
  constructor(){this.sensor=new TacticalSensor();this.decisionEngine=new AutonomousDecisionEngine();}
  reset(){this.decisionEngine.reset();}
  plan(rider,engine,dt){
    const sensed=this.sensor.sense(rider,engine);
    const decision=this.decisionEngine.decide(rider,sensed,engine,dt);
    return this.translateDecision(rider,sensed,decision,engine);
  }

  translateDecision(rider,sensed,decision,engine){
    const p=rider.profile;
    const intensity=clamp(decision.intensity??.5,0,1);
    let targetSpeed=engine.profile.FORMATION_SPEED;

    if(decision.action===ACTION.DEFEND)targetSpeed=p.topSpeed*(.88+.10*intensity);
    else if([ACTION.ATTACK,ACTION.FULL_CONTEST].includes(decision.action))targetSpeed=p.topSpeed*(.92+.12*intensity);
    else if(decision.action===ACTION.CONTEST)targetSpeed=p.topSpeed*(.87+.10*intensity);
    else if(decision.action===ACTION.YIELD)targetSpeed=Math.max(engine.profile.FORMATION_SPEED,rider.speed-2.2);
    else if(decision.action===ACTION.RETREAT)targetSpeed=Math.max(7.5,rider.speed-2.8);
    else if(decision.action===ACTION.CONTROL_PACE)targetSpeed=engine.profile.FORMATION_SPEED+2.0;
    else if(decision.action===ACTION.SAVE_ENERGY)targetSpeed=Math.max(engine.profile.FORMATION_SPEED*.95,rider.speed-.6);
    else if(decision.action===ACTION.SWITCH_TO_SELF_POWER)targetSpeed=p.topSpeed+p.sprintBonus*(.55+rider.energy*.45);
    else if(decision.action===ACTION.FINAL_SPRINT)targetSpeed=p.topSpeed+p.sprintBonus*(.45+rider.energy*.70);
    else if(decision.action===ACTION.BLOCK)targetSpeed=Math.max(rider.speed,sensed.lineLeader?.speed??rider.speed);
    else if(decision.action===ACTION.FOLLOW){
      const target=decision.followTargetNumber?engine.rider(decision.followTargetNumber):sensed.frontRider;
      targetSpeed=target?engine.followDesiredSpeed(rider,target):engine.profile.FORMATION_SPEED;
    }

    return {...decision,targetSpeed,laneTarget:decision.laneTarget??rider.laneOffset,followTargetNumber:decision.followTargetNumber??null};
  }
}
