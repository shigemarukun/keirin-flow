import {
  ACTION,
  LINE_FOLLOW_MODE,
  SCENARIO_PHASE,
  TRACK_LANE,
  TSUPPARI_MAKURI_SCENARIO,
  YIELD_KAMASI_SCENARIO,
  SCENARIO_TYPE,
  GENERIC_PHASE,
  ROLE,
  RUN_STYLE
} from './race-plan.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class ScenarioPhaseManager {
  constructor(definition = TSUPPARI_MAKURI_SCENARIO) {
    this.definition = definition;
    this.reset();
  }

  configure(definition) {
    this.definition = definition ?? TSUPPARI_MAKURI_SCENARIO;
    this.reset();
  }

  reset() {
    this.currentPhase = this.definition?.id === SCENARIO_TYPE.YIELD_KAMASI
      ? GENERIC_PHASE.PACER_CUT
      : SCENARIO_PHASE.PACER_CUT;
    this.phaseEnteredAt = 0;
    this.phaseHistory = [this.currentPhase];
    this.phase3SideBySideSeconds = 0;
    this.phase4BlockActive = false;
    this.phase4BlockStartedAt = null;
    this.phase4BlockCompleted = false;
  }

  initialize(engine) {
    this.reset();
    if (this.definition.id === SCENARIO_TYPE.YIELD_KAMASI) {
      const cut = this._leader(engine, this.definition.roles.pacerCutLineId);
      this._emitPhase(engine, `${cut?.number ?? '?'}番を先頭とするラインが外から誘導切りへ上昇`);
    } else {
      this._emitPhase(engine, '7-8-9が外から誘導切りへ上昇');
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
    if (this.definition.id === SCENARIO_TYPE.YIELD_KAMASI) {
      this._updateYieldKamasi(engine, dt);
      return;
    }
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

  _leader(engine, lineId) {
    return engine.rider(engine.lineManager.leaderNumber(lineId));
  }

  _tail(engine, lineId) {
    return engine.rider(engine.lineManager.tailNumber(lineId));
  }

  _updateYieldKamasi(engine, dt) {
    const d = this.definition;
    const remaining = engine.raceClock.remainingDistance;
    const receiveLeader = this._leader(engine, d.roles.receivingLineId);
    const cutLeader = this._leader(engine, d.roles.pacerCutLineId);
    const kamasiLeader = this._leader(engine, d.roles.kamasiLineId);

    if (this.currentPhase === GENERIC_PHASE.PACER_CUT) {
      const reached = receiveLeader && cutLeader && (receiveLeader.distance - cutLeader.distance) <= 5;
      if (reached || remaining <= d.thresholds.pacerCutFallbackRemaining) {
        this._transition(GENERIC_PHASE.START_RESOLUTION, engine, '前受けラインはインを一定ペースで維持し、突っ張らずに誘導切りラインの進入を許容');
      }
      return;
    }

    if (this.currentPhase === GENERIC_PHASE.START_RESOLUTION) {
      // YIELD is passive: the receiving line never brakes or changes lane.
      // The line has yielded once the attacking LEADER has naturally cleared
      // the receiving leader. Followers remain rigidly attached behind it.
      const fullyYielded = receiveLeader && cutLeader && cutLeader.distance >= receiveLeader.distance + 7;
      const opportunist = this._leader(engine, d.roles.opportunistLineId);
      const shouldMiddleAttack = opportunist && [RUN_STYLE.NIGE, RUN_STYLE.SENKO].includes(opportunist.profile?.runStyle);

      if (fullyYielded && remaining <= d.thresholds.yieldSettleRemaining) {
        if (shouldMiddleAttack) {
          this._transition(
            GENERIC_PHASE.MIDDLE_REACTION,
            engine,
            `${opportunist.number}番は逃げ・先行型。前を取ったラインが流した隙を叩き、ライン単位で主導権を取りに行く`
          );
        } else {
          this._transition(GENERIC_PHASE.MIDDLE_ACTION, engine, '中団は動かず、後方へ引いたラインが打鐘手前からKAMASIを発動');
        }
      }
      return;
    }

    if (this.currentPhase === GENERIC_PHASE.MIDDLE_REACTION) {
      const opportunist = this._leader(engine, d.roles.opportunistLineId);
      const opportunistTail = this._tail(engine, d.roles.opportunistLineId);
      const cut = this._leader(engine, d.roles.pacerCutLineId);
      const clearedCutAsBundle =
        opportunistTail && cut &&
        opportunistTail.distance >= cut.distance + d.thresholds.middleClearance;
      const receiveBehindCut = receiveLeader && cut && receiveLeader.distance <= cut.distance - 8;

      if (clearedCutAsBundle && receiveBehindCut) {
        this._transition(
          GENERIC_PHASE.MIDDLE_SETTLE,
          engine,
          '456が789をライン丸ごと叩き切った。456がインへ締め、789 / 123もその後ろで隊列を整える'
        );
      }
      return;
    }

    if (this.currentPhase === GENERIC_PHASE.MIDDLE_SETTLE) {
      const middleLeader = this._leader(engine, d.roles.opportunistLineId);
      const cutLeaderNow = this._leader(engine, d.roles.pacerCutLineId);
      const receiveLeaderNow = this._leader(engine, d.roles.receivingLineId);
      const allInner = [middleLeader, cutLeaderNow, receiveLeaderNow]
        .every(r => r && Math.abs(r.laneOffset - TRACK_LANE.INNER) < 2.5);
      const ordered =
        middleLeader && cutLeaderNow && receiveLeaderNow &&
        middleLeader.distance > cutLeaderNow.distance + 12 &&
        cutLeaderNow.distance > receiveLeaderNow.distance + 12;

      if (allInner && ordered) {
        this._transition(
          GENERIC_PHASE.MIDDLE_ACTION,
          engine,
          '456 / 789 / 123の一列棒状が完成。後方123が次のカマシ判断へ'
        );
      }
      return;
    }

    if (this.currentPhase === GENERIC_PHASE.MIDDLE_ACTION) {
      const opponents = engine.riders.filter(r=>!r.finished && r.lineId !== d.roles.kamasiLineId && r.role !== ROLE.SOLO);
      const bestOpponent = [...opponents].sort((a,b)=>b.distance-a.distance)[0];
      const cleared = kamasiLeader && (!bestOpponent || kamasiLeader.distance >= bestOpponent.distance + d.thresholds.kamasiClearance);
      if (cleared) {
        this._transition(GENERIC_PHASE.FRONT_ESTABLISHED, engine, 'カマシラインが全別線を叩き切ってインへ入り主導権を確立');
      }
      return;
    }

    if (this.currentPhase === GENERIC_PHASE.FRONT_ESTABLISHED && remaining <= d.thresholds.finishStartRemaining) {
      this._transition(GENERIC_PHASE.FINISH_ACTION, engine, '主導権ラインが最終直線へ。逃げ切り／番手差しの決着へ');
    }
  }

  _bestKirikaeTarget(rider, engine) {
    const candidates = engine.lineManager.linesArray()
      .filter(line => !line.isSolo)
      .map(line => {
        const tail = this._tail(engine, line.id);
        const leader = this._leader(engine, line.id);
        if (!tail || !leader || tail.finished || leader.finished) return null;
        const gap = tail.distance - rider.distance;
        if (gap < -4 || gap > 70) return null;
        const score = leader.speed * 2.2 - Math.max(0, gap) * 0.08 + engine.measureLineIntegrity(line.id) * 3;
        return { tail, score };
      })
      .filter(Boolean)
      .sort((a,b)=>b.score-a.score);
    return candidates[0]?.tail ?? null;
  }

  _kirikaePlan(rider, engine) {
    const target = this._bestKirikaeTarget(rider, engine);
    if (!target) return this._leaderPlan(rider, Math.max(16, rider.speed), TRACK_LANE.INNER, ACTION.SAVE_ENERGY, '単騎で脚を溜めて展開待ち', {maxAccel:3.0,laneRate:2.2});
    const gap = target.distance - rider.distance;
    const desired = Math.max(0, target.speed + clamp((gap - 17) * 0.30, -1.5, 4.0));
    return {
      action: ACTION.KIRIKAE,
      targetSpeed: desired,
      laneTarget: target.laneOffset,
      followTargetNumber: target.number,
      followMode: LINE_FOLLOW_MODE.SETTLING,
      reason: `単騎KIRIKAE: 勢いのあるライン最後尾${target.number}番へ切り替え`,
      scenarioControlled: true,
      maxAccel: 5.0,
      maxBrake: 3.0,
      laneRate: 3.0
    };
  }

  _planYieldKamasi(rider, engine) {
    const d = this.definition;
    const p = this.currentPhase;
    const receiveId = d.roles.receivingLineId;
    const cutId = d.roles.pacerCutLineId;
    const middleId = d.roles.middleLineId;
    const kamasiId = d.roles.kamasiLineId;

    if (rider.role === ROLE.SOLO && [GENERIC_PHASE.MIDDLE_REACTION, GENERIC_PHASE.MIDDLE_ACTION, GENERIC_PHASE.FRONT_ESTABLISHED, GENERIC_PHASE.FINISH_ACTION].includes(p)) {
      return this._kirikaePlan(rider, engine);
    }

    // NIGERIKIRI may resolve as leader hold or bante-sashi. Release only the
    // bante in the final straight; the rest of the line remains coherent.
    if (p === GENERIC_PHASE.FINISH_ACTION && rider.lineId === kamasiId && rider.linePosition === 1) {
      return this._leaderPlan(rider, d.speeds.finishBante, -6, ACTION.FINAL_SPRINT, '番手が先行を残しながら直線で差しに入る', {maxAccel:5.6,maxBrake:2.2,laneRate:2.4});
    }

    if (rider.frontLineMate) {
      // Tactical authority belongs to the self-powered leader only.
      // Followers are rendered as a rigid slipstream chain; they do not
      // choose lane, avoidance, attack or braking independently.
      if (p === GENERIC_PHASE.FINISH_ACTION && rider.lineId === kamasiId && rider.linePosition === 1) {
        // handled above: only the finish bante is deliberately released
      } else {
        return this._rigidFollowPlan(rider, engine);
      }
    }

    if (rider.role === ROLE.SOLO) {
      return this._leaderPlan(rider, Math.max(12.5, rider.speed), TRACK_LANE.INNER, ACTION.SAVE_ENERGY, '単騎は序盤の攻防を見ながら脚を温存', {maxAccel:2.5,laneRate:2.0});
    }

    if (p === GENERIC_PHASE.PACER_CUT) {
      if (rider.lineId === cutId) return this._leaderPlan(rider, d.speeds.pacerCut, d.lanes.attack, ACTION.ATTACK, '誘導切りへ外上昇', {maxAccel:5.2,laneRate:3.0});
      if (rider.lineId === receiveId) return this._leaderPlan(rider, d.speeds.receive, d.lanes.inner, ACTION.CONTROL_PACE, '前受けで相手の上昇を待つ', {maxAccel:2.5,laneRate:3.0});
      return this._leaderPlan(rider, d.speeds.middle, d.lanes.inner, ACTION.SAVE_ENERGY, '中団で脚を温存', {maxAccel:2.5,laneRate:2.6});
    }

    if (p === GENERIC_PHASE.START_RESOLUTION) {
      if (rider.lineId === cutId) return this._leaderPlan(rider, d.speeds.controlFront, d.lanes.inner, ACTION.CONTROL_PACE, '前へ出て流し、打鐘前の主導権を一旦確保', {maxBrake:2.8,laneRate:3.6});
      if (rider.lineId === receiveId) {
        return this._leaderPlan(
          rider,
          d.speeds.yieldPace,
          TRACK_LANE.INNER,
          ACTION.YIELD,
          '突っ張らずインを一定ペースで維持。外線の速度差で自然に相対後退',
          {maxAccel:2.0,maxBrake:1.0,laneRate:4.6}
        );
      }
      return this._leaderPlan(rider, d.speeds.middle, d.lanes.inner, ACTION.SAVE_ENERGY, '前受けラインをやり過ごして中団維持', {maxAccel:2.4,laneRate:2.6});
    }

    if (p === GENERIC_PHASE.MIDDLE_REACTION) {
      const opportunistId = d.roles.opportunistLineId;
      if (rider.lineId === opportunistId) {
        const outsideReady = rider.laneOffset >= -5;
        return this._leaderPlan(
          rider,
          outsideReady ? d.speeds.opportunistAttack : 20.0,
          d.lanes.middleAttack,
          ACTION.ATTACK,
          '前を取ったラインの緩みを逃げ・先行型が即座に叩く',
          {maxAccel: outsideReady ? 7.2 : 4.6, maxBrake:1.8, laneRate:4.2}
        );
      }
      if (rider.lineId === cutId) {
        return this._leaderPlan(rider, d.speeds.controlFront, TRACK_LANE.INNER, ACTION.CONTROL_PACE, 'インで一定ペースを保ち、外から来る中団ラインの叩きを受ける', {maxAccel:2.0,maxBrake:1.2,laneRate:4.4});
      }
      if (rider.lineId === receiveId) {
        return this._leaderPlan(rider, 12.5, TRACK_LANE.INNER, ACTION.SAVE_ENERGY, '後方で隊列変化を見ながらカマシの脚を溜める', {maxAccel:2.6,laneRate:3.2});
      }
    }

    if (p === GENERIC_PHASE.MIDDLE_SETTLE) {
      if (rider.lineId === d.roles.opportunistLineId) {
        return this._leaderPlan(rider, d.speeds.opportunistControl, TRACK_LANE.INNER, ACTION.CONTROL_PACE, '叩き切ったラインが速やかにインを締める', {maxBrake:2.0,laneRate:5.0});
      }
      if (rider.lineId === cutId) {
        return this._leaderPlan(rider, d.speeds.controlFront, TRACK_LANE.INNER, ACTION.FOLLOW, '叩かれたラインは456の後方へ収まりライン維持', {maxAccel:2.5,maxBrake:1.4,laneRate:4.8});
      }
      if (rider.lineId === receiveId) {
        return this._leaderPlan(rider, d.speeds.yieldPace, TRACK_LANE.INNER, ACTION.SAVE_ENERGY, '123はイン後方で脚を溜め、隊列完成を待つ', {maxAccel:2.0,maxBrake:1.0,laneRate:4.8});
      }
    }

    if (p === GENERIC_PHASE.MIDDLE_ACTION) {
      if (rider.lineId === kamasiId) {
        const outsideReady = rider.laneOffset >= -5;
        return this._leaderPlan(rider, outsideReady ? d.speeds.kamasi : 18.0, d.lanes.kamasi, ACTION.ATTACK, '後方から爆発的な打鐘カマシ', {maxAccel:outsideReady?6.4:4.0,laneRate:3.4});
      }
      if (rider.lineId === cutId) return this._leaderPlan(rider, d.speeds.chase, d.lanes.inner, ACTION.DEFEND, '流していたところをカマされ追走へ切り替え', {maxAccel:4.2,laneRate:3.0});
      return this._leaderPlan(rider, d.speeds.chase - 1.0, d.lanes.inner, ACTION.FOLLOW, 'カマシを見て追走', {maxAccel:4.0,laneRate:2.8});
    }

    if (p === GENERIC_PHASE.FRONT_ESTABLISHED) {
      if (rider.lineId === kamasiId) return this._leaderPlan(rider, 24.5, d.lanes.inner, ACTION.CONTROL_PACE, '叩き切ってインを締め、そのまま先行', {maxBrake:1.6,laneRate:4.0});
      return this._leaderPlan(rider, d.speeds.chase, d.lanes.inner, ACTION.FOLLOW, '主導権ラインを追走', {maxAccel:4.0,laneRate:3.0});
    }

    if (rider.lineId === kamasiId) {
      if (rider.linePosition === 0) return this._leaderPlan(rider, d.speeds.finishLeader, d.lanes.inner, ACTION.FINAL_SPRINT, 'カマシ先行から逃げ込み', {maxAccel:4.8,laneRate:3.0});
    }
    if (rider.lineId === cutId) return this._leaderPlan(rider, 18.8, TRACK_LANE.INNER, ACTION.FADE, 'カマされて追走一杯', {maxBrake:2.0,laneRate:2.8});
    return this._leaderPlan(rider, 20.0, rider.laneOffset, ACTION.FINAL_SPRINT, '最終直線へ', {maxAccel:4.2,laneRate:2.5});
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

  _rigidFollowPlan(rider, engine) {
    const front = engine.rider(rider.frontLineMate);
    if (!front) return this._leaderPlan(rider, rider.speed, rider.laneOffset, ACTION.CONTROL_PACE, '追従対象なし');

    return {
      action: ACTION.FOLLOW,
      targetSpeed: front.speed,
      laneTarget: front.laneOffset,
      followTargetNumber: front.number,
      followMode: LINE_FOLLOW_MODE.LOCKED_FOLLOW,
      reason: '先頭軌跡へ剛体スリップストリーム追走',
      scenarioControlled: true,
      rigidFollow: true,
      rigidGap: 16.5
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
    if (this.definition.id === SCENARIO_TYPE.YIELD_KAMASI) return this._planYieldKamasi(rider, engine);
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
          ACTION.ATTACK,
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
    if (this.definition.id === SCENARIO_TYPE.YIELD_KAMASI) {
      if (this.currentPhase !== GENERIC_PHASE.PACER_CUT) return true;
      const frontLeader = this._leader(engine, this.definition.roles.receivingLineId);
      const rearLeader = this._leader(engine, this.definition.roles.pacerCutLineId);
      if (!frontLeader || !rearLeader) return false;
      return (frontLeader.distance - rearLeader.distance) <= 14;
    }
    if (this.currentPhase !== SCENARIO_PHASE.PACER_CUT) return true;
    const frontLeader = engine.rider(engine.lineManager.leaderNumber(this.definition.frontLineId));
    const rearLeader = engine.rider(engine.lineManager.leaderNumber(this.definition.rearLineId));
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
      phase4BlockStartedAt: this.phase4BlockStartedAt
    };
  }
}
