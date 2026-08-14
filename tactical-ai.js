import { ACTION } from './race-plan.js';
import { TacticalSensor } from './tactical-sensor.js';
import { AutonomousDecisionEngine } from './autonomous-decision-engine.js';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export class TacticalAI {
  constructor(){this.sensor=new TacticalSensor();this.decisionEngine=new AutonomousDecisionEngine();}
  reset(){this.decisionEngine.reset();}
  plan(rider,engine,dt){
    const sensed=this.sensor.sense(rider,engine);
    const protocolDecision=engine.keirinProtocol?.getDirective(rider,engine)??null;
    const decision=protocolDecision??this.decisionEngine.decide(rider,sensed,engine,dt);
    const translated=this.translateDecision(rider,sensed,decision,engine);

    // Decision Log: same action is not spammed every frame. Protocol transitions
    // emit their detailed story separately; autonomous changes remain visible here.
    const previous=rider.lastDecisionAction??null;
    const storyActions=new Set(['ATTACK','DEFEND','CONTEST','FULL_CONTEST','RETREAT','BLOCK','SWITCH_TO_SELF_POWER','FINAL_SPRINT','YIELD']);
    const shouldLog=protocolDecision ? previous!==translated.action : (previous!==translated.action && storyActions.has(translated.action));
    if(shouldLog){
      rider.lastDecisionAction=translated.action;
      const now=engine.elapsedTime;
      if(rider.lastDecisionLogTime==null||now-rider.lastDecisionLogTime>=.75||protocolDecision){
        rider.lastDecisionLogTime=now;
        engine.emitDecision({
          riderNumber:rider.number,
          category:protocolDecision?'PROTOCOL_ACTION':'AI_DECISION',
          action:translated.action,
          message:decision.reason??this.describeDecision(rider,translated,sensed)
        });
      }
    }else if(previous!==translated.action){
      rider.lastDecisionAction=translated.action;
    }
    return translated;
  }

  describeDecision(rider,decision,sensed){
    const labels={
      FOLLOW:'前走者との車間を見て追走',ATTACK:'前方の空きを見て仕掛け',DEFEND:'外圧を検知して主導権を防御',
      CONTEST:'主導権争いを継続',FULL_CONTEST:'勝機ありと判断し全力で踏み合い',YIELD:'一旦出させて脚を温存',
      RETREAT:'勝ち目と残脚を再評価して後退',BLOCK:'後方の強襲を検知して牽制',SWITCH_TO_SELF_POWER:'前走者の失速を察知して自力へ切替',
      SAVE_ENERGY:'位置を保って脚を温存',FINAL_SPRINT:'残脚を使って最終スプリント',CONTROL_PACE:'前でペースを管理'
    };
    return labels[decision.action]??`${decision.action}を選択`;
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
      targetSpeed=target?engine.followDesiredSpeed(rider,target,decision.followMode??null):engine.profile.FORMATION_SPEED;
    }

    return {...decision,targetSpeed,laneTarget:decision.laneTarget??rider.laneOffset,followTargetNumber:decision.followTargetNumber??null};
  }
}
