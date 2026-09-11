(async () => {
  'use strict';
  const $=id=>document.getElementById(id);
  $('activate').disabled=true;
  await MFP.ready;
  $('activate').disabled=false;
  if(MFP.real){
    // La disposizione approvata e le immagini restano nell'HTML originale.
    // I dati reali della carta vengono inseriti soltanto nel Checkout Stripe.
    document.querySelector('.payment-fields').hidden=true;
    document.querySelector('.payment-fields').style.display='none';
    document.querySelector('.demo-note span').textContent='Inserirai i dati della carta nella pagina protetta di Stripe.';
    const state=MFP.read();
    if(MFP.problem)$('payment-status').textContent=MFP.problem;
    if(!state.profile)$('activate').textContent='REGISTRATI O ACCEDI PER CONTINUARE →';
    else if(state.paid)$('activate').textContent='TORNA ALLE STANZE →';
    else if(!state.consented)$('activate').textContent='LEGGI I DOCUMENTI E CONTINUA →';
    else $('activate').textContent='CONTINUA AL PAGAMENTO →';
    if(new URLSearchParams(location.search).get('pagamento')==='annullato')$('payment-status').textContent='Pagamento annullato. Puoi riprenderlo quando vuoi.';
  }
  $('payment-demo-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if(MFP.real){
      const state=MFP.read();
      if(!state.profile||!state.consented){location.href='account.html';return;}
      if(state.paid){location.href='home2.html';return;}
      $('activate').disabled=true;$('payment-status').textContent='Apro il pagamento protetto…';
      try{const {url}=await MFP.api('checkout',{});location.assign(url);}
      catch(error){$('payment-status').textContent=error.message;$('activate').disabled=false;}
      return;
    }
    const state=MFP.read();state.paid=true;
    if(!MFP.save(state)){$('payment-status').textContent='Consenti la memorizzazione in questa scheda per continuare la prova.';return;}
    $('activate').disabled=true;
    $('payment-status').textContent='Attivazione di prova completata. Nessun addebito effettuato.';
    location.href='home2.html?attivato=1';
  });
})();
