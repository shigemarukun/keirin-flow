import { AIModel } from './ai.js';
import { PhysicsEngine } from './engine.js';
import { UIRenderer } from './ui.js';
import { SCENARIO_TYPE } from './race-plan.js';

window.addEventListener('DOMContentLoaded',()=>{
 const aiModel=new AIModel();
 const setup=aiModel.getInitialRaceSetup();
 // CR-0015 browser demo: slot/path-history teacher case.
 // The engine itself still supports TSUPPARI_MAKURI by scenarioId.
 setup.scenarioId=SCENARIO_TYPE.YIELD_KAMASI;
 const physics=new PhysicsEngine(setup);
 window.__KEIRIN_PHYSICS__=physics;
 const ui=new UIRenderer('bankCanvas');

 const renderSetup=(applied)=>{
  if(typeof ui.renderRaceSetup==='function')ui.renderRaceSetup(applied);
  else ui.renderLineList(applied.lines.map(line=>line.members));
  ui.renderTenkaiSummary?.(physics.getPrediction());
 };
 renderSetup(setup);

 let audioContext=null;
 const ensureAudioReady=async()=>{try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return false;audioContext??=new C();if(audioContext.state==='suspended')await audioContext.resume();return audioContext.state==='running';}catch{return false;}};
 const playBellSound=async()=>{if(!(await ensureAudioReady())||!audioContext)return;const now=audioContext.currentTime+.02;[880,1760,2640,3520].forEach((frequency,index)=>{const o=audioContext.createOscillator(),g=audioContext.createGain(),duration=2.6/(index+1);o.type=index===0?'sine':'triangle';o.frequency.setValueAtTime(frequency,now);g.gain.setValueAtTime(.22/(index+1),now);g.gain.exponentialRampToValueAtTime(.0001,now+duration);o.connect(g);g.connect(audioContext.destination);o.start(now);o.stop(now+duration+.05);});};
 physics.onBell(playBellSound);

 let rafId=null;
 let lastTime=performance.now();

 const renderFrame=()=>{
  const state=physics.getState();
  window.__KEIRIN_STATE__=state;
  ui.drawBank();
  ui.drawRiders(state);
  ui.updateUI(state);
 };

 const stopAnimationLoop=()=>{
  if(rafId!==null){
   cancelAnimationFrame(rafId);
   rafId=null;
  }
 };

 const frame=now=>{
  // A cancelled/paused/reset engine never continues mutating state.
  if(!physics.isStarted){
   rafId=null;
   renderFrame();
   return;
  }

  const dt=Math.max(0,(now-lastTime)/1000);
  lastTime=now;
  physics.update(dt);
  renderFrame();

  if(physics.isStarted)rafId=requestAnimationFrame(frame);
  else rafId=null;
 };

 const startAnimationLoop=()=>{
  if(rafId!==null)return;
  lastTime=performance.now();
  rafId=requestAnimationFrame(frame);
 };

 const fullReset=()=>{
  stopAnimationLoop();
  physics.reset();
  lastTime=performance.now();
  renderSetup(physics.getState().setup);
  ui.renderDecisionLog?.([]);
  renderFrame();
 };

 document.getElementById('btn-start')?.addEventListener('click',async()=>{
  await ensureAudioReady();
  physics.start();
  startAnimationLoop();
 });

 document.getElementById('btn-pause')?.addEventListener('click',()=>{
  physics.pause();
  stopAnimationLoop();
  renderFrame();
 });

 document.getElementById('btn-reset')?.addEventListener('click',fullReset);

 const speed=document.getElementById('speedRange');
 const speedVal=document.getElementById('speedVal');
 speed?.addEventListener('input',event=>{
  const value=Number.parseFloat(event.target.value);
  physics.setSpeedScale(value);
  if(speedVal)speedVal.textContent=value.toFixed(1);
 });

 // Future drag/drop or slider UI entry point.
 window.KEIRIN_FLOW_APPLY_SETUP=(newSetup)=>{
  stopAnimationLoop();
  physics.applyRaceSetup(newSetup);
  lastTime=performance.now();
  renderSetup(physics.getState().setup);
  ui.renderDecisionLog?.([]);
  renderFrame();
 };

 window.__KEIRIN_RESET__=fullReset;
 window.__KEIRIN_STOP_LOOP__=stopAnimationLoop;

 renderFrame();

 if(new URLSearchParams(location.search).get('autostart')==='1'){
  physics.start();
  startAnimationLoop();
 }
});
