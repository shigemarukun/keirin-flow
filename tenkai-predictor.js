import { MINDSET } from './race-plan.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class TenkaiPredictor {
  predict(setup, lineManager) {
    const lines = lineManager.linesArray();
    if (!lines.length) throw new Error('TenkaiPredictor requires at least one line.');

    const initialFront = lines[0];
    const candidates = lines.slice(1).map((line, index) => ({
      line,
      score: this.scorePacerCutCandidate(line, setup, index, lines.length - 1)
    })).sort((a, b) => b.score - a.score || a.line.id.localeCompare(b.line.id));

    const pacerCut = candidates[0] ?? { line: initialFront, score: 0 };
    const frontLeader = setup.riders[initialFront.leader];
    const frontResponse = this.predictFrontResponse(frontLeader);

    const initiative = frontResponse === 'TSUPPARI' ? initialFront : pacerCut.line;
    const makuriCandidates = lines.filter(line => line.id !== initiative.id).map(line => ({
      lineId: line.id,
      leaderNumber: line.leader,
      score: this.scoreMakuri(line, setup)
    })).sort((a, b) => b.score - a.score || a.lineId.localeCompare(b.lineId));

    const prediction = {
      initialFormation: this.formatFormation(lines, setup),
      initialFrontLineId: initialFront.id,
      initialFrontLeaderNumber: initialFront.leader,
      pacerCut: {
        lineId: pacerCut.line.id,
        leaderNumber: pacerCut.line.leader,
        score: Number(pacerCut.score.toFixed(3))
      },
      frontResponse,
      initiative: {
        lineId: initiative.id,
        leaderNumber: initiative.leader
      },
      makuriCandidate: makuriCandidates[0] ?? null,
      makuriCandidates,
      points: []
    };

    prediction.points = this.buildPoints(prediction);
    return prediction;
  }

  scorePacerCutCandidate(line, setup, index, candidateCount) {
    const leader = setup.riders[line.leader];
    const ability =
      leader.aggression * 0.30 +
      leader.power * 0.20 +
      leader.acceleration * 0.25 +
      leader.endurance * 0.15 +
      leader.tacticalIQ * 0.10;

    // 誘導切りは後方ラインほど先に動く必要がある、という位置責任を決定論的に加点。
    const rearPosition = candidateCount <= 1 ? 1 : index / (candidateCount - 1);
    return ability * 0.65 + rearPosition * 0.35;
  }

  predictFrontResponse(rider) {
    if (rider.mindset === MINDSET.TSUPPARI) return 'TSUPPARI';
    if (rider.mindset === MINDSET.YIELD_AND_ROLL) return 'YIELD';
    return 'CONTAIN';
  }

  scoreMakuri(line, setup) {
    const leader = setup.riders[line.leader];
    return clamp(
      leader.acceleration * 0.35 +
      leader.power * 0.30 +
      leader.endurance * 0.20 +
      leader.tacticalIQ * 0.15,
      0,
      1.25
    );
  }

  formatFormation(lines, setup) {
    const groups = lines.map(line => line.members.join(''));
    const solos = Object.values(setup.riders)
      .filter(rider => rider.solo === true)
      .map(rider => rider.number)
      .sort((a, b) => a - b)
      .map(String);
    return `← ${[...groups, ...solos].join(' / ')}`;
  }

  buildPoints(prediction) {
    const points = [];
    points.push(`${prediction.pacerCut.leaderNumber}番を先頭とする${prediction.pacerCut.lineId}が赤板付近から誘導切りを狙う想定。`);

    if (prediction.frontResponse === 'TSUPPARI') {
      points.push(`${prediction.initialFrontLeaderNumber}番は前受けから突っ張りを選択する可能性が高く、赤板〜打鐘で主導権争いになる想定。`);
    } else if (prediction.frontResponse === 'YIELD') {
      points.push(`${prediction.initialFrontLeaderNumber}番は一旦出させて位置を下げ、後半の巻き返しを狙う想定。`);
    } else {
      points.push(`${prediction.initialFrontLeaderNumber}番は前を抑えながらペースを管理し、相手の出方を見て主導権を判断する想定。`);
    }

    points.push(`主導権の第一候補は${prediction.initiative.leaderNumber}番を先頭とする${prediction.initiative.lineId}。`);

    if (prediction.makuriCandidate) {
      points.push(`後半の捲り候補は${prediction.makuriCandidate.leaderNumber}番（${prediction.makuriCandidate.lineId}）。前団の消耗度が展開の鍵。`);
    }
    return points;
  }
}
