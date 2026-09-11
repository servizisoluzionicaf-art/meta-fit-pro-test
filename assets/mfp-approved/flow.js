(() => {
  'use strict';
  const key='mfp.home2.reconstructed.demo.v1';
  const fresh=()=>({paid:false,profile:false,room:null,completedWeeks:0});
  function read(){
    if(window.MFP?.real)return {...(window.MFP.serverState||fresh())};
    try{const value=JSON.parse(sessionStorage.getItem(key)||'null');return {paid:value?.paid===true,profile:value?.profile===true,room:typeof value?.room==='string'?value.room:null,completedWeeks:Number.isInteger(value?.completedWeeks)?Math.max(0,Math.min(value.completedWeeks,104)):0};}catch{return fresh();}
  }
  function save(value){
    if(window.MFP?.real){
      if(!window.MFP.account)return false;
      window.MFP.serverState.room=value.room;
      try{sessionStorage.setItem('mfp.room.'+window.MFP.account.id,value.room||'');}catch{}
      return true;
    }
    try{sessionStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}
  }
  window.MFP={read,save,fresh,clear(){try{sessionStorage.removeItem(key);}catch{}}};
  window.MFP.ready=import('../mfp-account/client.js').then(module=>module.initialize(window.MFP)).catch(error=>{
    window.MFP.real=true;window.MFP.problem=error.message||'Servizio non disponibile.';
  });
})();
