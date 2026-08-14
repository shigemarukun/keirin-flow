import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PhysicsEngine } from './engine.js';
import { DEFAULT_RACE_SETUP, MINDSET } from './race-plan.js';

function stablePrediction(setup){
  const a=new PhysicsEngine(setup).getPrediction();
  const b=new PhysicsEngine(setup).getPrediction();
  assert.deepEqual(a,b,'TenkaiPredictor must be deterministic');
  return a;
}

function simulate(setup,scale=1){
  const e=new PhysicsEngine(setup);e.setSpeedScale(scale);e.start();
  let frames=0,pacerExitRemaining=null,pacerBeforeCut=true;
  while(e.isStarted&&frames++<160000){
    e.update(1/60);const s=e.getState();
    if(s.raceClock.remainingDistance>770&&s.pacer.state!=='LEADING')pacerBeforeCut=false;
    if(pacerExitRemaining==null&&s.pacer.state==='EXITING')pacerExitRemaining=s.raceClock.remainingDistance;
  }
  return {e,state:e.getState(),frames,pacerExitRemaining,pacerBeforeCut};
}

const pred=stablePrediction(DEFAULT_RACE_SETUP);
assert.equal(pred.initialFormation,'← 123 / 456 / 789');
assert.equal(pred.pacerCut.lineId,'LINE_C');
assert.equal(pred.pacerCut.leaderNumber,7);
assert.equal(pred.frontResponse,'TSUPPARI');
assert.equal(pred.initiative.lineId,'LINE_A');
assert.equal(pred.makuriCandidate.lineId,'LINE_B');
assert.ok(pred.points.length>=4);
console.log('PASS deterministic main prediction / newspaper summary');

for(const scale of [.5,1,2,3]){
  const {state,frames,pacerExitRemaining,pacerBeforeCut}=simulate(DEFAULT_RACE_SETUP,scale);
  assert.ok(frames<160000,`${scale}x timeout`);
  assert.equal(state.ranking.length,9,`${scale}x all finish`);
  assert.equal(pacerBeforeCut,true,`${scale}x pacer left before red-board protocol`);
  assert.ok(pacerExitRemaining!=null,`${scale}x pacer never exits`);

  const logs=state.decisionLogs;
  const idxCut=logs.findIndex(x=>x.category==='PACER_CUT');
  const idxPressure=logs.findIndex(x=>x.category==='FRONT_PRESSURE');
  const idxResponse=logs.findIndex(x=>x.category==='FRONT_RESPONSE');
  const idxPacer=logs.findIndex(x=>x.category==='PACER'&&x.message.includes('退避開始'));
  const idxResult=logs.findIndex(x=>x.category==='PACER_CUT_RESULT');
  const idxBell=logs.findIndex(x=>x.category==='BELL');
  assert.ok(idxCut>=0&&idxPressure>idxCut&&idxResponse>idxPressure&&idxPacer>idxResponse,`${scale}x protocol causal order`);
  assert.ok(idxResult>idxPacer,`${scale}x contest must resolve after pacer exit trigger`);
  assert.ok(idxBell>idxResult,`${scale}x bell must follow protocol result in reference setup`);
  assert.equal(state.protocol.state,'OPEN_RACE',`${scale}x protocol must hand off to open race`);
  console.log(`PASS ${scale}x protocol cut->response->pacer->result->bell finish=${state.ranking.map(x=>x.number).join('-')}`);
}

const yieldSetup=structuredClone(DEFAULT_RACE_SETUP);
yieldSetup.riders[1].mindset=MINDSET.YIELD_AND_ROLL;
const yieldPred=stablePrediction(yieldSetup);
assert.equal(yieldPred.frontResponse,'YIELD');
assert.equal(yieldPred.initiative.lineId,yieldPred.pacerCut.lineId);
const yieldRun=simulate(yieldSetup,1);
assert.ok(yieldRun.state.decisionLogs.some(x=>x.category==='FRONT_RESPONSE'&&x.message.includes('出させ')),'YIELD runtime response missing');
console.log('PASS YIELD_AND_ROLL changes predicted and actual protocol causally');

const dynamicSetup={
  trackProfile:'PROFILE_400',
  lines:[{id:'A',members:[1,2],leader:1},{id:'B',members:[3,4,5],leader:3},{id:'C',members:[6,7],leader:6}],
  riders:{
    1:{mindset:MINDSET.TSUPPARI},3:{mindset:MINDSET.CONTAIN},6:{mindset:MINDSET.YIELD_AND_ROLL},
    8:{solo:true},9:{solo:true}
  }
};
const dynamicPred=stablePrediction(dynamicSetup);
assert.equal(dynamicPred.initialFormation,'← 12 / 345 / 67 / 8 / 9');
assert.notEqual(dynamicPred.pacerCut.lineId,dynamicPred.initialFrontLineId);
console.log('PASS arbitrary lines + SOLO summary formatting');

for(const file of ['engine.js','tactical-ai.js','autonomous-decision-engine.js','keirin-protocol-controller.js','tenkai-predictor.js']){
  const src=await readFile(new URL(`./${file}`,import.meta.url),'utf8');
  assert.doesNotMatch(src,/Math\.random\s*\(/,`${file} contains runtime randomness`);
}
console.log('PASS production prediction/protocol is random-free');

const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const ui=await readFile(new URL('./ui.js',import.meta.url),'utf8');
for(const id of ['tenkai-summary-ui','decision-log-ui','protocol-status'])assert.match(html,new RegExp(`id=["']${id}["']`));
assert.match(ui,/renderTenkaiSummary\(/);
assert.match(ui,/renderDecisionLog\(/);
console.log('PASS summary + Decision Log UI wiring');

console.log('CR-0008 PROTOCOL / TENKAI PREDICTOR: all strict checks passed');
