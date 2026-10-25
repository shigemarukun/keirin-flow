import { AIModel } from './ai.js';
import { PhysicsEngine } from './engine.js';
import { UIRenderer } from './ui.js';
import { mountRaceInput } from './race-input.js';
import { mountTacticsPanel } from './tactics-panel.js';
import { mountForecastPanel } from './forecast-panel.js';
import { withCondition } from './forecast.js';
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
 // baseSetup: 出走表と展開の指定から作った、そのままのレース設定 (調子のゆらぎなし)
 let baseSetup=physics.getState().setup;
 // seed を渡すと、AIが「何通りもの未来」で走らせたうちの、その1回 (その日の調子) をそのまま再生する
 const watchRace=async(seed=null)=>{
  await ensureAudioReady();
  physics.applyRaceSetup(seed==null?baseSetup:withCondition(baseSetup,seed).setup);
  physics.reset();physics.start();
  document.getElementById('bank-container')?.scrollIntoView({behavior:'smooth',block:'start'});
 };
 const forecast=mountForecastPanel(document.getElementById('forecast-ui'),{onWatch:seed=>watchRace(seed)});

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
  baseSetup=physics.getState().setup;
  renderSetup(physics.getState().setup);
  ui.renderDecisionLog?.([]);
  forecast.update(physics.getState().setup);
  results?.reset();
 };

 // 出走表の手入力 → このレースで予想 / 展開をタップで選ぶ
 let tactics=null,results=null;
 const raceInput=mountRaceInput(document.getElementById('race-input-ui'),{onApply:newSetup=>{window.KEIRIN_FLOW_APPLY_SETUP(newSetup);tactics?.render();},onLinked:()=>tactics?.render()});
 tactics=mountTacticsPanel(document.getElementById('tactics-ui'),{
  getData:()=>raceInput?.getData(),apply:data=>raceInput.apply(data),
  getSetup:()=>baseSetup,getPrediction:()=>physics.getPrediction()
 });
 tactics.render();
 document.getElementById('btn-run-tactics')?.addEventListener('click',()=>watchRace());

 // 答え合わせ
 results=mountResultsPanel(document.getElementById('results-ui'),{getSetup:()=>baseSetup,getForecast:()=>forecast.getLast()});
 document.querySelector('.results-panel')?.addEventListener('toggle',()=>results?.render?.());

 // この予想 (出走表 + 展開の指定) をリンクにして送る
 document.getElementById('btn-share')?.addEventListener('click',async()=>{
  const note=document.getElementById('share-note');
  const data=raceInput?.getData();if(!data)return;
  const url=await shareUrl(data);
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

 // 見たい場面から再生 (赤板・打鐘・最終周・バック・直線)
 // カメラ: 選手を追って寄る / バンク全体を見る (選んだほうを覚えておく)
 const camBtn=document.getElementById('cam-toggle');
 const setCam=on=>{ui.setCameraFollow(on);if(camBtn){camBtn.textContent=on?'全体':'追う';camBtn.setAttribute('aria-pressed',String(on));}try{localStorage.setItem('keirin-flow:camera',on?'follow':'all');}catch{}};
 let camOn=true;try{camOn=localStorage.getItem('keirin-flow:camera')!=='all';}catch{}
 setCam(camOn);
 camBtn?.addEventListener('click',()=>setCam(!ui.cameraFollow));
 document.getElementById('jump-bar')?.addEventListener('click',async event=>{
  const b=event.target.closest('[data-rem]');if(!b)return;
  await ensureAudioReady();
  physics.reset();physics.fastForwardTo(Number(b.dataset.rem)*(physics.lapScale??1));physics.start();
  // 少しゆっくり見せる
  const slow=Math.min(1,physics.timeScale);physics.setSpeedScale(slow);
 });

 // 実況テロップ: 直近の大事な判断を、コースの上に数秒出す
 const caption=document.getElementById('race-caption');
 const capPhase=caption?.querySelector('.rc-phase'),capText=caption?.querySelector('.rc-text');
 const KEY=/誘導切り|突っ張|出させ|先行|叩|カマ|捲り|番手|ブロック|牽制|切り替え|踏み合い|タレ|内を突|包まれ|飲み込|競り|打鐘/;
 const phaseOf=rem=>rem>770?'周回':rem>600?'赤板':rem>400?'打鐘':rem>200?'最終周':rem>65?'バック〜4角':rem>0?'直線':'ゴール';
 let shownId=null,finishCaption=null;
 const updateCaption=state=>{
  if(!caption)return;
  const now=state.elapsedTime;
  const logs=state.decisionLogs??[];
  let pick=null;
  for(let i=logs.length-1;i>=0&&i>=logs.length-12;i--){const l=logs[i];if(now-l.time>3.2)break;if(l.category==='BELL'||(l.riderNumber!=null&&KEY.test(l.message))){pick=l;break;}}
  const total=state.totalDistance??800;
  const rem=state.raceClock?.remainingDistance??total;
  const rem400=rem/(state.lapScale??1);
  if(capPhase){const ph=state.isStarted||rem<total?phaseOf(rem400):'';if(capPhase.textContent!==ph)capPhase.textContent=ph;}
  if(pick&&pick.id!==shownId){shownId=pick.id;capText.textContent=pick.riderNumber!=null?`${pick.riderNumber}番 ${pick.message.replace(/\s*\(.*?\)\s*$/,'').replace(/^残\d+mで?/,'').replace(/^残\d+mから/,'')}`:pick.message;caption.classList.add('is-on');caption.dataset.rider=pick.riderNumber??'';}
  // ゴールしたら結果と決まり手を出し続ける
  if((state.ranking?.length??0)>=Math.min(3,state.riders.length)){
   const k=finishCaption??=(()=>{try{return physics.getStory()?.kimarite?.how??'';}catch{return '';}})();
   const top=[...state.ranking].sort((a,b)=>a.time-b.time).slice(0,3).map(r=>r.number).join('-');
   const text=`ゴール ${top}${k?` (${k})`:''}`;
   if(capText.textContent!==text){capText.textContent=text;caption.classList.add('is-on');}
   if(capPhase&&capPhase.textContent!=='結果')capPhase.textContent='結果';
   return state.ranking[0]?.number??null;
  }
  finishCaption=null;
  if(!pick&&caption.classList.contains('is-on')){caption.classList.remove('is-on');caption.dataset.rider='';}
  if(!state.isStarted&&rem>=total){caption.classList.remove('is-on');}
  return pick?.riderNumber??null;
 };

 // はじめての方へ (一度閉じたら出さない)
 const welcome=document.getElementById('welcome');
 try{if(welcome&&!localStorage.getItem('keirin-flow:welcome-closed'))welcome.hidden=false;}catch{if(welcome)welcome.hidden=false;}
 welcome?.querySelector('.welcome-close')?.addEventListener('click',()=>{welcome.hidden=true;try{localStorage.setItem('keirin-flow:welcome-closed','1');}catch{}});

 let lastTime=performance.now();
 const frame=now=>{
  const dt=(now-lastTime)/1000;lastTime=now;
  physics.update(dt);
  const state=physics.getState();
  if(state.trackLength&&ui.trackGeometry?.length!==state.trackLength)ui.setTrackLength(state.trackLength);
  ui.updateCamera(state,dt);ui.drawBank();ui.drawRiders(state);ui.updateUI(state);
  const spot=updateCaption(state);if(spot!=null)ui.drawSpotlight(state,spot);
  if(barStatus){
   const rem=Math.max(0,Math.ceil(state.raceClock?.remainingDistance??0));
   const top=state.ranking?.length?[...state.ranking].sort((a,b)=>a.time-b.time).slice(0,3).map(r=>r.number).join('-'):null;
   const text=top&&state.ranking.length===state.riders.length?`結果 ${top}`:state.isStarted?`残り${rem}m`:(rem<(state.totalDistance??800)?`停止中 残り${rem}m`:'スタート前');
   if(barStatus.textContent!==text)barStatus.textContent=text;
  }
  requestAnimationFrame(frame);
 };
 requestAnimationFrame(frame);
});
