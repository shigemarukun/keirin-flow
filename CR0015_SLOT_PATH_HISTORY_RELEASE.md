# KEIRIN FLOW CR-0015 — SLOT / PATH HISTORY ENGINE

## 根本刷新
- 車体の権威座標を `distance (1D track metres)` + `laneOffset` のみに限定。Canvas x/y はUIでのみ導出。
- 旧 collision guard / billiard correction / follower individual physics を教師シナリオ経路から撤去。
- 各ライン先頭だけが速度とレーンを持ち、番手・三番手は 1.5m / 3.0m のスロットを追尾。
- `LinePathHistory` が先頭の distance/lane/speed 履歴を保持し、後続は過去軌跡を距離基準でサンプリング。
- `LaneTransition` は Ease-In-Out Sine。外持ち出し→内締めは先頭がS字を描き、後続は距離差ぶん遅れて同じ軌跡を通る。
- finished leader は virtualDistance を継続し、後続がゴール前で凍結しない。Canvas上はfinish済み車を消し、ゴール線団子を防止。

## YIELD_KAMASI 教師展開
789上昇 → 123イン一定ペース → 789イン進入 → 456が外側S字でライン丸ごと被せる → 456イン締め → 456 / 789 / 123。

## CR-0015 regression
0.5x / 1x / 2x / 3x:
- 全車distance単調増加（逆流ゼロ）
- follower slot error 0.0000m
- exact same logical coordinate overlapなし（走行中）
- Path Historyによるleader/follower lane差を検出（snake bend）
- 789前進、456全体クリア、456/789/123形成を確認

## Browser validation note
この実行環境のChromiumは localhost と file URL が組織ポリシーでブロックされるため、実ブラウザのCanvas動画検証は実行不能。Node回帰とコード整合性までは実施済み。
