# CR-0002 — 赤板・誘導員退避・打鐘タイムライン

## このCRで固定する責務

CR-0002は戦術AIを実装しない。
CASE-001で得た FOLLOW → DECIDE → 自力切替の知見は次のDecision層へ保存し、
ここでは全戦術が共通利用する「レース時間軸」だけを堅牢化する。

### Source of Truth

- 開始地点 / 赤板マーカー: 残り800m
- 誘導員退避開始 `PacerLeaveLine`: 残り620m
- 打鐘 `Bell`: 残り600m
- 誘導員退避許可点 `PacerExit`: 残り560m
- 最終周回 `FinalLap`: 残り400m
- 最終バック `FinalBack`: 残り200m
- ゴール `Finish`: 残り0m

RedBoardはイベントではなく、シミュレーション開始の物理/表示マーカー。

### ClockOwner

- 誘導員が物理的に退避完了するまでは `PACER`
- 退避完了後のみ `LEADER`
- PACER → LEADER 切替時に残距離が逆戻りしないよう `referenceDistance = max(previous, candidate)`

### 誘導員

1. `PacerLeaveLine` で `LEADING → EXITING`
2. BellはEXITING中に鳴る
3. `PacerExit` を通過し、かつ `exitProgress === 1` になった時だけ `EXITED`
4. EXITED後にClockOwnerがLEADERへ切り替わる

### Bell

`Bell`イベントは一度だけ発火し、既存 `physics.onBell()` を一度だけ呼ぶ。

## 変更範囲

- `engine.js`
- `cr0002-timeline-check.mjs`
- この仕様書
- 既存のScenario B、UI、main.js、ベル音、描画座標には手を入れない

## 回帰条件

0.5x / 1x / 2x / 3x 全速度で以下を保証する。

- `PacerLeaveLine > Bell > PacerExit > FinalLap > FinalBack > Finish`
- Bell 1回のみ
- 誘導退避開始はBellより前
- ClockOwnerは物理退避完了前にLEADERへ変わらない
- 残距離は単調減少
- RESETで赤板800m・PACER・未発火状態へ完全復帰
