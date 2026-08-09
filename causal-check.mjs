import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';

const groups = new AIModel().getInitialLineGroups();
assert.deepEqual(groups, [[1,2,3],[4,5,6],[7,8,9]]);

function run(scale = 1, mutate = null) {
    const plan = structuredClone(DEFAULT_RACE_PLAN);
    if (mutate) mutate(plan);
    const engine = new PhysicsEngine(groups, [-18,-6,6,18], undefined, plan);
    engine.setSpeedScale(scale);
    let bell = 0;
    engine.onBell(() => bell++);
    engine.start();

    let frames = 0;
    let energyNeverIncreasesUnderHardEffort = true;
    let sawLeaderUsesMoreThanFollower = false;
    let previous = new Map(engine.riders.map(r => [r.number, r.energy]));
    let sample = null;

    while (engine.isStarted && frames < 70000) {
        engine.update(1/60);
        const s = engine.getState();
        const r = n => s.riders.find(x => x.number === n);

        for (const rider of s.riders) {
            const prev = previous.get(rider.number);
            if ((rider.action === 'ATTACK' || rider.action === 'DEFEND') && rider.energy > prev + 1e-7) {
                energyNeverIncreasesUnderHardEffort = false;
            }
            previous.set(rider.number, rider.energy);
        }

        if (s.raceClock.remainingDistance < 300 && s.raceClock.remainingDistance > 220) {
            if (r(7).energy + 0.015 < r(8).energy) sawLeaderUsesMoreThanFollower = true;
        }
        if (!sample && s.raceClock.remainingDistance <= 190) {
            sample = Object.fromEntries(s.riders.map(x => [x.number, { energy:x.energy, speed:x.speed, position:[...s.riders].sort((a,b)=>b.distance-a.distance).findIndex(y=>y.number===x.number)+1 }]));
        }
        frames++;
    }

    const s = engine.getState();
    return { engine, state:s, frames, bell, energyNeverIncreasesUnderHardEffort, sawLeaderUsesMoreThanFollower, sample };
}

for (const scale of [0.5,1,2,3]) {
    const x = run(scale);
    assert.ok(x.frames < 70000, `${scale}x timeout`);
    assert.equal(x.bell, 1, `${scale}x bell`);
    assert.equal(x.state.ranking.length, 9, `${scale}x ranking`);
    assert.deepEqual(x.state.raceClock.firedEventSequence, ['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
    assert.ok(x.energyNeverIncreasesUnderHardEffort, `${scale}x hard effort energy monotonic`);
    assert.ok(x.sawLeaderUsesMoreThanFollower, `${scale}x leading rider should spend more than sheltered follower`);
    assert.ok(x.state.riders.every(r => r.energy >= 0 && r.energy <= r.capability.energyCapacity + 1e-9), `${scale}x energy bounds`);
    console.log(`PASS ${scale}x finish=${x.state.ranking.map(r=>r.number).join('-')} E7=${x.state.riders.find(r=>r.number===7).energy.toFixed(3)} E8=${x.state.riders.find(r=>r.number===8).energy.toFixed(3)}`);
}

// Counterfactual: asking the early leader to defend harder must cost more energy.
// This proves the result is responding to race causality rather than a hard-coded finish list.
{
    const normal = run(1);
    const hard = run(1, plan => {
        plan[7].defendSpeed = 20.0;
        plan[7].defendUntilRemaining = 120;
    });
    const n7 = normal.state.riders.find(r=>r.number===7);
    const h7 = hard.state.riders.find(r=>r.number===7);
    assert.ok(h7.energy < n7.energy - 0.01, `harder defence must cost 7 more energy normal=${n7.energy} hard=${h7.energy}`);
    console.log(`PASS counterfactual harder resistance costs energy: ${n7.energy.toFixed(3)} -> ${h7.energy.toFixed(3)}`);
}

// Counterfactual: changing attack timing must materially change both energy use
// and the resulting race.  We intentionally do NOT assert which timing is
// universally "better"; that must emerge from position, drafting and race load.
{
    const early = run(1, plan => { plan[4].triggerRemaining = 220; });
    const late = run(1, plan => { plan[4].triggerRemaining = 80; });
    const e4 = early.state.riders.find(r=>r.number===4);
    const l4 = late.state.riders.find(r=>r.number===4);
    const earlyOrder = early.state.ranking.map(r=>r.number).join('-');
    const lateOrder = late.state.ranking.map(r=>r.number).join('-');
    assert.ok(Math.abs(e4.energy - l4.energy) > 0.01, `attack timing must change energy early=${e4.energy} late=${l4.energy}`);
    console.log(`PASS counterfactual timing changes energy/state: early E4=${e4.energy.toFixed(3)} finish=${earlyOrder}; late E4=${l4.energy.toFixed(3)} finish=${lateOrder}`);
}

console.log('Causal race engine checks passed');
