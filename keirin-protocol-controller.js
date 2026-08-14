import { ACTION, MINDSET, PROTOCOL_STATE, RACE_INTENT } from './race-plan.js';

export class KeirinProtocolController {
  constructor() { this.reset(); }

  reset() {
    this.state = PROTOCOL_STATE.FORMATION;
    this.pacerCutLineId = null;
    this.frontLineId = null;
    this.pacerCutLeaderNumber = null;
    this.frontLeaderNumber = null;
    this.frontResponse = null;
    this.protocolResolved = false;
    this.contestElapsed = 0;
    this.initialized = false;
  }

  initialize(engine, prediction) {
    this.reset();
    this.frontLineId = prediction.initialFrontLineId;
    this.pacerCutLineId = prediction.pacerCut.lineId;
    this.frontLeaderNumber = prediction.initialFrontLeaderNumber;
    this.pacerCutLeaderNumber = prediction.pacerCut.leaderNumber;
    this.frontResponse = prediction.frontResponse;
    this.initialized = true;
  }

  update(dt, engine) {
    if (!this.initialized || this.state === PROTOCOL_STATE.OPEN_RACE) return;
    const remaining = engine.raceClock.remainingDistance;

    if (this.state === PROTOCOL_STATE.FORMATION && remaining <= 770) {
      this._transition(PROTOCOL_STATE.RED_BOARD_APPROACH, engine, null, '赤板進入。誘導切り候補の動きを確認。');
    }

    if (this.state === PROTOCOL_STATE.RED_BOARD_APPROACH) {
      this._transition(PROTOCOL_STATE.PACER_CUT_SELECTION, engine);
    }

    if (this.state === PROTOCOL_STATE.PACER_CUT_SELECTION) {
      const attacker = engine.rider(this.pacerCutLeaderNumber);
      if (attacker) {
        attacker.raceIntent = RACE_INTENT.CUT_PACER;
        this._transition(
          PROTOCOL_STATE.PACER_CUT_APPROACH,
          engine,
          attacker.number,
          '誘導切り狙いで外から上昇開始',
          'PACER_CUT'
        );
      }
    }

    if (this.state === PROTOCOL_STATE.PACER_CUT_APPROACH) {
      const attacker = engine.rider(this.pacerCutLeaderNumber);
      const defender = engine.rider(this.frontLeaderNumber);
      if (attacker && defender && defender.distance - attacker.distance <= 14) {
        this._transition(
          PROTOCOL_STATE.FRONT_RESPONSE,
          engine,
          defender.number,
          '外からの上昇を検知。前受け対応を判断',
          'FRONT_PRESSURE'
        );
      }
    }

    if (this.state === PROTOCOL_STATE.FRONT_RESPONSE) {
      this._resolveFrontResponse(engine);
    }

    if (this.state === PROTOCOL_STATE.FRONT_CONTEST) {
      this._evaluateContest(dt, engine);
    }

    if ([PROTOCOL_STATE.PACER_CUT_SUCCESS, PROTOCOL_STATE.PACER_CUT_REJECTED].includes(this.state)) {
      this.protocolResolved = true;
      this._transition(PROTOCOL_STATE.BELL_FORMATION, engine);
    }

    if (this.state === PROTOCOL_STATE.BELL_FORMATION && engine.raceClock.events.Bell) {
      this._transition(PROTOCOL_STATE.OPEN_RACE, engine, null, '打鐘通過。通常の自律レース判断へ移行。', 'PROTOCOL');
    }
  }

  _resolveFrontResponse(engine) {
    const attacker = engine.rider(this.pacerCutLeaderNumber);
    const defender = engine.rider(this.frontLeaderNumber);
    if (!attacker || !defender) return;

    const p = defender.profile;
    const defendScore = p.power * 0.30 + p.acceleration * 0.25 + defender.energy * 0.25 + p.aggression * 0.20;

    if (defender.mindset === MINDSET.TSUPPARI && defendScore >= 0.60) {
      defender.raceIntent = RACE_INTENT.HOLD_FRONT;
      this.frontResponse = 'TSUPPARI';
      this._transition(PROTOCOL_STATE.FRONT_CONTEST, engine, defender.number, `外圧検知: 突っ張り（DEFEND）発動`, 'FRONT_RESPONSE');
      return;
    }

    if (defender.mindset === MINDSET.CONTAIN && defendScore >= 0.70) {
      defender.raceIntent = RACE_INTENT.HOLD_FRONT;
      this.frontResponse = 'CONTAIN';
      this._transition(PROTOCOL_STATE.FRONT_CONTEST, engine, defender.number, '前を抑えながら抵抗し、主導権争いを継続', 'FRONT_RESPONSE');
      return;
    }

    defender.raceIntent = RACE_INTENT.YIELD_FRONT;
    attacker.raceIntent = RACE_INTENT.TAKE_FRONT;
    this.frontResponse = 'YIELD';
    this._transition(PROTOCOL_STATE.PACER_CUT_SUCCESS, engine, defender.number, '誘導切りラインを出させ、一旦引く判断', 'FRONT_RESPONSE');
  }

  _evaluateContest(dt, engine) {
    const attacker = engine.rider(this.pacerCutLeaderNumber);
    const defender = engine.rider(this.frontLeaderNumber);
    if (!attacker || !defender) return;

    this.contestElapsed += dt;
    const sensed = engine.tacticalAI.sensor.sense(attacker, engine);
    const result = engine.tacticalAI.decisionEngine.decideContest(attacker, defender, sensed, engine);

    if (result === ACTION.RETREAT || attacker.energy < attacker.profile.contestEnergyFloor) {
      attacker.raceIntent = RACE_INTENT.RETAKE_LATER;
      this._transition(PROTOCOL_STATE.PACER_CUT_REJECTED, engine, attacker.number, '突っ張りを受け誘導切りを断念。後方へ引いて再仕掛けを狙う', 'PACER_CUT_RESULT');
      return;
    }

    if (attacker.distance > defender.distance + 3) {
      attacker.raceIntent = RACE_INTENT.TAKE_FRONT;
      this._transition(PROTOCOL_STATE.PACER_CUT_SUCCESS, engine, attacker.number, '前受けを叩いて主導権を確保', 'PACER_CUT_RESULT');
      return;
    }

    // 永久踏み合い防止。ただし位置・能力に基づく決定論的決着。
    if (this.contestElapsed >= 2.6) {
      const attackerScore = attacker.profile.power * 0.35 + attacker.profile.acceleration * 0.25 + attacker.energy * 0.40;
      const defenderScore = defender.profile.power * 0.35 + defender.profile.acceleration * 0.25 + defender.energy * 0.40;
      if (attackerScore > defenderScore + 0.04) {
        attacker.raceIntent = RACE_INTENT.TAKE_FRONT;
        this._transition(PROTOCOL_STATE.PACER_CUT_SUCCESS, engine, attacker.number, '踏み合いを制して主導権を奪取', 'PACER_CUT_RESULT');
      } else {
        attacker.raceIntent = RACE_INTENT.RETAKE_LATER;
        this._transition(PROTOCOL_STATE.PACER_CUT_REJECTED, engine, attacker.number, '踏み合いで優位を作れず、一旦引いて再仕掛けへ', 'PACER_CUT_RESULT');
      }
    }
  }

  getDirective(rider, engine) {
    if (!this.initialized || this.state === PROTOCOL_STATE.OPEN_RACE) return null;
    const isCutLine = rider.lineId === this.pacerCutLineId;
    const isFrontLine = rider.lineId === this.frontLineId;
    const attacker = engine.rider(this.pacerCutLeaderNumber);
    const defender = engine.rider(this.frontLeaderNumber);

    if (isCutLine) {
      if (rider.number === this.pacerCutLeaderNumber) {
        if ([PROTOCOL_STATE.PACER_CUT_APPROACH, PROTOCOL_STATE.FRONT_RESPONSE].includes(this.state)) {
          return { action: ACTION.ATTACK, intensity: 0.92, laneTarget: 34, reason: '誘導切りのため前受けへ上昇' };
        }
        if (this.state === PROTOCOL_STATE.FRONT_CONTEST) {
          const result = attacker && defender
            ? engine.tacticalAI.decisionEngine.decideContest(attacker, defender, engine.tacticalAI.sensor.sense(attacker, engine), engine)
            : ACTION.CONTEST;
          if (result === ACTION.RETREAT) return { action: ACTION.RETREAT, intensity: 0.42, laneTarget: 30, reason: '突っ張り優勢を検知し撤退判断' };
          return { action: result, intensity: result === ACTION.FULL_CONTEST ? 1 : 0.84, laneTarget: 36, reason: '前受けとの主導権争いを継続' };
        }
        if (this.state === PROTOCOL_STATE.BELL_FORMATION && rider.raceIntent === RACE_INTENT.RETAKE_LATER) {
          return { action: ACTION.RETREAT, intensity: 0.38, laneTarget: -12, reason: '再仕掛けに備えて後方へ引く' };
        }
        if (rider.raceIntent === RACE_INTENT.TAKE_FRONT) {
          return { action: ACTION.CONTROL_PACE, intensity: 0.68, laneTarget: -10, reason: '誘導切り成功後、前で隊列を整える' };
        }
      } else if (attacker) {
        const ctx = engine.lineManager.context(rider.number);
        const front = ctx?.frontLineMate ? engine.rider(ctx.frontLineMate) : attacker;
        return {
          action: ACTION.FOLLOW,
          intensity: 0.66,
          followTargetNumber: front?.number ?? attacker.number,
          laneTarget: front?.laneOffset ?? attacker.laneOffset,
          reason: '誘導切りラインの前走者へ追走'
        };
      }
    }

    if (isFrontLine) {
      if (rider.number === this.frontLeaderNumber) {
        if (this.state === PROTOCOL_STATE.FRONT_CONTEST) {
          return { action: ACTION.DEFEND, intensity: 1, laneTarget: -18, reason: '前受けから突っ張り主導権を守る' };
        }
        if (rider.raceIntent === RACE_INTENT.YIELD_FRONT) {
          return { action: ACTION.YIELD, intensity: 0.44, laneTarget: -18, reason: '一旦出させて後方へ引く' };
        }
        return { action: ACTION.FOLLOW, intensity: 0.56, laneTarget: -18, reason: '前受け位置を維持し相手の上昇を待つ' };
      }
      if (defender) {
        const ctx = engine.lineManager.context(rider.number);
        const front = ctx?.frontLineMate ? engine.rider(ctx.frontLineMate) : defender;
        return { action: ACTION.FOLLOW, intensity: 0.60, followTargetNumber: front?.number ?? defender.number, laneTarget: front?.laneOffset ?? defender.laneOffset, reason: '前受けラインを追走' };
      }
    }

    // 赤板〜打鐘の競輪プロトコル中は、指定された誘導切りライン以外が
    // 勝手に先にATTACKしてストーリーを壊さない。中団ラインは位置を守って脚を溜め、
    // 単騎も展開が開くまで追走・温存する。
    if (rider.role === 'SOLO') {
      return { action: ACTION.SAVE_ENERGY, intensity: 0.40, laneTarget: rider.laneOffset, reason: '誘導切り攻防を見ながら単騎で脚を温存' };
    }

    const ctx = engine.lineManager.context(rider.number);
    if (ctx?.frontLineMate) {
      const front = engine.rider(ctx.frontLineMate);
      if (front) return { action: ACTION.FOLLOW, intensity: 0.52, followTargetNumber: front.number, laneTarget: front.laneOffset, reason: '誘導切り攻防を見ながら中団位置を維持' };
    }
    return { action: ACTION.CONTROL_PACE, intensity: 0.42, laneTarget: rider.laneOffset, reason: '誘導切り攻防を見ながら中団で待機' };
  }

  _transition(next, engine, riderNumber = null, message = null, category = 'PROTOCOL') {
    if (next === this.state) return;
    this.state = next;
    if (message) {
      engine.emitDecision({ riderNumber, category, message, protocolState: next });
    }
  }
}
