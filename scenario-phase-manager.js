import {
  ACTION,
  LINE_FOLLOW_MODE,
  SCENARIO_PHASE,
  TRACK_LANE,
  TSUPPARI_MAKURI_SCENARIO
} from './race-plan.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class ScenarioPhaseManager {
  constructor(definition = TSUPPARI_MAKURI_SCENARIO) {
    this.definition = definition;
    this.reset();
  }

  reset() {
    this.currentPhase = SCENARIO_PHASE.PACER_CUT;
    this.phaseEnteredAt = 0;
    this.phaseHistory = [this.currentPhase];
    this.phase3SideBySideSeconds = 0;
    this.phase4BlockActive = false;
    this.phase4BlockStartedAt = null;
    this.phase4BlockCompleted = false;
    this.reassessment = new Map();
  }

  initialize(engine) {
    this.reset();
    this._emitPhase(engine, '7-8-9が外から誘導切りへ上昇');
  }


  _reassessAfterTsuppari(engine) {
    const d = this.definition;
    const frontLeader = engine.rider(engine.lineManager.leaderNumber(d.frontLineId));
    for (const lineId of [d.middleLineId, d.rearLineId]) {
      const leader = engine.rider(engine.lineManager.leaderNumber(lineId));
      if (!leader || !frontLeader) continue;
      const p = leader.profile;
      const accel = p.acceleration ?? .8;
      const endurance = p.endurance ?? .8;
      const iq = p.tacticalIQ ?? .8;
      const energy = leader.energy ?? 1;
      const lanePressure = engine.measureOutsidePressure(frontLeader);

      // Fully deterministic CR-0013 re-evaluation.  Scores are deliberately
      // separated enough that tiny integration differences cannot flip intent.
      const saveMakuri = accel*.34 + endurance*.30 + iq*.20 + energy*.16;
      const insideSwitch = iq*.38 + endurance*.20 + (1-lanePressure)*.22 + energy*.20 - .12;
      const keepPressure = (p.power??.8)*.30 + (p.aggression??.65)*.30 + accel*.20 + energy*.20 - .10;
      const choices = [
        ['SAVE_FOR_MAKURI', saveMakuri],
        ['INSIDE_SWITCH', insideSwitch],
        ['KEEP_PRESSURE', keepPressure]
      ].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
      const selected=choices[0][0];
      this.reassessment.set(lineId, selected);
      engine.emitDecision({
        riderNumber: leader.number, category:'CR0013_REASSESS', action:selected,
        message: selected==='SAVE_FOR_MAKURI'
          ? '突っ張りを確認。一旦引いて脚を溜め、最終周の大外捲りへ温存'
          : selected==='INSIDE_SWITCH'
            ? '突っ張りを確認。無理な踏み合いを避け、イン差し・切り替えを選択'
            : '突っ張りを確認。外並走の圧力を維持して主導権争いを継続'
      });
    }
  }
  _emitPhase(engine, message) {
    engine.emitDecision({
      category: 'SCENARIO_PHASE',
      action: this.currentPhase,
      message
    });
  }

  _transition(next, engine, message) {
    if (this.currentPhase === next) return;
    this.currentPhase = next;
    this.phaseEnteredAt = engine.elapsedTime;
    this.phaseHistory.push(next);
    this._emitPhase(engine, message);
  }

  update(engine, dt = 1 / 120) {
    const d = this.definition;
    const remaining = engine.raceClock.remainingDistance;
    const r1 = engine.rider(1);
    const r7 = engine.rider(7);

    if (this.currentPhase === SCENARIO_PHASE.PACER_CUT) {
      const attackReachedFront = r1 && r7 && (r1.distance - r7.distance) <= d.phase1.contestGap;
      if (attackReachedFront || remaining <= d.phaseThresholds.phase1FallbackRemaining) {
        this._transition(
          SCENARIO_PHASE.TSUPPARI_RESET,
          engine,
          '1番が突っ張り。7-8-9は無理をせず後退し、3ラインを再整列'
        );
        this._reassessAfterTsuppari(engine);
      }
    } else if (this.currentPhase === SCENARIO_PHASE.TSUPPARI_RESET) {
      const lineCSettled = this._lineSettled(engine, d.rearLineId, TRACK_LANE.INNER, 4);
      // Phase 3 is forbidden until the rear line has actually completed the
      // reset-to-inner formation. This prevents high playback speeds from
      // skipping the visible re-alignment.
      if (lineCSettled && remaining <= 560) {
        this._transition(
          SCENARIO_PHASE.SECOND_ATTACK,
          engine,
          '打鐘から7-8-9が再仕掛け。1-2-3が突っ張って外並走'
        );
      }
    } else if (this.currentPhase === SCENARIO_PHASE.SECOND_ATTACK) {
      const r1Now = engine.rider(1);
      const r7Now = engine.rider(7);
      const sideBySide =
        r1Now && r7Now &&
        Math.abs(r1Now.distance - r7Now.distance) <= 5 &&
        Math.abs(r1Now.laneOffset - r7Now.laneOffset) >= d.phase3.contestLaneSeparation;

      if (sideBySide) this.phase3SideBySideSeconds += dt;
      else this.phase3SideBySideSeconds = Math.max(0, this.phase3SideBySideSeconds - dt * 0.5);

      const contestProven =
        remaining <= d.phaseThresholds.phase3EndRemaining &&
        this.phase3SideBySideSeconds >= 0.70;

      // Safety fallback is later than the final-back marker; normal operation
      // must prove a visible side-by-side contest before Phase 4.
      const lateFallback = remaining <= 185;

      if (contestProven || lateFallback) {
        this._transition(
          SCENARIO_PHASE.MAKURI,
          engine,
          '1-2-3と7-8-9の外並走が成立。7-8-9が一杯になり、4-5-6が大外捲りへ'
        );
      }
    } else if (this.currentPhase === SCENARIO_PHASE.MAKURI) {
      const r2 = engine.rider(2);
      const r4 = engine.rider(4);

      if (!this.phase4BlockCompleted && r2 && r4) {
        const blockGap = r2.distance - r4.distance;
        const blockWindow = remaining <= d.phase4.blockStartRemaining;
        const fourArrived = blockGap >= -2 && blockGap <= d.phase4.blockGap;

        if (!this.phase4BlockActive && blockWindow && fourArrived) {
          this.phase4BlockActive = true;
          this.phase4BlockStartedAt = engine.elapsedTime;
          engine.emitDecision({
            riderNumber: 2,
            category: 'BANTE_BLOCK',
            action: ACTION.BLOCK,
            message: '最終コーナー。2番が捲ってくる4番へ一瞬外に張って牽制'
          });
        }

        if (
          this.phase4BlockActive &&
          engine.elapsedTime - this.phase4BlockStartedAt >= d.phase4.blockDuration
        ) {
          this.phase4BlockActive = false;
          this.phase4BlockCompleted = true;
          engine.emitDecision({
            riderNumber: 4,
            category: 'BLOCK_OVERCOME',
            action: ACTION.ATTACK,
            message: '4番が2番の牽制を勢いで乗り越え、直線へ向く'
          });
        }
      }

      // Never enter the finish phase before the intended final-corner block has
      // either happened or the field has passed the final emergency point.
      const finishReady =
        remaining <= d.phaseThresholds.phase4EndRemaining &&
        (this.phase4BlockCompleted || remaining <= 52);

      if (finishReady) {
        this._transition(
          SCENARIO_PHASE.FINISH,
          engine,
          '4番が番手ブロックを乗り越えて直線へ。4-5ワンツー、2-6が3着争い'
        );
      }
    }
  }

  _lineSettled(engine, lineId, lane, laneTolerance = 7) {
    const members = engine.lineManager.members(lineId).map(n => engine.rider(n)).filter(Boolean);
    if (!members.length) return false;
    const laneOk = members.every(r => Math.abs(r.laneOffset - lane) <= laneTolerance);
    const gapOk = members.slice(1).every((r, i) => {
      const front = members[i];
      const gap = front.distance - r.distance;
      return gap > 9 && gap < 24;
    });
    return laneOk && gapOk;
  }

  _leaderPlan(rider, speed, lane, action, reason, options = {}) {
    return {
      action,
      targetSpeed: speed,
      laneTarget: lane,
      followMode: options.followMode ?? LINE_FOLLOW_MODE.FREE,
      reason,
      scenarioControlled: true,
      maxAccel: options.maxAccel,
      maxBrake: options.maxBrake,
      laneRate: options.laneRate
    };
  }

  _dockLeaderPlan(rider, engine, targetNumber, speedCap, reason) {
    const target = engine.rider(targetNumber);
    if (!target) {
      return this._leaderPlan(
        rider,
        Math.min(rider.speed, speedCap),
        TRACK_LANE.INNER,
        ACTION.CONTROL_PACE,
        reason,
        { followMode: LINE_FOLLOW_MODE.SETTLING, maxAccel: 3.2, maxBrake: 2.8, laneRate: 3.4 }
      );
    }

    const desired = engine.followDesiredSpeed(rider, target, LINE_FOLLOW_MODE.SETTLING);
    return {
      action: ACTION.FOLLOW,
      targetSpeed: Math.min(desired, speedCap),
      laneTarget: TRACK_LANE.INNER,
      followTargetNumber: target.number,
      followMode: LINE_FOLLOW_MODE.SETTLING,
      reason,
      scenarioControlled: true,
      maxAccel: 3.4,
      maxBrake: 2.8,
      laneRate: 3.4
    };
  }

  _followPlan(rider, engine, speedCap = null, laneDelay = 0) {
    const front = engine.rider(rider.frontLineMate);
    if (!front) {
      return this._leaderPlan(rider, rider.speed, rider.laneOffset, ACTION.CONTROL_PACE, '追従対象なし');
    }
    // Scenario-follow spring is not capped by the autonomous rider profile:
    // the phase definition owns the intended line speed. This lets 5/6 remain
    // attached to a 28m/s makuri without the old autonomous top-speed ceiling.
    const gap = front.distance - rider.distance;
    const idealGap = 17;
    const catchUp = clamp((gap - idealGap) * 0.34, -2.2, 4.6);
    const desired = Math.max(0, front.speed + catchUp);
    const targetSpeed = speedCap == null ? desired : Math.min(desired, speedCap);
    return {
      action: ACTION.FOLLOW,
      targetSpeed,
      laneTarget: front.laneOffset,
      followTargetNumber: front.number,
      followMode: LINE_FOLLOW_MODE.LOCKED_FOLLOW,
      reason: 'シナリオライン追従',
      scenarioControlled: true,
      maxAccel: laneDelay > 0 ? 5.8 : 4.8,
      maxBrake: 3.4,
      laneRate: Math.max(1.7, 4.0 - laneDelay)
    };
  }

  plan(rider, engine) {
    const d = this.definition;
    const p = this.currentPhase;

    // Final straight exceptions: 2 and 6 are released from line-following
    // so they can pass the fading 1 and contest third place side-by-side.
    if (p === SCENARIO_PHASE.FINISH && (rider.number === 2 || rider.number === 6)) {
      return this._leaderPlan(
        rider,
        d.phase5.speeds[rider.number],
        rider.number === 2 ? -6 : 18,
        ACTION.FINAL_SPRINT,
        rider.number === 2 ? '1番をかわして3着争いへ' : '4-5追走から3着争いへ',
        { maxAccel: 5.8, maxBrake: 2.4, laneRate: 2.6 }
      );
    }

    // Phase 4 final-corner bante block: 2 temporarily releases from 1,
    // drifts outward with inertia, then returns to the line after the check.
    if (p === SCENARIO_PHASE.MAKURI && rider.number === 2 && this.phase4BlockActive) {
      return this._leaderPlan(
        rider,
        Math.max(rider.speed, 22.6),
        d.phase4.banteBlockLane,
        ACTION.BLOCK,
        '4番の捲りに対して一瞬外へ張る番手ブロック',
        { maxAccel: 3.6, maxBrake: 2.4, laneRate: 2.0 }
      );
    }

    // Line followers never independently choose tactics in this teacher scenario.
    if (rider.frontLineMate) {
      let cap = null;
      let delay = 0;
      if (p === SCENARIO_PHASE.MAKURI && rider.lineId === d.middleLineId) {
        cap = rider.linePosition === 1 ? d.phase4.makuriSpeed - 0.25 : d.phase4.makuriSpeed - 0.75;
        delay = rider.linePosition === 1 ? 0.55 : 1.00; // 5→6の順で「しなり」
      }
      if (p === SCENARIO_PHASE.FINISH) {
        cap = d.phase5.speeds[rider.number];
      }
      return this._followPlan(rider, engine, cap, delay);
    }

    if (p === SCENARIO_PHASE.PACER_CUT) {
      if (rider.lineId === d.frontLineId)
        return this._leaderPlan(rider, d.phase1.frontSpeed, TRACK_LANE.INNER, ACTION.DEFEND, '前受けを維持', {maxAccel: 2.6, laneRate: 2.8});
      if (rider.lineId === d.middleLineId)
        return this._dockLeaderPlan(rider, engine, 3, d.phase1.middleSpeed, '1-2-3の後ろで4-5-6が中団を維持');
      if (rider.lineId === d.rearLineId) {
        const clearOutside = rider.laneOffset >= -7;
        const speed = clearOutside ? d.phase1.attackerSpeed : Math.min(12.6, d.phase1.attackerSpeed);
        return this._leaderPlan(
          rider, speed, d.phase1.attackerLane, ACTION.ATTACK,
          clearOutside ? '誘導切りへ外上昇・前受けへ接近' : 'まず外へ持ち出して安全な上昇路を作る',
          {maxAccel: clearOutside ? 5.4 : 2.4, laneRate: 3.0}
        );
      }
    }

    if (p === SCENARIO_PHASE.TSUPPARI_RESET) {
      if (rider.lineId === d.frontLineId)
        return this._leaderPlan(rider, d.phase2.frontSpeed, TRACK_LANE.INNER, ACTION.DEFEND, '突っ張って前を譲らない', {maxAccel: 3.0, laneRate: 3.2});
      if (rider.lineId === d.middleLineId)
        return this._dockLeaderPlan(rider, engine, 3, d.phase2.middleSpeed, '1-2-3の直後へ4-5-6を整列');
      if (rider.lineId === d.rearLineId) {
        const tail = engine.rider(6);
        const safelyBehind = tail && rider.distance <= tail.distance - 11;
        if (!safelyBehind) {
          return this._leaderPlan(
            rider, d.phase2.retreatSpeed, TRACK_LANE.OUTSIDE, ACTION.RETREAT,
            '突っ張られたため大外のまま速度を緩め、4-5-6の後方まで下がる',
            {maxBrake: 4.4, laneRate: 1.6}
          );
        }
        return this._dockLeaderPlan(
          rider, engine, 6, d.phase2.middleSpeed,
          '4-5-6の最後尾まで下がったため巡航速度へ戻し、インへ復帰して三ライン再整列'
        );
      }
    }

    if (p === SCENARIO_PHASE.SECOND_ATTACK) {
      if (rider.lineId === d.frontLineId)
        return this._leaderPlan(rider, d.phase3.frontSpeed, TRACK_LANE.INNER, ACTION.FULL_CONTEST, 'インを死守して7番のねじ込みを張り返す', {maxAccel: 4.0, maxBrake: 2.2, laneRate: 4.0});
      if (rider.lineId === d.middleLineId)
        return this._dockLeaderPlan(rider, engine, 3, d.phase3.middleSpeed, '4-5-6は最内中団で脚を温存');
      if (rider.lineId === d.rearLineId) {
        const phaseAge = engine.elapsedTime - this.phaseEnteredAt;

        // Keep the completed 123 / 456 / 789 inner formation visible for a
        // short beat before the second attack begins. This is especially
        // important at 2x/3x where several physics substeps occur per frame.
        if (phaseAge < 0.35) {
          return this._leaderPlan(
            rider,
            Math.max(rider.speed, d.phase3.frontSpeed - 0.8),
            TRACK_LANE.INNER,
            ACTION.CONTROL_PACE,
            '三ライン再整列を一瞬維持してから再仕掛けへ',
            {maxAccel: 3.0, maxBrake: 2.2, laneRate: 4.2}
          );
        }

        const front = engine.rider(1);
        const clearOutside = rider.laneOffset >= -7;
        const gap = front ? front.distance - rider.distance : 999;
        const reachedContest = clearOutside && front && gap <= d.phase3.squeezeGap;

        let speed = clearOutside ? d.phase3.attackerSpeed : d.phase3.frontSpeed;
        let laneTarget = d.phase3.approachLane;
        let reason = clearOutside ? '大外から再仕掛け・前団へ強襲' : '再仕掛け前に外レーンへ持ち出す';
        let laneRate = 3.0;

        if (reachedContest) {
          // 7 wants the inner lane, but 1 remains fixed at -18. The 28px/m-ish
          // lateral separation is retained; this is pressure, not collision.
          speed = Math.max(d.phase3.frontSpeed, front.speed + 0.08);
          laneTarget = d.phase3.squeezeLane;
          laneRate = 1.65;
          reason = '1番の横から内へねじ込むが、インを張られて入れず拮抗';
        }

        return this._leaderPlan(
          rider, speed, laneTarget, ACTION.FULL_CONTEST, reason,
          {maxAccel: clearOutside ? 6.5 : 3.0, maxBrake: reachedContest ? 4.4 : 2.2, laneRate}
        );
      }
    }

    if (p === SCENARIO_PHASE.MAKURI) {
      if (rider.lineId === d.frontLineId)
        return this._leaderPlan(rider, d.phase4.frontFadeSpeed, TRACK_LANE.INNER, ACTION.FADE, '突っ張り消耗で失速', {maxBrake: 1.8, laneRate: 3.0});
      if (rider.lineId === d.middleLineId) {
        const blockLane = this.phase4BlockActive ? d.phase4.makuriEvadeLane : d.phase4.makuriLane;
        const blockBoost = this.phase4BlockActive ? 0.7 : 0;
        return this._leaderPlan(
          rider,
          d.phase4.makuriSpeed + blockBoost,
          blockLane,
          ACTION.LINE_ATTACK,
          this.phase4BlockActive ? '2番の外牽制をさらに外から勢いで乗り越える' : '中団から大外捲り',
          {maxAccel: 5.4, maxBrake: 2.0, laneRate: this.phase4BlockActive ? 2.2 : 2.5}
        );
      }
      if (rider.lineId === d.rearLineId)
        return this._leaderPlan(rider, d.phase4.attackerFadeSpeed, d.phase4.failedAttackLane, ACTION.FADE, '二度の仕掛けで一杯', {maxBrake: 3.8, laneRate: 1.8});
    }

    const finishSpeed = d.phase5.speeds[rider.number] ?? 20;
    let lane = rider.laneOffset;
    let action = ACTION.FINAL_SPRINT;
    let reason = '最終直線';
    if (rider.number === 4) { lane = 4; reason = '捲り切って1着へ'; }
    else if (rider.number === 1) { lane = TRACK_LANE.INNER; action = ACTION.FADE; reason = '突っ張り消耗で後退'; }
    else if ([7,8,9].includes(rider.number)) { lane = d.phase4.failedAttackLane; action = ACTION.FADE; reason = '仕掛け不発で大外へ退避しながら後退'; }
    return this._leaderPlan(rider, finishSpeed, lane, action, reason, {maxAccel: 5.8, maxBrake: 2.2, laneRate: 2.4});
  }

  canPacerExit(engine) {
    if (this.currentPhase !== SCENARIO_PHASE.PACER_CUT) return true;
    const frontLeader = engine.rider(
      engine.lineManager.leaderNumber(this.definition.frontLineId)
    );
    const rearLeader = engine.rider(
      engine.lineManager.leaderNumber(this.definition.rearLineId)
    );
    if (!frontLeader || !rearLeader) return false;
    return (frontLeader.distance - rearLeader.distance) <= 14;
  }

  state() {
    return {
      id: this.definition.id,
      currentPhase: this.currentPhase,
      phaseHistory: [...this.phaseHistory],
      phaseEnteredAt: this.phaseEnteredAt,
      phase3SideBySideSeconds: this.phase3SideBySideSeconds,
      phase4BlockActive: this.phase4BlockActive,
      phase4BlockCompleted: this.phase4BlockCompleted,
      phase4BlockStartedAt: this.phase4BlockStartedAt,
      reassessment: Object.fromEntries(this.reassessment)
    };
  }
}
