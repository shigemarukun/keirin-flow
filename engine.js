import { DEFAULT_RACE_PLAN } from './race-plan.js';

const CAR_STYLES = Object.freeze({
    1:{background:'#ffffff',text:'#111111'},2:{background:'#222222',text:'#ffffff'},3:{background:'#e60012',text:'#ffffff'},
    4:{background:'#0068b7',text:'#ffffff'},5:{background:'#ffd400',text:'#111111'},6:{background:'#00a651',text:'#ffffff'},
    7:{background:'#f08300',text:'#111111'},8:{background:'#ff69b4',text:'#111111'},9:{background:'#7f3fbf',text:'#ffffff'}
});

const RACE_STATE=Object.freeze({POSITION_BATTLE:'POSITION_BATTLE',FINAL:'FINAL',FINISHED:'FINISHED'});
const PACER_STATE=Object.freeze({LEADING:'LEADING',EXITING:'EXITING',EXITED:'EXITED'});
const CLOCK_OWNER=Object.freeze({PACER:'PACER',LEADER:'LEADER'});
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

export const RACE_PROFILES=Object.freeze({
    PROFILE_400:{TRACK_LENGTH:400,RACE_DISTANCE:800,FORMATION_SPEED:10.5,PacerLeaveLine:620,Bell:600,PacerExit:560,FinalLap:400,FinalBack:200,Finish:0}
});
export const RACE_CONFIG=RACE_PROFILES.PROFILE_400;

export class RaceClock{
    constructor(config=RACE_CONFIG){this.config=config;this.trackLength=config.TRACK_LENGTH;this.totalDistance=config.RACE_DISTANCE;this.reset();}
    reset(){
        this.owner=CLOCK_OWNER.PACER;this.referenceDistance=0;this.remainingDistance=this.totalDistance;this.currentLap=2;this.firedEventSequence=[];
        this.events={PacerLeaveLine:{fired:false},Bell:{fired:false},PacerExit:{fired:false},FinalLap:{fired:false},FinalBack:{fired:false},Finish:{fired:false}};
    }
    update(pacerDistance,leaderDistance,engine){
        if(engine.pacer.state===PACER_STATE.EXITED)this.owner=CLOCK_OWNER.LEADER;
        const candidate=this.owner===CLOCK_OWNER.PACER?pacerDistance:leaderDistance;
        this.referenceDistance=Math.max(this.referenceDistance,candidate);
        this.remainingDistance=Math.max(0,this.totalDistance-this.referenceDistance);
        this.currentLap=this.remainingDistance>this.trackLength?2:1;
        const thresholds={PacerLeaveLine:this.config.PacerLeaveLine,Bell:this.config.Bell,PacerExit:this.config.PacerExit,FinalLap:this.config.FinalLap,FinalBack:this.config.FinalBack,Finish:0};
        const order=['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish'],triggered=[];
        for(const name of order){
            if(!this.events[name].fired&&this.remainingDistance<=thresholds[name]){
                this.events[name].fired=true;this.firedEventSequence.push(name);triggered.push(name);
            }
        }
        return triggered;
    }
}

export class PhysicsEngine{
    constructor(lineGroups,lineOffsets=[-18,-6,6,18],profile=RACE_CONFIG,racePlan=DEFAULT_RACE_PLAN){
        this.lineGroups=lineGroups.map(g=>[...g]);this.lineOffsets=[...lineOffsets];this.profile=profile;this.totalDistance=profile.RACE_DISTANCE;this.racePlan=racePlan;
        this.timeScale=1;this.onBellCallback=null;this.onFinishCallback=null;this.raceClock=new RaceClock(profile);this._buildRiders();this.reset();
    }

    _buildRiders(){
        this.riders=[];let globalIndex=0;
        this.lineGroups.forEach((group,lineId)=>group.forEach((number,lineOrder)=>{
            const p=this.racePlan[number]??{};
            const initialDistance=-14-globalIndex*17;
            this.riders.push({
                number,lineId,lineOrder,globalIndex,isLeader:lineOrder===0,lineFrontNumber:lineOrder>0?group[lineOrder-1]:null,
                initialDistance,initialLaneOffset:-18,style:CAR_STYLES[number],plan:p,
                distance:initialDistance,speed:this.profile.FORMATION_SPEED,acceleration:0,laneOffset:-18,
                action:'FORMATION',followTargetNumber:lineOrder>0?group[lineOrder-1]:null,followStatus:lineOrder===0?'LEADER':'ATTACHED',
                energy:1,fatigue:0,effort:0,drafting:false,load:0,blockTargetNumber:null,blockActive:false,blockUsed:false,blockedBy2:false,
                finished:false,finishTime:null,history:[]
            });
            globalIndex++;
        }));
    }

    reset(){
        this.isStarted=false;this.elapsedTime=0;this.bellRung=false;this.currentState=RACE_STATE.POSITION_BATTLE;this.ranking=[];this.raceEvents=[];this.raceClock.reset();
        this.pacer={distance:0,speed:this.profile.FORMATION_SPEED,state:PACER_STATE.LEADING,laneOffset:-18,exitProgress:0};
        for(const r of this.riders){
            r.distance=r.initialDistance;r.speed=this.profile.FORMATION_SPEED;r.acceleration=0;r.laneOffset=-18;r.action='FORMATION';
            r.followTargetNumber=r.lineFrontNumber;r.followStatus=r.isLeader?'LEADER':'ATTACHED';r.energy=1;r.fatigue=0;r.effort=0;r.drafting=false;r.load=0;
            r.blockTargetNumber=null;r.blockActive=false;r.blockUsed=false;r.blockedBy2=false;r.finished=false;r.finishTime=null;r.history=[];
        }
    }

    start(){if(this.riders.every(r=>r.finished))this.reset();this.isStarted=true;}
    pause(){this.isStarted=false;}
    setSpeedScale(v){this.timeScale=clamp(Number(v)||1,0.5,3);}
    onBell(cb){this.onBellCallback=cb;}
    onFinish(cb){this.onFinishCallback=cb;}
    _rider(n){return this.riders.find(r=>r.number===n)??null;}
    _leader(){return [...this.riders].filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance)[0]??null;}
    _emit(type,data={}){this.raceEvents.push({time:this.elapsedTime,remaining:this.raceClock.remainingDistance,type,...data});}

    _updatePacer(dt){
        if(this.pacer.state===PACER_STATE.EXITED)return;
        this.pacer.distance+=this.pacer.speed*dt;
        if(this.raceClock.events.PacerLeaveLine.fired&&this.pacer.state===PACER_STATE.LEADING)this.pacer.state=PACER_STATE.EXITING;
        if(this.pacer.state===PACER_STATE.EXITING){
            this.pacer.exitProgress=Math.min(1,this.pacer.exitProgress+0.82*dt);
            const e=this.pacer.exitProgress*this.pacer.exitProgress*(3-2*this.pacer.exitProgress);
            this.pacer.laneOffset=-18-72*e;
            if(this.raceClock.events.PacerExit.fired&&this.pacer.exitProgress>=1){this.pacer.state=PACER_STATE.EXITED;this.currentState=RACE_STATE.FINAL;}
        }
    }

    _stage(rem){
        if(rem>665)return 'FORMATION';
        if(rem>555)return 'FIRST_789_ATTACK';
        if(rem>410)return '789_RETREAT';
        if(rem>390)return 'RESET_FORMATION';
        if(rem>205)return 'SECOND_789_ATTACK';
        if(rem>150)return '789_COLLAPSE';
        if(rem>85)return '456_MAKURI';
        return 'FINAL_CORNER';
    }

    _followSpeed(rider,target,desiredGap=10.5){
        if(!target||target.finished)return this.profile.FORMATION_SPEED;
        const gap=target.distance-rider.distance;
        const lower=desiredGap-2.0,upper=desiredGap+3.5;
        if(gap>=lower&&gap<=upper)return target.speed;
        const correction=gap<lower?(gap-lower)*0.24:(gap-upper)*0.28;
        return clamp(target.speed+correction,Math.max(0,target.speed-1.4),target.speed+3.2);
    }

    _decision(rider){
        const rem=this.raceClock.remainingDistance,stage=this._stage(rem),p=rider.plan;
        rider.blockActive=false;rider.blockTargetNumber=null;

        // Line 1-2-3
        if(rider.number===1){
            rider.followTargetNumber=null;
            if(stage==='FIRST_789_ATTACK'){rider.action='DEFEND';return p.firstDefenseSpeed;}
            if(stage==='SECOND_789_ATTACK'||stage==='789_COLLAPSE'){rider.action='DEFEND';return p.secondDefenseSpeed;}
            if(stage==='456_MAKURI'||stage==='FINAL_CORNER'){rider.action='LEAD';return p.finalHoldSpeed;}
            rider.action='LEAD';return stage==='FORMATION'?this.profile.FORMATION_SPEED:17.0;
        }
        if(rider.number===2){
            rider.followTargetNumber=1;
            const four=this._rider(4);
            if(stage==='FINAL_CORNER'&&rider.blockUsed&&rem>55){
                rider.action='BLOCK';rider.blockActive=true;rider.blockTargetNumber=4;
                return Math.max(this._rider(1).speed,19.2);
            }
            if(stage==='FINAL_CORNER'&&!rider.blockUsed&&four&&!four.finished){
                const gap=this._rider(1).distance-four.distance;
                if(gap<=48&&gap>=-6){
                    rider.action='BLOCK';rider.blockActive=true;rider.blockTargetNumber=4;rider.blockUsed=true;
                    four.blockedBy2=true;
                    this._emit('BLOCK_START',{rider:2,target:4});
                    return Math.max(this._rider(1).speed,19.2);
                }
            }
            rider.action=stage==='FINAL_CORNER'?'FINAL_SPRINT':'FOLLOW';
            return stage==='FINAL_CORNER'?p.finalSpeed:this._followSpeed(rider,this._rider(1),9.0);
        }
        if(rider.number===3){
            rider.followTargetNumber=2;rider.action=stage==='FINAL_CORNER'?'FINAL_SPRINT':'FOLLOW';
            return stage==='FINAL_CORNER'?p.finalSpeed:this._followSpeed(rider,this._rider(2),10.5);
        }

        // Line 4-5-6
        if(rider.number===4){
            rider.followTargetNumber=null;
            if(stage==='456_MAKURI'||stage==='FINAL_CORNER'){rider.action='ATTACK';return p.makuriSpeed;}
            rider.action='FOLLOW';
            const target=stage==='SECOND_789_ATTACK'?this._rider(3):this._rider(3);
            rider.followTargetNumber=target?.number??3;
            return this._followSpeed(rider,target,13.0);
        }
        if(rider.number===5){
            const two=this._rider(2),four=this._rider(4);
            if((two?.blockActive&&two.blockTargetNumber===4)||four?.blockedBy2||rider.action==='DIVE'){
                rider.action='DIVE';rider.followTargetNumber=null;return p.diveSpeed;
            }
            rider.followTargetNumber=4;rider.action=stage==='FINAL_CORNER'?'FINAL_SPRINT':'FOLLOW';
            return this._followSpeed(rider,four,9.5);
        }
        if(rider.number===6){
            rider.followTargetNumber=5;rider.action=stage==='FINAL_CORNER'?'FINAL_SPRINT':'FOLLOW';
            return stage==='FINAL_CORNER'?p.finalSpeed:this._followSpeed(rider,this._rider(5),10.5);
        }

        // Line 7-8-9
        if(rider.number===7){
            rider.followTargetNumber=null;
            if(stage==='FIRST_789_ATTACK'){rider.action='MOVE_UP';return p.firstAttackSpeed;}
            if(stage==='789_RETREAT'||stage==='RESET_FORMATION'){rider.action='RETREAT';return p.retreatSpeed;}
            if(stage==='SECOND_789_ATTACK'){rider.action='ATTACK';return p.secondAttackSpeed;}
            if(stage==='789_COLLAPSE'||stage==='456_MAKURI'||stage==='FINAL_CORNER'){rider.action='FADE';return p.collapseSpeed;}
            rider.action='FORMATION';return this.profile.FORMATION_SPEED;
        }
        if(rider.number===8){
            rider.followTargetNumber=7;rider.action=stage==='FINAL_CORNER'?'FINAL_SPRINT':'FOLLOW';
            return stage==='FINAL_CORNER'?p.finalSpeed:this._followSpeed(rider,this._rider(7),10.0);
        }
        if(rider.number===9){
            rider.followTargetNumber=8;
            if(stage==='FINAL_CORNER'&&rem<=45){rider.action='FINAL_SPRINT';return p.finalSpeed;}
            rider.action='FOLLOW';return this._followSpeed(rider,this._rider(8),10.0);
        }
        return this.profile.FORMATION_SPEED;
    }

    _laneTarget(rider){
        const stage=this._stage(this.raceClock.remainingDistance);
        if(rider.number===1)return -18;
        if(rider.number===2&&rider.blockActive)return 28;
        if(rider.number===4&&(stage==='456_MAKURI'||stage==='FINAL_CORNER'))return 38;
        if(rider.number===5&&rider.action==='DIVE')return 6;
        if(rider.lineId===2){
            if(stage==='FIRST_789_ATTACK')return 34;
            if(stage==='789_RETREAT'||stage==='RESET_FORMATION')return -18;
            if(stage==='SECOND_789_ATTACK')return 38;
            if(stage==='789_COLLAPSE'||stage==='456_MAKURI')return 30;
            if(stage==='FINAL_CORNER'){
                // The spent line is no longer a rigid three-car train.
                // 9 searches outside, 8 stays middle, 7 fades inside.
                if(rider.number===9)return 42;
                if(rider.number===8)return 20;
                return 30;
            }
        }
        const target=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;
        if(target)return target.laneOffset;
        return -18;
    }

    _updateEnergy(rider,desired,dt){
        const base=this.profile.FORMATION_SPEED;
        const target=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;
        const gap=target?target.distance-rider.distance:999;
        const draft=target&&gap>5&&gap<14&&Math.abs(target.laneOffset-rider.laneOffset)<14?0.28:0;
        const speedDemand=Math.max(0,desired-base)/base;
        let actionFactor=1;
        if(['MOVE_UP','ATTACK','DEFEND'].includes(rider.action))actionFactor=1.55;
        if(rider.action==='BLOCK')actionFactor=1.35;
        if(rider.action==='DIVE'||rider.action==='FINAL_SPRINT')actionFactor=1.42;
        if(rider.action==='RETREAT'||rider.action==='FADE')actionFactor=0.55;
        const load=(0.0025+0.0105*speedDemand*speedDemand)*actionFactor*(1-draft)/(rider.plan.endurance??1);
        rider.load=load;rider.effort=speedDemand;rider.drafting=draft>0;rider.energy=clamp(rider.energy-load*dt,0,1);rider.fatigue=1-rider.energy;
    }

    _effectiveDesired(rider,desired){
        const p=rider.plan;
        const fatigueStart=0.48;
        let fatigueFactor=1;
        if(rider.energy<fatigueStart)fatigueFactor=0.58+0.42*(rider.energy/fatigueStart);
        const top=(p.topSpeed??21)*(0.72+0.28*fatigueFactor);
        let result=Math.min(desired,top);

        // 2's block physically checks 4's makuri rather than teleporting the order.
        if(rider.number===4){
            const two=this._rider(2);
            if(two?.blockActive&&Math.abs(two.distance-rider.distance)<22){
                rider.blockedBy2=true;
                this._emit('BLOCK_CONTACT',{rider:2,target:4});
            }
            if(rider.blockedBy2){
                result=Math.min(result,15.4);
                rider.energy=clamp(rider.energy-0.0014,0,1);
            }
        }
        return result;
    }

    _move(rider,desired,dt){
        desired=this._effectiveDesired(rider,desired);
        const prev=rider.speed;
        const accel=(rider.plan.acceleration??3.2)*(0.60+0.40*Math.max(0.35,rider.energy));
        const decel=3.4;
        if(rider.speed<desired)rider.speed=Math.min(desired,rider.speed+accel*dt);
        else rider.speed=Math.max(desired,rider.speed-decel*dt);

        const laneTarget=this._laneTarget(rider);
        const laneRate=rider.action==='BLOCK'?3.2:(rider.action==='DIVE'?3.8:(rider.action==='ATTACK'||rider.action==='MOVE_UP'?2.6:1.8));
        rider.laneOffset+=(laneTarget-rider.laneOffset)*clamp(laneRate*dt,0,1);

        let next=rider.distance+rider.speed*dt;
        const target=rider.followTargetNumber?this._rider(rider.followTargetNumber):null;
        if(target&&!target.finished&&target.distance>rider.distance&&!['ATTACK','MOVE_UP','DIVE','FINAL_SPRINT'].includes(rider.action)){
            const minGap=5.8;
            if(next>target.distance-minGap){next=target.distance-minGap;rider.speed=Math.min(rider.speed,target.speed);}
        }

        // Occupancy guard: abreast is allowed, same slot is not.
        for(const other of this.riders){
            if(other===rider||other.finished)continue;
            if(Math.abs(other.distance-next)<4.5&&Math.abs(other.laneOffset-rider.laneOffset)<8){
                const outward=['ATTACK','MOVE_UP','BLOCK','DIVE','FINAL_SPRINT'].includes(rider.action);
                const candidate=clamp(other.laneOffset+(outward?11:-11),-18,46);
                rider.laneOffset+=(candidate-rider.laneOffset)*clamp(5*dt,0,1);
            }
        }

        rider.distance=next;rider.acceleration=(rider.speed-prev)/Math.max(dt,1e-6);
    }

    _recordFinish(r){
        r.distance=this.totalDistance;r.finished=true;r.finishTime=this.elapsedTime;
        this.ranking.push({rank:0,number:r.number,lineId:r.lineId,time:r.finishTime,margin:''});
    }
    _finalizeRanking(){
        this.ranking.sort((a,b)=>a.time-b.time||a.number-b.number);
        const w=this.ranking[0]?.time??0;
        this.ranking.forEach((x,i)=>{x.rank=i+1;const m=(x.time-w)*10.5;x.margin=i===0?'先頭':m<0.12?'ハナ':m<0.25?'アタマ':m<0.7?'1/2車身':m<1.1?'1車身':`${m.toFixed(1)}車身`;});
    }
    _recordHistory(){
        const sorted=[...this.riders].sort((a,b)=>b.distance-a.distance);const pos=new Map(sorted.map((r,i)=>[r.number,i+1]));
        for(const r of this.riders){
            r.history.push({time:this.elapsedTime,distance:r.distance,speed:r.speed,acceleration:r.acceleration,laneOffset:r.laneOffset,position:pos.get(r.number),action:r.action,followTargetNumber:r.followTargetNumber,followStatus:r.followStatus,energy:r.energy,fatigue:r.fatigue,drafting:r.drafting,blockTargetNumber:r.blockTargetNumber});
            if(r.history.length>1800)r.history.shift();
        }
    }

    update(dt){
        if(!this.isStarted)return;
        const frameDt=clamp(Number(dt)||0,0,0.1)*this.timeScale,maxStep=1/120,steps=Math.max(1,Math.ceil(frameDt/maxStep)),stepDt=frameDt/steps;
        for(let s=0;s<steps;s++){
            this.elapsedTime+=stepDt;this._updatePacer(stepDt);
            const desired=new Map();
            for(const r of this.riders)if(!r.finished)desired.set(r.number,this._decision(r));
            for(const r of this.riders){
                if(r.finished)continue;
                this._updateEnergy(r,desired.get(r.number),stepDt);
                const prev=r.distance;this._move(r,desired.get(r.number),stepDt);
                if(prev<this.totalDistance&&r.distance>=this.totalDistance)this._recordFinish(r);
            }
            const leaderDistance=this.riders.reduce((m,r)=>Math.max(m,r.distance),0);
            const trig=this.raceClock.update(this.pacer.distance,leaderDistance,this);
            if(trig.includes('Bell')){this.bellRung=true;this.onBellCallback?.();}
        }
        this._recordHistory();
        if(this.riders.every(r=>r.finished)){
            this.isStarted=false;this.currentState=RACE_STATE.FINISHED;this._finalizeRanking();this.onFinishCallback?.(this.ranking.map(x=>({...x})));
        }
    }

    getDiagnostics(){
        const gaps=this.riders.map(r=>({r,front:r.followTargetNumber?this._rider(r.followTargetNumber):null}))
            .filter(x=>x.front&&!x.r.finished&&!x.front.finished&&x.front.distance>x.r.distance)
            .map(x=>({number:x.r.number,frontNumber:x.front.number,gap:x.front.distance-x.r.distance}));
        return {gaps,minGap:gaps.length?Math.min(...gaps.map(x=>x.gap)):null,maxGap:gaps.length?Math.max(...gaps.map(x=>x.gap)):null};
    }
    getState(){return{riders:this.riders,pacer:this.pacer,ranking:this.ranking,isStarted:this.isStarted,currentState:this.currentState,elapsedTime:this.elapsedTime,totalDistance:this.totalDistance,bellRung:this.bellRung,diagnostics:this.getDiagnostics(),raceClock:this.raceClock,raceEvents:this.raceEvents};}
}
