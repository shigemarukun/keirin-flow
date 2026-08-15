import { AIModel } from './ai.js';
import { PhysicsEngine } from './engine.js';
import { UIRenderer } from './ui.js';

window.addEventListener('DOMContentLoaded',()=>{
 const aiModel=new AIModel();
 const setup=aiModel.getInitialRaceSetup();
 const physics=new PhysicsEngine(setup);
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

 document.getElementById('btn-start')?.addEventListener('click',async()=>{await ensureAudioReady();physics.start();});
 document.getElementById('btn-pause')?.addEventListener('click',()=>physics.pause());
 document.getElementById('btn-reset')?.addEventListener('click',()=>{physics.reset();renderSetup(physics.getState().setup);ui.renderDecisionLog?.([]);});
 const speed=document.getElementById('speedRange'),speedVal=document.getElementById('speedVal');
 speed?.addEventListener('input',event=>{const value=Number.parseFloat(event.target.value);physics.setSpeedScale(value);if(speedVal)speedVal.textContent=value.toFixed(1);});

 // Future drag/drop or slider UI entry point.
 window.KEIRIN_FLOW_APPLY_SETUP=(newSetup)=>{
  physics.applyRaceSetup(newSetup);
  renderSetup(physics.getState().setup);
  ui.renderDecisionLog?.([]);
 };

 let lastTime=performance.now();
 const frame=now=>{
  const dt=(now-lastTime)/1000;lastTime=now;
  physics.update(dt);
  const state=physics.getState();
  ui.drawBank();ui.drawRiders(state);ui.updateUI(state);
  requestAnimationFrame(frame);
 };
 requestAnimationFrame(frame);
});
