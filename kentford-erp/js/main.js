'use strict';
/* KENTFORD ERP - bootstrap */
/* Error global dulu cuma nampilin toast di layar user tanpa jejak apapun di server — kalau
   bug kejadian di HP user lapangan, tim baru tahu kalau ada yang screenshot dan lapor manual.
   reportError() kirim ringkasannya ke /api/errorlog (lihat kentford-erp-auth/errorlog.js) di
   samping toast yang tetap tampil seperti biasa; gagal kirim (mis. offline) dibiarkan diam-diam
   supaya tidak menambah noise di atas error aslinya. */
function reportError(message,stack){
 try{
  fetch('/api/errorlog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   message:String(message||''),stack:String(stack||''),url:location.href,userEmail:(typeof Auth!=='undefined'&&Auth.user&&Auth.user.email)||''
  })}).catch(()=>{});
 }catch(x){}
}
window.addEventListener('error',e=>{try{UI.toast('Error: '+e.message,'err')}catch(x){}reportError(e.message,e.error&&e.error.stack)});
window.addEventListener('unhandledrejection',e=>{const msg=e.reason&&e.reason.message||e.reason;try{UI.toast('Error: '+msg,'err')}catch(x){}reportError(msg,e.reason&&e.reason.stack)});

/* Service worker (app shell offline) - sw.js cuma ada di hasil build (dist/, lihat build.js),
   tidak ada di source mentah yang dipakai langsung waktu development. 404 di lingkungan dev
   dibiarkan diam-diam gagal, tidak dianggap error fatal. */
if('serviceWorker' in navigator){
 window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})});
}
(async function boot(){
 try{
  // Baca token sesi (kalau ada) SEBELUM Store.init() — Store.init() sendiri langsung menarik
  // data dari server begitu IndexedDB lokal siap (lihat Store.pullFromServer di core.js), jadi
  // butuh Auth.token sudah terisi lebih dulu. Auth.restore() di bawah tetap jalan seperti biasa
  // untuk validasi penuh sesi ini ke server (isi Auth.user/role).
  try{const s=JSON.parse(localStorage.getItem('kerp_sess')||'null');if(s?.token)Auth.token=s.token}catch(e){}
  await Store.init();
  if(Seed.needed())await Seed.run();
  Quote.expire();
  if(/^#\/reset-password/.test(location.hash)){ResetPassword.show();return}
  if(await Auth.restore())App.mount();else Login.show();
  // Partner network data kini di server (lihat js/partners.js PartnerAPI) — muat cache awal
  // sekali di sini (paralel, tidak diblokir) supaya dashboard/rekomendasi partner di halaman
  // lain sudah punya data walau user belum membuka halaman Partners secara langsung.
  if(typeof PartnerAPI!=='undefined'&&Auth.user)PartnerAPI.syncAll().catch(e=>console.warn('[partners] sync awal gagal',e));
 }catch(e){
  console.error(e);
  reportError('Boot gagal: '+(e.message||e),e.stack);
  document.getElementById('root').innerHTML='<div class="card errbox" style="margin:20px"><b>Aplikasi gagal dimuat.</b><br>'+String(e.message||e)+'</div>';
 }
})();
