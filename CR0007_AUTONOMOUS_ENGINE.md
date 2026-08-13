# KEIRIN FLOW — CR-0007 AUTONOMOUS ENGINE

## 目的
固定Scenario Bを本番経路から切り離し、入力されたライン構成・能力値・Mindsetから展開を生成する。

## 本番構造
- RaceSetupConfig / normalizeRaceSetup
- LineManager
- TacticalSensor
- AutonomousDecisionEngine
- TacticalAI
- PhysicsEngine.applyRaceSetup()
- PhysicsEngine.reset()
- UI renderRaceSetup()

## 禁止
本番Engine/AIでは以下を禁止。
- rider.number === X による戦術分岐
- Scenario固有phaseによる戦術分岐
- LINE7_FADE / LINE4_MAKURI 等の台本状態

## 単騎
単騎は1車ラインに変換しない。
- lineId = null
- role = SOLO
- soloMindset で行動
- ATTACH_AND_STRIKE / SAVE_AND_SPRINT / FLOW_RIDE

## Regression teacher
旧Scenario Bは本番コードではなく「教師データ」の考え方として残す。
`cr0007-autonomous-check.mjs` では台本なしで、
突っ張り・後方ラインの仕掛け・撤退・別線の再攻撃・番手ブロック・自力切替が発生可能なことを検証する。

## 実行
```bash
node cr0007-no-hardcode-check.mjs
node cr0007-autonomous-check.mjs
```
