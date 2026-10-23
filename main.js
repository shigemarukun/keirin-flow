import { AIModel } from './ai.js';
import { PhysicsEngine } from './engine.js';
import { UIRenderer } from './ui.js';
import { mountRaceInput } from './race-input.js';
import { mountTacticsPanel } from './tactics-panel.js';
import { mountForecastPanel } from './forecast-panel.js';
import { mountResultsPanel } from './results-panel.js';
import { shareUrl } from './race-input.js';

window.addEventListener('DOMContentLoaded',()=>{
 const aiModel=new AIModel();
 const setup=aiModel.getInitialRaceSetup();
 const physics=new PhysicsEngine(setup);
 const ui=new UIRenderer('bankCanvas');

 const renderSetup=(applied)=>{
  if(typeof ui.renderRaceSetup==='function')ui.renderRaceSetup(applied);
  else ui.renderLineList(applied.lines.map(line=>line.members));
  if(!document.getElementById('forecast-ui'))ui.renderTenkaiSummary?.(physics.getPrediction());
 };
 renderSetup(setup);
 // AIの展開予想: 出走表や展開を変えるたびに計算し直す
 const watchRace=async()=>{await ensureAudioReady();physics.reset();physics.start();document.getElementById('bank-container')?.scrollIntoView({behavior:'smooth',block:'start'});};
 const forecast=mountForecastPanel(document.getElementById('forecast-ui'),{onWatch:()=>watchRace()});

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
  forecast.update(physics.getState().setup);
  results?.reset();
 };

 // 出走表の手入力 → このレースで予想 / 展開をタップで選ぶ
 let tactics=null,results=null;
 const raceInput=mountRaceInput(document.getElementById('race-input-ui'),{onApply:newSetup=>{window.KEIRIN_FLOW_APPLY_SETUP(newSetup);tactics?.render();}});
 tactics=mountTacticsPanel(document.getElementById('tactics-ui'),{
  getData:()=>raceInput?.getData(),apply:data=>raceInput.apply(data),
  getSetup:()=>physics.getState().setup,getPrediction:()=>physics.getPrediction()
 });
 tactics.render();
 document.getElementById('btn-run-tactics')?.addEventListener('click',()=>watchRace());

 // 答え合わせ
 results=mountResultsPanel(document.getElementById('results-ui'),{getSetup:()=>physics.getState().setup,getForecast:()=>forecast.getLast()});

 // この予想 (出走表 + 展開の指定) をリンクにして送る
 document.getElementById('btn-share')?.addEventListener('click',async()=>{
  const note=document.getElementById('share-note');
  const data=raceInput?.getData();if(!data)return;
  const url=shareUrl(data);
  try{
   if(navigator.share){await navigator.share({title:'KEIRIN FLOW の展開予想',text:'このレースの展開予想を見てみて',url});if(note)note.textContent='送りました。';return;}
  }catch(e){if(e?.name==='AbortError')return;}
  try{await navigator.clipboard.writeText(url);if(note)note.textContent='リンクをコピーしました。LINEなどに貼り付けて送ってください。';}
  catch{if(note)note.textContent=url;}
 });

 // スマホの下の操作ボタン
 const bar=document.getElementById('mobile-bar');
 const speeds=[1,2,3,0.5];
 bar?.addEventListener('click',event=>{
  const act=event.target.closest('[data-act]')?.dataset.act;
  if(act==='start')document.getElementById('btn-start')?.click();
  if(act==='pause')document.getElementById('btn-pause')?.click();
  if(act==='reset')document.getElementById('btn-reset')?.click();
  if(act==='speed'){
   const b=event.target.closest('[data-act]');const next=speeds[(speeds.indexOf(Number(b.dataset.v??1))+1)%speeds.length];
   b.dataset.v=next;b.textContent=`${next}x`;physics.setSpeedScale(next);
   if(speed){speed.value=next;if(speedVal)speedVal.textContent=next.toFixed(1);}
  }
 });
 const barStatus=document.getElementById('mobile-bar-status');

 let lastTime=performance.now();
 const frame=now=>{
  const dt=(now-lastTime)/1000;lastTime=now;
  physics.update(dt);
  const state=physics.getState();
  ui.drawBank();ui.drawRiders(state);ui.updateUI(state);
  if(barStatus){
   const rem=Math.max(0,Math.ceil(state.raceClock?.remainingDistance??0));
   const top=state.ranking?.length?[...state.ranking].sort((a,b)=>a.time-b.time).slice(0,3).map(r=>r.number).join('-'):null;
   const text=top&&state.ranking.length===state.riders.length?`結果 ${top}`:state.isStarted?`残り${rem}m`:(rem<800?`停止中 残り${rem}m`:'スタート前');
   if(barStatus.textContent!==text)barStatus.textContent=text;
  }
  requestAnimationFrame(frame);
 };
 requestAnimationFrame(frame);
});
