# KEIRIN FLOW CR-0009 — LINE SETTLING / INSIDE CLOSE

## Purpose
CR-0008の自律・競輪プロトコル基盤を維持したまま、主導権奪取後の外空走とライン混線を抑える。

## Implemented
- LINE_FOLLOW_MODE: LOCKED_FOLLOW / SETTLING / FREE
- TRACK_LANE.INNER = -18
- ATTACK/CONTEST成功後の ESTABLISH_FRONT 永続状態
- 最イン線到達までイン締めを継続
- 主導権確立判定: 先頭 + イン復帰 + clearance + line integrity
- 後方ラインLeaderは直前ラインのtailへライン単位でドッキング
- LOCKED_FOLLOW / SETTLING別の縦PDゲイン
- LOCKED_FOLLOW laneRate=4.2 / SETTLING laneRate=3.4
- ATTACK / CONTEST / BLOCK / SWITCH_TO_SELF_POWER / FINAL_SPRINT はFREE
- SOLOはライン単位ドッキング対象外

## Regression
CR-0007/CR-0008既存テストを全維持。0.5x / 1x / 2x / 3x の決定論的結果も維持。

## New strict check
`node cr0009-line-settling-check.mjs`

検証内容:
1. ATTACK成功後にESTABLISH_FRONTへ入る
2. CONTROL_PACEへ変わった次フレームもイン締めが止まらない
3. INNER到達後HOLD_FRONTへ遷移
4. establishedFrontLine判定がイン復帰とline integrityを要求
5. 後方ラインがレース先頭ではなく直前ラインtailへドッキング
6. SETTLING / LOCKED_FOLLOW / FREE の状態遷移
