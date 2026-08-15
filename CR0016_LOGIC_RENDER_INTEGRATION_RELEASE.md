# KEIRIN FLOW — CR-0016 LOGIC / RENDER INTEGRATION

## 根本変更

CR-0015のPath Historyを残しつつ、戦術ロジックと描画座標を完全分離。

### Logic Layer
- `distance / laneOffset / action / phase` がレースの正本。
- TSUPPARI / YIELD / KAMASI / BLOCK / CONTEST / KIRIKAE を保持。
- Decision Logも戦術状態遷移から生成。

### Render Layer
- `renderDistance / renderLaneOffset` は画面専用。
- 通常時はPath Historyをスネーク追尾。
- BLOCK / CONTEST / KIRIKAE等では `COMPETE` に一時解放。
- 戦術終了後は自動で `SNAKE_FOLLOW` に復帰。
- `RenderSlotResolver` が同一フレームの表示位置を排他的に解決。
- 400m周回のラップ跨ぎも円環距離で衝突判定。
- レースロジック座標へ描画補正をフィードバックしない。

## RESET
- START時だけrequestAnimationFrameを開始。
- PAUSE / RESETは`cancelAnimationFrame`でループを明示停止。
- RESETはRaceClock / pacer / rider / Path History / RenderSlot / LaneTransition / ranking / energyを初期化。
- RESET直後は1フレームだけ初期画面を再描画し、ループは停止状態。

## 誘導員
- 後方ライン上昇＋残760〜560mの退避ウィンドウでのみEXITING。
- EXITING時は速度を緩やかに+3.0m/sへ加速。
- lane -18 → +82を1.75秒のEase-In-Outで外側退避線へ移動。
- Canvas座標を直接ワープさせない。
- EXITING開始時点でRaceClockはLEADER基準へ移行し、誘導員の加速で残距離が歪まない。

## 表示サイズ
- デスクトップは800pxバンクを基準に復元。
- Rider marker radius 5.2px / font 7.2px。
- 排他スロットは復元サイズより大きい画面間隔を保証。

## 回帰
0.5x / 1x / 2x / 3xで:
- Path Historyスネーク追尾 PASS
- TSUPPARI / CONTEST PASS
- BANTE BLOCK → COMPETE → SNAKE復帰 PASS
- YIELD / KAMASI / KIRIKAE PASS
- Decision Log維持 PASS
- 画面上の完全同一座標 overlap = 0
- 最小マーカー中心距離:
  - TSUPPARI: 12.71px以上
  - YIELD_KAMASI: 12.05px以上
  - marker直径: 10.4px
- Render逆流 = 0
- RESET完全復帰 PASS
- 誘導員退避開始: 残759.9m前後、全速度でPASS
