import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';

const groups=new AIModel().getInitialLineGroups();

function run(scale){
  const e=new PhysicsEngine(groups);
  e.setSpeedScale(scale);
  let bell=0;e.onBell(()=>bell++);
  e.start();

  let frames=0;
  const M={
    blockStart:null, blockGap:null, fourSpeedAtBlock:null, fourEnergyAtBlock:null,
    oneEnergyAtBlock:null, oneFadeStart:null, oneFadeSpeedStart:null, oneFadeEnergy:null,
    twoRelease:null, twoReleaseSpeed:null, fourFinalKick:null, fourFinalKickSpeed:null,
    maxFourMakuriSpeed:0, minGap4to2:Infinity,
    twoPassedOne:false, fourPassedOne:false,
    oneMinAfterFade:Infinity, finish:null, minSpatial:Infinity
  };

  while(e.isStarted&&frames++<150000){
    e.update(1/60);
    const s=e.getState(),r=n=>s.riders.find(x=>x.number===n),ph=s.scenario.phase;
    const one=r(1),two=r(2),four=r(4);

    if(['LINE4_MAKURI','BANTE_BLOCK'].includes(ph)){
      M.maxFourMakuriSpeed=Math.max(M.maxFourMakuriSpeed,four.speed);
      M.minGap4to2=Math.min(M.minGap4to2,two.distance-four.distance);
    }

    if(ph==='BANTE_BLOCK'&&M.blockStart==null){
      M.blockStart=s.elapsedTime;
      M.blockGap=two.distance-four.distance;
      M.fourSpeedAtBlock=four.speed;
      M.fourEnergyAtBlock=four.energy;
      M.oneEnergyAtBlock=one.energy;
    }

    if(one.action==='LEAD_FADE'){
      if(M.oneFadeStart==null){
        M.oneFadeStart=s.elapsedTime;
        M.oneFadeSpeedStart=one.speed;
        M.oneFadeEnergy=one.energy;
      }
      M.oneMinAfterFade=Math.min(M.oneMinAfterFade,one.speed);
    }

    if(two.action==='SWITCH_TO_SELF_POWER'&&M.twoRelease==null){
      M.twoRelease=s.elapsedTime;
      M.twoReleaseSpeed=two.speed;
    }

    if(four.action==='FINAL_SPRINT'&&M.fourFinalKick==null){
      M.fourFinalKick=s.elapsedTime;
      M.fourFinalKickSpeed=four.speed;
    }

    if(two.distance>one.distance+0.2)M.twoPassedOne=true;
    if(four.distance>one.distance+0.2)M.fourPassedOne=true;

    const active=s.riders.filter(x=>!x.finished);
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j];
      M.minSpatial=Math.min(M.minSpatial,Math.hypot(a.distance-b.distance,(a.laneOffset-b.laneOffset)*0.45));
    }
  }

  M.finish=e.getState().ranking.map(x=>x.number);
  return {state:e.getState(),M,bell,frames};
}

for(const scale of [0.5,1,2,3]){
  const {state,M,bell,frames}=run(scale);
  assert.ok(frames<150000,`${scale}x timeout`);
  assert.equal(bell,1,`${scale}x bell once`);
  assert.equal(state.ranking.length,9,`${scale}x all riders finish`);

  // 4 must arrive as a real, fast makuri and physically enter the bante block window.
  assert.ok(M.blockStart!=null,`${scale}x block not triggered`);
  assert.ok(M.blockGap<=24.5&&M.blockGap>=-4.5,`${scale}x 4 never entered real block window: ${M.blockGap}`);
  assert.ok(M.fourSpeedAtBlock>=25.0,`${scale}x 4 makuri lacks punch: ${M.fourSpeedAtBlock}`);
  assert.ok(M.maxFourMakuriSpeed>=26.0,`${scale}x 4 never reached strong makuri speed: ${M.maxFourMakuriSpeed}`);

  // The long-leading 1 must pay an energy price and visibly go ippai after the block has developed.
  assert.ok(M.oneEnergyAtBlock<0.35,`${scale}x 1 still has too much energy at final corner: ${M.oneEnergyAtBlock}`);
  assert.ok(M.oneFadeStart!=null,`${scale}x 1 never enters LEAD_FADE`);
  assert.ok(M.oneFadeStart>M.blockStart,`${scale}x 1 fades before the makuri/block climax`);
  assert.ok(M.oneFadeEnergy<=0.34,`${scale}x fade not energy-driven: ${M.oneFadeEnergy}`);
  assert.ok(M.oneMinAfterFade<=15.5,`${scale}x 1 does not visibly tare: ${M.oneMinAfterFade}`);

  // 2 must stop being chained to a spent leader and attack the line himself.
  assert.ok(M.twoRelease!=null,`${scale}x 2 never releases from spent 1`);
  assert.ok(M.twoRelease>=M.oneFadeStart-0.05,`${scale}x 2 anticipates fade unrealistically`);
  assert.equal(M.twoPassedOne,true,`${scale}x 2 fails to pass the spent leader`);

  // 4 is checked by 2, but the block is not a permanent delete-button.
  assert.ok(M.fourFinalKick!=null,`${scale}x 4 never re-accelerates after block`);
  assert.equal(M.fourPassedOne,true,`${scale}x 4 fails to rejoin the finish after passing spent 1`);

  const p1=M.finish.indexOf(1),p2=M.finish.indexOf(2),p4=M.finish.indexOf(4);
  assert.ok(p2<p1,`${scale}x 2 must finish ahead of spent 1: ${M.finish.join('-')}`);
  assert.ok(p4<p1,`${scale}x 4 must finish ahead of spent 1: ${M.finish.join('-')}`);
  assert.ok(M.minSpatial>3.8,`${scale}x collision / same-slot regression: ${M.minSpatial}`);

  console.log(
    `PASS ${scale}x blockGap=${M.blockGap.toFixed(1)} `+
    `4v=${M.fourSpeedAtBlock.toFixed(1)} 1E=${M.oneEnergyAtBlock.toFixed(2)} `+
    `fadeV=${M.oneMinAfterFade.toFixed(1)} finish=${M.finish.join('-')}`
  );
}
console.log('CR-0006 STAMINA / CLIMAX: all strict checks passed');
