# KEIRIN FLOW — CR-0006 STAMINA CLIMAX

## 目的

CR-0005で完成した「789失速 → 456動的オーバーテイク → 2番ブロック」を、
スタミナ消費まで含む最終局面へ発展させる。

## 今回の変更

### 1番：長い突っ張り先行の代償

- `leadLoadMultiplier`
- `defendLoadMultiplier`
- `finalFadeEnergy`
- `finalFadeRemaining`
- `finalFadeSpeed`
- `finalFadeBrake`

を `race-plan.js` に追加。

通常の先行と突っ張りを同じ消耗量で扱わず、
長く風を受けて主導権を維持した1番のエネルギーが終盤までに明確に減る。

最終コーナーで残脚条件を下回ると `LEAD_FADE` へ入り、
ゼロ速度にはならず、踏み続けながら14〜15m/s付近まで徐々にタレる。

### 2番：番手仕事後の自力切替

1番が一杯になったことを感知すると、
2番は前走者へ固定追従せず `SWITCH_TO_SELF_POWER` へ移行する。

これにより、
「4を牽制した後も、タレた1の後輪に縛られて終了」
という不自然な状態を解消した。

### 4番：捲り強化＋ブロック後の再加速

4番の捲り能力を強化。

- topSpeed: 28.2
- acceleration: 5.85
- makuri: 27.2

4番は失速789を動的ルートで抜き、
2番のブロック圏24m以内へ実際の速度差で突入する。

2番のブロックを受けた後も永久 `BLOCKED` にはせず、
FINALでは残エネルギーに応じて再加速する。

## 基準最終局面

1. 789が一杯になり大外へ後退。
2. 4-5-6が空いたコースを選び強烈な捲り。
3. 4が2の24m圏へ高速接近。
4. 2が外へブロック。
5. 長く先行した1が残脚切れで `LEAD_FADE`。
6. 2が1から離れ自力へ切替。
7. 4もブロック後に再加速。
8. 2・4・他選手がゴール前の混戦へ。

## 回帰テスト

- `node cr0004-realism-check.mjs`
- `node cr0005-final-corner-check.mjs`
- `node cr0006-stamina-climax-check.mjs`

0.5x / 1x / 2x / 3x 全速度でPASSすること。
