# KEIRIN FLOW — CR-0007 AUTONOMOUS ENGINE

固定Scenario Bの台本実行を本番経路から撤去し、`RaceSetupConfig` のライン構成・能力値・Mindsetを入力として展開を生成する自律型エンジンへ移行した版です。

## Core

- `race-plan.js` — RaceSetupConfig / Role / Mindset / Profile
- `line-manager.js` — 可変ラインと単騎の構造化
- `tactical-sensor.js` — SENSE
- `autonomous-decision-engine.js` — ASSESS / DECIDE
- `tactical-ai.js` — ACTプランへの変換
- `engine.js` — Physics / Energy / RaceSetup lifecycle
- `main.js` / `ui.js` — 将来UIから `applyRaceSetup()` を呼ぶ入口

単騎は1車ラインではなく `lineId=null`, `role='SOLO'` です。

## Runtime setup replacement

ブラウザ側から将来のD&D UI等で設定を変更する場合、`window.KEIRIN_FLOW_APPLY_SETUP(newSetup)` を呼ぶ構造になっています。

## Tests

```bash
npm run check
```

- 車番・Scenario phaseの本番ハードコード禁止検査
- 3分戦 / 可変ライン+単騎 / 4分戦+単騎を0.5x〜3xで完走
- `applyRaceSetup()` / `reset()`
- Scenario Bを教師データとして、突っ張り・仕掛け・撤退・再攻撃・ブロック・自力切替が台本なしで発生することを回帰確認
