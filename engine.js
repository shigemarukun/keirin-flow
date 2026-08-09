import { ACTION, FOLLOW_STATUS, TACTIC, DEFAULT_RIDER_CAPABILITY } from './tactics.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';
import { INTERACTION_RULES } from './rules.js';

const CAR_STYLES = Object.freeze({
    1:{background:'#ffffff',text:'#111111'},2:{background:'#222222',text:'#ffffff'},3:{background:'#e60012',text:'#ffffff'},
    4:{background:'#0068b7',text:'#ffffff'},5:{background:'#ffd400',text:'#111111'},6:{background:'#00a651',text:'#ffffff'},
    7:{background:'#f08300',text:'#111111'},8:{background:'#ff69b4',text:'#111111'},9:{background:'#7f3fbf',text:'#ffffff'}
});

const RACE_STATE = Object.freeze({ POSITION_BATTLE:'POSITION_BATTLE', FINAL:'FINAL', FINISHED:'FINISHED' });
const PACER_STATE = Object.freeze({ LEADING:'LEADING', EXITING:'EXITING', EXITED:'EXITED' });
const CLOCK_OWNER = Object.freeze({ PACER:'PACER', LEADER:'LEADER' });
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

export const RACE_PROFILES = Object.freeze({
    PROFILE_400:{TRACK_LENGTH:400,RACE_DISTANCE:800,FORMATION_SPEED:10.5,PacerLeaveLine:620,Bell:600,PacerExit:560,FinalLap:400,FinalBack:200,Finish:0}
});
export const RACE_CONFIG=RACE_PROFILES.PROFILE_400;

export class RaceClock {
    constructor(config=RACE_CONFIG){
        this.config=config;this.trackLength=config.TRACK_LENGTH;this.totalDistance=config.RACE_DISTANCE;
        this.events={
            PacerLeaveLine:{fired:false,condition:c=>c.remainingDistance<=config.PacerLeaveLine},
            Bell:{fired:false,condition:c=>c.remainingDistance<=config.Bell},
            PacerExit:{fired:false,condition:c=>c.remainingDistance<=config.PacerExit},
            FinalLap:{fired:false,condition:c=>c.remainingDistance<=config.FinalLap},
            FinalBack:{fired:false,condition:c=>c.remainingDistance<=config.FinalBack},
            Finish:{fired:false,condition:c=>c.remainingDistance<=0}
        };this.reset();
    }
    update(pacerDistance,leaderDistance,engine){
        if(engine.pacer.state===PACER_STATE.EXITED)this.owner=CLOCK_OWNER.LEADER;
        const candidate=this.owner===CLOCK_OWNER.PACER?pacerDistance:leaderDistance;
        this.referenceDistance=Math.max(this.referenceDistance,candidate);
        this.remainingDistance=Math.max(0,this.totalDistance-this.referenceDistance);
        this.currentLap=this.remainingDistance>this.trackLength?2:1;
        const order=['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish'];const triggered=[];
        for(const name of order){const ev=this.events[name];if(!ev.fired&&ev.condition(this,engine)){ev.fired=true;triggered.push(name);this.firedEventSequence.push(name);}}
        return triggered;
    }
    reset(){this.owner=CLOCK_OWNER.PACER;this.referenceDistance=0;this.remainingDistance=this.totalDistance;this.currentLap=2;this.firedEventSequence=[];for(const ev of Object.values(this.events))ev.fired=false;}
}

export class PhysicsEngine {
    constructor(lineGroups,lineOffsets=[-18,-6,6,18],profile=RACE_CONFIG,racePlan=DEFAULT_RACE_PLAN){
        this.lineGroups=lineGroups.map(g=>[...g]);this.lineOffsets=[...lineOffsets];this.profile=profile;this.totalDistance=profile.RACE_DISTANCE;
        this.racePlan=racePlan;this.rules=INTERACTION_RULES;this.timeScale=1;this.onBellCallback=null;this.onFinishCallback=null;
        this.RACE_STATE=RACE_STATE;this.PACER_STATE=PACER_STATE;this.raceClock=new RaceClock(profile);this.raceEvents=[];this._buildRiders();this.reset();
    }

    _buildRiders(){
        this.riders=[];let globalIndex=0;
        this.lineGroups.forEach((group,lineId)=>group.forEach((number,lineOrder)=>{
            const plan=this.racePlan[number]??{tactic:TACTIC.HOLD};
            const roleDefaults={acceleration:lineOrder===0?3.2:(lineOrder===1?3.6:3.45),response:lineOrder===0?1.0:1.04,topSpeed:lineOrder===0?21.0:(lineOrder===1?21.7:21.2)};
            const capability={...DEFAULT_RIDER_CAPABILITY,...roleDefaults,...(plan.capability??{})};
            const initialDistance=-14-globalIndex*17;
            this.riders.push({
                number,lineId,lineOrder,globalIndex,isLeader:lineOrder===0,lineFrontNumber:lineOrder>0?group[lineOrder-1]:null,
                initialDistance,initialLaneOffset:-18,baseLaneOffset:this.lineOffsets[lineId%this.lineOffsets.length],style:CAR_STYLES[number]??CAR_STYLES[1],
                plan,capability,distance:initialDistance,speed:this.profile.FORMATION_SPEED,acceleration:0,laneOffset:-18,
                action:ACTION.FORMATION,followTargetNumber:plan.followNumber??(lineOrder>0?group[lineOrder-1]:null),followStatus:lineOrder===0?FOLLOW_STATUS.LEADER:FOLLOW_STATUS.ATTACHED,
                detachedTime:0,attackCompleted:false,hasLed:false,energy:capability.energyCapacity,fatigue:0,effort:0,drafting:false,load:0,
                blockTimer:0,blockCooldown:0,blockTargetNumber:null,banteMakuriStarted:false,interference:0,finished:false,finishTime:null,history:[]
            });globalIndex+=1;
        }));
    }

    reset(){
        this.isStarted=false;this.elapsedTime=0;this.bellRung=false;this.currentState=RACE_STATE.POSITION_BATTLE;this.ranking=[];this.raceEvents=[];this.raceClock.reset();
        this.pacer={distance:0,speed:this.profile.FORMATION_SPEED,state:PACER_STATE.LEADING,laneOffset:-18,exitProgress:0};
        for(const r of this.riders){
            r.distance=r.initialDistance;r.speed=this.profile.FORMATION_SPEED;r.acceleration=0;r.laneOffset=r.initialLaneOffset;r.action=ACTION.FORMATION;
            r.followTargetNumber=r.plan.followNumber??r.lineFrontNumber;r.followStatus=r.isLeader?FOLLOW_STATUS.LEADER:FOLLOW_STATUS.ATTACHED;r.detachedTime=0;
            r.attackCompleted=false;r.hasLed=false;r.energy=r.capability.energyCapacity;r.fatigue=0;r.effort=0;r.drafting=false;r.load=0;
            r.blockTimer=0;r.blockCooldown=0;r.blockTargetNumber=null;r.banteMakuriStarted=false;r.interference=0;r.finished=false;r.finishTime=null;r.history=[];
        }
    }

    start(){if(this.riders.every(r=>r.finished))this.reset();this.isStarted=true;}
    pause(){this.isStarted=false;}
    setSpeedScale(scale){this.timeScale=clamp(Number(scale)||1,0.25,4);}
    onBell(cb){this.onBellCallback=cb;}
    onFinish(cb){this.onFinishCallback=cb;}
    _rider(n){return this.riders.find(r=>r.number===n)??null;}
    _line(lineId){return this.riders.filter(r=>r.lineId===lineId&&!r.finished).sort((a,b)=>a.lineOrder-b.lineOrder);}
    _frontOfLine(lineId){return [...this._line(lineId)].sort((a,b)=>b.distance-a.distance)[0]??null;}
    _raceLeader(){return [...this.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance)[0]??null;}
    _nearestExternalAhead(rider,maxGap=42){
        // When a self-powered rider is suppressed and '引く', it should settle
        // behind the tail of a passing line rather than splice itself between
        // that line's leader and bante.
        const tails=this.lineGroups.map((_,lineId)=>this._line(lineId).sort((a,b)=>b.lineOrder-a.lineOrder)[0]).filter(Boolean);
        return tails.filter(o=>o.lineId!==rider.lineId&&!o.finished&&o.distance>rider.distance).map(o=>({o,gap:o.distance-rider.distance,laneGap:Math.abs(o.laneOffset-rider.laneOffset)})).filter(x=>x.gap<=maxGap).sort((a,b)=>a.gap-b.gap||a.laneGap-b.laneGap)[0]?.o??null;
    }
    _emit(type,data={}){this.raceEvents.push({time:this.elapsedTime,remaining:this.raceClock.remainingDistance,type,...data});if(this.raceEvents.length>500)this.raceEvents.shift();}

    _updatePacer(dt){
        if(this.pacer.state===PACER_STATE.EXITED)return;this.pacer.distance+=this.pacer.speed*dt;
        if(this.raceClock.events.PacerLeaveLine.fired&&this.pacer.state===PACER_STATE.LEADING)this.pacer.state=PACER_STATE.EXITING;
        if(this.pacer.state===PACER_STATE.EXITING){const target=this.raceClock.events.PacerExit.fired?1:0.7;this.pacer.exitProgress=Math.min(target,this.pacer.exitProgress+0.8*dt);const e=this.pacer.exitProgress*this.pacer.exitProgress*(3-2*this.pacer.exitProgress);this.pacer.laneOffset=-18-72*e;if(this.raceClock.events.PacerExit.fired&&this.pacer.exitProgress>=1){this.pacer.state=PACER_STATE.EXITED;this.currentState=RACE_STATE.FINAL;}}
    }

    _isControllingLine(lineId){const raceLeader=this._raceLeader();const lineFront=this._frontOfLine(lineId);return !!(raceLeader&&lineFront&&lineFront.distance>=raceLeader.distance-2.5);}

    _findThreatForLine(lineId){
        const front=this._frontOfLine(lineId);if(!front)return null;const rr=this.rules.threat;
        const threats=this.riders.filter(r=>r.lineId!==lineId&&!r.finished&&(r.action===ACTION.ATTACK||r.action===ACTION.MOVE_UP))
            .map(r=>({r,gap:front.distance-r.distance,laneGap:Math.abs(r.laneOffset-front.laneOffset)}))
            .filter(x=>x.gap<=rr.detectBehind&&x.gap>=-rr.detectAhead&&x.laneGap<=rr.maxLaneGap)
            .sort((a,b)=>a.gap-b.gap||a.laneGap-b.laneGap);
        return threats[0]?.r??null;
    }

    _resolveLeaderAction(rider){
        const p=rider.plan;const remaining=this.raceClock.remainingDistance;const controlling=this._isControllingLine(rider.lineId);const threat=this._findThreatForLine(rider.lineId);
        if(p.preFollowNumber&&remaining<=p.preFollowTriggerRemaining&&remaining>p.triggerRemaining&&!rider.attackCompleted){rider.followTargetNumber=p.preFollowNumber;return ACTION.FOLLOW;}

        if((p.tactic===TACTIC.OSAE_SENKO||p.tactic===TACTIC.KAMASHI||p.tactic===TACTIC.NAKADAN_MAKURI||p.tactic===TACTIC.MAKURI)&&controlling)rider.hasLed=true;

        if(controlling&&threat&&p.defendOnThreat&&rider.energy>0.18){rider.blockTargetNumber=threat.number;return ACTION.DEFEND;}

        if(p.tactic===TACTIC.OSAE_SENKO){if(remaining<=p.settleRemaining)return ACTION.LEAD;if(remaining<=p.triggerRemaining)return ACTION.MOVE_UP;return ACTION.FORMATION;}
        if(p.tactic===TACTIC.TSUPPARI){if(threat&&remaining<=p.triggerRemaining)return ACTION.DEFEND;return remaining<=p.triggerRemaining?ACTION.LEAD:ACTION.FORMATION;}
        if(p.tactic===TACTIC.MAKURI||p.tactic===TACTIC.NAKADAN_MAKURI||p.tactic===TACTIC.KAMASHI){
            if(!rider.attackCompleted&&remaining<=p.triggerRemaining)return ACTION.ATTACK;
            if(rider.attackCompleted)return ACTION.LEAD;
            // A self-powered rider that has been suppressed does not remain a
            // virtual race leader.  It settles behind the nearest passing line
            // until its own attack trigger.  This is the foundation for
            // '抑えられて引く -> 中団/後方から再度仕掛ける'.
            if(this.pacer.state===PACER_STATE.EXITED){const ahead=this._nearestExternalAhead(rider,32);if(ahead){rider.followTargetNumber=ahead.number;return ACTION.FOLLOW;}}
            return ACTION.FORMATION;
        }
        return ACTION.FORMATION;
    }

    _canBanteMakuri(rider){
        if(rider.lineOrder!==1||!rider.plan.banteMakuriEnabled||rider.banteMakuriStarted)return false;
        const front=this._rider(rider.lineFrontNumber);if(!front||front.finished)return false;const r=this.rules.banteMakuri;
        return this.raceClock.remainingDistance<=r.remainingMax&&front.energy<=r.leaderEnergyMax&&rider.energy>=r.riderEnergyMin&&front.distance-rider.distance<=r.maxGapToLeader;
    }

    _canBlock(rider,threat){
        if(rider.lineOrder!==1||!rider.plan.blockEnabled||!threat||rider.blockCooldown>0||rider.energy<0.20)return false;
        const front=this._rider(rider.lineFrontNumber);if(!front||front.finished)return false;const rr=this.rules.threat;const gap=front.distance-threat.distance;
        return this._isControllingLine(rider.lineId)&&gap<=rr.blockStartGap&&gap>=-rr.blockEndAhead;
    }

    _shouldSwitch(rider){
        if(rider.lineOrder===0)return false;
        const current=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;
        if(current&&!current.finished){const gap=current.distance-rider.distance;if(gap>0&&gap<=this.rules.follow.stretchedGap)return false;}
        const original=this._rider(rider.lineFrontNumber);if(!original||original.finished)return true;
        const raceLeader=this._raceLeader();if(!raceLeader||raceLeader.lineId===rider.lineId)return false;
        return raceLeader.distance-original.distance>=this.rules.switch.leaderLostMargin&&raceLeader.distance-rider.distance<=this.rules.switch.candidateMaxAhead;
    }

    _findSwitchCandidate(rider){
        const s=this.rules.switch;return this.riders.filter(o=>o.number!==rider.number&&!o.finished&&o.lineId!==rider.lineId)
            .map(o=>({o,gap:o.distance-rider.distance,laneGap:Math.abs(o.laneOffset-rider.laneOffset)}))
            .filter(x=>x.gap>=s.candidateMinAhead&&x.gap<=s.candidateMaxAhead&&x.laneGap<=s.candidateMaxLaneGap)
            .sort((a,b)=>a.gap-b.gap||a.laneGap-b.laneGap)[0]?.o??null;
    }

    _updateActionAndFollow(rider,dt){
        rider.blockCooldown=Math.max(0,rider.blockCooldown-dt);
        if(rider.isLeader){rider.action=this._resolveLeaderAction(rider);}else{
            const threat=this._findThreatForLine(rider.lineId);
            if(rider.blockTimer>0){rider.blockTimer=Math.max(0,rider.blockTimer-dt);rider.action=ACTION.BLOCK;if(rider.blockTimer===0){rider.blockCooldown=this.rules.block.cooldownSeconds;rider.blockTargetNumber=null;}}
            else if(this._canBanteMakuri(rider)){rider.banteMakuriStarted=true;rider.followTargetNumber=null;rider.action=ACTION.BANTE_MAKURI;this._emit('BANTE_MAKURI',{rider:rider.number,lineId:rider.lineId});}
            else if(this._canBlock(rider,threat)){rider.blockTimer=this.rules.block.maxSeconds;rider.blockTargetNumber=threat.number;rider.action=ACTION.BLOCK;this._emit('BLOCK_START',{rider:rider.number,target:threat.number,lineId:rider.lineId});}
            else if(this._shouldSwitch(rider)){const c=this._findSwitchCandidate(rider);if(c){if(rider.followTargetNumber!==c.number)this._emit('SWITCH',{rider:rider.number,from:rider.followTargetNumber,to:c.number});rider.followTargetNumber=c.number;rider.followStatus=FOLLOW_STATUS.SWITCHED;rider.action=ACTION.SWITCH;}else rider.action=ACTION.FOLLOW;}
            else rider.action=ACTION.FOLLOW;
            if(!rider.followTargetNumber&&!rider.banteMakuriStarted)rider.followTargetNumber=rider.lineFrontNumber;
        }

        const p=rider.plan;
        if(rider.isLeader&&rider.action===ACTION.ATTACK){const targetLineFront=p.targetLineId!=null?this._frontOfLine(p.targetLineId):null;if(targetLineFront&&rider.distance>=targetLineFront.distance+(p.settleAfterPassMeters??6)){rider.attackCompleted=true;rider.hasLed=true;rider.action=ACTION.LEAD;this._emit('ATTACK_COMPLETED',{rider:rider.number,targetLineId:p.targetLineId});}}

        if(!rider.isLeader&&this.raceClock.remainingDistance<=this.rules.finalSprint.remainingMax&&rider.energy>=this.rules.finalSprint.energyMin&&rider.action===ACTION.FOLLOW){rider.action=ACTION.FINAL_SPRINT;}

        const target=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;if(!target||target.finished){if(!rider.isLeader&&!rider.banteMakuriStarted)rider.followStatus=FOLLOW_STATUS.DETACHED;return;}
        const gap=target.distance-rider.distance;if(gap>this.rules.follow.detachedGap){rider.followStatus=FOLLOW_STATUS.DETACHED;rider.detachedTime+=dt;}else if(gap>this.rules.follow.stretchedGap){rider.followStatus=FOLLOW_STATUS.STRETCHED;rider.detachedTime=Math.max(0,rider.detachedTime-dt*0.5);}else if(rider.followStatus!==FOLLOW_STATUS.SWITCHED){rider.followStatus=FOLLOW_STATUS.ATTACHED;rider.detachedTime=0;}
        if(!rider.isLeader&&rider.followStatus===FOLLOW_STATUS.DETACHED&&rider.detachedTime>this.rules.follow.switchAfterSeconds){const c=this._findSwitchCandidate(rider);if(c){this._emit('SWITCH',{rider:rider.number,from:rider.followTargetNumber,to:c.number});rider.followTargetNumber=c.number;rider.followStatus=FOLLOW_STATUS.SWITCHED;rider.action=ACTION.SWITCH;rider.detachedTime=0;}}
    }

    _draftFactor(rider){
        const t=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;if(!t||t.finished||t.distance<=rider.distance)return 0;const gap=t.distance-rider.distance,laneGap=Math.abs(t.laneOffset-rider.laneOffset);if(gap<4.8||gap>14||laneGap>17)return 0;
        return clamp((1-Math.min(1,Math.abs(gap-8.8)/5.2))*(1-Math.min(1,laneGap/17)),0,1);
    }
    _fatigueFactor(rider){const start=rider.capability.fatigueStart;if(rider.energy>=start)return 1;const ratio=clamp(rider.energy/Math.max(start,1e-6),0,1);return rider.capability.fatigueFloor+(1-rider.capability.fatigueFloor)*ratio;}
    _effectiveTopSpeed(rider){const f=this._fatigueFactor(rider);return Math.max(this.profile.FORMATION_SPEED*0.9,rider.capability.topSpeed*(0.70+0.30*f));}

    _updateEnergy(rider,desiredSpeed,dt){
        const c=rider.capability,base=this.profile.FORMATION_SPEED,draft=this._draftFactor(rider);rider.drafting=draft>0.12;
        const speedDemand=Math.max(0,desiredSpeed-base)/base;const accelDemand=Math.max(0,desiredSpeed-rider.speed)/Math.max(c.acceleration,0.1);
        const actionBase={
            [ACTION.FORMATION]:0.0015,[ACTION.FOLLOW]:0.0022,[ACTION.SWITCH]:0.0032,[ACTION.MOVE_UP]:0.0090,[ACTION.ATTACK]:0.0130,[ACTION.LEAD]:0.0066,[ACTION.DEFEND]:0.0140,[ACTION.BLOCK]:0.0100,[ACTION.BANTE_MAKURI]:0.0145,[ACTION.FINAL_SPRINT]:0.0170
        }[rider.action]??0.0024;
        const outer=Math.max(0,rider.laneOffset+18)/48;let load=actionBase*(1+1.45*speedDemand*speedDemand+0.62*accelDemand+outer*c.outerLaneCost);
        if(rider.action===ACTION.BLOCK)load*=1.10;load*=1+(rider.interference??0)*0.45;load*=1-draft*c.draftSaving;load/=Math.max(0.58,c.endurance);
        const easy=desiredSpeed<=base*1.06&&(rider.action===ACTION.FOLLOW||rider.action===ACTION.FORMATION);const recovery=easy?c.recoveryRate*(0.25+0.75*draft):0;
        rider.load=load;rider.effort=clamp(speedDemand+0.35*accelDemand,0,2);rider.energy=clamp(rider.energy-load*dt+recovery*dt,0,c.energyCapacity);rider.fatigue=1-rider.energy/c.energyCapacity;
    }

    _followDesiredSpeed(rider,target){
        const gap=target.distance-rider.distance;const desired=rider.lineOrder>=2?this.rules.follow.thirdGap:this.rules.follow.secondGap;const low=desired-this.rules.follow.toleranceBehind,high=desired+this.rules.follow.toleranceAhead;
        if(gap>=low&&gap<=high)return target.speed;const correction=gap<low?(gap-low)*0.20:(gap-high)*0.24;return clamp(target.speed+correction,Math.max(0,target.speed-1.0),target.speed+4.0);
    }

    _blockSpeedPenalty(attacker,desired){
        let adjusted=desired;attacker.interference=0;
        for(const blocker of this.riders.filter(r=>r.action===ACTION.BLOCK&&r.blockTargetNumber===attacker.number&&!r.finished)){
            const longitudinal=blocker.distance-attacker.distance;const lateral=Math.abs(blocker.laneOffset-attacker.laneOffset);
            // A bante rider does not need to be wheel-to-wheel before the block
            // matters: moving into the attacker's lane a few metres ahead forces
            // the attacker to check momentum or go farther outside.
            if(longitudinal>=0&&longitudinal<=20&&lateral<=25){
                const strength=clamp(blocker.capability.blockSkill,0.6,1.4);
                const proximity=1-longitudinal/20;const overlap=1-lateral/25;
                const pressure=clamp((0.35+0.65*proximity)*(0.30+0.70*overlap)*strength,0,1.25);
                attacker.interference=Math.max(attacker.interference,pressure);
                const cap=blocker.speed+Math.max(0.10,0.85*(longitudinal/20));
                adjusted=Math.min(adjusted,cap);
            }
        }
        return adjusted;
    }

    _desiredSpeed(rider){
        const p=rider.plan,base=this.profile.FORMATION_SPEED,top=this._effectiveTopSpeed(rider);let requested=base;
        if(rider.action===ACTION.MOVE_UP||rider.action===ACTION.ATTACK)requested=p.attackSpeed??base*1.65;
        else if(rider.action===ACTION.DEFEND)requested=p.defendSpeed??base*1.55;
        else if(rider.action===ACTION.LEAD)requested=p.leadSpeed??base*1.28;
        else if(rider.action===ACTION.BLOCK){const front=this._rider(rider.lineFrontNumber);const target=rider.blockTargetNumber?this._rider(rider.blockTargetNumber):null;requested=Math.max(front?.speed??base,Math.min(target?.speed??base,top));}
        else if(rider.action===ACTION.BANTE_MAKURI)requested=Math.min(top,base*1.92);
        else if(rider.action===ACTION.FINAL_SPRINT)requested=Math.min(top,base*2.02);
        else{const target=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;if(target&&!target.finished)requested=this._followDesiredSpeed(rider,target);else if(rider.isLeader){const gapError=(this.pacer.distance-14)-rider.distance;requested=clamp(this.pacer.speed+gapError*0.06,this.pacer.speed-0.4,this.pacer.speed+0.6);}else requested=base*1.15;}
        requested=Math.min(requested,top);if(rider.action===ACTION.ATTACK||rider.action===ACTION.MOVE_UP)requested=this._blockSpeedPenalty(rider,requested);return clamp(requested,0,top);
    }

    _targetLane(rider){
        if(rider.action===ACTION.MOVE_UP||rider.action===ACTION.ATTACK||rider.action===ACTION.BANTE_MAKURI)return rider.plan.attackLane??28;
        if(rider.action===ACTION.BLOCK){const target=rider.blockTargetNumber?this._rider(rider.blockTargetNumber):null;if(target)return clamp(target.laneOffset-this.rules.block.lateralTargetMargin,-18,this.rules.block.maxOuterOffset);}
        if(rider.action===ACTION.DEFEND||rider.action===ACTION.LEAD)return -18;
        const target=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;if(target)return target.laneOffset;return -18;
    }

    _move(rider,desiredSpeed,dt){
        const prev=rider.speed,f=this._fatigueFactor(rider);const accel=rider.capability.acceleration*rider.capability.response*(0.56+0.44*f),decel=rider.capability.deceleration;
        if(rider.speed<desiredSpeed)rider.speed=Math.min(desiredSpeed,rider.speed+accel*dt);else if(rider.speed>desiredSpeed)rider.speed=Math.max(desiredSpeed,rider.speed-decel*dt);
        const laneTarget=this._targetLane(rider);const laneRate=rider.action===ACTION.BLOCK?1.65:(rider.isLeader||rider.action===ACTION.BANTE_MAKURI?2.0:(rider.lineOrder>=2?1.08:1.35));rider.laneOffset+=(laneTarget-rider.laneOffset)*clamp(laneRate*dt,0,1);
        let next=rider.distance+rider.speed*dt;const target=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;const safety=this.rules.follow.safetyGap;
        if(target&&!target.finished&&target.distance>rider.distance&&rider.action!==ACTION.ATTACK&&rider.action!==ACTION.BANTE_MAKURI&&rider.action!==ACTION.FINAL_SPRINT){next=Math.min(next,target.distance-safety);if(next>=target.distance-safety&&rider.speed>target.speed)rider.speed=target.speed;}
        rider.distance=next;rider.acceleration=(rider.speed-prev)/Math.max(dt,1e-6);
    }

    _recordFinish(r){r.distance=this.totalDistance;r.finished=true;r.finishTime=this.elapsedTime;this.ranking.push({rank:0,number:r.number,lineId:r.lineId,time:r.finishTime,margin:''});}
    _finalizeRanking(){this.ranking.sort((a,b)=>a.time-b.time||a.number-b.number);const w=this.ranking[0]?.time??0;this.ranking.forEach((x,i)=>{x.rank=i+1;const m=(x.time-w)*10.5;x.margin=i===0?'先頭':m<0.12?'ハナ':m<0.25?'アタマ':m<0.7?'1/2車身':m<1.1?'1車身':`${m.toFixed(1)}車身`;});}

    _recordHistory(){const sorted=[...this.riders].sort((a,b)=>b.distance-a.distance);const pos=new Map(sorted.map((r,i)=>[r.number,i+1]));for(const r of this.riders){r.history.push({time:this.elapsedTime,distance:r.distance,speed:r.speed,acceleration:r.acceleration,laneOffset:r.laneOffset,position:pos.get(r.number),action:r.action,followTargetNumber:r.followTargetNumber,followStatus:r.followStatus,energy:r.energy,fatigue:r.fatigue,drafting:r.drafting,blockTargetNumber:r.blockTargetNumber});if(r.history.length>1800)r.history.shift();}}

    update(dt){
        if(!this.isStarted)return;const frameDt=clamp(Number(dt)||0,0,0.1)*this.timeScale,maxStep=1/120,steps=Math.max(1,Math.ceil(frameDt/maxStep)),stepDt=frameDt/steps;
        for(let step=0;step<steps;step++){
            this.elapsedTime+=stepDt;this._updatePacer(stepDt);
            // Decisions are made from the same pre-move state for all riders.
            for(const r of this.riders)if(!r.finished)this._updateActionAndFollow(r,stepDt);
            const desired=new Map();for(const r of this.riders)if(!r.finished)r.interference=0;for(const r of this.riders)if(!r.finished)desired.set(r.number,this._desiredSpeed(r));
            for(const r of this.riders){if(r.finished)continue;const prev=r.distance;this._updateEnergy(r,desired.get(r.number),stepDt);this._move(r,desired.get(r.number),stepDt);if(prev<this.totalDistance&&r.distance>=this.totalDistance)this._recordFinish(r);}
            const leaderDistance=this.riders.reduce((max,r)=>Math.max(max,r.distance),0);const triggered=this.raceClock.update(this.pacer.distance,leaderDistance,this);if(triggered.includes('Bell')){this.bellRung=true;this.onBellCallback?.();}
        }
        this._recordHistory();if(this.riders.every(r=>r.finished)){this.isStarted=false;this.currentState=RACE_STATE.FINISHED;this._finalizeRanking();this.onFinishCallback?.(this.ranking.map(x=>({...x})));}
    }

    getDiagnostics(){const gaps=this.riders.map(r=>({r,front:r.followTargetNumber?this._rider(r.followTargetNumber):null})).filter(x=>x.front&&!x.r.finished&&!x.front.finished&&x.front.distance>x.r.distance).map(x=>({number:x.r.number,frontNumber:x.front.number,gap:x.front.distance-x.r.distance}));return{gaps,minGap:gaps.length?Math.min(...gaps.map(x=>x.gap)):null,maxGap:gaps.length?Math.max(...gaps.map(x=>x.gap)):null,raceClock:{owner:this.raceClock.owner,remainingDistance:this.raceClock.remainingDistance,currentLap:this.raceClock.currentLap,eventsFired:Object.fromEntries(Object.entries(this.raceClock.events).map(([k,v])=>[k,v.fired])),firedSequence:this.raceClock.firedEventSequence}};}
    getState(){return{riders:this.riders,pacer:this.pacer,ranking:this.ranking,isStarted:this.isStarted,currentState:this.currentState,elapsedTime:this.elapsedTime,totalDistance:this.totalDistance,bellRung:this.bellRung,diagnostics:this.getDiagnostics(),raceClock:this.raceClock,raceEvents:this.raceEvents};}
}
