(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const assets=JSON.parse($('mfp-original-assets').textContent);
  let state=MFP.read(),doorRunning=false;
  const roomUnlocked=room=>!!room&&state.completedWeeks>=room.unlockWeeks;
  if(!assets.rooms.some(r=>r.id===state.room&&roomUnlocked(r)))state.room=null;
  const say=text=>{$('mfp-status').textContent=text;};
  const save=()=>MFP.save(state);
  function render(){
    const pay=$('mfp-payment'),profile=$('mfp-profile'),choose=$('mfp-select-room');
    pay.textContent=state.paid?'HOME 3 · PAGAMENTO DI PROVA COMPLETATO ✓':'2 · HOME 3 · PAGAMENTO';
    pay.classList.toggle('is-done',state.paid);pay.classList.toggle('is-next',state.profile&&!state.paid);
    profile.disabled=false;profile.textContent=state.profile?'1 · REGISTRAZIONE DI PROVA CONFERMATA ✓':'1 · REGISTRAZIONE DI PROVA';
    profile.classList.toggle('is-done',state.profile);profile.classList.toggle('is-next',!state.profile);
    choose.disabled=!(state.paid&&state.profile);choose.classList.toggle('is-next',state.paid&&state.profile);
    choose.textContent=state.room?'CAMBIA STANZA':'3 · SCEGLI STANZA';
    const room=assets.rooms.find(r=>r.id===state.room);
    say(!state.profile?'Inizia dalla registrazione di prova.':!state.paid?'Registrazione confermata. Prosegui al pagamento nella Home 3.':!room?'Scegli la tua stanza nella Home 4: la porta si aprirà automaticamente.':'Stanza selezionata: '+room.name+'. La porta si apre automaticamente dopo ogni scelta.');
    document.documentElement.style.setProperty('--mfp-controls-height',($('mfp-controls').offsetHeight+30)+'px');
  }
  const show=dialog=>dialog.showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  function showProfile(){show($('mfp-profile-dialog'));}
  function openLinked(kind){
    if(kind==='payment'&&!state.profile){showProfile();return;}
    location.href={home1:'home1-fullscreen.html',payment:'home3.html',home4:'home4.html'}[kind];
  }
  $('mfp-home1').addEventListener('click',()=>openLinked('home1'));
  $('mfp-payment').addEventListener('click',()=>openLinked('payment'));
  $('mfp-profile').addEventListener('click',showProfile);
  $('mfp-trial').addEventListener('click',()=>show($('mfp-trial-dialog')));
  $('mfp-confirm-payment').addEventListener('click',()=>{
    state.paid=true;if(!save()){say('Consenti la memorizzazione in questa scheda per continuare.');return;}
    $('mfp-trial-dialog').close();render();if(!state.profile)showProfile();
  });
  $('mfp-profile-form').addEventListener('submit',e=>{
    e.preventDefault();const input=e.currentTarget.elements.displayName;
    if(!input.value.trim()){input.setCustomValidity('Inserisci un nome di prova.');input.reportValidity();return;}
    input.setCustomValidity('');if(!e.currentTarget.reportValidity())return;
    state.profile=true;
    if(!save()){say('Consenti la memorizzazione in questa scheda per continuare.');return;}
    $('mfp-profile-dialog').close();render();
    location.href=state.paid?'home4.html':'home3.html';
  });
  $('mfp-profile-form').elements.displayName.addEventListener('input',e=>e.target.setCustomValidity(''));
  $('mfp-select-room').addEventListener('click',()=>openLinked('home4'));
  $('mfp-visit').addEventListener('click',()=>openLinked('home4'));

  const body=document.querySelector('.body'),base=body.querySelector('img');
  const entry=document.createElement('dialog');entry.id='mfp-entry';entry.setAttribute('aria-label','Ingresso nella stanza Meta Fit Pro');
  entry.innerHTML='<div class="mfp-entry-stage"><div class="mfp-entry-camera"></div><section class="mfp-arrival" hidden aria-labelledby="mfp-arrival-title"><img alt=""><div class="mfp-arrival-light" aria-hidden="true"></div><div class="mfp-arrival-label"><p>META FIT PRO · LA TUA STANZA</p><h2 id="mfp-arrival-title"></h2></div></section><div class="mfp-entry-wash" aria-hidden="true"></div></div><button class="mfp-entry-return" type="button">← TORNA ALLA HOME 2</button><p class="mfp-entry-status" role="status" aria-live="polite"></p>';
  document.body.append(entry);
  const camera=entry.querySelector('.mfp-entry-camera'),arrival=entry.querySelector('.mfp-arrival'),arrivalImg=arrival.querySelector('img'),wash=entry.querySelector('.mfp-entry-wash'),entryStatus=entry.querySelector('.mfp-entry-status');
  let entryAbort=null,entryFocus=null;
  const cleanEntry=()=>{
    if(entryAbort){entryAbort.abort();entryAbort=null;}
    doorRunning=false;camera.replaceChildren();camera.removeAttribute('style');camera.hidden=false;arrival.hidden=true;arrival.classList.remove('visible','lit','has-room-page');arrival.querySelector('iframe')?.remove();wash.classList.remove('visible');entry.dataset.phase='idle';document.body.classList.remove('mfp-entering');
  };
  function closeDoor(){
    cleanEntry();
    if(entry.open)entry.close();
  }
  entry.addEventListener('close',()=>{cleanEntry();render();if(entryFocus?.isConnected)entryFocus.focus();});
  entry.addEventListener('cancel',event=>{event.preventDefault();closeDoor();});
  entry.querySelector('.mfp-entry-return').addEventListener('click',closeDoor);
  function entryWait(ms,signal){
    return new Promise((resolve,reject)=>{
      if(signal.aborted){reject(new DOMException('Ingresso annullato','AbortError'));return;}
      const abort=()=>{clearTimeout(timer);reject(new DOMException('Ingresso annullato','AbortError'));};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
      signal.addEventListener('abort',abort,{once:true});
    });
  }
  async function animateDoor(preview){
    if(doorRunning)return;
    const selected=assets.rooms.find(r=>r.id===state.room);
    if(!preview&&!(state.paid&&state.profile&&roomUnlocked(selected))){say('Completa i passaggi e scegli una stanza disponibile prima di entrare.');return;}
    const room=roomUnlocked(selected)?selected:assets.rooms[0];
    doorRunning=true;entryFocus=document.activeElement;
    const controller=new AbortController();entryAbort=controller;const signal=controller.signal;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    try{
      // Preload the destination while keeping it hidden until the light fills the view.
      arrivalImg.src=room.image;arrivalImg.alt=room.name;arrival.hidden=true;arrival.classList.remove('visible');
      if(arrivalImg.decode)await arrivalImg.decode();
      if(room.page){
        const frame=document.createElement('iframe');frame.className='mfp-arrival-room';frame.title='Stanza '+room.name;frame.src=room.page;
        frame.addEventListener('load',()=>{try{frame.contentDocument.querySelectorAll('a').forEach(a=>a.target='_top');}catch{}});
        arrival.append(frame);arrival.classList.add('has-room-page');
      }
      if(signal.aborted)return;
      body.scrollIntoView({behavior:'instant',block:'start'});
      const page=document.querySelector('.page'),rect=page.getBoundingClientRect(),copy=page.cloneNode(true);
      copy.querySelectorAll('button').forEach(button=>button.remove());copy.setAttribute('aria-hidden','true');
      camera.hidden=false;camera.replaceChildren(copy);Object.assign(camera.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',transform:'none',transition:'none'});
      const portal=document.createElement('div');portal.className='mfp-door';portal.setAttribute('aria-hidden','true');
      const glow=document.createElement('div');glow.className='mfp-door-aura';
      const light=document.createElement('div');light.className='mfp-door-light';
      const leaf=document.createElement('div');leaf.className='mfp-door-leaf';leaf.style.backgroundImage='url("'+base.src+'")';
      portal.append(glow,light,leaf);
      const copyBody=copy.querySelector('.body');
      for(const className of ['mfp-light-halo','mfp-light-air','mfp-light-floor']){const spill=document.createElement('div');spill.className=className;spill.setAttribute('aria-hidden','true');copyBody.append(spill);}
      copyBody.append(portal);
      $('mfp-arrival-title').textContent=room.name;
      entry.dataset.phase='opening';entryStatus.textContent='LA PORTA SI APRE';
      document.body.classList.add('mfp-entering');entry.showModal();
      await entryWait(50,signal);portal.classList.add('open');copyBody.classList.add('mfp-light-on');
      await entryWait(reduced?400:2350,signal);
      entryStatus.textContent='PORTA APERTA';
      if(!reduced){
        const doorRect=portal.getBoundingClientRect(),vw=entry.clientWidth||innerWidth,vh=entry.clientHeight||innerHeight;
        const scale=Math.max(vw/doorRect.width,vh/doorRect.height)*1.22;
        const x=doorRect.left+doorRect.width/2-rect.left,y=doorRect.top+doorRect.height/2-rect.top;
        camera.style.transition='transform 4.8s cubic-bezier(.45,.03,.68,1)';
        camera.style.transform='translate('+(vw/2-rect.left-scale*x)+'px,'+(vh/2-rect.top-scale*y)+'px) scale('+scale+')';
        entry.dataset.phase='approaching';
        await entryWait(4300,signal);
      }
      entry.dataset.phase='light';wash.classList.add('visible');
      await entryWait(reduced?220:650,signal);
      // This is the first point at which the chosen room can become visible.
      camera.hidden=true;arrival.hidden=false;arrival.classList.add('visible','lit');
      await entryWait(100,signal);wash.classList.remove('visible');entry.dataset.phase='arrived';
      entryStatus.textContent='Sei nella stanza '+room.name;doorRunning=false;
      say('Sei entrato nella stanza '+room.name+'.');
      // The glow continues into the chosen room and settles after entry.
      await entryWait(reduced?100:500,signal);arrival.classList.remove('lit');
    }catch(error){
      if(error.name!=='AbortError'){closeDoor();say('Non riesco ad aprire la stanza. Riprova.');}
    }finally{if(!entry.open)doorRunning=false;}
  }

  $('mfp-preview').addEventListener('click',()=>animateDoor(true));
  $('mfp-reset').addEventListener('click',()=>show($('mfp-reset-dialog')));
  $('mfp-confirm-reset').addEventListener('click',()=>{closeDoor();state=MFP.fresh();MFP.clear();$('mfp-profile-form').reset();render();$('mfp-reset-dialog').close();});
  const hotspots=[
    ['Registrazione e profilo',76.3,30.9,21.8,5.6,showProfile],
    ['Torna alla Home 1',2,87.9,30.4,8.8,()=>openLinked('home1')],
    ['Home 1',41.5,88,17,9,()=>openLinked('home1')],
    ['Avanti alla Home 3: pagamento',65,87.9,32.3,8.8,()=>openLinked('payment')]
  ];
  hotspots.forEach(([label,left,top,width,height,action])=>{
    const b=document.createElement('button');b.type='button';b.className='mfp-hotspot';b.setAttribute('aria-label',label);
    Object.assign(b.style,{left:left+'%',top:top+'%',width:width+'%',height:height+'%'});b.addEventListener('click',action);body.append(b);
  });
  if(window.ResizeObserver)new ResizeObserver(()=>document.documentElement.style.setProperty('--mfp-controls-height',($('mfp-controls').offsetHeight+30)+'px')).observe($('mfp-controls'));
  const query=new URLSearchParams(location.search),incoming=assets.rooms.find(r=>r.id===query.get('stanza'));
  render();
  if(incoming&&roomUnlocked(incoming)&&state.paid&&state.profile){
    state.room=incoming.id;save();history.replaceState(null,'',location.pathname);render();
    requestAnimationFrame(()=>animateDoor(false));
  }else if(query.has('stanza')){
    say(!state.profile?'Completa la registrazione di prova prima di scegliere la stanza.':!state.paid?'Completa il pagamento di prova nella Home 3.':'Questa stanza non è ancora disponibile.');
    if(!state.profile)showProfile();
  }else if(query.has('attivato')){
    history.replaceState(null,'',location.pathname);
    if(!state.profile)showProfile();
    else $('mfp-select-room').focus();
  }
})();
