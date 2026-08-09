import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { AIModel } from './ai.js';
import { TACTIC, FOLLOW_STATUS } from './tactics.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';

const groups = new AIModel().getInitialLineGroups();
assert.deepEqual(groups, [[1,2,3],[4,5,6],[7,8,9]]);
assert.equal(DEFAULT_RACE_PLAN[7].tactic, TACTIC.OSAE_SENKO);
assert.equal(DEFAULT_RACE_PLAN[1].tactic, TACTIC.MAKURI);
assert.equal(DEFAULT_RACE_PLAN[4].tactic, TACTIC.NAKADAN_MAKURI);

for (const scale of [0.5, 1, 2, 3]) {
    const engine = new PhysicsEngine(groups);
    engine.setSpeedScale(scale);
    let bell = 0;
    engine.onBell(() => bell++);
    engine.start();
    let frames = 0;
    let saw789Trail = false;
    let saw123Attack = false;
    let saw456Attack = false;
    let sawStretch = false;
    while (engine.isStarted && frames < 70000) {
        engine.update(1/60);
        const s = engine.getState();
        const r = n => s.riders.find(x => x.number === n);
        if (r(7).laneOffset > r(8).laneOffset + 0.5 && r(8).laneOffset > r(9).laneOffset + 0.2) saw789Trail = true;
        if (r(1).action === 'ATTACK') saw123Attack = true;
        if (r(4).action === 'ATTACK') saw456Attack = true;
        if ([2,3,5,6,8,9].some(n => r(n).followStatus === FOLLOW_STATUS.STRETCHED || r(n).followStatus === FOLLOW_STATUS.DETACHED)) sawStretch = true;
        frames++;
    }
    const s = engine.getState();
    assert.equal(bell, 1, `${scale}x bell`);
    assert.equal(s.ranking.length, 9, `${scale}x ranking`);
    assert.deepEqual(s.raceClock.firedEventSequence, ['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
    assert.ok(saw789Trail, `${scale}x 789 lateral trail`);
    assert.ok(saw123Attack, `${scale}x 123 attack`);
    assert.ok(saw456Attack, `${scale}x 456 attack`);
    assert.ok(sawStretch, `${scale}x flexible gap`);
    assert.deepEqual(s.ranking.map(x => x.number), [4,5,6,1,2,3,7,8,9], `${scale}x scripted finish order`);
    console.log(`PASS ${scale}x finish=${s.ranking.map(x=>x.number).join('-')}`);
}

// Dynamic follow-target separation test: affiliation remains unchanged while target can switch.
{
    const engine = new PhysicsEngine(groups);
    const r3 = engine.riders.find(r => r.number === 3);
    const originalLineId = r3.lineId;
    r3.followTargetNumber = 2;
    const r2 = engine.riders.find(r => r.number === 2);
    r3.distance = 0; r3.laneOffset = -18;
    r2.distance = 40; r2.laneOffset = 40; // unavailable: too far and wrong lane
    const r6 = engine.riders.find(r => r.number === 6);
    r6.distance = 18; r6.laneOffset = -10;
    r3.followStatus = FOLLOW_STATUS.DETACHED;
    r3.detachedTime = 1;
    const candidate = engine._findSwitchCandidate(r3);
    assert.equal(candidate?.number, 6);
    assert.equal(r3.lineId, originalLineId);
    console.log('PASS dynamic follow candidate without changing line affiliation');
}

console.log('Race Tactics Architecture v1 checks passed');
