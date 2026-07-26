# KEIRIN FLOW v2.3.0 — Alpha2.3 Final

競輪の展開予想を動きとして再生するための、レースエンジン基盤です。

## このリリースの目的

赤板付近（残り2周・800m）からシミュレーションを開始し、誘導員・打鐘・最終周回までの進行を、距離イベントとRaceClockで一元管理します。打鐘前の9車は一列・同一レーン・一定速度を基本とし、旧来のバネ追従による伸縮を排除しています。

## 実装済み

- 9車一列の初期隊列と一定速度スタート
- 左回り（6時→3時→12時→9時）のバンク描画
- RaceClockとClockOwner（PACER → LEADER）
- `PacerLeaveLine → Bell → PacerExit → FinalLap → FinalBack → Finish`
- ベルの一度だけの発火
- 誘導員の退避演出
- 0.5x〜3.0xの再生速度
- RESET、完走、着順表示
- 400mバンク用RaceProfile

## 未実装

- POSITION_BATTLEの戦術行動（抑え・突っ張り・引き）
- 逃げ・捲り・差し・追込の戦術AI
- バンク別の直線長・コーナー半径・カント
- 実レース映像に基づくイベント距離の最終調整

## ファイル構成

- `index.html`
- `style.css`
- `main.js`
- `engine.js`
- `ui.js`
- `ai.js`
- `foundation-check.mjs`
- `README.md`
- `CHANGELOG.md`

## 動作確認

ブラウザ確認はGitHub Pagesへ全ファイルを同じ階層でアップロードしてください。

ローカル品質チェック：

```bash
node foundation-check.mjs
```

期待結果：`10/10 checks passed`

## 次フェーズ

v2.4.0では、実機映像を基準に誘導員の動きから順番に検証し、POSITION_BATTLEの「誘導切り・抑え・突っ張り」を最小差分で追加します。
