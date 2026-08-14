import assert from 'node:assert/strict';
import { PhysicsEngine } from './engine.js';
import { ACTION, LINE_FOLLOW_MODE, TRACK_LANE } from './race-plan.js';

const engine = new PhysicsEngine();
const d = engine.tacticalAI.decisionEngine;
const leader = engine.rider(4);
const memory = d.state(leader);

// Synthetic post-attack snapshot: 4 has really cleared the field while still outside.
for (const r of engine.riders) r.distance = 100 - r.globalIndex * 17;
leader.distance = 180;
leader.laneOffset = 30;
leader.action = ACTION.ATTACK;
memory.lastAction = ACTION.ATTACK;
const sensed = engine.tacticalAI.sensor.sense(leader, engine);
const first = d.decideLeader(leader, sensed, engine, 1/60, memory);
assert.equal(memory.intent, 'ESTABLISH_FRONT');
assert.equal(first.followMode, LINE_FOLLOW_MODE.SETTLING);
assert.equal(first.laneTarget, TRACK_LANE.INNER);

// The next decision must continue closing inside even though the prior action is now CONTROL_PACE.
memory.lastAction = ACTION.CONTROL_PACE;
leader.action = ACTION.CONTROL_PACE;
leader.laneOffset = 12;
const second = d.decideLeader(leader, engine.tacticalAI.sensor.sense(leader, engine), engine, 1/60, memory);
assert.equal(memory.intent, 'ESTABLISH_FRONT');
assert.equal(second.laneTarget, TRACK_LANE.INNER);
assert.equal(second.followMode, LINE_FOLLOW_MODE.SETTLING);

// Arrival completes the persistent state.
leader.laneOffset = TRACK_LANE.INNER + 1;
d.decideLeader(leader, engine.tacticalAI.sensor.sense(leader, engine), engine, 1/60, memory);
assert.equal(memory.intent, 'HOLD_FRONT');

// Established-front detection requires inside + clearance + line integrity.
const e2 = new PhysicsEngine();
for (const r of e2.riders) { r.laneOffset = TRACK_LANE.INNER; }
e2.rider(4).distance = 180; e2.rider(5).distance = 163; e2.rider(6).distance = 146;
e2.rider(1).distance = 135; e2.rider(2).distance = 118; e2.rider(3).distance = 101;
e2.rider(7).distance = 90; e2.rider(8).distance = 73; e2.rider(9).distance = 56;
assert.equal(e2.detectEstablishedFrontLine(), 'LINE_B');

// LINE_C leader must dock to the nearest preceding line tail (LINE_A tail=3), not race leader 4.
const target = e2.findSettleTargetForLine('LINE_C');
assert.equal(target.number, 3);

// Followers use the explicit state machine.
e2.settlingLineId = 'LINE_B';
assert.equal(e2.getLineFollowMode(e2.rider(5)), LINE_FOLLOW_MODE.SETTLING);
e2.settlingLineId = null;
assert.equal(e2.getLineFollowMode(e2.rider(5)), LINE_FOLLOW_MODE.LOCKED_FOLLOW);
e2.rider(5).action = ACTION.BLOCK;
assert.equal(e2.getLineFollowMode(e2.rider(5)), LINE_FOLLOW_MODE.FREE);

console.log('PASS CR-0009 persistent inside-close + line docking + follow-mode state machine');
