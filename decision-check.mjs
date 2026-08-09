import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';

const groups=new AIModel().getInitialLineGroups();
assert.deepEqual(groups,[[1,2,3],[4,5,6],[7,8,9]]);

function run(scale=1,mutate=null){
    const plan=structuredClone(DEFAULT_RACE_PLAN);if(mutate)mutate(plan);
    const e=new PhysicsEngine(groups,[-18,-6,6,18],undefined,plan);e.setSpeedScale(scale);let bell=0;e.onBell(()=>bell++);e.start();
    let frames=0,saw4Lead=false,saw1Attack=false,saw5Block=false,saw4Defend=false,sawBante=false,sawSwitch=false,maxInterference=0;
    let snapshotBefore1=null,snapshotAfter1=null;
    while(e.isStarted&&frames<80000){
        e.update(1/60);const s=e.getState();const r=n=>s.riders.find(x=>x.number===n);const order=[...s.riders].filter(x=>!x.finished).sort((a,b)=>b.distance-a.distance);
        if(order[0]?.lineId===1&&s.raceClock.remainingDistance<320&&s.raceClock.remainingDistance>210)saw4Lead=true;
        if(r(1)?.action==='ATTACK'){saw1Attack=true;if(!snapshotBefore1)snapshotBefore1={remaining:s.raceClock.remainingDistance,e4:r(4).energy,e5:r(5).energy};}
        if(r(5)?.action==='BLOCK')saw5Block=true;maxInterference=Math.max(maxInterference,r(1)?.interference??0);
        if(r(4)?.action==='DEFEND')saw4Defend=true;
        if(r(5)?.action==='BANTE_MAKURI')sawBante=true;
        if(s.raceEvents.some(x=>x.type==='SWITCH'))sawSwitch=true;
        if(saw1Attack&&!snapshotAfter1&&s.raceClock.remainingDistance<120)snapshotAfter1={d1:r(1).distance,d4:r(4).distance,e1:r(1).energy,e4:r(4).energy,e5:r(5).energy};
        frames++;
    }
    return {e,state:e.getState(),frames,bell,saw4Lead,saw1Attack,saw5Block,saw4Defend,sawBante,sawSwitch,maxInterference,snapshotBefore1,snapshotAfter1};
}

for(const scale of [0.5,1,2,3]){
    const x=run(scale);assert.ok(x.frames<80000,`${scale} timeout`);assert.equal(x.bell,1);assert.equal(x.state.ranking.length,9);
    assert.deepEqual(x.state.raceClock.firedEventSequence,['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
    assert.ok(x.saw4Lead,`${scale}: 4-line must gain control before late 1 attack`);
    assert.ok(x.saw1Attack,`${scale}: 1 must attack late`);
    assert.ok(x.saw4Defend||x.saw5Block,`${scale}: controlling line must react to the attack`);
    assert.ok(x.state.riders.every(r=>r.energy>=0&&r.energy<=r.capability.energyCapacity+1e-9));
    console.log(`PASS ${scale}x finish=${x.state.ranking.map(r=>r.number).join('-')} block=${x.saw5Block} defend4=${x.saw4Defend} bante=${x.sawBante} switch=${x.sawSwitch}`);
}

// Counterfactual A: block is a live interaction, not a cosmetic lane move.
// With block enabled the attacking rider must experience positive interference,
// and removing the block must produce a different race result.
{
    const withBlock=run(1);
    const noBlock=run(1,p=>{p[5].blockEnabled=false;});
    assert.ok(withBlock.maxInterference>0.05,`block must create attacker interference`);
    assert.equal(noBlock.maxInterference,0,`no block must mean no interference`);
    const withOrder=withBlock.state.ranking.map(r=>r.number).join('-');
    const noOrder=noBlock.state.ranking.map(r=>r.number).join('-');
    assert.notEqual(withOrder,noOrder,`block should be capable of changing the resulting order`);
    console.log(`PASS block counterfactual interference=${withBlock.maxInterference.toFixed(3)} with=${withOrder} no=${noOrder}`);
}

// Counterfactual B: if 4 is deliberately made much less durable, 5 must be
// allowed to abandon pure marking and use bante-makuri late.
{
    const weak4=run(1,p=>{p[4].capability.endurance=0.25;p[4].capability.topSpeed=18.5;p[5].banteMakuriEnabled=true;});
    assert.ok(weak4.sawBante,`weak leading rider should permit bante makuri`);
    console.log(`PASS bante-makuri counterfactual finish=${weak4.state.ranking.map(r=>r.number).join('-')}`);
}

// Counterfactual C: if a line is passed badly, at least one non-leader can
// dynamically switch follow target instead of remaining welded to affiliation.
{
    const x=run(1,p=>{p[7].capability.endurance=0.45;p[7].leadSpeed=15.0;p[8].blockEnabled=false;});
    assert.ok(x.sawSwitch,`passed line should be capable of switching`);
    console.log(`PASS switch counterfactual events=${x.state.raceEvents.filter(e=>e.type==='SWITCH').length}`);
}


// Counterfactual D: a clearly stronger late makuri can overcome the same block.
// This is essential: BLOCK is an interaction, not a scripted veto.
{
    const strong1=run(1,p=>{
        Object.assign(p[1].capability,{topSpeed:23.8,acceleration:4.5,endurance:1.12,dash:1.20});
        p[1].attackSpeed=22.8;
        p[4].capability.endurance=0.82;
    });
    assert.equal(strong1.state.ranking[0].number,1,`stronger makuri should be able to break the controlling line`);
    assert.ok(strong1.saw5Block,`the win must occur despite a real block attempt`);
    console.log(`PASS strong-makuri counterfactual finish=${strong1.state.ranking.map(r=>r.number).join('-')}`);
}

console.log('OFFICIAL DECISION ENGINE V2 checks passed');
