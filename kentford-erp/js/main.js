'use strict';
/* KENTFORD ERP - bootstrap */
window.addEventListener('error',e=>{try{UI.toast('Error: '+e.message,'err')}catch(x){}});
window.addEventListener('unhandledrejection',e=>{try{UI.toast('Error: '+(e.reason&&e.reason.message||e.reason),'err')}catch(x){}});
(async function boot(){
 try{
  await Store.init();
  if(Seed.needed())await Seed.run();
  Quote.expire();
  if(/^#\/reset-password/.test(location.hash)){ResetPassword.show();return}
  if(await Auth.restore())App.mount();else Login.show();
 }catch(e){
  console.error(e);
  document.getElementById('root').innerHTML='<div class="card errbox" style="margin:20px"><b>Aplikasi gagal dimuat.</b><br>'+String(e.message||e)+'</div>';
 }
})();
