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
// 「前後に何台分」という距離は、エンジンの車間(1台分)に合わせて伸び縮みさせる (engine.unit = 車間 / 7.8m)
const U = (engine, x) => x * (engine?.unit ?? 1);
export let SENKO_EFFORT = 1.2;
export const setSenkoEffort = v => { SENKO_EFFORT = v; };
const pct = v => `${Math.round(v * 100)}%`;

// Speeds in m/s. Real keirin: cruising ~14-16, bell ~16-17, sprint ~18-20+.
export const PACE = Object.freeze({
  RED_BOARD: 770,      // 赤板: pacer-cut moves begin
  PACER_EXIT_MAX: 640, // pacer always leaves by here
  BELL: 600,
  FINAL_STRAIGHT: 65,  // 最終4コーナーの出口あたり (400バンクの直線は約50m)
  CRUISE: 13.6,
  BELL_PACE: 15.4
});

// 展開としてユーザーが選べる戦法
export const TACTICS = Object.freeze(['SENKO', 'KAMASHI', 'MAKURI', 'OIKOMI']);
export const TACTIC_LABEL = Object.freeze({ SENKO: '先行', KAMASHI: 'カマシ', MAKURI: '捲り', OIKOMI: '追込' });

export class RaceAI {
  constructor() { this.memory = new Map(); this.pacerCut = null; this.contests = []; this.seri = new Map(); }

  reset() { this.memory.clear(); this.pacerCut = null; this.contests = []; this.seri = new Map(); }

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
    // 出走表の決まり手の実績 (逃げで勝つか、捲りで勝つか) で判断を傾ける
    return senko + (p.styleBias ?? 0) >= makuri ? 'SENKO' : 'MAKURI';
  }

  strikeDistance(rider, style) {
    const p = rider.profile;
    if (style === 'OIKOMI') return 0; // 追込: 最後の直線まで仕掛けない
    if (style === 'KAMASHI') return clamp(520 + (p.acceleration - .8) * 200, 460, 600); // 打鐘前後に後方から一気に
    if (style === 'SENKO') return clamp(410 + (p.endurance - .8) * 300 + (p.aggression - .65) * 150, 300, 480);
    return clamp((globalThis.KF_TUNE?.mk ?? 330) + (p.acceleration - .8) * 200 + (p.tacticalIQ - .8) * 100 - (p.strikeLater ?? 0), 180, 400);
  }

  sprintSpeed(rider) {
    const p = rider.profile, e = rider.energy, T = globalThis.KF_TUNE ?? {};
    const fatigue = e < .4 ? .72 + .7 * e : 1; // an empty rider cannot hold its top speed
    // (残脚で上乗せできる速さの幅。広すぎると、脚を溜めただけの選手が直線で楽に突き抜けてしまう)
    return (p.topSpeed * (.90 + .10 * e) + p.sprintBonus * ((T.sb0 ?? 0) + (T.sb1 ?? .7) * e)) * fatigue;
  }
  // 追走で出せる上限の速さ (自分の今のスプリント + 風よけで楽になる分)
  followCap(rider, wheel = null, now = 0) {
    const T = globalThis.KF_TUNE ?? {};
    // 前がラインの仲間で、ダッシュで踏み出している最中なら、後ろはその風よけに引っ張られて一緒に上がっていける
    // (捲りやカマシは、ライン全体で上がっていく)
    const pull = wheel && wheel.lineId && wheel.lineId === rider.lineId && (wheel._dashUntil ?? -1) > now ? (wheel._dash ?? 0) * (T.fdash ?? .8) : 0;
    return this.sprintSpeed(rider) + (rider.profile.followAllowance ?? T.fa ?? 0.6) + pull;
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
    if (engine.raceClock.remainingDistance / (engine.lapScale ?? 1) <= PACE.PACER_EXIT_MAX) return true;
    return !!this.pacerCut?.outcome;
  }

  // ---------- main entry ----------
  plan(rider, engine) {
    this._engine = engine;
    // 400バンクに直した残り距離 (333・500バンクでも、周回の何割かで同じように判断する)
    const rem = engine.raceClock.remainingDistance / (engine.lapScale ?? 1);
    const m = this.mem(rider);
    if (!m.style) {
      // ユーザーが展開を指定していればそれを優先 (先行 / カマシ / 捲り / 追込)、なければ能力から決める
      m.style = TACTICS.includes(rider.profile.tactic) ? rider.profile.tactic : (TACTICS.includes(rider.profile.tacticPlan) ? rider.profile.tacticPlan : this.styleOf(rider));
      m.forced = TACTICS.includes(rider.profile.tactic);
      m.strikeAt = this.strikeDistance(rider, m.style);
    }
    if (rem <= PACE.RED_BOARD) this._resolvePacerCut(engine);

    this._noteFatigue(rider, engine, m, rem);

    let d = this._contestDecision(rider, engine, rem);
    if (!d && rider.profile.seriTarget && !engine.setup?.rules?.noBlock && rem > PACE.FINAL_STRAIGHT) d = this._seriDecision(rider, engine, m, rem);
    if (!d && rem <= PACE.FINAL_STRAIGHT) d = this.finalStraight(rider, engine, m);
    if (!d) {
      const role = rider.role;
      if (role === ROLE.LEADER) d = this.leader(rider, engine, m, rem);
      // 自力型の単騎 (逃・両) は「1人のライン」として先頭の判断をする。追込型の単騎は他のラインに付ける
      else if (role === ROLE.SOLO && rider.profile.aggression >= 0.62) d = this.leader(rider, engine, m, rem);
      else if (role === ROLE.SOLO) d = this.solo(rider, engine, m, rem);
      else d = this.follower(rider, engine, m, rem);
    }
    this._log(rider, engine, m, d);
    return this._toPlan(rider, engine, d);
  }

  // ---------- helpers ----------
  _nearestAheadInCorridor(rider, engine, maxGap = 60) {
    maxGap = U(engine, maxGap); // 「何台分先まで見るか」(7.8m 基準の値を車間に合わせる)
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
  _retreating(o, depth = 0) {
    const om = this.memory.get(o.number);
    if (o.action === ACTION.RETREAT || (om?.gaveUp && !om?.retreatDone)) return true;
    // 下げているラインの後ろの選手も、一緒に下げている
    if (depth === 0 && o.leaderNumber && o.leaderNumber !== o.number && o.lineId) {
      const leader = this._engine?.rider(o.leaderNumber);
      if (leader && !leader.finished && this._retreating(leader, 1) && o.followTargetNumber != null) return true;
    }
    return false;
  }
  _frontRunner(engine) {
    let best = null;
    for (const o of engine.riders) if (!o.finished && !this._retreating(o) && (!best || o.distance > best.distance)) best = o;
    return best;
  }
  // Following someone whose own wheel (or his wheel's wheel...) is me would make a circle of riders slowing each other down.
  _followsMe(target, rider, engine) {
    let cur = target;
    for (let i = 0; i < 10 && cur; i++) {
      if (cur.number === rider.number) return true;
      cur = cur.followTargetNumber ? engine.rider(cur.followTargetNumber) : null;
    }
    return false;
  }

  // Keep following the same wheel while it is still a sensible wheel (stops target flicker).
  _sticky(rider, candidate, engine) {
    const cur = rider.followTargetNumber ? engine.rider(rider.followTargetNumber) : null;
    if (cur && !cur.finished && !this._retreating(cur) && cur.distance > rider.distance && cur.distance - rider.distance < U(engine, 40)) return cur;
    return candidate;
  }

  // Don't slot into the middle of someone else's line: aim for that line's last rider instead.
  _lineTailAhead(target, rider, engine) {
    if (!target?.lineId || target.lineId === rider.lineId) return target;
    // その列の最後尾 (自分の真横や少し後ろにいても、そこへ下がって付く)
    let tail = target;
    for (const o of engine.riders) {
      if (o.finished || o.lineId !== target.lineId || this._retreating(o)) continue;
      if (o.distance > rider.distance - 25 && o.distance < tail.distance) tail = o;
    }
    return tail;
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
    // Go one lane outside the widest rider we actually have to beat...
    let widest = TRACK_LANE.INNER;
    for (const o of engine.riders) {
      if (o.finished || o.number === rider.number || this._retreating(o)) continue;
      if (o.lineId && o.lineId === rider.lineId) continue; // own line mates are behind us, not in the way
      const gap = o.distance - rider.distance;
      // 外を回って越えなければいけないのは「前にいる」選手だけ。横や後ろで外にいる選手のさらに外へ出る必要はない
      // (横の選手の外へ出ようとすると、出られずに包まれた扱いになって減速してしまう)
      if (gap > U(engine, 1) && gap < U(engine, 70)) widest = Math.max(widest, o.laneOffset);
    }
    const wanted = clamp(widest + 16, -2, 42);
    // ...but never pick a lane where a slower rider sits right in front of us (we'd be stuck behind him).
    // 「遅い」は自分が本来出せる速度と比べる (後ろで詰まると今の速度は前と同じになり、いつまでも抜け出せないため)
    const mySpeed = Math.max(rider.speed, this.sprintSpeed(rider) - 1);
    const blocked = lane => engine.riders.some(o => {
      if (o.finished || o.number === rider.number) return false;
      const gap = o.distance - rider.distance;
      return gap > 0 && gap < U(engine, 45) && Math.abs(o.laneOffset - lane) < 11 && (this._retreating(o) || o.speed < mySpeed - 2.5);
    });
    const lanes = [-2, 14, 30, 42];
    // 外がすべて塞がっていれば、空いている内側の走路を探す (それも無ければ一番外で待つ)
    return lanes.find(l => l >= wanted && !blocked(l)) ?? [...lanes].reverse().find(l => !blocked(l)) ?? (!blocked(TRACK_LANE.INNER) ? TRACK_LANE.INNER : wanted);
  }

  _followPlan(target, reason, extra = {}) {
    return { action: ACTION.FOLLOW, followTarget: target, reason, ...extra };
  }

  // 安全な追走先: 自分より前にいて、輪になって追いかけ合わない選手
  _safeWheel(candidate, rider, engine) {
    // 付く相手は「自分よりはっきり前にいる」選手だけ (横や後ろの選手に付くと、お互いに減速し合う)
    const ok = c => c && !c.finished && c.distance > rider.distance + U(engine, 2) && !this._followsMe(c, rider, engine);
    if (ok(candidate)) return candidate;
    const ahead = this._aheadNotRetreating(rider, engine);
    return ok(ahead) ? ahead : null;
  }

  // ---------- LEADER ----------
  leader(rider, engine, m, rem) {
    const p = rider.profile;
    const pc = this.pacerCut;
    const isRaceLeader = this._frontRunner(engine)?.number === rider.number;

    const cutting = pc && pc.cutterNumber === rider.number && (!pc.outcome || pc.outcome === 'YIELD');

    // 0) Front leader who chose to let the pacer-cut line in: ease off until that whole line is in front.
    if (pc && ['YIELD', 'CUT'].includes(pc.outcome) && pc.frontNumber === rider.number && !m.letInDone) {
      const cutter = engine.rider(pc.cutterNumber);
      const cutTail = engine.riders.filter(o => !o.finished && o.lineId && o.lineId === cutter?.lineId).sort((a, b) => a.distance - b.distance)[0] ?? cutter;
      m.letInSince ??= engine.elapsedTime;
      if (!cutter || !cutTail || cutTail.distance >= rider.distance + U(engine, 14) || engine.elapsedTime - m.letInSince > 8) {
        m.letInDone = true;
        // 引く: 前に入れたら、そのまま後方まで下げて巻き返しを狙う
        if (m.hiku) { m.gaveUp = true; m.retreatDone = false; m.hikuRetreat = true; }
      }
      else {
        return { action: ACTION.YIELD, speed: Math.max(PACE.CRUISE - 4, (engine.pacer.state === 'EXITED' ? cutter.speed : Math.min(cutter.speed, engine.pacer.speed + 1)) - 2.5), lane: TRACK_LANE.INNER, reason: `${cutter.number}番のラインを前に入れるため、少し下げて待つ` };
      }
    }

    // 1) Pacer phase: the front leader sits behind the pacer.
    if (engine.pacer.state !== 'EXITED' && isRaceLeader && !cutting) {
      if (pc && pc.frontNumber === rider.number && !pc.outcome) return this._frontResponse(rider, engine, m, pc);
      return { action: ACTION.CONTROL_PACE, speed: Math.max(engine.pacer.speed + (engine.pacer.distance - engine.spacing.start - rider.distance) * .3, 0), lane: TRACK_LANE.INNER, reason: '誘導員の後ろで隊列を維持' };
    }

    // 2) Pacer-cut attacker.
    if (cutting) {
      const front = engine.rider(pc.frontNumber);
      const gap = front.distance - rider.distance;
      if (gap < -U(engine, 4)) { pc.outcome = 'CUT'; pc.done = true; return { action: ACTION.CONTROL_PACE, speed: engine.pacer.speed + 1, lane: TRACK_LANE.INNER, reason: '誘導切り成功。前受けラインの前に入って隊列を整える' }; }
      return { action: ACTION.MOVE_UP, speed: Math.min(front.speed + 7, 17.5), lane: this._attackLane(rider, engine), reason: `赤板から誘導切りへ外を上昇 (前受けまで${Math.max(0, gap).toFixed(0)}m)` };
    }

    // 3) Gave up a contest: drop back behind the field, then wait for a second chance.
    if (m.gaveUp && !m.retreatDone) {
      let tail = null;
      for (const o of engine.riders) if (!o.finished && o.lineId !== rider.lineId && (!tail || o.distance < tail.distance)) tail = o;
      if (tail && rider.distance > tail.distance - U(engine, 15) && engine.raceClock.remainingDistance / (engine.lapScale ?? 1) > 300) {
        const front = this._frontRunner(engine);
        return { action: ACTION.RETREAT, speed: Math.max(7, Math.min(tail.speed, front?.speed ?? tail.speed) - 5.5), lane: TRACK_LANE.OUTSIDE, reason: m.hikuRetreat ? '前受けから後方まで引いて、巻き返しを狙う' : '突っ張られたので外を下げ、後方へ引いて立て直す' };
      }
      m.retreatDone = true;
    }

    // 3b) Won a contest but not in front yet: keep going until we really are.
    if (m.mustTakeFront) {
      const beaten = engine.rider(m.mustTakeFront);
      if (beaten && !beaten.finished && rem > PACE.FINAL_STRAIGHT && rider.distance - beaten.distance < engine.spacing.follow * 1.6) {
        return { action: ACTION.ATTACK, speed: Math.max(beaten.speed + 2.5, PACE.BELL_PACE), lane: Math.max(rider.laneOffset, beaten.laneOffset + 14), reason: '競り勝ったので、そのまま前に出きる' };
      }
      m.mustTakeFront = null;
    }

    // 4) Strike: our planned moment has come (or the race is slipping away).
    const lead = this._frontRunner(engine);
    const iLead = lead?.number === rider.number;
    const threat = this._incomingAttack(rider, engine);
    // 先頭にいたのに他のラインに前へ出られた = 叩かれた (番手が切り替えを考えるきっかけ)
    if (m.wasFront && !iLead && lead && lead.lineId !== rider.lineId && lead.distance - rider.distance > engine.spacing.follow && rem < 600 && rem > PACE.FINAL_STRAIGHT && !m.beaten) {
      m.beaten = true;
      engine.emitDecision({ riderNumber: rider.number, category: 'AI_DECISION', action: ACTION.FOLLOW, message: `${lead.number}番に叩かれて先頭を明け渡す (残脚${pct(rider.energy)})` });
    }
    if (iLead) m.wasFront = true;
    else if (lead && lead.distance - rider.distance > engine.spacing.follow) m.wasFront = false;

    if (iLead) {
      if (threat) return this._defendOrConcede(rider, engine, m, threat, rem);
      m.contestTime = 0;
      // front-runner (先行) winds the pace up from its strike point to hold everyone off
      if (rem <= m.strikeAt && rider.energy > .12) {
        m.struck = true;
        // 先頭で一定のペースを刻む先行は、仕掛けや踏み合いほど脚を使わない
        return { action: ACTION.ATTACK, speed: this.sprintSpeed(rider) - (globalThis.KF_TUNE?.pace ?? 1.4), lane: TRACK_LANE.INNER, effortFactor: SENKO_EFFORT, reason: `残${rem.toFixed(0)}mから主導権を握って先行 (残脚${pct(rider.energy)})` };
      }
      const pace = rem <= PACE.BELL ? PACE.BELL_PACE : PACE.CRUISE;
      return { action: ACTION.CONTROL_PACE, speed: pace, lane: TRACK_LANE.INNER, reason: rem <= PACE.BELL ? '打鐘。先頭でペースを上げて主導権を維持' : '先頭でペースを作る' };
    }

    // not leading: should I go now?
    const lateAndStillBehind = m.style !== 'OIKOMI' && rem <= 140 && engine.positionRank(rider) >= 4 && rider.energy > .2;
    // the further back we sit, the earlier a makuri has to start
    const behindBy = lead ? lead.distance - rider.distance : 0;
    const strikeAt = m.style === 'MAKURI' ? m.strikeAt + clamp((behindBy / U(engine, 1) - 35) * (globalThis.KF_TUNE?.mkb ?? 1.5), 0, globalThis.KF_TUNE?.mkc ?? 80) : m.strikeAt;
    // (前受けから自分で引いた選手は、競り負けて下げたのとは違い、脚質どおりのタイミングで巻き返す)
    const regroup = m.gaveUp && !m.hikuRetreat;
    // すでに先頭のすぐ後ろ (好位) にいる捲り型は、外へ仕掛けずに直線で差しにいく (ガールズで多い形)
    const sitRank = engine.setup?.rules?.girls ? (globalThis.KF_TUNE?.sitG ?? 3) : (globalThis.KF_TUNE?.sitM ?? 0);
    const sitting = m.style === 'MAKURI' && !m.struck && engine.positionRank(rider) <= sitRank && behindBy < engine.spacing.follow * (sitRank + .5) && rider.boxedFor < .3;
    const strikeNow = ((!regroup) && !sitting && rem <= strikeAt && rider.energy > .25) || (regroup && rem <= Math.min(m.strikeAt, 260) && rider.energy > .22) || lateAndStillBehind || m.struck;
    if (strikeNow && rider.energy > .08) {
      if (!m.struck) m.struck = true;
      const leadGap = lead.distance - rider.distance;
      const farBack = behindBy > U(engine, 40) && rem > 420;
      const why = { SENKO: farBack ? '後方から一気にカマす' : '叩いて主導権を奪いにいく', KAMASHI: '後方から一気にカマす', MAKURI: '中団から捲りに出る', OIKOMI: '追い込みに出る' }[m.style] ?? '仕掛ける';
      const wait = this._boxedWait(rider, engine);
      if (wait) return wait;
      // 外に出たいのに横に選手がいて出られない (包まれた): 少し下げてから外へ持ち出す
      if ((rider.boxedFor ?? 0) > 0.6 && rider.boxedBy) {
        const box = engine.rider(rider.boxedBy);
        return { action: ACTION.ATTACK, speed: Math.max(PACE.CRUISE, (box?.speed ?? rider.speed) - 1.5), lane: this._attackLane(rider, engine),
          reason: `${rider.boxedBy}番に外を塞がれて出られず、一旦下げて外へ持ち出す`, tag: 'BOXED' };
      }
      const blocker = this._blockerOn(rider, engine);
      if (blocker) return { action: ACTION.ATTACK, speed: this.sprintSpeed(rider), lane: this._attackLane(rider, engine), reason: `${blocker.number}番のブロックで外へ持っていかれながら踏む (残脚${pct(rider.energy)})`, tag: 'BLOCKED' };
      // 仕掛けの「ダッシュ」: 脚を溜めていた選手は、仕掛けた直後の数秒だけ巡航の最高速を上回る速さを出せる
      // (競輪の捲り・カマシは、この速度差で先行の上を越えていく。溜めた脚を一気に使うので、そのぶん脚は減る)
      if (m.struckAt == null) m.struckAt = engine.elapsedTime;
      const T = globalThis.KF_TUNE ?? {};
      const since = engine.elapsedTime - m.struckAt, dashT = T.dashT ?? 6;
      // (ダッシュは前に追いつくための勢い。先頭に並んだら、あとは自分の最高速で押し切る)
      const reach = (T.dreach ?? 1) ? clamp(leadGap / U(engine, T.dgapU ?? 6), 0, 1) : 1;
      const dash = m.style === 'OIKOMI' ? 0 : (T.dash ?? 2.5) * rider.profile.acceleration * clamp(1 - since / dashT, 0, 1) * clamp((rider.energy - .3) / .4, 0, 1) * reach;
      rider._dash = dash; rider._dashUntil = engine.elapsedTime + .3;
      return { action: ACTION.ATTACK, speed: this.sprintSpeed(rider) + dash, dash, lane: this._attackLane(rider, engine), reason: `残${rem.toFixed(0)}mで${why} (先頭まで${leadGap.toFixed(0)}m・残脚${pct(rider.energy)})` };
    }

    const corridor = this._nearestAheadInCorridor(rider, engine, 80);
    let ahead = corridor && !this._retreating(corridor.rider) ? corridor : (this._aheadNotRetreating(rider, engine) ? { rider: this._aheadNotRetreating(rider, engine) } : null);
    if (ahead) {
      const tail = this._lineTailAhead(ahead.rider, rider, engine);
      ahead = { rider: tail !== ahead.rider ? tail : this._sticky(rider, tail, engine) };
    }
    if (ahead) return this._followPlan(ahead.rider, m.gaveUp ? '一度引いて脚を回復。後方から再仕掛けを待つ' : `前のラインの後ろで脚を溜める (仕掛け予定 残${m.strikeAt.toFixed(0)}m)`, { lane: TRACK_LANE.INNER });
    return { action: ACTION.CONTROL_PACE, speed: PACE.CRUISE, lane: TRACK_LANE.INNER, reason: '位置を保つ' };
  }

  _frontResponse(rider, engine, m, pc) {
    // Front-line leader reacts when the pacer-cut attacker arrives alongside.
    const cutter = engine.rider(pc.cutterNumber);
    const gap = rider.distance - cutter.distance;
    if (gap > U(engine, 14)) return { action: ACTION.CONTROL_PACE, speed: Math.max(engine.pacer.speed + (engine.pacer.distance - engine.spacing.start - rider.distance) * .3, 0), lane: TRACK_LANE.INNER, reason: '前受けで誘導員の後ろ。外からの上昇を待つ' };
    // 前受けの動き: ユーザーの指定 → なければ、このレースの条件 (相手との力の差・自分のくせ・ラインの人数) で選ぶ
    const user = rider.profile.frontResponse;
    const plan = user ?? (pc.plan ??= this._chooseFrontPlan(rider, cutter, engine, pc));
    pc.plan = plan;
    const label = user ? '指定どおり、' : '';
    const why = user ? '' : ` (${this._planOdds(pc)})`;
    if (plan === 'HIKU' || plan === 'CHUDAN' || plan === 'YIELD') {
      pc.outcome = 'YIELD';
      if (plan === 'HIKU') m.hiku = true;
      return { action: ACTION.YIELD, speed: engine.pacer.speed - .6, lane: TRACK_LANE.INNER,
        reason: plan === 'HIKU' ? `${label}${cutter.number}番を出させて後方へ引く (巻き返し狙い)${why}`
          : plan === 'CHUDAN' ? `${label}${cutter.number}番を出させて、その後ろの中団を取る${why}` : `${label}誘導切りを出させて一旦引く` };
    }
    pc.outcome = 'CONTEST';
    this._startContest(cutter, rider, engine, '誘導切りに来た相手を突っ張る');
    return { action: ACTION.DEFEND, speed: cutter.speed + 1.2, lane: TRACK_LANE.INNER, reason: `${label}外から来た${cutter.number}番を突っ張る${why}` };
  }

  // 前受けの選択: 突っ張る / 引く / 中団 を、条件で重み付けして選ぶ (選ぶことと、それが決まるかは別。決まるかは走りで決まる)
  //   もとの割合 … EXデータの突っ張り回数など (無ければ脚質から)
  //   相手との力の差 … 自分が上なら突っ張りやすく、下なら前に入れて中団を取りやすい
  //   ラインの人数 … 3人以上なら引いて巻き返しやすい、単騎なら中団に入りやすい
  _chooseFrontPlan(rider, cutter, engine, pc) {
    const T = globalThis.KF_TUNE ?? {};
    const base = rider.profile.frontPlanProbs ?? { TSUPPARI: .1, HIKU: .45, CHUDAN: .45 };
    const d = this.strength(rider) - this.strength(cutter) + (rider.mindset === MINDSET.TSUPPARI ? .06 : 0);
    const size = engine.lineManager?.linesArray?.().find(l => l.members?.includes(rider.number))?.members?.length ?? (rider.role === ROLE.SOLO ? 1 : 2);
    const u = {
      TSUPPARI: Math.log(Math.max(.01, base.TSUPPARI ?? .1)) + (T.fkT ?? 10) * d,
      HIKU: Math.log(Math.max(.01, base.HIKU ?? .45)) + (size >= 3 ? (T.fkL ?? .3) : 0),
      CHUDAN: Math.log(Math.max(.01, base.CHUDAN ?? .45)) - (T.fkC ?? 5) * d + (size <= 1 ? (T.fkL ?? .3) : 0)
    };
    const mx = Math.max(...Object.values(u)), z = Object.values(u).reduce((a, v) => a + Math.exp(v - mx), 0);
    const probs = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, Math.exp(v - mx) / z]));
    pc.planProbs = probs;
    // レースごとのゆらぎ (何通りもの未来) では、この割合どおりに選ぶ。1レースだけ走らせるときは一番ありそうなもの
    const draw = rider.profile.frontDraw;
    if (draw == null) return Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
    let x = draw;
    for (const [k, p] of Object.entries(probs)) { x -= p; if (x <= 0) return k; }
    return 'HIKU';
  }

  _planOdds(pc) {
    const p = pc.planProbs; if (!p) return '';
    return `見立て: 突っ張り${Math.round(p.TSUPPARI * 100)}%・引き${Math.round(p.HIKU * 100)}%・中団${Math.round(p.CHUDAN * 100)}%`;
  }

  _incomingAttack(rider, engine) {
    let best = null;
    for (const o of engine.riders) {
      if (o.finished || o.number === rider.number || (o.lineId && o.lineId === rider.lineId)) continue;
      if (![ACTION.ATTACK, ACTION.MOVE_UP, ACTION.SWITCH_TO_SELF_POWER].includes(o.action)) continue;
      const gap = rider.distance - o.distance; // positive: attacker is behind
      if (gap < -U(engine, 3) || gap > U(engine, 30)) continue;
      if (o.laneOffset < rider.laneOffset + 6) continue;
      if (!best || gap < best.gap) best = { rider: o, gap };
    }
    return best;
  }

  _defendOrConcede(rider, engine, m, threat, rem) {
    const attacker = threat.rider;
    const mine = this.strength(rider), theirs = this.strength(attacker);
    if (m.yieldTo === attacker.number) {
      // 競り負けた相手: 前に入れて、その後ろで脚を溜め直す
      return { action: ACTION.CONTROL_PACE, speed: Math.max(PACE.CRUISE, Math.min(rider.speed, attacker.speed - 1)), lane: TRACK_LANE.INNER, reason: `${attacker.number}番に競り負けたので前に入れる` };
    }
    if (attacker.distance > rider.distance + 4) {
      m.defending = false;
      // 長く先行して脚が残っていない選手は、捲られると付いていけずに飲み込まれる
      if (m.struck && rider.energy < (globalThis.KF_TUNE?.swallow ?? .32) && rem > PACE.FINAL_STRAIGHT) {
        if (rem < 600) m.beaten = true;
        return { action: ACTION.FADE, speed: Math.min(rider.speed, this.sprintSpeed(rider) * .9), lane: TRACK_LANE.INNER, reason: `${attacker.number}番に捲られ、脚が残っておらず飲み込まれる (残脚${pct(rider.energy)})` };
      }
      if (rem < 600) m.beaten = true; // 叩かれた (番手が切り替えを考えるきっかけ)
      return this._followPlan(attacker, `${attacker.number}番に叩かれたため後ろに付けて立て直す`, { lane: TRACK_LANE.INNER });
    }
    if (m.style === 'SENKO' || rider.mindset === MINDSET.TSUPPARI || rem <= m.strikeAt) {
      if (rider.energy > .18 && mine >= theirs + (globalThis.KF_TUNE?.dth ?? .12)) {
        m.defending = true;
        if (Math.abs(rider.distance - attacker.distance) < U(engine, globalThis.KF_TUNE?.dgap ?? 10)) this._startContest(attacker, rider, engine, '主導権を渡さず合わせて踏む');
        // 長く先行してきた選手は、もう目一杯に近い。合わせて踏んでも上げられる速度は少しだけ
        const T = globalThis.KF_TUNE ?? {};
        const room = m.struck ? (T.defRoom ?? 0.6) : 0;
        return { action: ACTION.DEFEND, speed: this.sprintSpeed(rider) - room, lane: TRACK_LANE.INNER, reason: `${attacker.number}番の仕掛けに合わせて踏み上げ主導権を守る (残脚${pct(rider.energy)})` };
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

    // 番手の競りに負けた: 競り勝った選手の後ろ(3番手)を走る
    const lostSeri = this._lostSeriDecision(rider, engine);
    if (lostSeri) return lostSeri;

    // 千切れ: 前の選手のスピードに付いていけず、車間が空いていく
    // (車間がいつもより自転車1台半ほど空いた状態が1秒続いたら「口が空いて千切れた」とみなす)
    if (front && !front.finished && !this._retreating(front) && !this._retreating(rider) && rem < 700 && rem > PACE.FINAL_STRAIGHT) {
      const gap = front.distance - rider.distance;
      // 数えるのは「前に付いていこうとしているのに、空いた車間を詰められない」ときだけ
      // (ブロックで外へ張る・踏み合いで並ぶ・切り替えなど、自分から車間を空けたときは千切れではない)
      const trying = rider.action === ACTION.FOLLOW && rider.followTargetNumber === front.number && !m.switchedTo
        && front.speed >= rider.speed - .1 // 車間を詰められていない (詰めている途中なら、口が空いただけ)
        && Math.abs(front.laneOffset - rider.laneOffset) < (globalThis.KF_TUNE?.cgl ?? 14) // ほぼ真後ろで付いているとき (前が大きく外へ持ち出した直後の、走路の移り遅れは数えない)
        && !this._someoneBetween(rider, front, engine) // 間に他の選手が入っていない (割り込まれたのは千切れではない)
        && ![ACTION.BLOCK, ACTION.FULL_CONTEST, ACTION.YIELD].includes(front.action);
      if (trying && gap > engine.spacing.follow + (globalThis.KF_TUNE?.cg ?? 2.5)) m.gapSince ??= engine.elapsedTime; else m.gapSince = null;
      if (!m.chigire && m.gapSince != null && engine.elapsedTime - m.gapSince > 1.0) {
        m.chigire = true;
        // 付いている相手は同じままなので、ふつうの記録では残らない。ここで必ず記録する
        const msg = `${front.number}番の踏み出しに遅れて口が空き、千切れる (車間${gap.toFixed(0)}m・残脚${pct(rider.energy)})`;
        engine.emitDecision({ riderNumber: rider.number, category: 'AI_DECISION', action: ACTION.FOLLOW, message: msg });
        return this._followPlan(front, msg, { lane: front.laneOffset });
      }
    }

    // 番手捲り: 前の選手が脚を使い切りそうで、後ろから捲りが来るなら、自分から踏んで出る
    // (番手は基本的に前を残して差すのが仕事。前が明らかに力尽き、外から捲りが並びかけたときだけ自分から出る)
    if (rider.role === ROLE.BANTE && rem < 220 && rem > PACE.FINAL_STRAIGHT && leader && !this._retreating(leader) && rider.energy > .45) {
      const threat = this._incomingAttack(rider, engine) ?? this._incomingAttack(leader, engine);
      if (m.banteMakuri || (threat && threat.gap < U(engine, 12) && leader.energy < Math.max(globalThis.KF_TUNE?.bm ?? .25, rider.energy - (globalThis.KF_TUNE?.bmr ?? .22)) && leader.speed < threat.rider.speed - 1 && this.strength(rider) >= this.strength(threat.rider) + .02)) {
        m.banteMakuri = true;
        return { action: ACTION.SWITCH_TO_SELF_POWER, speed: this.sprintSpeed(rider), lane: this._attackLane(rider, engine),
          reason: `番手捲り。前の${leader.number}番が一杯(残脚${pct(leader.energy)})で${threat ? `${threat.rider.number}番が来るため` : ''}自分から踏む` };
      }
    }

    // 切り替え: 自分のラインの先頭が叩かれたら、叩いた側のラインの後ろへ移る
    // ただし先頭が巻き返して自分より前を走っているなら、ラインの先頭に付いていく (見捨てない)
    // (巻き返し = 先頭が自分より前で、もう一度踏んでいる。一度戻ったら、もう切り替えない)
    const leaderFightsBack = leader && !leader.finished && !this._retreating(leader) && leader.distance > rider.distance + U(engine, 2) && leader.energy > .12 && leader.action === ACTION.ATTACK;
    if (m.switchedTo && leaderFightsBack) {
      m.switchedTo = null; m.rejoined = true;
      return this._followPlan(front, `${leader.number}番が巻き返したので、再び${front.number}番の後ろに付く`, { lane: front.laneOffset });
    }
    if (rider.role === ROLE.BANTE && leader && !m.rejoined && !leaderFightsBack && this.memory.get(leader.number)?.beaten && rem < 600 && rem > PACE.FINAL_STRAIGHT && rider.profile.tacticalIQ >= .8) {
      // 一度決めた切り替え先は、その選手が走れている限り変えない (毎回選び直すと2人の間を行き来してしまう)
      const cur = m.switchedTo ? engine.rider(m.switchedTo) : null;
      if (cur && !cur.finished && !this._retreating(cur) && cur.distance > rider.distance) {
        return this._followPlan(cur, `${leader.number}番が叩かれたので、${cur.number}番の後ろに切り替える`, { lane: cur.laneOffset });
      }
      const target = this._aheadNotRetreating(rider, engine);
      if (target && target.lineId !== rider.lineId) {
        const tail = this._lineTailAhead(target, rider, engine);
        const t = tail.distance > rider.distance ? tail : target;
        m.switchedTo = t.number;
        return this._followPlan(t, `${leader.number}番が叩かれたので、${t.number}番の後ろに切り替える`, { lane: t.laneOffset });
      }
    }

    // Bante block (番手の牽制) against an attacker of another line.
    // (a line that is dropping back after a lost contest has no position to defend)
    // (ガールズなどブロック禁止のレースでは張らない)
    if (rider.role === ROLE.BANTE && !engine.setup?.rules?.noBlock && rem < 520 && rider.energy > .25 && !(leader && this._retreating(leader))) {
      const now = engine.elapsedTime;
      if (now < m.blockUntil) return { action: ACTION.BLOCK, speed: Math.min(rider.speed, (front?.speed ?? rider.speed) + .3), lane: m.blockLane, reason: m.blockReason };
      if (now >= m.blockCooldownUntil) {
        const t = this._blockTarget(rider, engine);
        if (t && rider.profile.blockSkill * rider.energy > .35) {
          m.blockUntil = now + 1.0; m.blockCooldownUntil = now + 2.5;
          m.blockLane = clamp(t.laneOffset - 8, rider.laneOffset, 34);
          m.blockReason = `${t.number}番の捲りに外へ張って牽制 (ブロック力${pct(rider.profile.blockSkill)})`;
          return { action: ACTION.BLOCK, speed: Math.min(rider.speed, (front?.speed ?? rider.speed) + .3), lane: m.blockLane, reason: m.blockReason };
        }
      }
    }

    // Lost the wheel? (front mate faded far away or is way off line)
    if (!front || front.finished || front.distance - rider.distance > U(engine, 40)) {
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
      if (gap < -U(engine, 4) || gap > U(engine, 16)) continue;
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
      if (Math.abs(b.distance - rider.distance) < U(engine, 9) && Math.abs(b.laneOffset - rider.laneOffset) < 26) return b;
    }
    return null;
  }

  // ---------- 踏み合い / 競り合い (side-by-side contest) ----------
  _startContest(attacker, defender, engine, why) {
    if (this.contests.some(c => [c.attacker, c.defender].some(n => n === attacker.number || n === defender.number))) return;
    if (engine.elapsedTime < (this.mem(attacker).noContestUntil ?? -1)) return;
    if (engine.elapsedTime < (this.mem(defender).noContestUntil ?? -1)) return;
    if (this.mem(defender).yieldTo === attacker.number) return; // 一度競り負けた相手には、もう合わせない
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
      const T = globalThis.KF_TUNE ?? {};
      // 勢い: 後ろから速度差をつけて来た捲りは、並んだ時点で有利 / 内の選手は距離が短いぶん有利
      c.momentum ??= clamp((a.speed - d.speed) / 10, 0, T.momc ?? .12) * (T.mom ?? 1);
      const sa = this.strength(a) + c.momentum, sd = this.strength(d) + (T.dbonus ?? .03);
      let winner = null;
      if (lead > U(engine, 6)) winner = 'ATTACKER';
      else if (lead < -U(engine, 9) && elapsed >= 1.5) winner = 'DEFENDER';
      else if (elapsed >= 1.2 && Math.abs(lead) < U(engine, 9)) {
        if (a.energy < .2 || sa < sd - .03) winner = 'DEFENDER';
        else if (d.energy < .15 || sd < sa - .06) winner = 'ATTACKER';
      }
      if (!winner && elapsed >= 4) winner = lead > 0 ? 'ATTACKER' : 'DEFENDER'; // 時間切れは、前に出ている方の勝ち
      if (!winner) continue;
      this.contests = this.contests.filter(x => x !== c);
      const secs = elapsed.toFixed(1);
      if (winner === 'DEFENDER') {
        const am = this.mem(a); am.gaveUp = true; am.retreatDone = false; am.struck = false; am.struckAt = null; am.noContestUntil = engine.elapsedTime + 3;
        const late = engine.raceClock.remainingDistance / (engine.lapScale ?? 1) <= 430;
        engine.emitDecision({ riderNumber: a.number, category: 'CONTEST', action: ACTION.RETREAT, message: `${secs}秒の踏み合いで${d.number}番に競り負け、${late ? '前に出られず' : '後ろへ下げる'} (残脚${pct(a.energy)})` });
        engine.emitDecision({ riderNumber: d.number, category: 'CONTEST', action: ACTION.DEFEND, message: `踏み合いを制して前を守る。ただし脚を使った (残脚${pct(d.energy)})` });
      } else {
        const dm = this.mem(d); dm.beaten = true; dm.noContestUntil = engine.elapsedTime + 3; dm.yieldTo = a.number;
        this.mem(a).mustTakeFront = d.number; // 競り勝った相手より十分前に出るまで踏み続ける
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
    if (m.tiredLogged || rem < 30 || rider.energy > (globalThis.KF_TUNE?.tire ?? .3)) return;
    if (![ACTION.ATTACK, ACTION.DEFEND, ACTION.FULL_CONTEST, ACTION.CONTROL_PACE, ACTION.FINAL_SPRINT].includes(rider.action)) return;
    if (engine.positionRank(rider) > 4 && !m.struck) return; // 前の方の選手か、自分から仕掛けた選手 (飲み込まれてからタレることもある)
    m.tiredLogged = true;
    engine.emitDecision({ riderNumber: rider.number, category: 'FATIGUE', action: ACTION.FADE, message: `脚が一杯になりタレ始める (残脚${pct(rider.energy)}・${rider.speed.toFixed(1)}m/s)` });
  }

  // ---------- 番手競り (単騎の選手が、他のラインの番手の位置を取り合う) ----------
  _seriState(challenger, engine) {
    if (!this.seri.has(challenger.number)) {
      const leader = engine.rider(challenger.profile.seriTarget);
      const holder = leader ? engine.rider(leader.rearLineMate) : null;
      this.seri.set(challenger.number, { challenger: challenger.number, leader: leader?.number, holder: holder?.number, start: null, result: holder ? null : 'NONE' });
    }
    return this.seri.get(challenger.number);
  }

  _seriDecision(rider, engine, m, rem) {
    const st = this._seriState(rider, engine);
    const leader = engine.rider(st.leader), holder = engine.rider(st.holder);
    if (!leader || leader.finished) return null;
    if (st.result === 'CHALLENGER') {
      if (this._retreating(leader) || leader.distance - rider.distance > U(engine, 40)) return null;
      return this._followPlan(leader, `競り勝った${leader.number}番の番手を守る`, { lane: leader.laneOffset });
    }
    if (st.result === 'HOLDER' || st.result === 'NONE' || !holder || holder.finished) return null; // 負けたら普通の単騎として走る

    const gap = holder.distance - rider.distance;
    const alongside = Math.abs(gap) < U(engine, 3.5);
    if (alongside && st.start == null) {
      st.start = engine.elapsedTime;
      engine.emitDecision({ riderNumber: rider.number, category: 'SERI', action: ACTION.CONTEST, message: `${leader.number}番の番手を巡って、${holder.number}番の外に並んで競る` });
    }
    const elapsed = st.start == null ? 0 : engine.elapsedTime - st.start;
    const leaderGoing = [ACTION.ATTACK, ACTION.FULL_CONTEST, ACTION.DEFEND].includes(leader.action);
    if (st.start != null && (elapsed >= 5 || leaderGoing || rem < 380)) {
      const score = r => r.profile.power * .35 + r.profile.blockSkill * .35 + r.energy * .2 + r.profile.aggression * .1;
      const sc = score(rider), sh = score(holder) + .04; // 内側にいる番手が少し有利
      st.result = sc > sh ? 'CHALLENGER' : 'HOLDER';
      st.decidedAt = engine.elapsedTime;
      const secs = elapsed.toFixed(1);
      if (st.result === 'CHALLENGER') {
        engine.emitDecision({ riderNumber: rider.number, category: 'SERI', action: ACTION.FOLLOW, message: `${secs}秒の競りに勝って、${leader.number}番の番手を奪う (競り力${sc.toFixed(2)} > ${sh.toFixed(2)})` });
        engine.emitDecision({ riderNumber: holder.number, category: 'SERI', action: ACTION.FOLLOW, message: `番手の競りに負けて、${rider.number}番の後ろ(3番手)に回る` });
      } else {
        engine.emitDecision({ riderNumber: holder.number, category: 'SERI', action: ACTION.FOLLOW, message: `${secs}秒の競りに勝って、${leader.number}番の番手を守る (競り力${sh.toFixed(2)} ≧ ${sc.toFixed(2)})` });
        engine.emitDecision({ riderNumber: rider.number, category: 'SERI', action: ACTION.FOLLOW, message: `番手の競りに負けて、後ろへ回る` });
      }
      if (st.result === 'CHALLENGER') return this._followPlan(leader, `競り勝った${leader.number}番の番手に入る`, { lane: leader.laneOffset });
      return null;
    }
    // 番手の外に並びに行く / 並んだまま競る
    return {
      action: st.start == null ? ACTION.MOVE_UP : ACTION.CONTEST,
      speed: holder.speed + clamp(gap * .5, -2, 3),
      lane: holder.laneOffset + 14,
      reason: st.start == null ? `${leader.number}番の番手を競りに、${holder.number}番の外へ上がる` : `${holder.number}番と番手を競り合う`,
      silent: st.start != null
    };
  }

  // 競り負けた番手: 競り勝った選手が前に入れるよう少し下げ、そのあと後ろ(3番手)に付く
  _lostSeriDecision(rider, engine) {
    for (const st of this.seri.values()) {
      if (st.holder !== rider.number || st.result !== 'CHALLENGER') continue;
      const c = engine.rider(st.challenger), leader = engine.rider(st.leader);
      if (!c || c.finished) return null;
      const inFront = c.distance > rider.distance + engine.spacing.cutIn + 1 && Math.abs(c.laneOffset - rider.laneOffset) < 6;
      if (inFront) return this._followPlan(c, `競り負けたので${c.number}番の後ろを走る`, { lane: c.laneOffset });
      return { action: ACTION.YIELD, speed: Math.max(PACE.CRUISE - 3, (leader?.speed ?? rider.speed) - 1.8), lane: rider.laneOffset, reason: `競り負けたので、${c.number}番を内に入れるため少し下げる` };
    }
    return null;
  }

  // 前に遅い選手、横にも選手がいて、どこにも出られない: 無理に踏まず、前の選手の後ろで待つ
  // 自分と前の選手の間 (前後・横とも) に、他の選手がいるか
  _someoneBetween(rider, front, engine) {
    const lo = Math.min(rider.laneOffset, front.laneOffset) - 11, hi = Math.max(rider.laneOffset, front.laneOffset) + 11;
    return engine.riders.some(o => o !== rider && o !== front && !o.finished && o.distance > rider.distance + .5 && o.distance < front.distance - .5 && o.laneOffset > lo && o.laneOffset < hi);
  }

  _boxedWait(rider, engine) {
    const wall = this._nearestAheadInCorridor(rider, engine, 16);
    if (!wall || wall.rider.speed >= rider.speed - .5 || !rider.boxedBy) return null;
    // 横に動こうとしても塞がれている (boxedFor) か、出られる走路が今の走路しかない
    if ((rider.boxedFor ?? 0) < .5 && Math.abs(this._attackLane(rider, engine) - rider.laneOffset) >= 6) return null;
    return this._followPlan(wall.rider, `${wall.rider.number}番と${rider.boxedBy}番に包まれて出られず、仕掛けを待つ`, { lane: rider.laneOffset });
  }

  // ---------- SOLO ----------
  solo(rider, engine, m, rem) {
    const ahead = this._nearestAheadInCorridor(rider, engine, 80) ?? (engine.findNearestAhead(rider) ? { rider: engine.findNearestAhead(rider) } : null);
    if (rem <= m.strikeAt * .6 && rider.energy > .3 && engine.positionRank(rider) >= 4) {
      const wait = this._boxedWait(rider, engine);
      if (wait) return wait;
      return { action: ACTION.ATTACK, speed: this.sprintSpeed(rider), lane: this._attackLane(rider, engine), reason: `単騎で自力発進 (残脚${pct(rider.energy)})` };
    }
    if (ahead) { const t = this._sticky(rider, this._lineTailAhead(ahead.rider, rider, engine), engine); return this._followPlan(t, `単騎。${t.number}番の後ろに付けて脚を溜める`, { lane: t.laneOffset }); }
    return { action: ACTION.CONTROL_PACE, speed: PACE.CRUISE, lane: TRACK_LANE.INNER, reason: '単騎で位置を保つ' };
  }

  // ---------- FINAL STRAIGHT ----------
  finalStraight(rider, engine, m) {
    if (rider.energy <= .04) return { action: ACTION.FADE, speed: rider.profile.topSpeed * .75, lane: rider.laneOffset, reason: '脚が残っておらず失速' };
    const ahead = this._nearestAheadInCorridor(rider, engine, 22);
    let lane = rider.laneOffset, how = '追い込む';
    if (ahead && ahead.rider.speed < rider.speed + 1.5) {
      // 前が詰まっている: 内が空いていれば内を突く(内すくい)
      const innerFree = rider.laneOffset <= 0 && !engine.riders.some(o => !o.finished && o !== rider && Math.abs(o.laneOffset - TRACK_LANE.INNER) < 11 && o.distance - rider.distance > -U(engine, 8) && o.distance - rider.distance < U(engine, 30));
      if (innerFree) { lane = TRACK_LANE.INNER; how = '内を突く'; }
      else {
        // 空いているコースのうち、今の位置から一番近いところを踏む (外を大きく回ると距離を損する)。
        // 前の番手が外へ持ち出して空いた「間」を割る(中割り)のもこれ
        const mine = this.sprintSpeed(rider);
        const open = lane => !engine.riders.some(o => {
          if (o.finished || o === rider) return false;
          const g = o.distance - rider.distance;
          return Math.abs(o.laneOffset - lane) < 11 && ((g > -U(engine, 3) && g < U(engine, 4)) || (g >= U(engine, 4) && g < U(engine, 24) && o.speed < mine - .5));
        });
        // 横へ動く途中の走路も空いていないと、そのコースには出られない (途中で前の選手に詰まって包まれる)
        const transitFree = l => {
          const lo = Math.min(l, rider.laneOffset), hi = Math.max(l, rider.laneOffset);
          return !engine.riders.some(o => {
            if (o.finished || o === rider || o === ahead.rider) return false;
            const g = o.distance - rider.distance;
            return o.laneOffset > lo - 9 && o.laneOffset < hi + 9 && g > -U(engine, 2) && g < U(engine, 6) && o.speed < mine + .3;
          });
        };
        const lanes = [];
        for (let l = -18; l <= 42; l += 4) if (open(l) && transitFree(l)) lanes.push(l);
        const best = lanes.sort((x, y) => Math.abs(x - rider.laneOffset) - Math.abs(y - rider.laneOffset))[0];
        const outside = clamp(ahead.rider.laneOffset + 13, -18, 42);
        if (best == null && (globalThis.KF_TUNE?.stay ?? 1)) {
          // 出るコースがない: 無理に外へ振らず、前の車輪に付いたまま踏む (マーク)
          const t = ahead.rider;
          return { action: ACTION.FINAL_SPRINT, speed: this.sprintSpeed(rider), lane: rider.laneOffset,
            reason: `最後の直線。外が塞がっていて出られず、${t.number}番の後ろで踏む (残脚${pct(rider.energy)})` };
        }
        if ((globalThis.KF_TUNE?.fs ?? 1) && best != null && best < outside - 4 && best > TRACK_LANE.INNER + 2) { lane = best; how = '中を割って伸びる'; }
        else { lane = best ?? outside; how = '外へ持ち出して追い込む'; }
      }
    }
    const pos = engine.positionRank(rider);
    return { action: ACTION.FINAL_SPRINT, speed: this.sprintSpeed(rider), lane, reason: `最後の直線。残脚${pct(rider.energy)}で${pos}番手から${how}` };
  }

  // ---------- plan translation + logging ----------
  _toPlan(rider, engine, d) {
    let speed = d.speed;
    let followTargetNumber = null;
    if (d.action === ACTION.FOLLOW && d.followTarget) {
      const safe = this._safeWheel(d.followTarget, rider, engine);
      if (!safe) { d = { ...d, action: ACTION.CONTROL_PACE, followTarget: null, speed: PACE.CRUISE }; }
      else d = { ...d, followTarget: safe };
    }
    if (d.action === ACTION.FOLLOW && d.followTarget) {
      followTargetNumber = d.followTarget.number;
      // Slipstream following: a follower can match a wheel faster than its own solo pace.
      const t = d.followTarget, gap = t.distance - rider.distance;
      // (追走で極端に減速しない: 前の選手が後ろにいても歩くような速度にはしない)
      speed = Math.max(Math.min(t.speed, PACE.CRUISE) - 3, t.speed + clamp((gap - engine.spacing.follow) * .35 / U(engine, 1), -2.5, 4) + clamp((t.speed - rider.speed) * .6, -2, 2));
      // 踏み出しへの反応: 前が急に加速したら、後ろは一瞬遅れて踏み出す (3番手ほど遅れやすい)。
      // 遅れて口が空くと風よけが弱まり、脚の差があればそのまま千切れる
      const mm = this.mem(rider), T = globalThis.KF_TUNE ?? {};
      const jumping = (t.acceleration ?? 0) > 1.2 && t.speed > rider.speed + .3;
      if (jumping && mm.jumpAt == null) mm.jumpAt = engine.elapsedTime;
      else if (!jumping && (t.acceleration ?? 0) < .3) mm.jumpAt = null;
      const react = (rider.linePosition ?? 0) >= 2 ? (T.rt3 ?? .45) : (rider.linePosition === 1 ? (T.rt2 ?? .2) : (T.rt0 ?? .3));
      if (mm.jumpAt != null && engine.elapsedTime - mm.jumpAt < react) speed = Math.min(speed, rider.speed + .1);
      // 付いていける速さには限りがある: 今の残脚で出せる速さ + 風よけの分まで。
      // 前の選手との脚の差がそれ以上あれば、口が空いて千切れる (3番手が千切れやすいのはこのため)
      speed = Math.min(speed, this.followCap(rider, t, engine.elapsedTime));
    }
    // Nobody can ride faster than their own sprint ceiling, whatever the tactic asks for.
    speed = Math.min(speed ?? PACE.CRUISE, rider.profile.topSpeed + rider.profile.sprintBonus + (d.dash ?? 0));
    const lane = Number.isFinite(d.lane) ? d.lane : rider.laneOffset;
    return {
      action: d.action, targetSpeed: Math.max(0, speed ?? PACE.CRUISE), laneTarget: lane,
      followTargetNumber, reason: d.reason, scenarioControlled: false, effortFactor: d.effortFactor,
      laneRate: [ACTION.ATTACK, ACTION.BLOCK, ACTION.FINAL_SPRINT].includes(d.action) ? 2.8 : 2.2
    };
  }

  _log(rider, engine, m, d) {
    const key = `${d.action}|${d.followTarget?.number ?? ''}`;
    if (key === m.key) return;
    m.key = key;
    if (d.silent) return; // contest start/end is logged by the contest itself
    // 先行中の「踏み上げる ⇔ ペースを守る」の細かい切り替えは、数秒に1回だけ記録する
    const family = [ACTION.ATTACK, ACTION.DEFEND].includes(d.action) ? 'PUSH' : d.action;
    if (family === 'PUSH' && m.lastPushLog != null && engine.elapsedTime - m.lastPushLog < 4) return;
    if (family === 'PUSH') m.lastPushLog = engine.elapsedTime;
    if (d.action === ACTION.FOLLOW && !/引いて|叩かれ|離れた|単騎|千切れ|巻き返した/.test(d.reason)) return; // ordinary following is noise
    engine.emitDecision({ riderNumber: rider.number, category: 'AI_DECISION', action: d.action, message: d.reason });
  }
}
