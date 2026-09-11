(() => {
  'use strict';
  const key='mfp.home2.reconstructed.demo.v1';
  const fresh=()=>({paid:false,profile:false,room:null,completedWeeks:0});
  function read(){
    try{const value=JSON.parse(sessionStorage.getItem(key)||'null');return {paid:value?.paid===true,profile:value?.profile===true,room:typeof value?.room==='string'?value.room:null,completedWeeks:Number.isInteger(value?.completedWeeks)?Math.max(0,Math.min(value.completedWeeks,104)):0};}catch{return fresh();}
  }
  function save(value){try{sessionStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
  window.MFP={read,save,fresh,clear(){try{sessionStorage.removeItem(key);}catch{}}};
})();
