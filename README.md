# KEIRIN FLOW

競輪のレース展開を、選手ごとの AI が自分で判断して走るデジタルツインです。

公開サイト: https://shigemarukun.github.io/keirin-flow/

## いまの仕組み (v0.17 自律AIモード)

各選手は毎フレーム、自分の状況を見て判断します。台本や車番の決め打ちはありません。

| 段階 | 中身 |
|---|---|
| SENSE | 残り距離、自分の残脚、前後・外側の選手、ラインの仲間 |
| ASSESS | 能力から決まる脚質 (先行 / 捲り)、仕掛け地点、相手の脅威 |
| DECIDE | 突っ張る・出させる・先行・捲り・番手牽制・自力切替・追い込み など |
| ACT | 目標速度と走路をエンジンに渡す |
| REASSESS | 選手ごとの記憶。状況が変われば判断も変わる |

判断を変えたときは、Decision Log に理由と数字 (残脚など) が出ます。

### 能力値の効き方

`race-plan.js` の `DEFAULT_RACE_SETUP` で選手の能力 (0〜1) とラインを設定します。

- `power` … 維持できる最高速
- `acceleration` … スプリントの上乗せ
- `endurance` … 脚の減りにくさ
- `tacticalIQ`, `aggression` … 仕掛ける位置とタイミング
- `blockSkill` … 番手の牽制の強さ
- `mindset` … 前受け時の対応 (`TSUPPARI` 突っ張り / `YIELD_AND_ROLL` 出させる / `CONTAIN`)

## 主なファイル

| ファイル | 役割 |
|---|---|
| `race-ai.js` | 選手の判断 (自律AI本体) |
| `engine.js` | 物理: 速度・脚の消耗・風よけ・走路の重なり防止 |
| `race-plan.js` | 能力値・ライン構成の設定 |
| `tenkai-predictor.js` | スタート前の展開予想 |
| `ui.js` / `main.js` | 画面表示 |
| `scenario-phase-manager.js` | 旧・教材シナリオ (台本)。`mode: 'TEACHER'` のときだけ使用 |

## テスト

```bash
npm test          # 自律AIのテスト: 能力を変えると結果が変わるか、車番の決め打ちがないか など
npm run test:teacher   # 旧・教材シナリオのテスト
```

`npm test` は「決まった着順になるか」ではなく、「AI が本当に自分で判断しているか」を確かめます。

## 動かし方

`index.html` を静的 Web サーバーで開きます (GitHub Pages ではそのまま動きます)。
