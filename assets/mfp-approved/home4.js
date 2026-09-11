(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const rooms=JSON.parse($('mfp-room-data').textContent);
  const embedded=window.parent!==window;
  let completedWeeks=0,selected=null,canSelect=!embedded;
  const cleanWeeks=value=>Number.isInteger(value)&&value>=0?Math.min(value,104):0;
  const available=room=>completedWeeks>=room.unlockWeeks;
  const lockIcon='<svg viewBox="0 0 32 36" aria-hidden="true" fill="currentColor"><path d="M7 15V10a9 9 0 0 1 18 0v5h2a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V18a3 3 0 0 1 3-3h2zm4 0h10V10a5 5 0 0 0-10 0v5zm5 7a3 3 0 0 0-1.5 5.6V31h3v-3.4A3 3 0 0 0 16 22z"/></svg>';
  const checkIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7 12 3 3 7-7" fill="none" stroke="#101b05" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function render(){
    $('room-grid').replaceChildren();
    rooms.forEach((room,index)=>{
      const unlocked=available(room),chosen=selected===room.id;
      const card=document.createElement('button');card.type='button';card.className='room-card'+(unlocked?'':' locked')+(chosen?' selected':'');
      card.disabled=!unlocked;card.dataset.roomId=room.id;card.setAttribute('aria-pressed',String(chosen));
      card.setAttribute('aria-label','Stanza '+(index+1)+', '+room.name+(unlocked?', disponibile':', si sblocca dopo '+room.unlockWeeks+' settimane completate'));
      const photo=document.createElement('span');photo.className='room-image';
      const img=document.createElement('img');img.src=room.image;img.alt='';img.width=640;img.height=360;img.loading=index<4?'eager':'lazy';photo.append(img);
      if(!unlocked){const lock=document.createElement('span');lock.className='lock-badge';lock.innerHTML=lockIcon;photo.append(lock);}
      const info=document.createElement('span');info.className='room-info';
      const title=document.createElement('span'),number=document.createElement('span'),name=document.createElement('span');
      number.className='room-number';number.textContent='STANZA '+(index+1);name.className='room-name';name.textContent=room.name;title.append(number,name);info.append(title);
      if(unlocked){const status=document.createElement('span');status.className='room-availability';status.innerHTML=checkIcon;status.append(document.createTextNode(chosen?'SCELTA':'DISPONIBILE'));info.append(status);}
      card.append(photo,info);
      if(!unlocked){const caption=document.createElement('span');caption.className='lock-caption';caption.textContent='Si sblocca dopo '+room.unlockWeeks+' settimane di programma completate';card.append(caption);}
      card.addEventListener('click',()=>{
        if(!available(room))return;
        if(!canSelect){$('selection-status').textContent='Completa il pagamento e il profilo nella Home 2 per scegliere la stanza.';return;}
        if(embedded)parent.postMessage({type:'mfp-room-selected',roomId:room.id},'*');
        else location.href='home2.html?stanza='+encodeURIComponent(room.id);
      });
      $('room-grid').append(card);
    });
    $('completed-weeks').textContent=completedWeeks;
    $('room-progress').value=Math.min(completedWeeks,14);
    $('room-progress').setAttribute('aria-valuetext',completedWeeks+' settimane completate');
    const next=rooms.find(room=>!available(room));
    $('next-room-description').textContent=next?'Completa altre '+(next.unlockWeeks-completedWeeks)+' settimane di allenamento per sbloccare la Stanza '+(rooms.indexOf(next)+1)+'.':'Hai sbloccato tutte le stanze.';
    $('selection-status').textContent=selected?'Stanza selezionata: '+rooms.find(room=>room.id===selected)?.name+'.':canSelect?'Scegli una stanza disponibile.':'Puoi esplorare le stanze. Completa pagamento e profilo nella Home 2 per selezionarle.';
  }
  window.addEventListener('message',event=>{
    if(!embedded||event.source!==parent||event.data?.type!=='mfp-room-selector-init')return;
    completedWeeks=cleanWeeks(event.data.completedWeeks);canSelect=event.data.canSelect===true;
    selected=rooms.some(room=>room.id===event.data.selected&&available(room))?event.data.selected:null;
    render();
  });
  $('back-home2').addEventListener('click',event=>{if(embedded){event.preventDefault();parent.postMessage({type:'mfp-home2-return'},'*');}});
  const video=$('isabella-video'),toggle=$('coach-toggle'),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function updateToggle(){toggle.textContent=video.paused?'Riprendi':'Pausa';toggle.setAttribute('aria-label',(video.paused?'Riprendi':'Metti in pausa')+' il movimento di Isabella');}
  toggle.addEventListener('click',()=>{if(video.paused)video.play().catch(()=>{});else video.pause();});
  video.addEventListener('play',updateToggle);video.addEventListener('pause',updateToggle);
  if(reduce){video.autoplay=false;video.pause();}else video.play().catch(updateToggle);
  if(!embedded){try{const saved=JSON.parse(sessionStorage.getItem('mfp.home2.reconstructed.demo.v1')||'null');completedWeeks=cleanWeeks(saved?.completedWeeks);selected=rooms.some(r=>r.id===saved?.room&&available(r))?saved.room:null;}catch{}}
  render();updateToggle();
  if(embedded)parent.postMessage({type:'mfp-room-selector-ready'},'*');
})();
