import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { getTrackPoint } from './ui.js';
import {
  DEFAULT_RACE_SETUP, SCENARIO_TYPE, MINDSET, RUN_STYLE
} from './race-plan.js';

const geometry={cx:400,cy:400,halfStraight:140,radius:200};
const markerDiameter=10.4;

function pixelDistance(a,b){
  const pa=getTrackPoint(geometry,a.renderDistance,a.renderLaneOffset);
  const pb=getTrackPoint(geometry,b.renderDistance,b.renderLaneOffset);
  return Math.hypot(pa.x-pb.x,pa.y-pb.y);
}

function run(setup,scale){
  const e=new PhysicsEngine(setup);
  e.setSpeedScale(scale);e.start();
  let frames=0;
  let minPx=Infinity;
  let exactOverlap=false;
  let renderReverse=false;
  const prevRender=new Map();
  const actions=new Map();
  let sawBlock=false,sawBlockCompete=false,sawBlockRecover=false,sawContest=false;
  let sawYield=false,sawKamasi=false,sawKirikae=false;
  let maxSnakeLag=0;

  while(e.isStarted&&frames<300000){
    e.update(1/60);
    const s=e.getState();
    const active=s.riders.filter(r=>!r.finished);

    for(const r of active){
      if(!actions.has(r.number))actions.set(r.number,new Set());
      actions.get(r.number).add(r.action);
      const prev=prevRender.get(r.number);
      if(prev!=null&&r.renderDistance<prev-1e-8)renderReverse=true;
      prevRender.set(r.number,r.renderDistance);
      if(r.action==='BLOCK'){sawBlock=true;if(r.renderMode==='COMPETE')sawBlockCompete=true;}
      if(r.number===2&&sawBlock&&r.action==='FOLLOW'&&r.renderMode==='SNAKE_FOLLOW')sawBlockRecover=true;
      if(r.action==='FULL_CONTEST')sawContest=true;
      if(r.action==='YIELD')sawYield=true;
      if(r.action==='ATTACK'&&s.scenario.currentPhase==='MIDDLE_ACTION')sawKamasi=true;
      if(r.action==='KIRIKAE')sawKirikae=true;
    }

    // Snake visual lag: leader starts changing lane before its third rider.
    for(const line of s.lines.filter(x=>!x.isSolo&&x.members.length>=3)){
      const L=s.riders.find(r=>r.number===line.members[0]);
      const T=s.riders.find(r=>r.number===line.members[2]);
      if(L&&T)maxSnakeLag=Math.max(maxSnakeLag,Math.abs(L.renderLaneOffset-T.renderLaneOffset));
    }

    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j];
      if(Math.abs(a.renderDistance-b.renderDistance)<1e-9&&Math.abs(a.renderLaneOffset-b.renderLaneOffset)<1e-9)exactOverlap=true;
      minPx=Math.min(minPx,pixelDistance(a,b));
    }
    frames++;
  }

  assert.ok(frames<300000,`${scale} timeout`);
  assert.equal(exactOverlap,false,`${scale} exact render overlap`);
  assert.equal(renderReverse,false,`${scale} render reverse`);
  assert.ok(minPx>=markerDiameter-0.05,`${scale} marker overlap minPx=${minPx}`);

  return {e,state:e.getState(),minPx,actions,sawBlock,sawBlockCompete,sawBlockRecover,sawContest,sawYield,sawKamasi,sawKirikae,maxSnakeLag};
}

for(const scale of [.5,1,2,3]){
  const r=run(DEFAULT_RACE_SETUP,scale);
  assert.ok(r.sawContest,`${scale} TSUPPARI contest lost`);
  assert.ok(r.sawBlock,`${scale} bante block lost`);
  assert.ok(r.sawBlockCompete,`${scale} block did not release bante render mode`);
  assert.ok(r.sawBlockRecover,`${scale} bante did not return to snake`);
  assert.ok(r.state.decisionLogs.some(x=>x.category==='BANTE_BLOCK'),`${scale} block Decision Log lost`);
  assert.ok(r.maxSnakeLag>3,`${scale} snake lane lag not visible`);
  console.log(`PASS TSUPPARI ${scale}x minPx=${r.minPx.toFixed(2)} lag=${r.maxSnakeLag.toFixed(2)}`);
}

const dynamicSetup={
  scenarioId:SCENARIO_TYPE.YIELD_KAMASI,
  trackProfile:'PROFILE_400',
  lines:[
    {id:'LINE_A',members:[1,2,3],leader:1},
    {id:'LINE_B',members:[4,5],leader:4},
    {id:'SOLO_6',members:[6],leader:6},
    {id:'LINE_C',members:[7,8,9],leader:7}
  ],
  riders:{
    1:{mindset:MINDSET.YIELD_AND_ROLL},2:{},3:{},
    4:{runStyle:RUN_STYLE.NIGE},5:{},6:{solo:true},
    7:{mindset:MINDSET.CONTAIN},8:{},9:{}
  }
};

for(const scale of [.5,1,2,3]){
  const r=run(dynamicSetup,scale);
  assert.ok(r.sawYield,`${scale} YIELD lost`);
  assert.ok(r.sawKamasi,`${scale} KAMASI lost`);
  assert.ok(r.sawKirikae,`${scale} KIRIKAE lost`);
  assert.ok(r.state.decisionLogs.some(x=>x.message.includes('KAMASI')||x.message.includes('カマシ')),`${scale} KAMASI log lost`);
  console.log(`PASS YIELD_KAMASI ${scale}x minPx=${r.minPx.toFixed(2)} kirikae=${r.sawKirikae}`);
}

console.log('CR-0016 LOGIC/RENDER INTEGRATION: ALL CHECKS PASSED');
