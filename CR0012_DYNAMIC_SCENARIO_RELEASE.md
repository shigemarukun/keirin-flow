# KEIRIN FLOW — CR-0012 DYNAMIC SCENARIO ENGINE

## 目的
CR-0011の教師シナリオ品質を維持したまま、ScenarioPhaseManagerを任意ライン構成・単騎・外部Scenario IDへ拡張。

## 新規
- `scenarioId` で `TSUPPARI_MAKURI` / `YIELD_KAMASI` を選択
- 1〜N車のラインを受理
- 1車ラインは `ROLE.SOLO` として扱う
- SOLOは中盤以降 `KIRIKAE` で最も勢いのある別ラインの最後尾へ切り替え
- 展開を START / MIDDLE / FINISH block で定義
- `YIELD_KAMASI` 教師シナリオ追加

## YIELD_KAMASI
1. 後方ラインが誘導切りへ上昇
2. 前受けはYIELDして後方へ
3. 前が流したところを元前受けラインが打鐘カマシ
4. 全別線を叩き切ってイン締め
5. NIGERIKIRI。今回の教師設定では1-2-3で決着

## 回帰
- CR-0011 `TSUPPARI_MAKURI`: 0.5x / 1x / 2x / 3x 全PASS
- CR-0012 `YIELD_KAMASI`: 0.5x / 1x / 2x / 3x 全PASS
- 動的構成 `[1,2,3] / [4,5] / [6 solo] / [7,8,9]` で検証
- SOLO 6のKIRIKAE発動確認
- YIELD → KAMASI → FRONT_ESTABLISHED → FINISH_ACTION を全速度で確認
