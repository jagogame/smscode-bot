'use strict';
/* KENTFORD ERP - bootstrap */
window.addEventListener('error',e=>{try{UI.toast('Error: '+e.message,'err')}catch(x){}});
window.addEventListener('unhandledrejection',e=>{try{UI.toast('Error: '+(e.reason&&e.reason.message||e.reason),'err')}catch(x){}});
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
  document.getElementById('root').innerHTML='<div class="card errbox" style="margin:20px"><b>Aplikasi gagal dimuat.</b><br>'+String(e.message||e)+'</div>';
 }
})();
