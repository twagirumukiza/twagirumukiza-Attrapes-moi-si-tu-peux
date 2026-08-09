(()=>{
'use strict';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const COLORS=['#2f8fe0','#ffcc33','#22c55e','#ef4444','#a855f7','#f97316'];
const TRACK={2:32,3:40,4:48,5:56,6:64};
const DICE=['⚀','⚁','⚂','⚃','⚄','⚅'];
const SPEED_STEP_MS={lente:430,normale:230,rapide:110};
const CARD_TURN_START=3; // à partir de ce numéro de tour (global), une carte est proposée
const SAVE_KEY='catchme_active_game_v1';
let sound=localStorage.getItem('catchme_sound')!=='off';
let moveSpeed=localStorage.getItem('catchme_speed')||'lente';
if(!SPEED_STEP_MS[moveSpeed])moveSpeed='lente';
let game=null, mode='local', localCount=2, onlineCount=4, aiDelay=1000, busy=false, aiTimer=null, onlineApi=null, modalShown=false;
let activeEffect=null; // {idx,type:'bonus'|'malus'} pendant l'animation d'un tour avec carte
let pendingEliminated=null; // {idx,pos} garde le coureur rattrapé visible pendant la course, avant l'effet de capture

function show(id){$$('.screen').forEach(s=>s.classList.remove('active')); const el=$('#'+id); if(el) el.classList.add('active');}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function wait(ms){return new Promise(r=>setTimeout(r,ms));}

/* ---------- Sons (synthétisés, ambiance stade) ---------- */
let actx=null;
function audioCtx(){if(!sound)return null;try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;if(!actx||actx.state==='closed')actx=new AC();if(actx.state==='suspended')actx.resume();return actx;}catch{return null;}}
function beep(freq=440,d=.08,type='sine',gain=.055,delay=0){const a=audioCtx();if(!a)return;try{const t0=a.currentTime+delay;const o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.value=freq;o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(gain,t0);g.gain.exponentialRampToValueAtTime(.001,t0+d);o.start(t0);o.stop(t0+d+.02);}catch{}}
function noiseBurst(d=.35,gain=.18,delay=0){const a=audioCtx();if(!a)return;try{const t0=a.currentTime+delay;const bufferSize=a.sampleRate*d,buffer=a.createBuffer(1,bufferSize,a.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<bufferSize;i++)data[i]=(Math.random()*2-1)*(1-i/bufferSize);const src=a.createBufferSource();src.buffer=buffer;const filt=a.createBiquadFilter();filt.type='bandpass';filt.frequency.value=1200;const g=a.createGain();g.gain.setValueAtTime(gain,t0);g.gain.exponentialRampToValueAtTime(.001,t0+d);src.connect(filt);filt.connect(g);g.connect(a.destination);src.start(t0);}catch{}}
function glide(f0,f1,d=.6,type='sawtooth',gain=.06,delay=0){const a=audioCtx();if(!a)return;try{const t0=a.currentTime+delay;const o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.setValueAtTime(f0,t0);o.frequency.exponentialRampToValueAtTime(Math.max(30,f1),t0+d);o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(gain,t0);g.gain.exponentialRampToValueAtTime(.001,t0+d);o.start(t0);o.stop(t0+d+.02);}catch{}}
function sndClick(){beep(520,.07,'triangle',.05);}
function sndStep(){beep(700+Math.random()*140,.045,'square',.03);}
function sndGun(){noiseBurst(.18,.28);beep(180,.1,'square',.06,.02);}
function sndCatch(){beep(90,.32,'sawtooth',.09);beep(60,.4,'square',.06,.05);}
function sndShrink(){beep(300,.25,'sine',.05);beep(200,.3,'sine',.04,.08);}
function sndFanfare(){[523,659,784,1047].forEach((f,i)=>beep(f,.5,'triangle',.07,i*.14));noiseBurst(1.2,.12,.1);}
function sndCardFlip(){beep(300,.05,'square',.03);beep(500,.05,'square',.03,.05);}
function sndDouble(){[660,880].forEach((f,i)=>beep(f,.16,'triangle',.06,i*.09));}
function sndBonus(){[523,659,784,988,1175].forEach((f,i)=>beep(f,.4,'triangle',.075,i*.09));noiseBurst(.9,.16,.05);}
function sndMalus(){glide(420,120,.8,'sawtooth',.07);beep(200,.5,'sine',.04,.15);}
function setSoundUI(){const t=sound?'🔊':'🔇';$('#soundBtn').textContent=t;$('#gameSound').textContent=t;$('#soundToggle').checked=sound;}
function toggleSound(){sound=!sound;localStorage.setItem('catchme_sound',sound?'on':'off');setSoundUI();}
setSoundUI();

function setSpeedUI(){$$('#speedCtrl button').forEach(b=>b.classList.toggle('selected',b.dataset.speed===moveSpeed));}
function setMoveSpeed(v){if(!SPEED_STEP_MS[v])return;moveSpeed=v;localStorage.setItem('catchme_speed',v);setSpeedUI();}

/* ---------- Setup UI ---------- */
function namesUI(n){$('#names').innerHTML=Array.from({length:n},(_,i)=>`<div class="name-row"><span class="dot" style="background:${COLORS[i]}"></span><input maxlength="18" value="Athlète ${i+1}"></div>`).join('');}
namesUI(2);

/* ---------- Game state ---------- */
function freshPlayers(list){const n=list.length,L=TRACK[n],gap=Math.floor(L/n);return list.map((x,i)=>({id:x.id||`p${i}`,uid:x.uid||null,name:x.name||`Athlète ${i+1}`,color:COLORS[i],pos:i*gap,alive:true,ai:!!x.ai}));}
function newGame(players,m){const ps=freshPlayers(players); return {players:ps,turn:0,track:TRACK[ps.length],initial:ps.length,status:'playing',mode:m,moveNo:0,lastRoll:null,cardHistory:{}};}
function aliveIndices(g=game){return g.players.map((p,i)=>p.alive?i:-1).filter(i=>i>=0);}
function nextAlive(from,g=game){if(aliveIndices(g).length<2)return from;let i=from;do{i=(i+1)%g.players.length;}while(!g.players[i].alive);return i;}
function distAhead(a,b,n){const d=(b-a+n)%n;return d===0?n:d;}
function shrink(oldN,newN,g=game){g.players.forEach(p=>{if(p.alive){const norm=((p.pos%oldN)+oldN)%oldN;p.pos=Math.floor(norm/oldN*newN)%newN;}});g.track=newN;}
function resolveMove(idx,steps,g=game){
  const p=g.players[idx];if(!p||!p.alive||g.status!=='playing')return{};
  const targetIdx=nextAlive(idx,g),target=g.players[targetIdx];
  const d=distAhead(p.pos,target.pos,g.track);
  p.pos=(p.pos+steps)%g.track;
  let eliminated=null,pendingShrink=null;
  if(steps>=d){
    target.alive=false;eliminated=targetIdx;
    const remain=aliveIndices(g).length;
    // Le rétrécissement de piste est appliqué plus tard (après l'animation de capture)
    // pour que le coureur éliminé reste visible, à sa position, pendant toute la course.
    if(remain>1)pendingShrink={oldN:g.track,newN:TRACK[remain]};
  }
  const remainIdx=aliveIndices(g);
  if(remainIdx.length===1){g.status='finished';g.turn=remainIdx[0];return{eliminated,winner:g.players[remainIdx[0]]};}
  g.turn=nextAlive(idx,g);
  return{eliminated,pendingShrink};
}

/* ---------- Cartes bonus / malus ---------- */
function randomCard(type){
  if(type==='bonus'){
    if(Math.random()<0.5){const n=2+Math.floor(Math.random()*4);return{type,op:'add',amount:n,label:`+${n}`,icon:'➕',text:`Addition : +${n} sur le résultat des dés`};}
    const n=Math.random()<0.5?2:3;return{type,op:'mul',amount:n,label:`×${n}`,icon:'✖️',text:`Multiplication : le résultat des dés ×${n}`};
  }
  if(Math.random()<0.5){const n=1+Math.floor(Math.random()*4);return{type,op:'sub',amount:n,label:`−${n}`,icon:'➖',text:`Soustraction : −${n} sur le résultat des dés`};}
  const n=Math.random()<0.5?2:3;return{type,op:'div',amount:n,label:`÷${n}`,icon:'➗',text:`Division : le résultat des dés ÷${n}`};
}
function applyCard(sum,card){
  let r=sum;
  if(card.op==='add')r=sum+card.amount;
  else if(card.op==='mul')r=sum*card.amount;
  else if(card.op==='sub')r=sum-card.amount;
  else if(card.op==='div')r=Math.floor(sum/card.amount);
  return Math.max(1,r);
}
function drawTwoCards(){const bonus=randomCard('bonus'),malus=randomCard('malus');return Math.random()<0.5?[bonus,malus]:[malus,bonus];}

function renderCardHistory(){
  const el=$('#cardHistory');
  if(!game){el.innerHTML='';return;}
  const hist=game.cardHistory||{};
  const rows=game.players.map(p=>{
    const list=hist[p.id]||[];
    const tags=list.length?list.map(c=>`<span class="card-tag ${c.type}">${escapeHtml(c.label)}</span>`).join(''):'<span class="card-history-empty">Aucune carte tirée</span>';
    return `<div class="card-history-row"><span class="dot" style="background:${p.color}"></span><span class="cname">${escapeHtml(p.name)}</span>${tags}</div>`;
  }).join('');
  el.innerHTML=`<h4>🎴 Cartes tirées</h4>${rows}`;
}

function showCardOverlay(cp){
  const ov=$('#cardOverlay');
  ov.classList.remove('hidden','bonus','malus');
  $('#cardOverlayTitle').textContent=cp.ai?`${cp.name} tire une carte…`:`${cp.name}, choisis ta carte !`;
  $('#cardReveal').classList.add('hidden');
  $$('#cardPair .game-card').forEach(b=>{b.classList.remove('picked');b.disabled=!!cp.ai;b.querySelector('.card-face').textContent='🎴';});
}
function hideCardOverlay(){$('#cardOverlay').classList.add('hidden');}
function waitForPlayerCardPick(){
  return new Promise(resolve=>{
    const btns=$$('#cardPair .game-card');
    const handler=e=>{btns.forEach(b=>b.onclick=null);resolve(+e.currentTarget.dataset.side);};
    btns.forEach(b=>b.onclick=handler);
  });
}
function revealCard(card,side){
  $$('#cardPair .game-card').forEach((b,i)=>{if(i===side)b.classList.add('picked');b.disabled=true;});
  const ov=$('#cardOverlay');ov.classList.add(card.type);
  $('#cardRevealIcon').textContent=card.type==='bonus'?'🌟':'⛈️';
  $('#cardRevealLabel').textContent=`${card.type==='bonus'?'BONUS':'MALUS'} ${card.icon} ${card.label}`;
  $('#cardRevealText').textContent=card.text;
  $('#cardReveal').classList.remove('hidden');
}

async function cardPhase(idx,cp,baseSum){
  const cards=drawTwoCards();
  showCardOverlay(cp);
  renderBoard();
  let side;
  if(cp.ai){
    await wait(700+Math.random()*500);
    side=Math.random()<0.5?0:1;
    sndCardFlip();
  }else{
    side=await waitForPlayerCardPick();
    sndCardFlip();
  }
  const card=cards[side];
  revealCard(card,side);
  if(card.type==='bonus')sndBonus();else sndMalus();
  await wait(3000);
  hideCardOverlay();
  game.cardHistory=game.cardHistory||{};
  (game.cardHistory[cp.id]=game.cardHistory[cp.id]||[]).push({label:card.label,type:card.type});
  renderCardHistory();
  const finalSum=applyCard(baseSum,card);
  return {finalSum,card};
}

/* ---------- Piste ovale style stade (anneau segmenté, sens anti-horaire) ---------- */
const CX=350, CY=410;
const R_OUT={rx:298,ry:368}, R_IN={rx:182,ry:242}, R_MID={rx:240,ry:305};
function angleAt(i,n){return Math.PI/2+2*Math.PI*i/n;} // i croissant => déplacement anti-horaire à l'écran
function ptAt(i,n,rx,ry){const t=angleAt(i,n);return[CX+rx*Math.cos(t),CY-ry*Math.sin(t)];}
function ellipsePath(rx,ry){return `M ${CX+rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX-rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX+rx} ${CY} Z`;}

function boardSkeleton(n){
  let h=`<defs>
    <radialGradient id="trackGrad" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#e2622a"/><stop offset="70%" stop-color="#c1440e"/><stop offset="100%" stop-color="#8f2f0a"/>
    </radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
  h+=`<path d="${ellipsePath(R_OUT.rx,R_OUT.ry)} ${ellipsePath(R_IN.rx,R_IN.ry)}" fill="url(#trackGrad)" fill-rule="evenodd" stroke="#ffffff33" stroke-width="3"/>`;
  h+=`<ellipse cx="${CX}" cy="${CY}" rx="${R_IN.rx-3}" ry="${R_IN.ry-3}" fill="#0a1330" stroke="#ffffff22" stroke-width="2"/>`;
  for(let i=0;i<n;i++){
    const a=i-0.5;
    const[x1,y1]=ptAt(a,n,R_IN.rx-2,R_IN.ry-2);
    const[x2,y2]=ptAt(a,n,R_OUT.rx,R_OUT.ry);
    h+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="cellline"/>`;
  }
  const[fx,fy]=ptAt(0,n,R_OUT.rx+18,R_OUT.ry+18);
  h+=`<text x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" text-anchor="middle" font-size="26">🏁</text>`;
  h+=`<text x="${CX}" y="${CY-6}" text-anchor="middle" font-size="15" fill="#ffffff55" font-weight="900" letter-spacing="2">STADE OLYMPIQUE</text>`;
  h+=`<text x="${CX}" y="${CY+16}" text-anchor="middle" font-size="11" fill="#ffffff33" font-weight="700">${n} CASES</text>`;
  return h;
}

function runnerSVG(p,x,y,current,effect){
  const glow=current?'filter="url(#glow)"':'';
  let ring='';
  if(effect){const col=effect==='bonus'?'#22c55e':'#ef4444';ring=`<circle r="27" fill="none" stroke="${col}" stroke-width="4" opacity="0.85" class="effect-ring"/>`;}
  return `<g class="runner ${effect?('fx-'+effect):''}" data-pid="${p.id}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    ${ring}<circle r="21" fill="${p.color}" stroke="#fff" stroke-width="4" ${glow}/>
    <text x="0" y="7" text-anchor="middle" font-size="17" font-weight="900" fill="#0a1330">${escapeHtml(p.name.slice(0,1).toUpperCase())}</text>
  </g>`;
}

function renderBoard(overridePos){
  if(!game)return;
  const svg=$('#board'), n=game.track;
  let h=boardSkeleton(n);
  game.players.forEach((p,i)=>{
    const isPendingCatch=pendingEliminated&&pendingEliminated.idx===i;
    if(!p.alive&&!isPendingCatch)return;
    const pos=(overridePos&&overridePos[i]!==undefined)?overridePos[i]:(isPendingCatch?pendingEliminated.pos:p.pos);
    const[x,y]=ptAt(((pos%n)+n)%n,n,R_MID.rx,R_MID.ry);
    const eff=(activeEffect&&activeEffect.idx===i)?activeEffect.type:null;
    h+=runnerSVG(p,x,y,i===game.turn&&game.status==='playing',eff);
  });
  svg.innerHTML=h;
  const alive=aliveIndices().length,cp=game.players[game.turn];
  $('#trackLabel').textContent=`${game.track} CASES • ${alive} COUREUR${alive>1?'S':''}`;
  $('#playersBar').innerHTML=game.players.map((p,i)=>`<span class="chip ${p.alive?'':'out'} ${i===game.turn&&p.alive?'current':''}" style="border-color:${p.color}">${escapeHtml(p.name)}${p.ai?' 🤖':''}</span>`).join('');
  $('#turnBanner').textContent=game.status==='finished'?'🏁 Course terminée':`Tour de ${cp?.name||''}${cp?.ai?' 🤖':''}`;
  $('#turnBanner').style.color=cp?.color||'#ffcc33';
  const mine=mode!=='online'||onlineApi?.isMyTurn?.(game);
  $('#rollBtn').disabled=busy||game.status!=='playing'||!mine||!!cp?.ai;
  $('#rollBtn').style.visibility=cp?.ai?'hidden':'visible';
  renderCardHistory();
}

/* ---------- Effets flottants sur le plateau ---------- */
function spawnFloatingFx(svgX,svgY,label,type){
  const layer=$('#floatingFx');if(!layer)return;
  const el=document.createElement('div');
  el.className='floatfx '+(type==='bonus'?'fx-bonus':'fx-malus');
  el.textContent=label;
  el.style.left=(svgX/700*100)+'%';
  el.style.top=(svgY/820*100)+'%';
  layer.appendChild(el);
  setTimeout(()=>el.remove(),1250);
}

/* ---------- Animation de course pas à pas ---------- */
async function animateRunner(idx,fromPos,steps,trackN){
  const stepMs=SPEED_STEP_MS[moveSpeed];
  for(let s=1;s<=steps;s++){
    const pos=(fromPos+s)%trackN;
    renderBoard({[idx]:pos});
    const g=$(`.runner[data-pid="${game.players[idx].id}"]`);
    if(g){g.classList.add('stepping');}
    sndStep();
    await wait(stepMs);
  }
}

function catchEffect(eliminatedIdx){
  const p=game.players[eliminatedIdx];
  const g=$(`.runner[data-pid="${p.id}"]`);
  if(g)g.classList.add('caught');
  sndCatch();
}

function shrinkEffect(){
  const svg=$('#board');svg.classList.add('track-shrink');
  sndShrink();
  setTimeout(()=>svg.classList.remove('track-shrink'),650);
}

/* ---------- Persistance ---------- */
function saveGame(){
  if(mode==='online'||!game||game.status!=='playing')return;
  try{localStorage.setItem(SAVE_KEY,JSON.stringify({mode,game,aiDelay,ts:Date.now()}));}catch{}
}
function clearSavedGame(){try{localStorage.removeItem(SAVE_KEY);}catch{}}
function loadSavedGame(){try{const raw=localStorage.getItem(SAVE_KEY);if(!raw)return null;const data=JSON.parse(raw);if(!data?.game||data.game.status!=='playing')return null;return data;}catch{return null;}}

/* ---------- Déroulement d'un tour ---------- */
function startGame(){
  modalShown=false;clearTimeout(aiTimer);activeEffect=null;show('game');
  $('#modeLabel').textContent=mode==='solo'?'SOLO VS IA':mode==='online'?'COURSE EN LIGNE':'COURSE LOCALE';
  $('#status').textContent='À vos marques… prêts… partez !';
  $('#die1').textContent=$('#die2').textContent='⚀';
  sndGun();
  renderBoard();
  saveGame();
  scheduleAI();
}
function celebrate(p){
  if(modalShown)return;modalShown=true;
  clearSavedGame();
  $('#modalTitle').textContent=`${p.name} remporte l'or !`;
  $('#modalText').textContent='Dernier athlète encore en piste.';
  $('#modal').classList.remove('hidden');
  const c=$('#confetti');c.innerHTML='';
  const medalColors=['#ffcc33','#c7ccd6','#e39a5b'];
  for(let i=0;i<50;i++){const s=document.createElement('span');s.className='conf';s.textContent=['🏅','●','■','★','🎉'][i%5];s.style.left=Math.random()*100+'%';s.style.color=medalColors[i%medalColors.length];s.style.animationDelay=Math.random()*.8+'s';c.appendChild(s);}
  sndFanfare();
}
function finishMove(cp,a,b,res,cardInfo,isDouble){
  const base=a+b;
  let txt=`${cp.name} lance ${a} + ${b} = ${base}.`;
  if(cardInfo)txt+=` Carte ${cardInfo.card.type==='bonus'?'BONUS':'MALUS'} ${cardInfo.card.icon} ${cardInfo.card.label} → ${cardInfo.finalSum}.`;
  if(isDouble && game.status==='playing' && !res.winner)txt+=' 🎲 Double ! Rejoue !';
  if(res.eliminated!==null&&res.eliminated!==undefined){
    txt+=` 💥 ${game.players[res.eliminated].name} est rattrapé ! La piste se resserre.`;
  }
  $('#status').textContent=txt;
  renderBoard();
  saveGame();
  if(res.winner)celebrate(res.winner);else scheduleAI();
}

async function performRoll(isAI=false){
  if(busy||!game||game.status!=='playing')return;
  const idx=game.turn,cp=game.players[idx];
  if(cp.ai!==isAI&&mode==='solo')return;
  if(mode==='online'&&!onlineApi?.isMyTurn?.(game))return;
  busy=true;renderBoard();
  $('#die1').classList.add('rolling');$('#die2').classList.add('rolling');
  sndClick();
  await wait(isAI?420:560);
  const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6),baseSum=a+b;
  const isDouble=a===b;
  $('#die1').textContent=DICE[a-1];$('#die2').textContent=DICE[b-1];
  $('#die1').classList.remove('rolling');$('#die2').classList.remove('rolling');
  game.lastRoll={a,b,by:cp.id};game.moveNo=(game.moveNo||0)+1;
  if(isDouble)sndDouble();

  let finalSum=baseSum, cardInfo=null;
  if(game.moveNo>=CARD_TURN_START){
    cardInfo=await cardPhase(idx,cp,baseSum);
    finalSum=cardInfo.finalSum;
  }

  const fromPos=cp.pos, trackN=game.track;
  const res=resolveMove(idx,finalSum);
  if(isDouble && game.status==='playing' && !res.winner)game.turn=idx;

  if(res.eliminated!==null&&res.eliminated!==undefined){
    // Le pion rattrapé reste affiché (figé à sa position) tant que la course anime et que
    // l'effet de capture ne s'est pas encore joué, au lieu de disparaître instantanément.
    pendingEliminated={idx:res.eliminated,pos:game.players[res.eliminated].pos};
  }
  if(cardInfo)activeEffect={idx,type:cardInfo.card.type};
  if(cardInfo){
    const[fx,fy]=ptAt(((fromPos%trackN)+trackN)%trackN,trackN,R_MID.rx,R_MID.ry);
    spawnFloatingFx(fx,fy,cardInfo.card.label,cardInfo.card.type);
  }
  await animateRunner(idx,fromPos,finalSum,trackN);
  activeEffect=null;

  if(res.eliminated!==null&&res.eliminated!==undefined){
    catchEffect(res.eliminated);
    await wait(280);
    pendingEliminated=null;
    if(res.pendingShrink){
      shrink(res.pendingShrink.oldN,res.pendingShrink.newN,game);
      shrinkEffect();
      renderBoard();
      await wait(200);
    }else{
      renderBoard();
    }
  }
  busy=false;
  if(mode==='online'){
    try{await onlineApi.pushGame(game);}
    catch(e){$('#status').textContent='Erreur de synchronisation : '+e.message;renderBoard();return;}
  }
  finishMove(cp,a,b,res,cardInfo,isDouble);
}
function scheduleAI(){
  clearTimeout(aiTimer);
  if(mode!=='solo'||!game||game.status!=='playing')return;
  const cp=game.players[game.turn];
  if(cp?.ai){$('#status').textContent=`${cp.name} se prépare…`;renderBoard();aiTimer=setTimeout(()=>performRoll(true),aiDelay);}
}

/* ---------- UI events ---------- */
$('#rollBtn').onclick=()=>performRoll(false);
$('#soloBtn').onclick=()=>show('solo');$('#localBtn').onclick=()=>show('local');$('#onlineBtn').onclick=()=>show('online');$('#rulesBtn').onclick=()=>show('rules');
$$('.back').forEach(b=>b.addEventListener('click',()=>show('home')));
$('#playerCount').onclick=e=>{const n=+e.target.dataset.n;if(!n)return;localCount=n;$('#playerCount .selected')?.classList.remove('selected');e.target.classList.add('selected');namesUI(n);};
$('#onlineCount').onclick=e=>{const n=+e.target.dataset.n;if(!n)return;onlineCount=n;$('#onlineCount .selected')?.classList.remove('selected');e.target.classList.add('selected');};
$('#aiSpeed').onclick=e=>{const ms=+e.target.dataset.ms;if(!ms)return;aiDelay=ms;$('#aiSpeed .selected')?.classList.remove('selected');e.target.classList.add('selected');};
$('#speedCtrl').onclick=e=>{const v=e.target.dataset.speed;if(!v)return;setMoveSpeed(v);};
setSpeedUI();
$('#startSolo').onclick=()=>{mode='solo';const name=$('#soloName').value.trim()||'Moi';game=newGame([{name},{name:'IA',ai:true}],'solo');startGame();};
$('#startLocal').onclick=()=>{mode='local';const list=$$('#names input').map((x,i)=>({name:x.value.trim()||`Athlète ${i+1}`}));game=newGame(list,'local');startGame();};

async function loadOnline(){
  if(onlineApi)return onlineApi;
  $('#onlineError').textContent='Connexion au serveur multijoueur…';
  try{
    const mod=await import('./online.js');
    onlineApi=await mod.createOnlineController({
      onLobby(room){
        $('#roomCode').textContent=room.code;$('#roomCodeBig').textContent=room.code;
        $('#lobbyPlayers').innerHTML=room.players.map(p=>`<div class="lobby-player"><span class="dot" style="background:${p.color}"></span><b>${escapeHtml(p.name)}</b>${p.uid===room.hostId?' 👑':''}</div>`).join('');
        $('#waitingText').textContent=`${room.players.length}/${room.maxPlayers} athlètes prêts`;
        $('#startOnline').classList.toggle('hidden',!room.amHost||room.players.length<2);
      },
      onGame(g){
        game=g;mode='online';
        if(!$('#game').classList.contains('active'))startGame();else renderBoard();
        if(g.status==='finished'){const w=g.players.find(p=>p.alive);if(w)celebrate(w);}
      },
      onClosed(msg){$('#lobbyError').textContent=msg||'Le salon a été fermé.';show('home');}
    });
    $('#onlineError').textContent='';
    return onlineApi;
  }catch(e){
    $('#onlineError').textContent='Connexion multijoueur impossible : '+e.message;
    throw e;
  }
}
$('#createRoom').onclick=async()=>{try{const api=await loadOnline();const name=$('#onlineName').value.trim()||'Athlète';await api.createRoom(name,onlineCount);show('lobby');}catch{}};
$('#joinRoom').onclick=async()=>{try{const api=await loadOnline();const name=$('#onlineName').value.trim()||'Athlète',code=$('#roomCodeInput').value.trim().toUpperCase();if(!code){$('#onlineError').textContent='Entre le code du salon.';return;}await api.joinRoom(name,code);show('lobby');}catch(e){$('#onlineError').textContent=e.message;}};
$('#startOnline').onclick=async()=>{try{await onlineApi.startGame();}catch(e){$('#lobbyError').textContent=e.message;}};
$('#shareRoom').onclick=async()=>{if(!onlineApi)return;const data=onlineApi.shareData();try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url);alert('Lien copié !');}}catch{}};
$('#leaveLobby').onclick=async()=>{if(onlineApi)await onlineApi.leave(false);show('home');};
$('#quitGame').onclick=async()=>{if(!confirm(mode==='online'?'Quitter ? Tu seras éliminé.':'Quitter la course ?'))return;clearTimeout(aiTimer);clearSavedGame();if(mode==='online'&&onlineApi)await onlineApi.leave(true);show('home');};

$('#replayBtn').onclick=async()=>{
  $('#modal').classList.add('hidden');modalShown=false;
  if(mode==='solo'){const human=game.players.find(p=>!p.ai)?.name||'Moi';game=newGame([{name:human},{name:'IA',ai:true}],'solo');startGame();}
  else if(mode==='local'){game=newGame(game.players.map(p=>({name:p.name})),'local');startGame();}
  else if(mode==='online'&&onlineApi){try{await onlineApi.restart();}catch(e){alert(e.message);}}
};
$('#homeBtn').onclick=async()=>{$('#modal').classList.add('hidden');clearTimeout(aiTimer);if(mode==='online'&&onlineApi)await onlineApi.leave(false);show('home');};

$('#burger').onclick=()=>{$('#drawer').classList.add('open');$('#shade').classList.add('open');};
const closeDrawer=()=>{$('#drawer').classList.remove('open');$('#shade').classList.remove('open');};
$('#closeDrawer').onclick=closeDrawer;$('#shade').onclick=closeDrawer;
$$('[data-go]').forEach(b=>b.onclick=()=>{closeDrawer();show(b.dataset.go);});
$('#soundBtn').onclick=toggleSound;$('#gameSound').onclick=toggleSound;
$('#soundToggle').onchange=()=>{sound=$('#soundToggle').checked;localStorage.setItem('catchme_sound',sound?'on':'off');setSoundUI();};

/* ---------- Reprise de partie ---------- */
$('#resumeYes').onclick=()=>{
  const data=loadSavedGame();
  $('#resumeModal').classList.add('hidden');
  if(!data)return;
  mode=data.mode;game=data.game;aiDelay=data.aiDelay||aiDelay;
  modalShown=false;activeEffect=null;show('game');
  $('#modeLabel').textContent=mode==='solo'?'SOLO VS IA':mode==='online'?'COURSE EN LIGNE':'COURSE LOCALE';
  $('#status').textContent='Course reprise !';
  renderBoard();
  scheduleAI();
};
$('#resumeNo').onclick=()=>{clearSavedGame();$('#resumeModal').classList.add('hidden');};

const q=new URLSearchParams(location.search).get('room');
if(q){$('#roomCodeInput').value=q.toUpperCase();show('online');}
else{
  const saved=loadSavedGame();
  if(saved){
    const names=saved.game.players.map(p=>p.name).join(', ');
    $('#resumeText').textContent=`${saved.mode==='solo'?'Solo contre l\u2019IA':'Course locale'} — ${names}.`;
    $('#resumeModal').classList.remove('hidden');
  }
}

window.CatchMeCore={TRACK,COLORS,freshPlayers,newGame,nextAlive,resolveMove,shrink,applyCard,randomCard};
})();
