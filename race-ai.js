// KEIRIN FLOW — 自律レースAI (Autonomous Race AI)
//
// Every rider decides every tick from what it can actually observe:
//   SENSE   : remaining distance, own energy, who is ahead / behind / outside, line mates
//   ASSESS  : own style (先行 / 捲り / 追込), strike point, threat level
//   DECIDE  : one action with a human-readable reason
//   ACT     : target speed + lane handed to the physics engine
//   REASSESS: memory per rider so decisions persist and can change when the race changes
//
// Rules of this file (charter):
//   * No car numbers, no line ids, no fixed phases. Only roles (LEADER/BANTE/...),
//     abilities, energy, positions and distances.
//   * Deterministic: the same setup always produces the same race.
//   * Every action change is written to the Decision Log with the numbers behind it.

import { ACTION, ROLE, MINDSET, TRACK_LANE } from './race-plan.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = v => `${Math.round(v * 100)}%`;
const FOLLOW_GAP = 14.5; // wheel-to-wheel spacing used while following (min legal gap is 13.5)

// Speeds in m/s. Real keirin: cruising ~14-16, bell ~16-17, sprint ~18-20+.
export const PACE = Object.freeze({
  RED_BOARD: 770,      // 赤板: pacer-cut moves begin
  PACER_EXIT_MAX: 640, // pacer always leaves by here
  BELL: 600,
  FINAL_STRAIGHT: 110,
  CRUISE: 13.6,
  BELL_PACE: 15.4
});

export class RaceAI {
  constructor() { this.memory = new Map(); this.pacerCut = null; this.contests = []; }

  reset() { this.memory.clear(); this.pacerCut = null; this.contests = []; }

  mem(rider) {
    if (!this.memory.has(rider.number)) {
      this.memory.set(rider.number, {
        key: null, strikeAt: null, style: null, struck: false, gaveUp: false,
        contestTime: 0, blockUntil: -1, blockCooldownUntil: -1, defending: false
      });
    }
    return this.memory.get(rider.number);
  }

  // ---------- style / strike point (derived from abilities, never from numbers) ----------
  styleOf(rider) {
    const p = rider.profile;
    const senko = p.endurance * .45 + p.power * .30 + p.aggression * .25 + (rider.mindset === MINDSET.TSUPPARI ? .05 : 0);
    const makuri = p.acceleration * .50 + p.power * .25 + p.tacticalIQ * .25 + (rider.mindset === MINDSET.YIELD_AND_ROLL ? .05 : 0);
    return senko >= makuri ? 'SENKO' : 'MAKURI';
  }

  strikeDistance(rider, style) {
    const p = rider.profile;
    if (style === 'SENKO') return clamp(430 + (p.endurance - .8) * 700 + (p.aggression - .65) * 200, 300, 560);
    return clamp(280 + (p.acceleration - .8) * 200 + (p.tacticalIQ - .8) * 100, 220, 340);
  }

  sprintSpeed(rider) {
    const p = rider.profile, e = rider.energy;
    const fatigue = e < .4 ? .80 + .5 * e : 1; // an empty rider cannot hold its top speed
    return (p.topSpeed * (.90 + .10 * e) + p.sprintBonus * e * 1.4) * fatigue;
  }
  strength(rider) { const p = rider.profile; return p.power * .45 + p.acceleration * .25 + rider.energy * .30; }

  // ---------- pacer-cut (誘導切り) resolution, decided once at the red board ----------
  _resolvePacerCut(engine) {
    if (this.pacerCut) return;
    const pr = engine.prediction;
    const cutter = engine.rider(pr?.pacerCut?.leaderNumber);
    const front = engine.rider(pr?.initialFrontLeaderNumber);
    if (!cutter || !front || cutter.number === front.number) { this.pacerCut = { done: true }; return; }
    this.pacerCut = { cutterNumber: cutter.number, frontNumber: front.number, outcome: null, done: false };
  }

  pacerCanExit(engine) {
    if (engine.raceClock.remainingDistance <= PACE.PACER_EXIT_MAX) return true;
    return !!this.pacerCut?.outcome;
  }

  // ---------- main entry ----------
  plan(rider, engine) {
    const rem = engine.raceClock.remainingDistance;
    const m = this.mem(rider);
    if (!m.style) { m.style = this.styleOf(rider); m.strikeAt = this.strikeDistance(rider, m.style); }
    if (rem <= PACE.RED_BOARD) this._resolvePacerCut(engine);

    this._noteFatigue(rider, engine, m, rem);

    let d = this._contestDecision(rider, engine, rem);
    if (!d && rem <= PACE.FINAL_STRAIGHT) d = this.finalStraight(rider, engine, m);
    if (!d) {
      const role = rider.role;
      if (role === ROLE.LEADER) d = this.leader(rider, engine, m, rem);
      else if (role === ROLE.SOLO) d = this.solo(rider, engine, m, rem);
      else d = this.follower(rider, engine, m, rem);
    }
    this._log(rider, engine, m, d);
    return this._toPlan(rider, engine, d);
  }

  // ---------- helpers ----------
  _nearestAheadInCorridor(rider, engine, maxGap = 60) {
    let best = null;
    for (const o of engine.riders) {
      if (o.finished || o.number === rider.number) continue;
      const gap = o.distance - rider.distance;
      if (gap <= 0 || gap > maxGap) continue;
      if (Math.abs(o.laneOffset - rider.laneOffset) > 14) continue;
      if (!best || gap < best.gap) best = { rider: o, gap };
    }
    return best;
  }

  // Who is really at the front: riders dropping back after a lost contest don't count.
  _retreating(o) { const om = this.memory.get(o.number); return o.action === ACTION.RETREAT || (om?.gaveUp && !om?.retreatDone); }
  _frontRunner(engine) {
    let best = null;
    for (const o of engine.riders) if (!o.finished && !this._retreating(o) && (!best || o.distance > best.distance)) best = o;
    return best;
  }
  _aheadNotRetreating(rider, engine) {
    let best = null;
    for (const o of engine.riders) {
      if (o.finished || o.number === rider.number || this._retreating(o)) continue;
      const gap = o.distance - rider.distance;
      if (gap > 0 && (!best || gap < best.distance - rider.distance)) best = o;
    }
    return best;
  }

  _attackLane(rider, engine) {
    // one lane outside the widest rider in the zone we must pass
    let widest = TRACK_LANE.INNER;
    for (const o of engine.riders) {
      if (o.finished || o.number === rider.number) continue;
      const gap = o.distance - rider.distance;
      if (gap > -10 && gap < 70) widest = Math.max(widest, o.laneOffset);
    }
    return clamp(widest + 16, -2, 42);
  }

  _followPlan(target, reason, extra = {}) {
    return { action: ACTION.FOLLOW, followTarget: target, reason, ...extra };
  }

  // ---------- LEADER ----------
  leader(rider, engine, m, rem) {
    const p = rider.profile;
    const pc = this.pacerCut;
    const isRaceLeader = this._frontRunner(engine)?.number === rider.number;

    // 1) Pacer phase: the front leader sits behind the pacer.
    if (engine.pacer.state !== 'EXITED' && isRaceLeader && !(pc && pc.cutterNumber === rider.number && !pc.outcome)) {
      if (pc && pc.frontNumber === rider.number && !pc.outcome) return this._frontResponse(rider, engine, m, pc);
      return { action: ACTION.CONTROL_PACE, speed: Math.max(engine.pacer.speed + (engine.pacer.distance - 17 - rider.distance) * .3, 0), lane: TRACK_LANE.INNER, reason: '誘導員の後ろで隊列を維持' };
    }

    // 2) Pacer-cut attacker.
    if (pc && pc.cutterNumber === rider.number && !pc.outcome) {
      const front = engine.rider(pc.frontNumber);
      const gap = front.distance - rider.distance;
      if (gap < -4) { pc.outcome = 'CUT'; pc.done = true; return { action: ACTION.CONTROL_PACE, speed: engine.pacer.speed + 1, lane: TRACK_LANE.INNER, reason: '誘導切り成功。前受けラインの前に入って隊列を整える' }; }
      return { action: ACTION.MOVE_UP, speed: Math.min(front.speed + 7, 17.5), lane: this._attackLane(rider, engine), reason: `赤板から誘導切りへ外を上昇 (前受けまで${Math.max(0, gap).toFixed(0)}m)` };
    }

    // 3) Gave up a contest: drop back behind the field, then wait for a second chance.
    if (m.gaveUp && !m.retreatDone) {
      let tail = null;
      for (const o of engine.riders) if (!o.finished && o.lineId !== rider.lineId && (!tail || o.distance < tail.distance)) tail = o;
      if (tail && rider.distance > tail.distance - 15 && engine.raceClock.remainingDistance > 300) {
        const front = this._frontRunner(engine);
        return { action: ACTION.RETREAT, speed: Math.max(7, Math.min(tail.speed, front?.speed ?? tail.speed) - 5.5), lane: TRACK_LANE.OUTSIDE, reason: '突っ張られたので外を下げ、後方へ引いて立て直す' };
      }
      m.retreatDone = true;
    }

    // 4) Strike: our planned moment has come (or the race is slipping away).
    const lead = this._frontRunner(engine);
    const iLead = lead?.number === rider.number;
    const threat = this._incomingAttack(rider, engine);

    if (iLead) {
      if (threat) return this._defendOrConcede(rider, engine, m, threat, rem);
      m.contestTime = 0;
      // front-runner (先行) winds the pace up from its strike point to hold everyone off
      if (rem <= m.strikeAt && rider.energy > .12) {
        m.struck = true;
        return { action: ACTION.ATTACK, speed: this.sprintSpeed(rider) - 2.4, lane: TRACK_LANE.INNER, reason: `残${rem.toFixed(0)}mから主導権を握って先行 (残脚${pct(rider.energy)})` };
      }
      const pace = rem <= PACE.BELL ? PACE.BELL_PACE : PACE.CRUISE;
      return { action: ACTION.CONTROL_PACE, speed: pace, lane: TRACK_LANE.INNER, reason: rem <= PACE.BELL ? '打鐘。先頭でペースを上げて主導権を維持' : '先頭でペースを作る' };
    }

    // not leading: should I go now?
    const lateAndStillBehind = rem <= 140 && engine.positionRank(rider) >= 4 && rider.energy > .2;
    // the further back we sit, the earlier a makuri has to start
    const behindBy = lead ? lead.distance - rider.distance : 0;
    const strikeAt = m.style === 'MAKURI' ? m.strikeAt + clamp((behindBy - 35) * 1.5, 0, 80) : m.strikeAt;
    const strikeNow = (!m.gaveUp && rem <= strikeAt && rider.energy > .25) || (m.gaveUp && rem <= Math.min(m.strikeAt, 260) && rider.energy > .22) || lateAndStillBehind || m.struck;
    if (strikeNow && rider.energy > .08) {
      if (!m.struck) m.struck = true;
      const leadGap = lead.distance - rider.distance;
      const why = m.style === 'SENKO' ? '叩いて主導権を奪いにいく' : '中団から捲りに出る';
      const blocker = this._blockerOn(rider, engine);
      if (blocker) return { action: ACTION.ATTACK, speed: this.sprintSpeed(rider), lane: this._attackLane(rider, engine), reason: `${blocker.number}番のブロックで外へ持っていかれながら踏む (残脚${pct(rider.energy)})`, tag: 'BLOCKED' };
      return { action: ACTION.ATTACK, speed: this.sprintSpeed(rider), lane: this._attackLane(rider, engine), reason: `残${rem.toFixed(0)}mで${why} (先頭まで${leadGap.toFixed(0)}m・残脚${pct(rider.energy)})` };
    }

    const corridor = this._nearestAheadInCorridor(rider, engine, 80);
    const ahead = corridor && !this._retreating(corridor.rider) ? corridor : (this._aheadNotRetreating(rider, engine) ? { rider: this._aheadNotRetreating(rider, engine) } : null);
    if (ahead) return this._followPlan(ahead.rider, m.gaveUp ? '一度引いて脚を回復。後方から再仕掛けを待つ' : `前のラインの後ろで脚を溜める (仕掛け予定 残${m.strikeAt.toFixed(0)}m)`, { lane: TRACK_LANE.INNER });
    return { action: ACTION.CONTROL_PACE, speed: PACE.CRUISE, lane: TRACK_LANE.INNER, reason: '位置を保つ' };
  }

  _frontResponse(rider, engine, m, pc) {
    // Front-line leader reacts when the pacer-cut attacker arrives alongside.
    const cutter = engine.rider(pc.cutterNumber);
    const gap = rider.distance - cutter.distance;
    if (gap > 14) return { action: ACTION.CONTROL_PACE, speed: Math.max(engine.pacer.speed + (engine.pacer.distance - 17 - rider.distance) * .3, 0), lane: TRACK_LANE.INNER, reason: '前受けで誘導員の後ろ。外からの上昇を待つ' };
    const mine = this.strength(rider) + (rider.mindset === MINDSET.TSUPPARI ? .06 : rider.mindset === MINDSET.YIELD_AND_ROLL ? -.20 : 0);
    const theirs = this.strength(cutter);
    if (mine > theirs + .02) {
      pc.outcome = 'CONTEST';
      this._startContest(cutter, rider, engine, '誘導切りに来た相手を突っ張る');
      return { action: ACTION.DEFEND, speed: cutter.speed + 1.2, lane: TRACK_LANE.INNER, reason: `外から来た相手を突っ張る (自分${mine.toFixed(2)} > 相手${theirs.toFixed(2)})` };
    }
    pc.outcome = 'YIELD';
    return { action: ACTION.YIELD, speed: engine.pacer.speed - .6, lane: TRACK_LANE.INNER, reason: `無理に張り合わず誘導切りを受け入れる (自分${mine.toFixed(2)} ≦ 相手${theirs.toFixed(2)})` };
  }

  _incomingAttack(rider, engine) {
    let best = null;
    for (const o of engine.riders) {
      if (o.finished || o.number === rider.number || (o.lineId && o.lineId === rider.lineId)) continue;
      if (![ACTION.ATTACK, ACTION.MOVE_UP, ACTION.SWITCH_TO_SELF_POWER].includes(o.action)) continue;
      const gap = rider.distance - o.distance; // positive: attacker is behind
      if (gap < -3 || gap > 30) continue;
      if (o.laneOffset < rider.laneOffset + 6) continue;
      if (!best || gap < best.gap) best = { rider: o, gap };
    }
    return best;
  }

  _defendOrConcede(rider, engine, m, threat, rem) {
    const attacker = threat.rider;
    const mine = this.strength(rider), theirs = this.strength(attacker);
    if (attacker.distance > rider.distance + 4) {
      m.defending = false;
      return this._followPlan(attacker, `${attacker.number}番に叩かれたため後ろに付けて立て直す`, { lane: TRACK_LANE.INNER });
    }
    if (m.style === 'SENKO' || rider.mindset === MINDSET.TSUPPARI || rem <= m.strikeAt) {
      if (rider.energy > .18 && mine >= theirs - .05) {
        m.defending = true;
        if (Math.abs(rider.distance - attacker.distance) < 10) this._startContest(attacker, rider, engine, '主導権を渡さず合わせて踏む');
        return { action: ACTION.DEFEND, speed: this.sprintSpeed(rider), lane: TRACK_LANE.INNER, reason: `${attacker.number}番の仕掛けに合わせて踏み上げ主導権を守る (残脚${pct(rider.energy)})` };
      }
    }
    m.defending = false;
    // keep riding our own pace; slowing down would only hand the race away
    const ownPace = m.struck ? this.sprintSpeed(rider) - 2.4 : Math.max(PACE.BELL_PACE, rider.speed);
    return { action: m.struck ? ACTION.ATTACK : ACTION.CONTROL_PACE, speed: ownPace, lane: TRACK_LANE.INNER, reason: `${attacker.number}番の勢いが上と判断。合わせ踏みはせず自分のペースを守る` };
  }

  // ---------- BANTE / LINE FOLLOWER ----------
  follower(rider, engine, m, rem) {
    const front = engine.rider(rider.frontLineMate);
    const leader = engine.rider(rider.leaderNumber);

    // Bante block (番手の牽制) against an attacker of another line.
    if (rider.role === ROLE.BANTE && rem < 520 && rider.energy > .25) {
      const now = engine.elapsedTime;
      if (now < m.blockUntil) return { action: ACTION.BLOCK, speed: Math.max(rider.speed, front?.speed ?? rider.speed), lane: m.blockLane, reason: m.blockReason };
      if (now >= m.blockCooldownUntil) {
        const t = this._blockTarget(rider, engine);
        if (t && rider.profile.blockSkill * rider.energy > .35) {
          m.blockUntil = now + 1.0; m.blockCooldownUntil = now + 2.5;
          m.blockLane = clamp(t.laneOffset - 8, rider.laneOffset, 34);
          m.blockReason = `${t.number}番の捲りに外へ張って牽制 (ブロック力${pct(rider.profile.blockSkill)})`;
          return { action: ACTION.BLOCK, speed: Math.max(rider.speed, front?.speed ?? rider.speed), lane: m.blockLane, reason: m.blockReason };
        }
      }
    }

    // Lost the wheel? (front mate faded far away or is way off line)
    if (!front || front.finished || front.distance - rider.distance > 40) {
      const ahead = engine.findNearestAhead(rider);
      if (ahead) return this._followPlan(ahead, 'ラインが離れたため前の選手を追う', { lane: ahead.laneOffset });
      return { action: ACTION.CONTROL_PACE, speed: PACE.CRUISE, lane: TRACK_LANE.INNER, reason: '位置を保つ' };
    }

    // Bante switches to own power when its leader is clearly spent late in the race.
    if (rider.role === ROLE.BANTE && rem < 220 && leader && leader.energy < .10 && rider.energy > .35 && front.speed < rider.profile.topSpeed - 2) {
      return { action: ACTION.SWITCH_TO_SELF_POWER, speed: this.sprintSpeed(rider), lane: this._attackLane(rider, engine), reason: `前の${front.number}番が一杯 (残脚${pct(leader.energy)})。自力に切り替えて踏む` };
    }
    return this._followPlan(front, `${front.number}番の後ろを追走`, { lane: front.laneOffset });
  }

  _blockTarget(rider, engine) {
    let best = null;
    for (const o of engine.riders) {
      if (o.finished || o.number === rider.number || (o.lineId && o.lineId === rider.lineId)) continue;
      if (![ACTION.ATTACK, ACTION.FULL_CONTEST, ACTION.SWITCH_TO_SELF_POWER].includes(o.action)) continue;
      const gap = rider.distance - o.distance;
      if (gap < -4 || gap > 16) continue;
      if (o.laneOffset <= rider.laneOffset + 4 || o.laneOffset > rider.laneOffset + 30) continue;
      if (o.speed - rider.speed < .3) continue;
      if (!best || gap < best.gap) best = { r: o, gap };
    }
    return best?.r ?? null;
  }

  _blockerOn(rider, engine) {
    for (const b of engine.riders) {
      if (b.finished || b.number === rider.number || b.action !== ACTION.BLOCK) continue;
      if (b.lineId && b.lineId === rider.lineId) continue;
      if (Math.abs(b.distance - rider.distance) < 22 && Math.abs(b.laneOffset - rider.laneOffset) < 26) return b;
    }
    return null;
  }

  // ---------- 踏み合い / 競り合い (side-by-side contest) ----------
  _startContest(attacker, defender, engine, why) {
    if (this.contests.some(c => [c.attacker, c.defender].some(n => n === attacker.number || n === defender.number))) return;
    if (engine.elapsedTime < (this.mem(attacker).noContestUntil ?? -1)) return;
    this.contests.push({ attacker: attacker.number, defender: defender.number, start: engine.elapsedTime });
    engine.emitDecision({ riderNumber: defender.number, category: 'CONTEST', action: ACTION.FULL_CONTEST,
      message: `${why}。${attacker.number}番と並んで踏み合い (残脚 ${attacker.number}番${pct(attacker.energy)} / ${defender.number}番${pct(defender.energy)})` });
  }

  _resolveContests(engine) {
    if (this._resolvedAt === engine.elapsedTime) return;
    this._resolvedAt = engine.elapsedTime;
    for (const c of [...this.contests]) {
      const a = engine.rider(c.attacker), d = engine.rider(c.defender);
      const elapsed = engine.elapsedTime - c.start;
      const lead = a.distance - d.distance;
      const sa = this.strength(a), sd = this.strength(d) + .03; // the inside rider has the shorter path
      let winner = null;
      if (lead > 6) winner = 'ATTACKER';
      else if (lead < -9 && elapsed >= 1.5) winner = 'DEFENDER';
      else if (elapsed >= 1.2 && Math.abs(lead) < 9) {
        if (a.energy < .2 || sa < sd - .03) winner = 'DEFENDER';
        else if (d.energy < .15 || sd < sa - .06) winner = 'ATTACKER';
      }
      if (!winner && elapsed >= 4) winner = sa > sd ? 'ATTACKER' : 'DEFENDER';
      if (!winner) continue;
      this.contests = this.contests.filter(x => x !== c);
      const secs = elapsed.toFixed(1);
      if (winner === 'DEFENDER') {
        const am = this.mem(a); am.gaveUp = true; am.retreatDone = false; am.struck = false; am.noContestUntil = engine.elapsedTime + 3;
        const late = engine.raceClock.remainingDistance <= 430;
        engine.emitDecision({ riderNumber: a.number, category: 'CONTEST', action: ACTION.RETREAT, message: `${secs}秒の踏み合いで${d.number}番に競り負け、${late ? '前に出られず' : '後ろへ下げる'} (残脚${pct(a.energy)})` });
        engine.emitDecision({ riderNumber: d.number, category: 'CONTEST', action: ACTION.DEFEND, message: `踏み合いを制して前を守る。ただし脚を使った (残脚${pct(d.energy)})` });
      } else {
        const dm = this.mem(d); dm.beaten = true; dm.noContestUntil = engine.elapsedTime + 3;
        if (this.pacerCut && this.pacerCut.cutterNumber === a.number) this.pacerCut.outcome = 'CUT';
        engine.emitDecision({ riderNumber: a.number, category: 'CONTEST', action: ACTION.ATTACK, message: `${secs}秒の踏み合いを制して${d.number}番を叩き切る (残脚${pct(a.energy)})` });
      }
    }
  }

  _contestDecision(rider, engine, rem) {
    this._resolveContests(engine);
    const c = this.contests.find(x => x.attacker === rider.number || x.defender === rider.number);
    if (!c) return null;
    const isDefender = c.defender === rider.number;
    const other = engine.rider(isDefender ? c.attacker : c.defender);
    const lane = isDefender ? TRACK_LANE.INNER : Math.max(rider.laneOffset, other.laneOffset + 16);
    return { action: ACTION.FULL_CONTEST, speed: this.sprintSpeed(rider) + (isDefender ? .2 : 0), lane,
      reason: isDefender ? `${other.number}番を内で張って踏み合い中` : `${other.number}番の外で並んで踏み合い中`, silent: true };
  }

  _noteFatigue(rider, engine, m, rem) {
    if (m.tiredLogged || rem < 30 || rider.energy > .22) return;
    if (![ACTION.ATTACK, ACTION.DEFEND, ACTION.FULL_CONTEST, ACTION.CONTROL_PACE, ACTION.FINAL_SPRINT].includes(rider.action)) return;
    if (engine.positionRank(rider) > 3) return; // only worth announcing for riders at the front
    m.tiredLogged = true;
    engine.emitDecision({ riderNumber: rider.number, category: 'FATIGUE', action: ACTION.FADE, message: `脚が一杯になりタレ始める (残脚${pct(rider.energy)}・${rider.speed.toFixed(1)}m/s)` });
  }

  // ---------- SOLO ----------
  solo(rider, engine, m, rem) {
    const ahead = this._nearestAheadInCorridor(rider, engine, 80) ?? (engine.findNearestAhead(rider) ? { rider: engine.findNearestAhead(rider) } : null);
    if (rem <= m.strikeAt * .6 && rider.energy > .3 && engine.positionRank(rider) >= 4) {
      return { action: ACTION.ATTACK, speed: this.sprintSpeed(rider), lane: this._attackLane(rider, engine), reason: `単騎で自力発進 (残脚${pct(rider.energy)})` };
    }
    if (ahead) return this._followPlan(ahead.rider, `単騎。${ahead.rider.number}番の後ろに付けて脚を溜める`, { lane: ahead.rider.laneOffset });
    return { action: ACTION.CONTROL_PACE, speed: PACE.CRUISE, lane: TRACK_LANE.INNER, reason: '単騎で位置を保つ' };
  }

  // ---------- FINAL STRAIGHT ----------
  finalStraight(rider, engine, m) {
    if (rider.energy <= .04) return { action: ACTION.FADE, speed: rider.profile.topSpeed * .75, lane: rider.laneOffset, reason: '脚が残っておらず失速' };
    const ahead = this._nearestAheadInCorridor(rider, engine, 22);
    let lane = rider.laneOffset;
    if (ahead && ahead.rider.speed < rider.speed + 1.5) lane = clamp(ahead.rider.laneOffset + 13, -18, 44); // 外へ持ち出して抜く
    const pos = engine.positionRank(rider);
    return { action: ACTION.FINAL_SPRINT, speed: this.sprintSpeed(rider), lane, reason: `最後の直線。残脚${pct(rider.energy)}で${pos}番手から追い込む` };
  }

  // ---------- plan translation + logging ----------
  _toPlan(rider, engine, d) {
    let speed = d.speed;
    let followTargetNumber = null;
    if (d.action === ACTION.FOLLOW && d.followTarget) {
      followTargetNumber = d.followTarget.number;
      // Slipstream following: a follower can match a wheel faster than its own solo pace.
      const t = d.followTarget, gap = t.distance - rider.distance;
      speed = Math.max(0, t.speed + clamp((gap - FOLLOW_GAP) * .35, -2.5, 4) + clamp((t.speed - rider.speed) * .6, -2, 2));
    }
    // Nobody can ride faster than their own sprint ceiling, whatever the tactic asks for.
    speed = Math.min(speed ?? PACE.CRUISE, rider.profile.topSpeed + rider.profile.sprintBonus);
    const lane = Number.isFinite(d.lane) ? d.lane : rider.laneOffset;
    return {
      action: d.action, targetSpeed: Math.max(0, speed ?? PACE.CRUISE), laneTarget: lane,
      followTargetNumber, reason: d.reason, scenarioControlled: false,
      laneRate: [ACTION.ATTACK, ACTION.BLOCK, ACTION.FINAL_SPRINT].includes(d.action) ? 2.8 : 2.2
    };
  }

  _log(rider, engine, m, d) {
    const key = `${d.action}|${d.followTarget?.number ?? ''}`;
    if (key === m.key) return;
    m.key = key;
    if (d.silent) return; // contest start/end is logged by the contest itself
    if (d.action === ACTION.FOLLOW && !/引いて|叩かれ|離れた|単騎/.test(d.reason)) return; // ordinary following is noise
    engine.emitDecision({ riderNumber: rider.number, category: 'AI_DECISION', action: d.action, message: d.reason });
  }
}
