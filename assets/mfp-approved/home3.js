(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  $('payment-demo-form').addEventListener('submit',event=>{
    event.preventDefault();
    const state=MFP.read();state.paid=true;
    if(!MFP.save(state)){$('payment-status').textContent='Consenti la memorizzazione in questa scheda per continuare la prova.';return;}
    $('activate').disabled=true;
    $('payment-status').textContent='Attivazione di prova completata. Nessun addebito effettuato.';
    location.href='home2.html?attivato=1';
  });
})();
