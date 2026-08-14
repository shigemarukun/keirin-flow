import { normalizeRaceSetup, DEFAULT_RACE_SETUP, ACTION, ROLE, PROTOCOL_STATE, LINE_FOLLOW_MODE, TRACK_LANE } from './race-plan.js';
import { LineManager } from './line-manager.js';
import { TenkaiPredictor } from './tenkai-predictor.js';
import { KeirinProtocolController } from './keirin-protocol-controller.js';
import { ScenarioPhaseManager } from './scenario-phase-manager.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const PACER_STATE=Object.freeze({LEADING:'LEADING',EXITING:'EXITING',EXITED:'EXITED'});
const CAR_STYLES=Object.freeze({
1:{background:'#ffffff',text:'#111111'},2:{background:'#222222',text:'#ffffff'},3:{background:'#e60012',text:'#ffffff'},
4:{background:'#0068b7',text:'#ffffff'},5:{background:'#ffd400',text:'#111111'},6:{background:'#00a651',text:'#ffffff'},
7:{background:'#f08300',text:'#111111'},8:{background:'#ff69b4',text:'#111111'},9:{background:'#7f3fbf',text:'#ffffff'}});

export const RACE_PROFILES=Object.freeze({
 PROFILE_400:Object.freeze({TRACK_LENGTH:400,RACE_DISTANCE:800,FORMATION_SPEED:10.5,Bell:600,FinalLap:400,FinalBack:200,Finish:0})
});

class RaceClock{
 constructor(config){this.config=config;this.reset();}
 reset(){this.owner='PACER';this.referenceDistance=0;this.remainingDistance=this.config.RACE_DISTANCE;this.currentLap=2;this.firedEventSequence=[];this.events={Bell:false,FinalLap:false,FinalBack:false,Finish:false};}
 update(pacerDistance,leaderDistance,engine){
  if(engine.pacer.state===PACER_STATE.EXITED)this.owner='LEADER';
  const candidate=this.owner==='PACER'?pacerDistance:leaderDistance;
  this.referenceDistance=Math.max(this.referenceDistance,candidate);
  this.remainingDistance=Math.max(0,this.config.RACE_DISTANCE-this.referenceDistance);
  this.currentLap=this.remainingDistance>this.config.TRACK_LENGTH?2:1;
  const out=[];
  for(const [name,threshold] of [['Bell',this.config.Bell],['FinalLap',this.config.FinalLap],['FinalBack',this.config.FinalBack],['Finish',0]]){
   if(!this.events[name]&&this.remainingDistance<=threshold){this.events[name]=true;this.firedEventSequence.push(name);out.push(name);}
  }
  return out;
 }
}

export class PhysicsEngine{
 constructor(setup=DEFAULT_RACE_SETUP){
  this.timeScale=1;this.onBellCallback=null;this.onFinishCallback=null;
  this.tenkaiPredictor=new TenkaiPredictor();
  this.keirinProtocol=new KeirinProtocolController();
  this.scenarioPhaseManager=new ScenarioPhaseManager();
  this.applyRaceSetup(setup);
 }

 applyRaceSetup(setup){
  this.setup=normalizeRaceSetup(setup);
  this.profile=RACE_PROFILES[this.setup.trackProfile]??RACE_PROFILES.PROFILE_400;
  this.totalDistance=this.profile.RACE_DISTANCE;
  this.lineManager=new LineManager(this.setup);
  this.raceClock=new RaceClock(this.profile);
  this.prediction=this.tenkaiPredictor.predict(this.setup,this.lineManager);
  this._buildRiders();
  this.reset();
 }

 _buildRiders(){
  const ordered=[];
  for(const line of this.lineManager.linesArray())ordered.push(...line.members);
  for(let number=1;number<=9;number+=1)if(!ordered.includes(number))ordered.push(number);

  this.riders=ordered.map((number,index)=>{
   const ctx=this.lineManager.context(number);
   const profile=this.setup.riders[number];
   return {number,globalIndex:index,style:CAR_STYLES[number],profile,mindset:profile.mindset,soloMindset:profile.soloMindset,
    lineId:ctx.lineId,role:ctx.role,linePosition:ctx.linePosition,leaderNumber:ctx.leaderNumber,frontLineMate:ctx.frontLineMate,rearLineMate:ctx.rearLineMate,
    initialDistance:-14-index*17,distance:-14-index*17,speed:this.profile.FORMATION_SPEED,acceleration:0,laneOffset:-18,action:ACTION.FORMATION,
    followTargetNumber:null,energy:1,finished:false,finishTime:null,history:[]};
  });
 }

 reset(setup=null){
  if(setup){this.applyRaceSetup(setup);return;}
  this.isStarted=false;this.elapsedTime=0;this.ranking=[];this.raceEvents=[];this.decisionLogs=[];this.bellRung=false;this.establishedFrontLineId=null;this.settlingLineId=null;this.raceClock.reset();
  this.pacer={distance:0,speed:this.profile.FORMATION_SPEED,state:PACER_STATE.LEADING,laneOffset:-18,exitProgress:0};
  for(const r of this.riders){r.distance=r.initialDistance;r.speed=this.profile.FORMATION_SPEED;r.acceleration=0;r.laneOffset=-18;r.action=ACTION.FORMATION;r.followTargetNumber=null;r.energy=1;r.finished=false;r.finishTime=null;r.history=[];r.raceIntent=null;r.lastDecisionAction=null;r.lastDecisionLogTime=null;}
  this.keirinProtocol.initialize(this,this.prediction);
  this.scenarioPhaseManager.initialize(this);
 }

 start(){if(this.riders.every(r=>r.finished))this.reset();this.isStarted=true;}
 pause(){this.isStarted=false;}
 setSpeedScale(v){this.timeScale=clamp(Number(v)||1,.5,3);}
 onBell(cb){this.onBellCallback=cb;}
 onFinish(cb){this.onFinishCallback=cb;}
 rider(n){return this.riders.find(r=>r.number===n)??null;}
 emitRaceEvent(type,data={}){this.raceEvents.push({time:this.elapsedTime,remaining:this.raceClock.remainingDistance,type,...data});}
 emitDecision(entry={}){
  const item={
   id:this.decisionLogs.length+1,
   time:this.elapsedTime,
   remaining:this.raceClock.remainingDistance,
   riderNumber:entry.riderNumber??null,
   category:entry.category??'AI_DECISION',
   action:entry.action??null,
   protocolState:entry.protocolState??this.keirinProtocol?.state??null,
   message:entry.message??''
  };
  const previous=this.decisionLogs[this.decisionLogs.length-1];
  if(previous&&previous.riderNumber===item.riderNumber&&previous.category===item.category&&previous.message===item.message&&Math.abs(previous.time-item.time)<.35)return;
  this.decisionLogs.push(item);
  if(this.decisionLogs.length>160)this.decisionLogs.shift();
 }
 getPrediction(){return structuredClone(this.prediction);}

 findNearestAhead(rider){
  return [...this.riders].filter(r=>!r.finished&&r.number!==rider.number&&r.distance>rider.distance)
   .sort((a,b)=>(a.distance-rider.distance)-(b.distance-rider.distance))[0]??null;
 }
 findNearestBehind(rider){
  return [...this.riders].filter(r=>!r.finished&&r.number!==rider.number&&r.distance<rider.distance)
   .sort((a,b)=>(rider.distance-a.distance)-(rider.distance-b.distance))[0]??null;
 }
 positionRank(rider){return [...this.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance).findIndex(r=>r.number===rider.number)+1;}
 getRaceLeader(){return [...this.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance)[0]??null;}
 hasClearedField(rider,clearance=6){
  const active=[...this.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance);
  if(active[0]?.number!==rider.number)return false;
  const nearestOpponent=active.find(other=>other.number!==rider.number&&other.lineId!==rider.lineId);
  if(!nearestOpponent)return true;
  return rider.distance-nearestOpponent.distance>=clearance;
 }
 detectEstablishedFrontLine(){
  const leader=this.getRaceLeader();
  if(!leader?.lineId)return null;
  if(Math.abs(leader.laneOffset-TRACK_LANE.INNER)>3)return null;
  if(!this.hasClearedField(leader,5))return null;
  if(this.measureLineIntegrity(leader.lineId)<.55)return null;
  return leader.lineId;
 }
 findSettleTargetForLine(lineId){
  const myLeader=this.rider(this.lineManager.leaderNumber(lineId));
  if(!myLeader||myLeader.finished)return null;
  const candidates=this.lineManager.linesArray().filter(line=>line.id!==lineId).map(line=>{
   const members=line.members.map(n=>this.rider(n)).filter(r=>r&&!r.finished);
   if(!members.length)return null;
   const tail=[...members].sort((a,b)=>a.distance-b.distance)[0];
   return {tail,gap:tail.distance-myLeader.distance};
  }).filter(item=>item&&item.gap>6).sort((a,b)=>a.gap-b.gap);
  return candidates[0]?.tail??null;
 }
 getLineFollowMode(rider){
  if([ACTION.ATTACK,ACTION.CONTEST,ACTION.FULL_CONTEST,ACTION.BLOCK,ACTION.SWITCH_TO_SELF_POWER,ACTION.FINAL_SPRINT].includes(rider.action))return LINE_FOLLOW_MODE.FREE;
  const frontNumber=rider.frontLineMate;
  if(!frontNumber)return LINE_FOLLOW_MODE.FREE;
  const front=this.rider(frontNumber);
  if(!front||front.finished)return LINE_FOLLOW_MODE.FREE;
  const gap=front.distance-rider.distance;
  if(gap>28||gap<=0)return LINE_FOLLOW_MODE.FREE;
  if(rider.lineId===this.settlingLineId||Math.abs(front.laneOffset-rider.laneOffset)>6)return LINE_FOLLOW_MODE.SETTLING;
  return LINE_FOLLOW_MODE.LOCKED_FOLLOW;
 }
 laneDensityAround(rider,lane){
  let score=0;
  for(const other of this.riders){if(other.number===rider.number||other.finished)continue;const longitudinal=Math.abs(other.distance-rider.distance),lateral=Math.abs(other.laneOffset-lane);if(longitudinal<28&&lateral<9)score+=1-(longitudinal/28)*.55;}
  return score;
 }
 measureLineIntegrity(lineId){
  if(!lineId)return 0;
  const members=this.lineManager.members(lineId).map(n=>this.rider(n)).filter(Boolean);
  if(members.length<=1)return 1;
  let error=0,count=0;
  for(let i=1;i<members.length;i++){error+=Math.abs((members[i-1].distance-members[i].distance)-17);count++;}
  return clamp(1-(error/Math.max(1,count))/24,0,1);
 }

 findNearestAttacker(rider){
  const candidates=this.riders.filter(other=>{
   if(other.finished||other.number===rider.number)return false;
   if(other.lineId&&rider.lineId&&other.lineId===rider.lineId)return false;
   return [ACTION.ATTACK,ACTION.CONTEST,ACTION.FULL_CONTEST,ACTION.SWITCH_TO_SELF_POWER].includes(other.action);
  });
  const other=candidates.sort((a,b)=>Math.abs(a.distance-rider.distance)-Math.abs(b.distance-rider.distance))[0];
  if(!other)return null;
  return {rider:other,distanceGap:rider.distance-other.distance,outside:other.laneOffset>rider.laneOffset+5,closingSpeed:other.speed-rider.speed};
 }

 measureOutsidePressure(rider){
  let pressure=0;
  for(const other of this.riders){
   if(other.finished||other.number===rider.number||other.laneOffset<=rider.laneOffset+5)continue;
   const gap=rider.distance-other.distance;
   if(gap>-8&&gap<30)pressure+=clamp((30-gap)/30,0,1)*clamp((other.speed-rider.speed+4)/8,0,1);
  }
  return clamp(pressure,0,1);
 }

 findIncomingThreat(rider){
  const threats=this.riders.filter(other=>{
   if(other.finished||other.number===rider.number)return false;
   if(other.lineId&&rider.lineId&&other.lineId===rider.lineId)return false;
   const distance=rider.distance-other.distance,closing=other.speed-rider.speed;
   return distance>-6&&distance<34&&closing>.8;
  }).map(other=>({rider:other,distance:rider.distance-other.distance,closingSpeed:other.speed-rider.speed}));
  return threats.sort((a,b)=>a.distance-b.distance)[0]??null;
 }

 chooseOvertakeLane(rider){
  const candidates=[];
  for(let lane=-18;lane<=42;lane+=10){const density=this.laneDensityAround(rider,lane),movement=Math.abs(lane-rider.laneOffset)/60;candidates.push({lane,score:density+movement*.35});}
  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0]?.lane??rider.laneOffset;
 }

 scoreBestAttachTarget(rider){
  let best=null;
  for(const line of this.lineManager.linesArray()){
   const members=line.members.map(n=>this.rider(n)).filter(r=>r&&!r.finished);
   if(!members.length)continue;
   const leader=this.rider(line.leader),tail=members[members.length-1];
   const positionScore=1-clamp(this.positionRank(tail)/9,0,1),density=this.laneDensityAround(rider,tail.laneOffset),stability=this.measureLineIntegrity(line.id);
   const score=(leader?.energy??0)*.25+(leader?.speed??0)/30*.20+positionScore*.25+stability*.15-density*.15;
   if(!best||score>best.score)best={score,targetNumber:tail.number,laneOffset:tail.laneOffset};
  }
  return best;
 }

 followDesiredSpeed(rider,target,modeOverride=null){
  const gap=target.distance-rider.distance,desiredGap=rider.profile.idealGap??17,gapError=gap-desiredGap,relative=target.speed-rider.speed;
  const mode=modeOverride??this.getLineFollowMode(rider);
  let kp=.23,kd=.75,minAccel=-2.6,maxAccel=3;
  if(mode===LINE_FOLLOW_MODE.SETTLING){kp=.32;kd=.88;minAccel=-3;maxAccel=3.5;}
  else if(mode===LINE_FOLLOW_MODE.LOCKED_FOLLOW){kp=.38;kd=.94;minAccel=-3.2;maxAccel=3.8;}
  const acceleration=clamp(gapError*kp+relative*kd,minAccel,maxAccel);
  return clamp(rider.speed+acceleration,0,rider.profile.topSpeed+2.5);
 }

 _canPacerExit(){
  return this.scenarioPhaseManager?.canPacerExit(this) ?? false;
 }
 _updatePacer(dt){
  if(this.pacer.state===PACER_STATE.EXITED)return;
  this.pacer.distance+=this.pacer.speed*dt;

  if(this.pacer.state===PACER_STATE.LEADING&&this._canPacerExit()){
   this.pacer.state=PACER_STATE.EXITING;
   this.emitRaceEvent('PACER_EXIT_START',{attacker:this.keirinProtocol.pacerCutLeaderNumber,defender:this.keirinProtocol.frontLeaderNumber});
   this.emitDecision({category:'PACER',message:'誘導切り攻防が成立したため誘導員が退避開始'});
  }

  if(this.pacer.state===PACER_STATE.EXITING){
   this.pacer.exitProgress=Math.min(1,this.pacer.exitProgress+.85*dt);
   const e=this.pacer.exitProgress*this.pacer.exitProgress*(3-2*this.pacer.exitProgress);
   this.pacer.laneOffset=-18-72*e;
   if(this.pacer.exitProgress>=1){
    this.pacer.state=PACER_STATE.EXITED;
    this.emitRaceEvent('PACER_EXIT_COMPLETE',{});
    this.emitDecision({category:'PACER',message:'誘導員の退避完了。先頭選手基準へ移行'});
   }
  }
 }
 _applyEnergy(rider,plan,dt){
  const demand=Math.max(0,plan.targetSpeed-this.profile.FORMATION_SPEED)/this.profile.FORMATION_SPEED;
  let factor=1;
  if([ACTION.ATTACK,ACTION.CONTEST,ACTION.FULL_CONTEST,ACTION.DEFEND,ACTION.SWITCH_TO_SELF_POWER].includes(plan.action))factor=1.55;
  if(plan.action===ACTION.BLOCK)factor=1.30;
  if([ACTION.SAVE_ENERGY,ACTION.YIELD,ACTION.RETREAT].includes(plan.action))factor=.55;
  const load=(.0022+.0105*demand*demand)*factor/Math.max(.55,rider.profile.endurance);
  rider.energy=clamp(rider.energy-load*dt,0,1);
 }

 _move(rider,plan,dt){
  rider.action=plan.action;rider.followTargetNumber=plan.followTargetNumber??null;
  let desired=plan.targetSpeed;
  // Scenario plans already encode the intended fatigue outcome. Do not let the
  // legacy autonomous-energy limiter contradict the teacher scenario.
  if(!plan.scenarioControlled && rider.energy<.18)
    desired=Math.min(desired,rider.profile.topSpeed*(.72+1.2*rider.energy));
  const prev=rider.speed;
  const naturalAccel=(rider.profile.baseAcceleration??4)*(.65+.55*rider.profile.acceleration);
  const accelBase=Math.min(plan.maxAccel??naturalAccel,naturalAccel*1.55);
  const naturalBrake=plan.action===ACTION.RETREAT?2.4:plan.action===ACTION.YIELD?2.0:3.7;
  const braking=Math.min(plan.maxBrake??naturalBrake,4.4);
  // Inertial integration: targets may jump at a phase boundary, rider speed may not.
  if(rider.speed<desired)rider.speed=Math.min(desired,rider.speed+accelBase*dt);
  else rider.speed=Math.max(desired,rider.speed-braking*dt);

  const followMode=plan.followMode??this.getLineFollowMode(rider);
  let laneRate=plan.laneRate??1.7;
  if(plan.laneRate==null){
   if(followMode===LINE_FOLLOW_MODE.LOCKED_FOLLOW)laneRate=4.2;
   else if(followMode===LINE_FOLLOW_MODE.SETTLING)laneRate=3.4;
   else if(plan.action===ACTION.BLOCK)laneRate=.95;
   else if([ACTION.ATTACK,ACTION.CONTEST,ACTION.FULL_CONTEST,ACTION.SWITCH_TO_SELF_POWER].includes(plan.action))laneRate=2.5;
  }
  rider.laneOffset+=(plan.laneTarget-rider.laneOffset)*clamp(laneRate*dt,0,1);

  let next=rider.distance+rider.speed*dt;
  const target=rider.followTargetNumber?this.rider(rider.followTargetNumber):null;
  if(target&&!target.finished&&target.distance>rider.distance&&plan.action===ACTION.FOLLOW){
   // Line-follow safety envelope. The spring controller does the real work;
   // this is only a sub-step guard and never changes speed instantaneously.
   const minGap=13.5;
   if(next>target.distance-minGap)next=target.distance-minGap;
  }

  // Soft geometric guard: no billiard-style impulse and no instant speed rewrite.
  // A sub-step may be shortened by at most the distance travelled in that sub-step.
  for(const other of this.riders){
   if(other.number===rider.number||other.finished)continue;
   const sameCorridor=Math.abs(other.laneOffset-rider.laneOffset)<7;
   const otherAhead=other.distance>rider.distance;
   if(sameCorridor&&otherAhead&&other.distance-next<7.0){
    next=Math.min(next,other.distance-7.0);
   }
  }

  rider.distance=next;rider.acceleration=(rider.speed-prev)/Math.max(dt,1e-6);
 }

 _recordFinish(rider){rider.distance=this.totalDistance;rider.finished=true;rider.finishTime=this.elapsedTime;this.ranking.push({rank:0,number:rider.number,lineId:rider.lineId,time:rider.finishTime,margin:''});}
 _finalizeRanking(){this.ranking.sort((a,b)=>a.time-b.time||a.number-b.number);this.ranking.forEach((item,index)=>{item.rank=index+1;item.margin=index===0?'先頭':'';});}

 update(dt){
  if(!this.isStarted)return;
  const frameDt=clamp(Number(dt)||0,0,.1)*this.timeScale,steps=Math.max(1,Math.ceil(frameDt/(1/120))),stepDt=frameDt/steps;
  for(let step=0;step<steps;step++){
   this.elapsedTime+=stepDt;
   // CR-0010: scenario grammar owns tactical intent. Physics only interpolates it.
   this.scenarioPhaseManager.update(this,stepDt);
   this._updatePacer(stepDt);
   const plans=new Map();
   for(const rider of this.riders)if(!rider.finished)plans.set(rider.number,this.scenarioPhaseManager.plan(rider,this));
   for(const rider of this.riders){
    if(rider.finished)continue;
    const plan=plans.get(rider.number);this._applyEnergy(rider,plan,stepDt);const before=rider.distance;this._move(rider,plan,stepDt);
    if(before<this.totalDistance&&rider.distance>=this.totalDistance)this._recordFinish(rider);
   }
   const leaderDistance=this.riders.reduce((m,r)=>Math.max(m,r.distance),0),triggered=this.raceClock.update(this.pacer.distance,leaderDistance,this);
   if(triggered.includes('Bell')){this.bellRung=true;this.emitDecision({category:'BELL',message:'打鐘。フェーズ駆動シナリオを継続'});this.onBellCallback?.();}
  }
  if(this.riders.every(r=>r.finished)){this.isStarted=false;this._finalizeRanking();this.onFinishCallback?.(this.ranking.map(x=>({...x})));}
 }

 getDiagnostics(){
  const gaps=[];
  for(const rider of this.riders){
   if(rider.finished)continue;
   const target=rider.followTargetNumber?this.rider(rider.followTargetNumber):null;
   if(target&&!target.finished&&target.distance>rider.distance){
    gaps.push({number:rider.number,frontNumber:target.number,gap:target.distance-rider.distance});
   }
  }
  return {gaps,minGap:gaps.length?Math.min(...gaps.map(x=>x.gap)):null,maxGap:gaps.length?Math.max(...gaps.map(x=>x.gap)):null};
 }

 getState(){return{riders:this.riders,pacer:this.pacer,ranking:this.ranking,isStarted:this.isStarted,elapsedTime:this.elapsedTime,totalDistance:this.totalDistance,bellRung:this.bellRung,diagnostics:this.getDiagnostics(),raceClock:this.raceClock,raceEvents:this.raceEvents,decisionLogs:this.decisionLogs,prediction:this.prediction,scenario:this.scenarioPhaseManager.state(),protocol:{state:this.keirinProtocol.state,pacerCutLineId:this.keirinProtocol.pacerCutLineId,frontLineId:this.keirinProtocol.frontLineId,pacerCutLeaderNumber:this.keirinProtocol.pacerCutLeaderNumber,frontLeaderNumber:this.keirinProtocol.frontLeaderNumber,frontResponse:this.keirinProtocol.frontResponse},setup:this.setup,lines:this.lineManager.linesArray()};}
}
