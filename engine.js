import { TacticalAI } from './tactical-ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';
import { ScenarioBController, SCENARIO_PHASE } from './scenario-b-controller.js';

const CAR_STYLES=Object.freeze({
1:{background:'#ffffff',text:'#111111'},2:{background:'#222222',text:'#ffffff'},3:{background:'#e60012',text:'#ffffff'},
4:{background:'#0068b7',text:'#ffffff'},5:{background:'#ffd400',text:'#111111'},6:{background:'#00a651',text:'#ffffff'},
7:{background:'#f08300',text:'#111111'},8:{background:'#ff69b4',text:'#111111'},9:{background:'#7f3fbf',text:'#ffffff'}});
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

const PACER_STATE=Object.freeze({
 LEADING:'LEADING',
 EXITING:'EXITING',
 EXITED:'EXITED'
});

const CLOCK_OWNER=Object.freeze({
 PACER:'PACER',
 LEADER:'LEADER'
});

/**
 * CR-0002
 * RedBoard is a physical/reference marker, not a one-shot event.
 * The one-shot race timeline is:
 * PacerLeaveLine -> Bell -> PacerExit -> FinalLap -> FinalBack -> Finish
 */
export const RACE_PROFILES=Object.freeze({
 PROFILE_400:Object.freeze({
  TRACK_LENGTH:400,
  RACE_DISTANCE:800,
  REDBOARD_MARKER:800,
  FORMATION_SPEED:10.5,

  // Timeline tuning values. Keep them centralized here so future
  // venue/profile calibration never leaks magic numbers into RaceClock.
  PacerLeaveLine:620,
  Bell:600,
  PacerExit:560,
  FinalLap:400,
  FinalBack:200,
  Finish:0
 })
});

export const RACE_CONFIG=RACE_PROFILES.PROFILE_400;

export class RaceClock{
 constructor(config=RACE_CONFIG){
  this.config=config;
  this.trackLength=config.TRACK_LENGTH;
  this.totalDistance=config.RACE_DISTANCE;
  this.redBoardMarker=config.REDBOARD_MARKER;
  this.reset();
 }

 _buildEvents(){
  return {
   PacerLeaveLine:{
    name:'PacerLeaveLine',
    fired:false,
    firedAtRemaining:null,
    condition:clock=>clock.remainingDistance<=clock.config.PacerLeaveLine
   },
   Bell:{
    name:'Bell',
    fired:false,
    firedAtRemaining:null,
    condition:clock=>clock.remainingDistance<=clock.config.Bell
   },
   PacerExit:{
    name:'PacerExit',
    fired:false,
    firedAtRemaining:null,
    condition:clock=>clock.remainingDistance<=clock.config.PacerExit
   },
   FinalLap:{
    name:'FinalLap',
    fired:false,
    firedAtRemaining:null,
    condition:clock=>clock.remainingDistance<=clock.config.FinalLap
   },
   FinalBack:{
    name:'FinalBack',
    fired:false,
    firedAtRemaining:null,
    condition:clock=>clock.remainingDistance<=clock.config.FinalBack
   },
   Finish:{
    name:'Finish',
    fired:false,
    firedAtRemaining:null,
    condition:clock=>clock.remainingDistance<=clock.config.Finish
   }
  };
 }

 reset(){
  this.owner=CLOCK_OWNER.PACER;
  this.referenceDistance=0;
  this.remainingDistance=this.totalDistance;
  this.currentLap=2;
  this.firedEventSequence=[];
  this.eventHistory=[];
  this.events=this._buildEvents();
 }

 update(pacerDistance,leaderDistance,engine){
  // Clock ownership changes only after the pacer has physically completed
  // its exit animation. PacerExit crossing alone is not ownership handoff.
  if(engine.pacer.state===PACER_STATE.EXITED){
   this.owner=CLOCK_OWNER.LEADER;
  }

  const candidateDistance=this.owner===CLOCK_OWNER.PACER
   ? pacerDistance
   : leaderDistance;

  // Monotonicity guard: when PACER -> LEADER handoff happens, the leader can
  // still be a few metres behind the pacer. Remaining distance must never jump back.
  this.referenceDistance=Math.max(this.referenceDistance,candidateDistance);
  this.remainingDistance=Math.max(0,this.totalDistance-this.referenceDistance);
  this.currentLap=this.remainingDistance>this.trackLength?2:1;

  const triggered=[];
  const sequenceOrder=[
   'PacerLeaveLine',
   'Bell',
   'PacerExit',
   'FinalLap',
   'FinalBack',
   'Finish'
  ];

  for(const key of sequenceOrder){
   const event=this.events[key];
   if(!event.fired&&event.condition(this,engine)){
    event.fired=true;
    event.firedAtRemaining=this.remainingDistance;
    triggered.push(event.name);
    this.firedEventSequence.push(event.name);
    this.eventHistory.push({
     name:event.name,
     remainingDistance:this.remainingDistance,
     referenceDistance:this.referenceDistance,
     clockOwner:this.owner
    });
   }
  }

  return triggered;
 }

 getTimelineState(){
  return {
   redBoardMarker:this.redBoardMarker,
   owner:this.owner,
   referenceDistance:this.referenceDistance,
   remainingDistance:this.remainingDistance,
   currentLap:this.currentLap,
   firedEventSequence:[...this.firedEventSequence],
   eventHistory:this.eventHistory.map(item=>({...item})),
   events:Object.fromEntries(
    Object.entries(this.events).map(([key,event])=>[
     key,
     {fired:event.fired,firedAtRemaining:event.firedAtRemaining}
    ])
   )
  };
 }
}

export class PhysicsEngine{
 constructor(lineGroups,lineOffsets=[-18,-6,6,18],profile=RACE_CONFIG,racePlan=DEFAULT_RACE_PLAN){
  this.lineGroups=lineGroups.map(x=>[...x]);this.lineOffsets=lineOffsets;this.profile=profile;this.totalDistance=profile.RACE_DISTANCE;this.racePlan=racePlan;this.timeScale=1;this.onBellCallback=null;this.onFinishCallback=null;this.raceClock=new RaceClock(profile);this.scenario=new ScenarioBController();this.tacticalAI=new TacticalAI();this.buildRiders();this.reset();
 }
 buildRiders(){
  this.riders=[];let gi=0;
  this.lineGroups.forEach((g,lineId)=>g.forEach((number,lineOrder)=>{
   const p=this.racePlan[number]??{},initialDistance=-14-gi*17;
   this.riders.push({number,lineId,lineOrder,globalIndex:gi,isLeader:lineOrder===0,lineFrontNumber:lineOrder?g[lineOrder-1]:null,initialDistance,initialLaneOffset:-18,style:CAR_STYLES[number],plan:p,distance:initialDistance,speed:10.5,acceleration:0,laneOffset:-18,action:'FORMATION',followTargetNumber:lineOrder?g[lineOrder-1]:null,followStatus:lineOrder?'ATTACHED':'LEADER',energy:1,fatigue:0,effort:0,drafting:false,load:0,finished:false,finishTime:null,history:[]});gi++;
  }));
 }
 reset(){this.isStarted=false;this.elapsedTime=0;this.bellRung=false;this.currentState='POSITION_BATTLE';this.ranking=[];this.raceEvents=[];this.raceClock.reset();this.scenario.reset();this.tacticalAI.reset();this.pacer={distance:0,speed:this.profile.FORMATION_SPEED,state:PACER_STATE.LEADING,laneOffset:-18,exitProgress:0};for(const r of this.riders){r.distance=r.initialDistance;r.speed=10.5;r.acceleration=0;r.laneOffset=-18;r.action='FORMATION';r.tacticalMode='FOLLOW';r.tacticalLaneTarget=-18;r.followTargetNumber=r.lineFrontNumber;r.followStatus=r.isLeader?'LEADER':'ATTACHED';r.energy=1;r.fatigue=0;r.effort=0;r.drafting=false;r.load=0;r.finished=false;r.finishTime=null;r.history=[];}}
 start(){if(this.riders.every(r=>r.finished))this.reset();this.isStarted=true;} pause(){this.isStarted=false;} setSpeedScale(v){this.timeScale=clamp(Number(v)||1,.5,3);} onBell(cb){this.onBellCallback=cb;} onFinish(cb){this.onFinishCallback=cb;}
 rider(n){return this.riders.find(r=>r.number===n)??null;} leader(){return [...this.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance)[0]??null;}
 emitRaceEvent(type,data={}){this.raceEvents.push({time:this.elapsedTime,remaining:this.raceClock.remainingDistance,type,...data});}
 updatePacer(dt){
  if(this.pacer.state===PACER_STATE.EXITED)return;

  this.pacer.distance+=this.pacer.speed*dt;

  // PacerLeaveLine: leave the racing line BEFORE the bell.
  if(this.raceClock.events.PacerLeaveLine.fired&&this.pacer.state===PACER_STATE.LEADING){
   this.pacer.state=PACER_STATE.EXITING;
   this.emitRaceEvent('PACER_EXIT_START',{distance:this.pacer.distance});
  }

  if(this.pacer.state===PACER_STATE.EXITING){
   this.pacer.exitProgress=Math.min(1,this.pacer.exitProgress+0.9*dt);
   const eased=this.pacer.exitProgress*this.pacer.exitProgress*(3-2*this.pacer.exitProgress);

   // Existing renderer convention: negative laneOffset moves the pacer inward.
   this.pacer.laneOffset=-18-72*eased;

   // PacerExit is the timeline permission point. The state becomes EXITED only
   // after BOTH the physical exit animation and the PacerExit landmark are complete.
   if(this.raceClock.events.PacerExit.fired&&this.pacer.exitProgress>=1){
    this.pacer.state=PACER_STATE.EXITED;
    this.emitRaceEvent('PACER_EXIT_COMPLETE',{distance:this.pacer.distance});
   }
  }
 }
 lineLeader(lineId){return this.riders.find(r=>r.lineId===lineId&&r.lineOrder===0);}
 followSpeed(r,target,gap=9.5,maxPlus=3.5){if(!target||target.finished)return 10.5;const g=target.distance-r.distance;let v=target.speed;if(g<gap-2)v-=Math.min(2.0,(gap-2-g)*.32);else if(g>gap+3)v+=Math.min(maxPlus,(g-gap-3)*.30);return Math.max(0,v);}
 actionAndSpeed(r){
  const cmd=this.tacticalAI.decide(r,this);
  r.tacticalMode=cmd.mode;
  r.action=cmd.action;
  r.followTargetNumber=cmd.followTargetNumber??null;
  r.tacticalLaneTarget=Number.isFinite(cmd.lane)?cmd.lane:r.laneOffset;
  return cmd.speed;
 }
 set(r,a,v){r.action=a;return v;}
 laneTarget(r){
  return Number.isFinite(r.tacticalLaneTarget)?r.tacticalLaneTarget:r.laneOffset;
 }
 updateEnergy(r,desired,dt){
  const target=r.followTargetNumber?this.rider(r.followTargetNumber):null,g=target?target.distance-r.distance:999,draft=target&&g>5&&g<14&&Math.abs(target.laneOffset-r.laneOffset)<14?.28:0;
  const demand=Math.max(0,desired-10.5)/10.5;let factor=1;if(['MOVE_UP','ATTACK','CONTEST','DEFEND'].includes(r.action))factor=1.65;if(r.action==='BLOCK')factor=1.35;if(['RETREAT','FADE'].includes(r.action))factor=.50;if(['DIVE','FINAL_SPRINT'].includes(r.action))factor=1.40;
  const load=(.0024+.011*demand*demand)*factor*(1-draft)/(r.plan.endurance??1);
  const recovery=(r.action==='RETREAT'||(r.action==='FOLLOW'&&desired<=12.0))?0.010:0;
  r.load=load;r.drafting=draft>0;r.effort=demand;r.energy=clamp(r.energy-load*dt+recovery*dt,0,1);r.fatigue=1-r.energy;
 }
 move(r,desired,dt){
  let top=((r.plan.topSpeed??21)+(r.action.endsWith('_FOLLOW')?3.0:0))*(r.energy<.45?.72+.28*(r.energy/.45):1);desired=Math.min(desired,top);
  const prev=r.speed,followBoost=r.action.endsWith('_FOLLOW')?1.45:1,acc=(r.plan.acceleration??3.2)*followBoost*(.62+.38*Math.max(.30,r.energy));if(r.speed<desired)r.speed=Math.min(desired,r.speed+acc*dt);else { const braking=['RETREAT','FADE'].includes(r.action)?7.2:3.8; r.speed=Math.max(desired,r.speed-braking*dt); }
  const lt=this.laneTarget(r);const leader4Attack=r.lineId===1&&[SCENARIO_PHASE.LINE4_MAKURI,SCENARIO_PHASE.BANTE_BLOCK,SCENARIO_PHASE.FIVE_DIVE,SCENARIO_PHASE.FINAL].includes(this.scenario.phase);const lr=['MOVE_UP','ATTACK','CONTEST','BLOCK','DIVE'].includes(r.action)?3.4:(leader4Attack?3.6:2.0);r.laneOffset+=(lt-r.laneOffset)*clamp(lr*dt,0,1);
  let next=r.distance+r.speed*dt,target=r.followTargetNumber?this.rider(r.followTargetNumber):null;
  if(target&&!target.finished&&target.distance>r.distance&&!['MOVE_UP','ATTACK','CONTEST','BLOCK','DIVE','FINAL_SPRINT'].includes(r.action)){if(next>target.distance-5.8){next=target.distance-5.8;r.speed=Math.min(r.speed,target.speed);}}
  for(const o of this.riders){if(o===r||o.finished)continue;if(Math.abs(o.distance-next)<4&&Math.abs(o.laneOffset-r.laneOffset)<8){const out=['MOVE_UP','ATTACK','CONTEST','BLOCK','DIVE','FINAL_SPRINT'].includes(r.action);r.laneOffset+=(clamp(o.laneOffset+(out?11:-11),-18,46)-r.laneOffset)*clamp(5*dt,0,1);}}
  r.distance=next;r.acceleration=(r.speed-prev)/Math.max(dt,1e-6);
 }
 recordFinish(r){r.distance=this.totalDistance;r.finished=true;r.finishTime=this.elapsedTime;this.ranking.push({rank:0,number:r.number,lineId:r.lineId,time:r.finishTime,margin:''});}
 finalize(){this.ranking.sort((a,b)=>a.time-b.time||a.number-b.number);const w=this.ranking[0]?.time??0;this.ranking.forEach((x,i)=>{x.rank=i+1;const m=(x.time-w)*10.5;x.margin=i===0?'先頭':m<.12?'ハナ':m<.25?'アタマ':m<.7?'1/2車身':m<1.1?'1車身':`${m.toFixed(1)}車身`;});}
 recordHistory(){const s=[...this.riders].sort((a,b)=>b.distance-a.distance),pm=new Map(s.map((r,i)=>[r.number,i+1]));for(const r of this.riders){r.history.push({time:this.elapsedTime,distance:r.distance,speed:r.speed,acceleration:r.acceleration,laneOffset:r.laneOffset,position:pm.get(r.number),action:r.action,tacticalMode:r.tacticalMode,followTargetNumber:r.followTargetNumber,energy:r.energy,fatigue:r.fatigue,drafting:r.drafting,scenarioPhase:this.scenario.phase});if(r.history.length>2000)r.history.shift();}}
 update(dt){
  if(!this.isStarted)return;const fd=clamp(Number(dt)||0,0,.1)*this.timeScale,steps=Math.max(1,Math.ceil(fd/(1/120))),sd=fd/steps;
  for(let k=0;k<steps;k++){this.elapsedTime+=sd;this.updatePacer(sd);this.scenario.update(sd,this);const desired=new Map();for(const r of this.riders)if(!r.finished)desired.set(r.number,this.actionAndSpeed(r));for(const r of this.riders){if(r.finished)continue;this.updateEnergy(r,desired.get(r.number),sd);const before=r.distance;this.move(r,desired.get(r.number),sd);if(before<this.totalDistance&&r.distance>=this.totalDistance)this.recordFinish(r);}const ld=this.riders.reduce((m,r)=>Math.max(m,r.distance),0),tr=this.raceClock.update(this.pacer.distance,ld,this);if(tr.includes('Bell')){this.bellRung=true;this.onBellCallback?.();}}
  this.recordHistory();if(this.riders.every(r=>r.finished)){this.isStarted=false;this.currentState='FINISHED';this.finalize();this.onFinishCallback?.(this.ranking.map(x=>({...x})));}
 }
 getDiagnostics(){const gaps=[];for(const r of this.riders){const f=r.followTargetNumber?this.rider(r.followTargetNumber):null;if(f&&!r.finished&&!f.finished&&f.distance>r.distance)gaps.push({number:r.number,frontNumber:f.number,gap:f.distance-r.distance});}return{gaps,minGap:gaps.length?Math.min(...gaps.map(x=>x.gap)):null,maxGap:gaps.length?Math.max(...gaps.map(x=>x.gap)):null};}
 getState(){return{riders:this.riders,pacer:this.pacer,ranking:this.ranking,isStarted:this.isStarted,currentState:this.currentState,elapsedTime:this.elapsedTime,totalDistance:this.totalDistance,bellRung:this.bellRung,diagnostics:this.getDiagnostics(),raceClock:this.raceClock,timeline:this.raceClock.getTimelineState(),raceEvents:this.raceEvents,scenario:{phase:this.scenario.phase,flags:{...this.scenario.flags}}};}
}
