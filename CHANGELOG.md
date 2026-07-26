# Changelog

## v2.3.0 — 2026-07-26

### RaceClock / Timeline
- RaceClockを導入し、残り距離とイベントを一元管理。
- ClockOwnerを誘導員（PACER）から先頭選手（LEADER）へ切り替える構造を追加。
- ClockOwner切替時に残り距離が逆戻りしない単調性保護を追加。
- イベント順を `PacerLeaveLine → Bell → PacerExit → FinalLap → FinalBack → Finish` に固定。
- ベルの重複発火を防止。

### Formation / Decision
- 初期状態を残り2周・POSITION_BATTLEとし、戦術実装まではFormation挙動を暫定利用。
- 初期速度を全車10.5m/sへ統一し、開始直後の伸縮を排除。
- Formation中はglobalIndex順の前走者を参照し、9車一列を維持。

### RaceProfile
- `TRACK_LENGTH`、`RACE_DISTANCE`、`FORMATION_SPEED`、イベント距離をプロファイル化。
- 333m・500mバンク拡張用の土台を追加。
- イベント距離は実レース映像で調整する仮値として明記。

### UI / Quality
- 残り距離・周回表示をRaceClock基準へ変更。
- 初期表示を「残り2周 / 残り800m」へ更新。
- 左回り、イベント順、ClockOwner、車間、完走、RESET、0.5x〜3.0xを自動検証。
