# KEIRIN FLOW — CR-0008 PROTOCOL / TENKAI PREDICTOR

## 目的

CR-0007の完全自律基盤の上に、競輪固有の「赤板〜打鐘プロトコル」と、START前に決定論的な展開予想を生成する上位レイヤーを追加する。

## Layer構造

1. RaceSetupConfig
2. TenkaiPredictor（乱数ゼロ）
3. KeirinProtocolController
4. AutonomousDecisionEngine / PhysicsEngine

## 主要実装

### TenkaiPredictor

- 初期並び: `← 123 / 456 / 789` 等
- 誘導切り第一候補
- 前受け応答予測
- 主導権候補
- 捲り候補
- 人間が読める展開POINT

同一RaceSetupConfigからは必ず同一結果を返す。

### KeirinProtocolController

`FORMATION -> RED_BOARD_APPROACH -> PACER_CUT_SELECTION -> PACER_CUT_APPROACH -> FRONT_RESPONSE -> FRONT_CONTEST / PACER_CUT_SUCCESS -> PACER_CUT_REJECTED or SUCCESS -> BELL_FORMATION -> OPEN_RACE`

後方ラインがCUT_PACERを開始し、前受けへ14m以内まで接近して初めて前受け判断と誘導員退避条件が成立する。

### 誘導員

時間や単純な距離だけでは退避しない。

- 誘導切り行動が存在する
- 攻撃ライン先頭と前受け先頭が14m以内
- FRONT_CONTESTまたはCUT_PACERがアクティブ

この条件が揃った時のみEXITINGへ遷移。

### Decision Log

- 誘導切り開始
- 外圧検知
- 突っ張り / YIELD
- 誘導員退避
- 誘導切り結果
- 打鐘後の自律判断

を画面にリアルタイム表示。

### UI

START前から以下を表示。

- 初期並び
- 誘導切り想定
- 前受け対応
- 主導権候補
- 捲り候補
- 展開POINT

## 決定論

本番モジュール内の `Math.random()` 使用なし。
同一設定・同一速度倍率では同一結果。
速度倍率0.5x / 1x / 2x / 3xでも基準セットアップの因果順序を維持する。

## 検証

```bash
node cr0007-interface-check.mjs
node cr0007-no-hardcode-check.mjs
node cr0007-autonomous-check.mjs
node cr0008-no-scenario-hardcode-check.mjs
node cr0008-protocol-tenkai-check.mjs
```
