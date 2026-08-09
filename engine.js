import { DEFAULT_RACE_PLAN } from './race-plan.js';
import { ScenarioBController, SCENARIO_PHASE } from './scenario-b-controller.js';

const CAR_STYLES=Object.freeze({
1:{background:'#ffffff',text:'#111111'},2:{background:'#222222',text:'#ffffff'},3:{background:'#e60012',text:'#ffffff'},
4:{background:'#0068b7',text:'#ffffff'},5:{background:'#ffd400',text:'#111111'},6:{background:'#00a651',text:'#ffffff'},
7:{background:'#f08300',text:'#111111'},8:{background:'#ff69b4',text:'#111111'},9:{background:'#7f3fbf',text:'#ffffff'}});
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const PACER_STATE=Object.freeze({LEADING:'LEADING',EXITING:'EXITING',EXITED:'EXITED'});
export const RACE_PROFILES=Object.freeze({PROFILE_400:{TRACK_LENGTH:400,RACE_DISTANCE:800,FORMATION_SPEED:10.5,PacerLeaveLine:620,Bell:600,PacerExit:560,FinalLap:400,FinalBack:200,Finish:0}});
export const RACE_CONFIG=RACE_PROFILES.PROFILE_400;

class RaceClock{
 constructor(config){this.config=config;this.reset();}
 reset(){this.owner='PACER';this.referenceDistance=0;this.remainingDistance=this.config.RACE_DISTANCE;this.currentLap=2;this.firedEventSequence=[];this.events={PacerLeaveLine:{fired:false},Bell:{fired:false},PacerExit:{fired:false},FinalLap:{fired:false},FinalBack:{fired:false},Finish:{fired:false}};}
 update(pacerDistance,leaderDistance,engine){
  if(engine.pacer.state===PACER_STATE.EXITED)this.owner='LEADER';
  const ref=this.owner==='PACER'?pacerDistance:leaderDistance;this.referenceDistance=Math.max(this.referenceDistance,ref);
  this.remainingDistance=Math.max(0,this.config.RACE_DISTANCE-this.referenceDistance);this.currentLap=this.remainingDistance>400?2:1;
  const t={PacerLeaveLine:620,Bell:600,PacerExit:560,FinalLap:400,FinalBack:200,Finish:0},out=[];
  for(const n of ['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish'])if(!this.events[n].fired&&this.remainingDistance<=t[n]){this.events[n].fired=true;this.firedEventSequence.push(n);out.push(n);}
  return out;
 }
}

export class PhysicsEngine{
 constructor(lineGroups,lineOffsets=[-18,-6,6,18],profile=RACE_CONFIG,racePlan=DEFAULT_RACE_PLAN){
  this.lineGroups=lineGroups.map(x=>[...x]);this.lineOffsets=lineOffsets;this.profile=profile;this.totalDistance=profile.RACE_DISTANCE;this.racePlan=racePlan;this.timeScale=1;this.onBellCallback=null;this.onFinishCallback=null;this.raceClock=new RaceClock(profile);this.scenario=new ScenarioBController();this.buildRiders();this.reset();
 }
 buildRiders(){
  this.riders=[];let gi=0;
  this.lineGroups.forEach((g,lineId)=>g.forEach((number,lineOrder)=>{
   const p=this.racePlan[number]??{},initialDistance=-14-gi*17;
   this.riders.push({number,lineId,lineOrder,globalIndex:gi,isLeader:lineOrder===0,lineFrontNumber:lineOrder?g[lineOrder-1]:null,initialDistance,initialLaneOffset:-18,style:CAR_STYLES[number],plan:p,distance:initialDistance,speed:10.5,acceleration:0,laneOffset:-18,action:'FORMATION',followTargetNumber:lineOrder?g[lineOrder-1]:null,followStatus:lineOrder?'ATTACHED':'LEADER',energy:1,fatigue:0,effort:0,drafting:false,load:0,finished:false,finishTime:null,history:[]});gi++;
  }));
 }
 reset(){this.isStarted=false;this.elapsedTime=0;this.bellRung=false;this.currentState='POSITION_BATTLE';this.ranking=[];this.raceEvents=[];this.raceClock.reset();this.scenario.reset();this.pacer={distance:0,speed:10.5,state:PACER_STATE.LEADING,laneOffset:-18,exitProgress:0};for(const r of this.riders){r.distance=r.initialDistance;r.speed=10.5;r.acceleration=0;r.laneOffset=-18;r.action='FORMATION';r.followTargetNumber=r.lineFrontNumber;r.followStatus=r.isLeader?'LEADER':'ATTACHED';r.energy=1;r.fatigue=0;r.effort=0;r.drafting=false;r.load=0;r.finished=false;r.finishTime=null;r.history=[];}}
 start(){if(this.riders.every(r=>r.finished))this.reset();this.isStarted=true;} pause(){this.isStarted=false;} setSpeedScale(v){this.timeScale=clamp(Number(v)||1,.5,3);} onBell(cb){this.onBellCallback=cb;} onFinish(cb){this.onFinishCallback=cb;}
 rider(n){return this.riders.find(r=>r.number===n)??null;} leader(){return [...this.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance)[0]??null;}
 emitRaceEvent(type,data={}){this.raceEvents.push({time:this.elapsedTime,remaining:this.raceClock.remainingDistance,type,...data});}
 updatePacer(dt){if(this.pacer.state===PACER_STATE.EXITED)return;this.pacer.distance+=this.pacer.speed*dt;if(this.raceClock.events.PacerLeaveLine.fired&&this.pacer.state===PACER_STATE.LEADING)this.pacer.state=PACER_STATE.EXITING;if(this.pacer.state===PACER_STATE.EXITING){this.pacer.exitProgress=Math.min(1,this.pacer.exitProgress+.9*dt);const e=this.pacer.exitProgress*this.pacer.exitProgress*(3-2*this.pacer.exitProgress);this.pacer.laneOffset=-18-72*e;if(this.raceClock.events.PacerExit.fired&&this.pacer.exitProgress>=1)this.pacer.state=PACER_STATE.EXITED;}}
 lineLeader(lineId){return this.riders.find(r=>r.lineId===lineId&&r.lineOrder===0);}
 followSpeed(r,target,gap=9.5,maxPlus=3.5){if(!target||target.finished)return 10.5;const g=target.distance-r.distance;let v=target.speed;if(g<gap-2)v-=Math.min(2.0,(gap-2-g)*.32);else if(g>gap+3)v+=Math.min(maxPlus,(g-gap-3)*.30);return Math.max(0,v);}
 actionAndSpeed(r){
  const p=r.plan,ph=this.scenario.phase,one=this.rider(1),two=this.rider(2),four=this.rider(4),seven=this.rider(7);
  r.followTargetNumber=null;
  if(r.number===1){
   if(ph===SCENARIO_PHASE.FIRST_MOVE)return this.set(r,'LEAD',10.8);
   if(ph===SCENARIO_PHASE.FIRST_CONTEST)return this.set(r,'DEFEND',p.defend1);
   if(ph===SCENARIO_PHASE.SECOND_MOVE)return this.set(r,'LEAD',12.6);
   if(ph===SCENARIO_PHASE.SECOND_CONTEST)return this.set(r,'DEFEND',p.defend2);
   return this.set(r,'LEAD',ph===SCENARIO_PHASE.FORMATION?10.5:p.final);
  }
  if(r.number===2){
   r.followTargetNumber=1;
   if(ph===SCENARIO_PHASE.BANTE_BLOCK)return this.set(r,'BLOCK',Math.max(one.speed,19.4));
   return this.set(r,ph===SCENARIO_PHASE.FINAL?'FINAL_SPRINT':'FOLLOW',ph===SCENARIO_PHASE.FINAL?p.final:this.followSpeed(r,one,9));
  }
  if(r.number===3){r.followTargetNumber=2;return this.set(r,ph===SCENARIO_PHASE.FINAL?'FINAL_SPRINT':'FOLLOW',ph===SCENARIO_PHASE.FINAL?p.final:this.followSpeed(r,two,10.5));}
  if(r.number===4){
   if([SCENARIO_PHASE.LINE4_MAKURI,SCENARIO_PHASE.BANTE_BLOCK,SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(ph)){
    const checked=this.scenario.flags.blockStarted;
    return this.set(r,checked?'BLOCKED':'ATTACK',checked?p.blocked:p.makuri);
   }
   r.followTargetNumber=3;return this.set(r,'FOLLOW',this.followSpeed(r,this.rider(3),13,2));
  }
  if(r.number===5){
   if([SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(ph))return this.set(r,'DIVE',p.dive);
   r.followTargetNumber=4;return this.set(r,'FOLLOW',this.followSpeed(r,four,9.5,4));
  }
  if(r.number===6){r.followTargetNumber=5;return this.set(r,ph===SCENARIO_PHASE.FINAL?'FINAL_SPRINT':'FOLLOW',ph===SCENARIO_PHASE.FINAL?p.final:this.followSpeed(r,this.rider(5),10.5,3));}
  if(r.number===7){
   if(ph===SCENARIO_PHASE.FIRST_MOVE)return this.set(r,'MOVE_UP',p.attack1);
   if(ph===SCENARIO_PHASE.FIRST_CONTEST)return this.set(r,'CONTEST',p.contest1);
   if([SCENARIO_PHASE.FIRST_RETREAT,SCENARIO_PHASE.RESET_LINEUP].includes(ph))return this.set(r,'RETREAT',p.retreat);
   if(ph===SCENARIO_PHASE.SECOND_MOVE)return this.set(r,'ATTACK',p.attack2);
   if(ph===SCENARIO_PHASE.SECOND_CONTEST)return this.set(r,'CONTEST',p.contest2);
   if([SCENARIO_PHASE.LINE7_FADE,SCENARIO_PHASE.LINE4_MAKURI,SCENARIO_PHASE.BANTE_BLOCK,SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(ph))return this.set(r,'FADE',p.fade);
   return this.set(r,'FORMATION',10.5);
  }
  if(r.number===8){
   if([SCENARIO_PHASE.LINE4_MAKURI,SCENARIO_PHASE.BANTE_BLOCK,SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(ph)){r.followTargetNumber=null;return this.set(r,'FINAL_SPRINT',p.final);}
   r.followTargetNumber=7;return this.set(r,'FOLLOW',this.followSpeed(r,seven,9.5));
  }
  if(r.number===9){
   if([SCENARIO_PHASE.LINE4_MAKURI,SCENARIO_PHASE.BANTE_BLOCK,SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(ph)){r.followTargetNumber=null;return this.set(r,'FINAL_SPRINT',p.final);}
   r.followTargetNumber=8;return this.set(r,'FOLLOW',this.followSpeed(r,this.rider(8),9.5));
  }
  return 10.5;
 }
 set(r,a,v){r.action=a;return v;}
 laneTarget(r){
  const ph=this.scenario.phase,target=r.followTargetNumber?this.rider(r.followTargetNumber):null;
  if(r.number===1)return -18;
  if(r.number===2&&ph===SCENARIO_PHASE.BANTE_BLOCK)return 30;
  if(r.number===4&&[SCENARIO_PHASE.LINE4_MAKURI,SCENARIO_PHASE.BANTE_BLOCK,SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(ph))return ph===SCENARIO_PHASE.BANTE_BLOCK?42:36;
  if(r.number===5&&[SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(ph))return -2;
  if(r.number===6&&ph===SCENARIO_PHASE.FINAL)return 10;
  if(r.lineId===2){
   if([SCENARIO_PHASE.FIRST_MOVE,SCENARIO_PHASE.FIRST_CONTEST].includes(ph))return 36;
   // After losing the tsuppari battle, 7-line drops back on the outside.
   // It merges to the inside only after the whole line has cleared 4-5-6.
   if(ph===SCENARIO_PHASE.FIRST_RETREAT)return 34;
   if(ph===SCENARIO_PHASE.RESET_LINEUP)return -18;
   if([SCENARIO_PHASE.SECOND_MOVE,SCENARIO_PHASE.SECOND_CONTEST].includes(ph))return 38;
   if(ph===SCENARIO_PHASE.FINAL){if(r.number===9)return 36;if(r.number===8)return 16;return -8;}
   return 30;
  }
  return target?target.laneOffset:-18;
 }
 updateEnergy(r,desired,dt){
  const target=r.followTargetNumber?this.rider(r.followTargetNumber):null,g=target?target.distance-r.distance:999,draft=target&&g>5&&g<14&&Math.abs(target.laneOffset-r.laneOffset)<14?.28:0;
  const demand=Math.max(0,desired-10.5)/10.5;let factor=1;if(['MOVE_UP','ATTACK','CONTEST','DEFEND'].includes(r.action))factor=1.65;if(r.action==='BLOCK')factor=1.35;if(['RETREAT','FADE'].includes(r.action))factor=.50;if(['DIVE','FINAL_SPRINT'].includes(r.action))factor=1.40;
  const load=(.0024+.011*demand*demand)*factor*(1-draft)/(r.plan.endurance??1);
  const recovery=(r.action==='RETREAT'||(r.action==='FOLLOW'&&desired<=12.0))?0.010:0;
  r.load=load;r.drafting=draft>0;r.effort=demand;r.energy=clamp(r.energy-load*dt+recovery*dt,0,1);r.fatigue=1-r.energy;
 }
 move(r,desired,dt){
  let top=(r.plan.topSpeed??21)*(r.energy<.45?.72+.28*(r.energy/.45):1);desired=Math.min(desired,top);
  const prev=r.speed,acc=(r.plan.acceleration??3.2)*(.62+.38*Math.max(.30,r.energy));if(r.speed<desired)r.speed=Math.min(desired,r.speed+acc*dt);else r.speed=Math.max(desired,r.speed-3.8*dt);
  const lt=this.laneTarget(r);const leader4Attack=r.lineId===1&&[SCENARIO_PHASE.LINE4_MAKURI,SCENARIO_PHASE.BANTE_BLOCK,SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(this.scenario.phase);const lr=['MOVE_UP','ATTACK','CONTEST','BLOCK','DIVE'].includes(r.action)?3.4:(leader4Attack?3.6:2.0);r.laneOffset+=(lt-r.laneOffset)*clamp(lr*dt,0,1);
  let next=r.distance+r.speed*dt,target=r.followTargetNumber?this.rider(r.followTargetNumber):null;
  if(target&&!target.finished&&target.distance>r.distance&&!['MOVE_UP','ATTACK','CONTEST','BLOCK','DIVE','FINAL_SPRINT'].includes(r.action)){if(next>target.distance-5.8){next=target.distance-5.8;r.speed=Math.min(r.speed,target.speed);}}
  for(const o of this.riders){if(o===r||o.finished)continue;if(Math.abs(o.distance-next)<4&&Math.abs(o.laneOffset-r.laneOffset)<8){const out=['MOVE_UP','ATTACK','CONTEST','BLOCK','DIVE','FINAL_SPRINT'].includes(r.action);r.laneOffset+=(clamp(o.laneOffset+(out?11:-11),-18,46)-r.laneOffset)*clamp(5*dt,0,1);}}
  r.distance=next;r.acceleration=(r.speed-prev)/Math.max(dt,1e-6);
 }
 recordFinish(r){r.distance=this.totalDistance;r.finished=true;r.finishTime=this.elapsedTime;this.ranking.push({rank:0,number:r.number,lineId:r.lineId,time:r.finishTime,margin:''});}
 finalize(){this.ranking.sort((a,b)=>a.time-b.time||a.number-b.number);const w=this.ranking[0]?.time??0;this.ranking.forEach((x,i)=>{x.rank=i+1;const m=(x.time-w)*10.5;x.margin=i===0?'先頭':m<.12?'ハナ':m<.25?'アタマ':m<.7?'1/2車身':m<1.1?'1車身':`${m.toFixed(1)}車身`;});}
 recordHistory(){const s=[...this.riders].sort((a,b)=>b.distance-a.distance),pm=new Map(s.map((r,i)=>[r.number,i+1]));for(const r of this.riders){r.history.push({time:this.elapsedTime,distance:r.distance,speed:r.speed,acceleration:r.acceleration,laneOffset:r.laneOffset,position:pm.get(r.number),action:r.action,followTargetNumber:r.followTargetNumber,energy:r.energy,fatigue:r.fatigue,drafting:r.drafting,scenarioPhase:this.scenario.phase});if(r.history.length>2000)r.history.shift();}}
 update(dt){
  if(!this.isStarted)return;const fd=clamp(Number(dt)||0,0,.1)*this.timeScale,steps=Math.max(1,Math.ceil(fd/(1/120))),sd=fd/steps;
  for(let k=0;k<steps;k++){this.elapsedTime+=sd;this.updatePacer(sd);this.scenario.update(sd,this);const desired=new Map();for(const r of this.riders)if(!r.finished)desired.set(r.number,this.actionAndSpeed(r));for(const r of this.riders){if(r.finished)continue;this.updateEnergy(r,desired.get(r.number),sd);const before=r.distance;this.move(r,desired.get(r.number),sd);if(before<this.totalDistance&&r.distance>=this.totalDistance)this.recordFinish(r);}const ld=this.riders.reduce((m,r)=>Math.max(m,r.distance),0),tr=this.raceClock.update(this.pacer.distance,ld,this);if(tr.includes('Bell')){this.bellRung=true;this.onBellCallback?.();}}
  this.recordHistory();if(this.riders.every(r=>r.finished)){this.isStarted=false;this.currentState='FINISHED';this.finalize();this.onFinishCallback?.(this.ranking.map(x=>({...x})));}
 }
 getDiagnostics(){const gaps=[];for(const r of this.riders){const f=r.followTargetNumber?this.rider(r.followTargetNumber):null;if(f&&!r.finished&&!f.finished&&f.distance>r.distance)gaps.push({number:r.number,frontNumber:f.number,gap:f.distance-r.distance});}return{gaps,minGap:gaps.length?Math.min(...gaps.map(x=>x.gap)):null,maxGap:gaps.length?Math.max(...gaps.map(x=>x.gap)):null};}
 getState(){return{riders:this.riders,pacer:this.pacer,ranking:this.ranking,isStarted:this.isStarted,currentState:this.currentState,elapsedTime:this.elapsedTime,totalDistance:this.totalDistance,bellRung:this.bellRung,diagnostics:this.getDiagnostics(),raceClock:this.raceClock,raceEvents:this.raceEvents,scenario:{phase:this.scenario.phase,flags:{...this.scenario.flags}}};}
}
