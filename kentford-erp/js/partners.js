'use strict';
/* =========================================================
   KENTFORD ERP - Aftersales Service Partner Network & Coverage Map
   Modul: kode partner otomatis (pulau-provinsi-urut), peta interaktif
   (Leaflet, dimuat lazy), rekap cakupan wilayah, prospek, evaluasi,
   pembayaran partner, rekomendasi partner untuk service request.
   ========================================================= */

/* ---------- C. Peta pulau & kode provinsi (untuk penomoran kode partner) ----------
   Cakupan: provinsi-provinsi utama di 8 kelompok pulau yang disebut spesifikasi
   (Sumatra, Jawa, Kalimantan, Sulawesi, Bali, Nusa Tenggara, Maluku, Papua).
   Bukan database nasional lengkap 38 provinsi — cukup untuk kebutuhan bisnis genset
   realistis. Kode provinsi bisa sama antar-pulau (mis. 'SS' dipakai Sumatera Selatan
   & Sulawesi Selatan) karena prefix pulau membuatnya tetap unik. */
const PROVINCE_MAP={
 // Jawa
 'DKI Jakarta':['JAVA','JKT'],'Jakarta':['JAVA','JKT'],'Jawa Barat':['JAVA','JBR'],'Jawa Tengah':['JAVA','JTG'],'DI Yogyakarta':['JAVA','JOG'],'Yogyakarta':['JAVA','JOG'],
 'Jawa Timur':['JAVA','JTM'],'Banten':['JAVA','BTN'],
 // Sumatra
 'Aceh':['SUM','ACE'],'Sumatera Utara':['SUM','SU'],'Sumatera Barat':['SUM','SB'],'Riau':['SUM','RIA'],'Kepulauan Riau':['SUM','KRI'],'Jambi':['SUM','JMB'],
 'Sumatera Selatan':['SUM','SS'],'Bengkulu':['SUM','BKL'],'Lampung':['SUM','LPG'],'Bangka Belitung':['SUM','BAB'],
 // Kalimantan
 'Kalimantan Barat':['KAL','KB'],'Kalimantan Tengah':['KAL','KTG'],'Kalimantan Selatan':['KAL','KS'],'Kalimantan Timur':['KAL','KT'],'Kalimantan Utara':['KAL','KU'],
 // Sulawesi
 'Sulawesi Utara':['SUL','SU'],'Sulawesi Tengah':['SUL','STG'],'Sulawesi Selatan':['SUL','SS'],'Sulawesi Tenggara':['SUL','STR'],'Gorontalo':['SUL','GTO'],'Sulawesi Barat':['SUL','SB'],
 // Bali
 'Bali':['BALI','BLI'],
 // Nusa Tenggara
 'Nusa Tenggara Barat':['NUSRA','NTB'],'Nusa Tenggara Timur':['NUSRA','NTT'],
 // Maluku
 'Maluku':['MALUKU','MLK'],'Maluku Utara':['MALUKU','MLU'],
 // Papua
 'Papua':['PAPUA','PAP'],'Papua Barat':['PAPUA','PB'],'Papua Tengah':['PAPUA','PTG'],'Papua Selatan':['PAPUA','PSL'],'Papua Pegunungan':['PAPUA','PPG']
};
const ISLANDS=['JAVA','SUM','KAL','SUL','BALI','NUSRA','MALUKU','PAPUA'];
/* Titik ibu kota provinsi (untuk layer region opsional pada peta — lihat MapPage.provinceMarkers) */
const PROVINCE_CAPITAL={'DKI Jakarta':[-6.2088,106.8456],'Jawa Barat':[-6.9175,107.6191],'Jawa Tengah':[-6.9932,110.4203],'DI Yogyakarta':[-7.7956,110.3695],
 'Jawa Timur':[-7.2575,112.7521],'Banten':[-6.1783,106.6319],'Aceh':[5.5483,95.3238],'Sumatera Utara':[3.5952,98.6722],'Sumatera Barat':[-0.9471,100.4172],
 'Riau':[0.5333,101.45],'Kepulauan Riau':[0.9167,104.4167],'Jambi':[-1.6,103.6167],'Sumatera Selatan':[-2.9908,104.7566],'Bengkulu':[-3.7928,102.2608],
 'Lampung':[-5.4292,105.2610],'Bangka Belitung':[-2.1333,106.1167],'Kalimantan Barat':[-0.0263,109.3425],'Kalimantan Tengah':[-2.2159,113.9213],
 'Kalimantan Selatan':[-3.3167,114.5906],'Kalimantan Timur':[-0.5022,117.1536],'Kalimantan Utara':[3.0731,116.0414],'Sulawesi Utara':[1.4748,124.8421],
 'Sulawesi Tengah':[-0.8917,119.8707],'Sulawesi Selatan':[-5.1477,119.4327],'Sulawesi Tenggara':[-3.9778,122.5194],'Gorontalo':[0.5435,123.0568],
 'Sulawesi Barat':[-2.6742,118.8987],'Bali':[-8.6705,115.2126],'Nusa Tenggara Barat':[-8.5833,116.1167],'Nusa Tenggara Timur':[-10.1772,123.6070],
 'Maluku':[-3.6954,128.1814],'Maluku Utara':[0.7833,127.3667],'Papua':[-2.5333,140.7167],'Papua Barat':[-0.8615,134.0620]};

/* Ekstraksi otomatis koordinat latitude & longitude dari Link Google Maps atau teks koordinat */
function parseGoogleMapsCoords(link){
 if(!link||typeof link!=='string')return null;
 const s=link.trim();
 // 1. Pola @lat,lng mis. google.com/maps/@-6.2088,106.8456,15z
 let m=s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
 if(m)return {lat:+m[1],lng:+m[2]};
 // 2. Pola q=lat,lng atau ll=lat,lng atau query=lat,lng
 m=s.match(/[?&](?:q|ll|query)=(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
 if(m)return {lat:+m[1],lng:+m[2]};
 // 3. Pola /place/.../@lat,lng atau /place/lat,lng
 m=s.match(/\/place\/[^/]*@?(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
 if(m)return {lat:+m[1],lng:+m[2]};
 // 4. Pola !3dlat!4dlng (URL sematan/embed/place share Google Maps)
 const mLat=s.match(/!3d(-?\d+\.\d+)/),mLng=s.match(/!4d(-?\d+\.\d+)/);
 if(mLat&&mLng)return {lat:+mLat[1],lng:+mLng[1]};
 // 5. Format koordinat langsung "lat, lng" atau "-6.2088, 106.8456"
 m=s.match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);
 if(m)return {lat:+m[1],lng:+m[2]};
 return null;
}

/* Dapatkan koordinat untuk partner: utamakan parse dari gmapsLink, fallback ke lat/lng lama bila ada, atau fallback ke ibu kota provinsi */
function getPartnerCoords(r){
 if(!r)return null;
 const parsed=parseGoogleMapsCoords(r.gmapsLink);
 if(parsed)return parsed;
 if(num(r.lat)&&num(r.lng))return {lat:num(r.lat),lng:num(r.lng)};
 if(r.province&&PROVINCE_CAPITAL[r.province]){
  const cap=PROVINCE_CAPITAL[r.province];
  return {lat:cap[0],lng:cap[1],isApprox:true};
 }
 return null;
}

/* ---------- Utilitas jarak (haversine, tanpa library) ---------- */
const Haversine=(lat1,lng1,lat2,lng2)=>{
 const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
 const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
 return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
};

/* ---------- Penomoran kode partner: {PULAU}-{PROVINSI}-{URUT3} ---------- */
const PartnerCode={
 lookup(province){return PROVINCE_MAP[province]||['LAINNYA',(province||'XX').slice(0,3).toUpperCase()]},
 next(province){
  const [island,pcode]=this.lookup(province);
  const ctr=Store.mem.counters||(Store.mem.counters={});
  const key='PTN-'+island+'-'+pcode;
  ctr[key]=(ctr[key]||0)+1;Store.put('counters');
  return island==='PAPUA'?`${island}-${pad(ctr[key],3)}`:`${island}-${pcode}-${pad(ctr[key],3)}`;
 }
};

/* ---------- Partners: helper bisnis (rating, nearest, region priority) ---------- */
const Partners={
 all(){return DB.all('partners')},
 active(){return this.all().filter(r=>r.status==='Active')},
 markerColor(r){
  if(r.status==='Blacklisted'||r.status==='Temporarily Inactive'||r.status==='Contract Ended')return 'grey';
  if(r.status==='Active')return r.isFullService?'blue':'green';
  if(['Follow-up','Surveyed','Under Evaluation','Waiting for Agreement','Contacted','Prospect'].includes(r.status))return 'yellow';
  return 'grey';
 },
 /* Evaluasi terkait satu partner + statistik turunan (H/I) */
 evaluations(partnerId){return DB.all('partner_evaluations').filter(e=>e.partnerId===partnerId)},
 avgScore(e){const ks=['scoreSpeed','scorePunctual','scoreTech','scoreTools','scoreQuality','scoreReport','scoreComm','scoreSatisfaction','scoreCost','scoreSop'];
  return sum(ks.map(k=>num(e[k])),x=>x)/ks.length},
 stats(partnerId){
  const evs=this.evaluations(partnerId);
  const jobs=DB.all('svc_req').filter(r=>r.partnerId===partnerId);
  return {
   avgRating:evs.length?+(sum(evs,e=>this.avgScore(e))/evs.length).toFixed(2):0,
   jobCount:jobs.length,
   completedCount:jobs.filter(r=>['Selesai','Ditutup'].includes(r.status)).length,
   evalCount:evs.length
  };
 },
 /* Perbarui field rating pada partner (dipanggil setelah simpan evaluasi) — pakai DB.update agar audit log tercatat */
 recalcRating(partnerId){
  const st=this.stats(partnerId);
  DB.update('partners',partnerId,{rating:st.avgRating},'','Update rating dari evaluasi');
 },
 /* B. haversine ke semua partner berkoordinat, urut terdekat — dipakai peta & rekomendasi service order (H) */
 nearest(lat,lng,limit=10,opts={}){
  const rows=this.all().map(r=>({partner:r,coords:getPartnerCoords(r)})).filter(x=>x.coords&&(!opts.activeOnly||x.partner.status==='Active'));
  return rows.map(x=>({partner:x.partner,distKm:+Haversine(lat,lng,x.coords.lat,x.coords.lng).toFixed(1)})).sort((a,b)=>a.distKm-b.distKm).slice(0,limit);
 },
 /* Ringkasan per provinsi: jumlah partner aktif/prospek/inactive, prospek, dan partner terdekat bila kosong. */
 provinceSummary(){
  const provs=[...new Set([...this.all().map(r=>r.province),...DB.all('customers').map(c=>c.city)].filter(Boolean))];
  return provs.map(p=>{
   const rows=this.all().filter(r=>r.province===p);
   const active=rows.filter(r=>r.status==='Active').length;
   const prospect=rows.filter(r=>['Prospect','Contacted','Follow-up','Surveyed','Under Evaluation','Waiting for Agreement'].includes(r.status)).length;
   const inactive=rows.filter(r=>['Temporarily Inactive','Blacklisted','Contract Ended'].includes(r.status)).length;
   const cap=PROVINCE_CAPITAL[p];
   let nearest=null;
   if(cap && !active){
    const nr=this.nearest(cap[0],cap[1],1,{activeOnly:true})[0];
    if(nr)nearest={name:nr.partner.name,distKm:nr.distKm};
   }
   const color=active?'green':prospect?'yellow':rows.length?'grey':'red';
   return {province:p,active,prospect,inactive,total:rows.length,nearest,color};
  }).sort((a,b)=>a.province.localeCompare(b.province));
 },
 /* F. Analisis prioritas wilayah — aturan (didokumentasikan, ambang batas dapat disesuaikan di sini):
    - Urgent: customer >= URGENT_CUST & partner terdekat > URGENT_DIST km (atau tidak ada partner), ATAU
              ada unit rental aktif / genset bergaransi di wilayah tsb tanpa partner dekat.
    - High:   customer >= HIGH_CUST & partner terdekat > HIGH_DIST km.
    - Medium: ada customer di wilayah tapi cakupan partner tipis (1 partner non-aktif / jarak sedang).
    - Low:    selebihnya. */
 regionPriority(province){
  const URGENT_CUST=3,URGENT_DIST=150,HIGH_CUST=1,HIGH_DIST=80;
  const customers=DB.all('customers').filter(c=>c.city===province||c.address?.includes(province));
  const custCount=customers.length;
  const cap=PROVINCE_CAPITAL[province];
  const nr=cap?this.nearest(cap[0],cap[1],1,{activeOnly:true})[0]:null;
  const distKm=nr?nr.distKm:Infinity;
  const rentActive=DB.all('rent_contracts').some(c=>customers.some(cu=>cu.id===c.customerId)&&c.status!=='Selesai'&&c.status!=='Dibatalkan');
  const warrantyOpen=DB.all('svc_req').some(r=>customers.some(cu=>cu.id===r.customerId)&&r.warrantyStatus==='Dalam Garansi'&&!['Selesai','Ditutup'].includes(r.status));
  let level='Low';
  if((custCount>=URGENT_CUST&&distKm>URGENT_DIST)||((rentActive||warrantyOpen)&&distKm>URGENT_DIST))level='Urgent';
  else if(custCount>=HIGH_CUST&&distKm>HIGH_DIST)level='High';
  else if(custCount>0&&distKm>0&&distKm!==Infinity)level='Medium';
  return {province,custCount,distKm:isFinite(distKm)?distKm:null,nearestName:nr?nr.partner.name:null,level,rentActive,warrantyOpen};
 },
 /* H. Skor rekomendasi partner untuk sebuah service request (coverage, brand match, rating, kontrak aktif) */
 recommend(svcReq,limit=5){
  const cust=DB.get('customers',svcReq.customerId);
  const lat=svcReq.lat||null,lng=svcReq.lng||null;
  const rows=this.active().map(p=>{
   let score=0;
   if(cust&&p.province&&cust.city&&(p.province===cust.city||p.city===cust.city))score+=40;
   if((p.coverageAreas||[]).some(a=>a.area&&cust&&(a.area===cust.city)))score+=20;
   if(svcReq.unitDesc&&p.brands&&p.brands.split(',').some(b=>svcReq.unitDesc.toLowerCase().includes(b.trim().toLowerCase())))score+=20;
   score+=num(p.rating)*5;
   if(p.contractEndDate&&p.contractEndDate>=today())score+=10;
   let distKm=null;
   const geo=getPartnerCoords(p);
   if(lat&&lng&&geo){distKm=+Haversine(lat,lng,geo.lat,geo.lng).toFixed(1);score+=Math.max(0,20-distKm/10)}
   return {partner:p,score:+score.toFixed(1),distKm};
  }).sort((a,b)=>b.score-a.score);
  return rows.slice(0,limit);
 }
};

/* ---------- Simple visibility gate untuk nomor telepon (spec M) ---------- */
const canSeePartnerPhone=()=>isRole('director','deputy_director','admin_aftersales','admin_hr_sales','tech_manager');
const phoneOrHidden=v=>canSeePartnerPhone()?esc(v||'-'):'••••••••';

/* =========================================================
   D. Tabel database partner (crudPage generik + kolom & filter tambahan)
   ========================================================= */
crudPage('partners');
(function(){
 const orig=PAGES.partners.render;
 PAGES.partners.render=async(v,param)=>{
  await orig(v,param);
  const dt=Object.values(DT.inst).filter(d=>document.body.contains(d.el)).pop();
  if(!dt)return;
  dt.cfg.filters=[
   {k:'status',l:t('partner.status'),opts:()=>PARTNER_STATUS_OPTS,get:r=>r.status},
   {k:'province',l:t('partner.province'),opts:()=>[...new Set(Partners.all().map(r=>r.province))].filter(Boolean),get:r=>r.province},
   {k:'brands',l:t('partner.brands'),opts:()=>[...new Set(Partners.all().flatMap(r=>(r.brands||'').split(',').map(s=>s.trim())))].filter(Boolean),get:r=>(r.brands||'')}
  ];
  // Sembunyikan nomor telepon/WA pada tabel untuk role yang tidak berwenang (spec M)
  dt.cfg.cols.forEach(c=>{if(c.k==='whatsapp'||c.k==='phone'){const orig2=c.text;c.text=r=>canSeePartnerPhone()?orig2(r):'••••••••'}});
  dt.init();
  const cb=$('[data-act="crud-arch"]',dt.el);if(cb)cb.dataset.dt=dt.id;
  const nb=$('[data-act="crud-new"]',dt.el);if(nb)nb.dataset.dt=dt.id;
 };
})();

/* Generate kode partner otomatis saat simpan record baru + cegah admin_hr_sales mengaktifkan status
   langsung ke 'Active' (hanya create/edit awal, tidak bisa "approve" jadi Active — spec M). Meng-hook
   lewat Approval-style guard sederhana langsung di titik simpan (Crud.open ada di admin.js, generik
   untuk semua entity) — di sini kita pasang pemeriksaan tambahan lewat listener capture pada klik simpan
   memakai pendekatan yang sama dgn pengecekan k==='products' dsb pada admin.js: tambahkan cek di sana. */

/* =========================================================
   B/A. Peta interaktif (Leaflet, dimuat lazy hanya saat halaman dibuka)
   ========================================================= */
const LeafletLoader={
 promise:null,
 ready(){return typeof window.L!=='undefined'},
 load(){
  if(this.ready())return Promise.resolve();
  if(this.promise)return this.promise;
  this.promise=new Promise((resolve,reject)=>{
   let tries=0;
   const check=()=>{
    if(this.ready())return resolve();
    if(++tries>100)return reject(new Error('Leaflet gagal dimuat (periksa koneksi/CDN).'));
    setTimeout(check,100);
   };
   check();
  });
  return this.promise;
 }
};

PAGES.partners_map.render=async(v,param)=>{
 v.innerHTML=UI.pghead(t('partner.map_title'),`<a class="btn btn-o btn-sm" href="#/partners">${t('partner.view_list')}</a>`)+
  `<div class="tabs"><a class="on" href="#/partners_map">${t('partner.view_map')}</a><a href="#/partners">${t('partner.view_list')}</a></div>
   <div class="card"><div class="fld"><input id="pmsearch" type="search" placeholder="${esc(t('partner.search_ph'))}" style="max-width:340px"></div></div>
   <div class="grid split" style="align-items:start">
   <div class="card" style="padding:0"><div id="leafmap" style="height:520px;border-radius:8px"></div>
    <div style="padding:8px 12px;font-size:12px" class="mut">
     <span class="badge" style="background:#2e7d32;color:#fff">●</span> ${t('partner.legend_active')}
     &nbsp;<span class="badge" style="background:#1565c0;color:#fff">●</span> ${t('partner.legend_full')}
     &nbsp;<span class="badge" style="background:#f9a825;color:#fff">●</span> ${t('partner.legend_prospect')}
     &nbsp;<span class="badge" style="background:#9e9e9e;color:#fff">●</span> ${t('partner.legend_inactive')}
    </div></div>
   <div class="card"><h3>${t('partner.coverage_by_province')}</h3><div id="provlist"></div></div>
   </div>
   <div class="card"><h3>${t('partner.region_priority')}</h3><div id="priolist"></div></div>`;
 const mapEl=$('#leafmap');
 renderProvinceList($('#provlist'));
 renderPriorityList($('#priolist'));
 try{
  await LeafletLoader.load();
  mountLeafletMap(mapEl);
 }catch(e){
  mapEl.innerHTML=`<div class="empty">${esc(t('partner.map_load_failed'))}</div>`;
 }
 $('#pmsearch').addEventListener('input',ev=>filterMapSearch(ev.target.value));
};
let _leafMap=null,_leafMarkers=[];
function mountLeafletMap(el){
 if(_leafMap){_leafMap.remove();_leafMap=null}
 _leafMap=L.map(el).setView([-2.5,118],5);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:18}).addTo(_leafMap);
 _leafMarkers=[];
 const colorHex={green:'#2e7d32',blue:'#1565c0',yellow:'#f9a825',grey:'#9e9e9e',red:'#c62828'};
 Partners.all().forEach(r=>{
  const geo=getPartnerCoords(r);
  if(!geo)return;
  const col=colorHex[Partners.markerColor(r)];
  const m=L.circleMarker([geo.lat,geo.lng],{radius:8,color:col,fillColor:col,fillOpacity:0.85,weight:1}).addTo(_leafMap);
  m.bindPopup(partnerPopupHtml(r));
  m._pname=(r.name||'').toLowerCase();m._pprov=(r.province||'').toLowerCase();m._pcity=(r.city||'').toLowerCase();m._pcode=(r.code||'').toLowerCase();
  _leafMarkers.push(m);
 });
}
function partnerPopupHtml(r){
 const st=Partners.stats(r.id);
 return `<div style="min-width:220px"><b>${esc(r.code||'-')}</b> — ${esc(r.name)}<br>
  <small>${esc(r.pic||'-')} • ${phoneOrHidden(r.whatsapp)}</small><br>
  ${UI.badge(r.status)} ${r.isFullService?UI.badge(t('partner.full_service')):''}<br>
  <small>${esc(r.city||'')}, ${esc(r.province||'')}</small><br>
  <small>${t('partner.rating')}: ${st.avgRating||'-'} • ${t('partner.jobs')}: ${st.completedCount}</small><br>
  <a href="#/partners/${r.id}">${esc(t('partner.view_detail'))}</a></div>`;
}
function filterMapSearch(q){
 q=(q||'').toLowerCase();
 (_leafMarkers||[]).forEach(m=>{
  const hit=!q||m._pname.includes(q)||m._pprov.includes(q)||m._pcity.includes(q)||m._pcode.includes(q);
  const el=m.getElement&&m.getElement();
  if(el)el.style.display=hit?'':'none';
 });
 const first=(_leafMarkers||[]).find(m=>{const el=m.getElement&&m.getElement();return !el||el.style.display!=='none'});
 if(q&&first&&_leafMap)_leafMap.setView(first.getLatLng(),9);
}
function renderProvinceList(el){
 const rows=Partners.provinceSummary();
 const badge=c=>({green:'ok',yellow:'menunggu',grey:'-',red:'tidak tersedia'}[c]);
 el.innerHTML=rows.length?`<div class="tblw"><table><tr><th>${t('partner.province')}</th><th>${t('partner.col_active')}</th><th>${t('partner.col_prospect')}</th><th>${t('partner.col_inactive')}</th><th>${t('partner.col_nearest')}</th><th></th></tr>
  ${rows.map(r=>`<tr class="clk" data-act="prov-open" data-p="${esc(r.province)}"><td>${esc(r.province)}</td><td>${r.active}</td><td>${r.prospect}</td><td>${r.inactive}</td>
   <td>${r.nearest?esc(r.nearest.name)+' ('+r.nearest.distKm+' km)':'-'}</td><td>${UI.badge(badge(r.color))}</td></tr>`).join('')}</table></div>`:`<div class="empty">${t('common.no_data_yet')}</div>`;
}
function renderPriorityList(el){
 const provs=[...new Set(DB.all('customers').map(c=>c.city))].filter(Boolean);
 const rows=provs.map(p=>Partners.regionPriority(p)).filter(r=>r.level!=='Low').sort((a,b)=>({Urgent:0,High:1,Medium:2,Low:3}[a.level]-{Urgent:0,High:1,Medium:2,Low:3}[b.level]));
 el.innerHTML=rows.length?`<div class="tblw"><table><tr><th>${t('partner.province')}</th><th>${t('partner.col_customers')}</th><th>${t('partner.col_nearest')}</th><th>${t('partner.col_priority')}</th></tr>
  ${rows.map(r=>`<tr><td>${esc(r.province)}</td><td>${r.custCount}</td><td>${r.nearestName?esc(r.nearestName)+' ('+r.distKm+' km)':t('partner.none')}</td><td>${UI.badge(r.level==='Urgent'?'terlambat':r.level==='High'?'menunggu':'proses').replace(/terlambat|menunggu|proses/,r.level)}</td></tr>`).join('')}</table></div>`
  :`<div class="empty">${t('common.no_data_yet')}</div>`;
}
ACT['prov-open']=el=>{
 const p=el.dataset.p,r=Partners.regionPriority(p);
 const cov=Partners.provinceSummary().find(x=>x.province===p);
 UI.modal({title:p,wide:true,body:UI.kv([
  [t('partner.col_active'),cov?.active??0],[t('partner.col_prospect'),cov?.prospect??0],[t('partner.col_inactive'),cov?.inactive??0],
  [t('partner.col_customers'),r.custCount],[t('partner.col_nearest'),r.nearestName?esc(r.nearestName)+' ('+r.distKm+' km)':'-'],
  [t('partner.col_priority'),r.level],[t('partner.rent_active'),r.rentActive?'Ya':'Tidak'],[t('partner.warranty_open'),r.warrantyOpen?'Ya':'Tidak']
 ]),foot:`<button class="btn btn-o" data-x="c">${t('admin.close')}</button>`});
 $$('.ov [data-x="c"]').forEach(b=>b.addEventListener('click',()=>b.closest('.ov')._m.close()));
};

/* =========================================================
   E. Prospek partner + konversi ke partner aktif
   ========================================================= */
crudPage('partner_prospects');
(function(){
 const orig=PAGES.partner_prospects.render;
 PAGES.partner_prospects.render=async(v,param)=>{
  await orig(v,param);
  const dt=Object.values(DT.inst).filter(d=>document.body.contains(d.el)).pop();
  if(dt)dt.cfg.cols.push({k:'_conv',l:'',html:r=>r.converted?UI.badge(t('partner.converted')):(canEnt(ENT.partner_prospects)?`<button class="btn btn-sm" data-act="prospect-convert" data-id="${r.id}" onclick="event.stopPropagation()">${esc(t('partner.convert_btn'))}</button>`:'')});
  if(dt)dt.init();
 };
})();
ACT['prospect-convert']=async el=>{
 const p=DB.get('partner_prospects',el.dataset.id);if(!p)return;
 if(p.converted)return UI.toast(t('partner.already_converted'),'err');
 const ok=await UI.confirm({title:t('partner.convert_title'),msg:t('partner.convert_confirm',{name:esc(p.name)})});
 if(!ok)return;
 const code=PartnerCode.next(p.province);
 const partner=DB.insert('partners',{code,name:p.name,pic:p.pic||'',whatsapp:p.whatsapp||'',province:p.province||'',city:p.city||'',
  gmapsLink:p.gmapsLink||'',techCount:p.techCount||0,techNotes:p.techCapability||'',brands:p.brands||'',hasTools:!!p.toolList,workshopPhotos:p.workshopPhotos||[],
  status:'Under Evaluation',evalNotes:p.notes||'',coverageAreas:[]});
 DB.update('partner_prospects',p.id,{converted:true,status:'Diterima'},t('partner.convert_action'),t('partner.convert_action'));
 UI.toast(t('partner.convert_success',{code:partner.code}));Router.go('partners/'+partner.id);
};

/* =========================================================
   I. Evaluasi partner
   ========================================================= */
crudPage('partner_evaluations');
/* Rating partner dihitung ulang otomatis setiap kali sebuah evaluasi dibuat/diubah, lewat wrapper
   tipis di sekitar DB.insert/DB.update (bukan mengubah admin.js generik) — tetap lewat DB.update()
   untuk field rating di partner sehingga audit log otomatis tercatat (lihat Partners.recalcRating). */
(function(){
 const origInsert=DB.insert.bind(DB),origUpdate=DB.update.bind(DB);
 DB.insert=function(col,o,reason){
  const r=origInsert(col,o,reason);
  if(col==='partner_evaluations')Partners.recalcRating(r.partnerId);
  return r;
 };
 DB.update=function(col,id,patch,reason,action){
  const r=origUpdate(col,id,patch,reason,action);
  if(col==='partner_evaluations')Partners.recalcRating(r.partnerId);
  return r;
 };
})();

/* =========================================================
   J. Pembayaran partner — gating: tidak bisa "Dibayar" tanpa service report
   + kedua approval (Manager Teknisi & Admin Aftersales) lengkap.
   Pendekatan: dua field boolean timestamp langsung di record (bukan lewat
   Approval engine, karena ini persetujuan teknis dua-pihak sederhana, bukan
   berjenjang berdasar nominal) — lebih ringan & risikonya lebih rendah.
   ========================================================= */
crudPage('partner_payments');
(function(){
 const orig=PAGES.partner_payments.render;
 PAGES.partner_payments.render=async(v,param)=>{
  await orig(v,param);
  const dt=Object.values(DT.inst).filter(d=>document.body.contains(d.el)).pop();
  if(!dt)return;
  dt.cfg.cols.push({k:'_appr',l:t('partner.approvals_col'),html:r=>{
   const tm=r.techManagerApproved?'✓ TM':(isRole('tech_manager','director','deputy_director')?`<button class="btn btn-sm btn-o" data-act="payment-approve-tm" data-id="${r.id}" onclick="event.stopPropagation()">✗ TM</button>`:'✗ TM');
   const aa=r.adminAftersalesApproved?'✓ AA':(isRole('admin_aftersales','director','deputy_director')?`<button class="btn btn-sm btn-o" data-act="payment-approve-aa" data-id="${r.id}" onclick="event.stopPropagation()">✗ AA</button>`:'✗ AA');
   return tm+' / '+aa;
  }});
  dt.cfg.cols.push({k:'_pay',l:'',html:r=>r.paymentStatus==='Dibayar'?'':`<button class="btn btn-sm" data-act="payment-mark-paid" data-id="${r.id}" onclick="event.stopPropagation()">${esc(t('partner.mark_paid'))}</button>`});
  dt.init();
 };
})();
ACT['payment-mark-paid']=async el=>{
 const p=DB.get('partner_payments',el.dataset.id);if(!p)return;
 if(!p.serviceReportNo)return UI.toast(t('partner.err_no_report'),'err');
 if(!p.techManagerApproved||!p.adminAftersalesApproved)return UI.toast(t('partner.err_approvals_incomplete'),'err');
 if(!isRole('finance','director','deputy_director'))return UI.toast(t('partner.err_not_finance'),'err');
 DB.update('partner_payments',p.id,{paymentStatus:'Dibayar',paymentDate:today()},'',t('partner.mark_paid'));
 UI.toast(t('partner.paid_success'));Crud.refresh();
};
ACT['payment-approve-tm']=el=>{
 if(!isRole('tech_manager','director','deputy_director'))return UI.toast(t('partner.err_not_authorized'),'err');
 DB.update('partner_payments',el.dataset.id,{techManagerApproved:true},'',t('partner.approved_tm'));UI.toast(t('partner.approved_tm'));Crud.refresh();
};
ACT['payment-approve-aa']=el=>{
 if(!isRole('admin_aftersales','director','deputy_director'))return UI.toast(t('partner.err_not_authorized'),'err');
 DB.update('partner_payments',el.dataset.id,{adminAftersalesApproved:true},'',t('partner.approved_aa'));UI.toast(t('partner.approved_aa'));Crud.refresh();
};

/* =========================================================
   K. Dashboard KPI helper (dipakai js/dashboard.js)
   ========================================================= */
const PartnerDash={
 summary(){
  const all=Partners.all();
  const active=all.filter(r=>r.status==='Active').length;
  const prospect=all.filter(r=>['Prospect','Contacted','Follow-up','Surveyed','Under Evaluation','Waiting for Agreement'].includes(r.status)).length;
  const inactive=all.filter(r=>['Temporarily Inactive','Blacklisted','Contract Ended'].includes(r.status)).length;
  const provs=[...new Set(all.map(r=>r.province))].filter(Boolean);
  const allProvs=[...new Set(DB.all('customers').map(c=>c.city))].filter(Boolean);
  const cities=[...new Set(all.map(r=>r.city))].filter(Boolean);
  const topRated=all.slice().sort((a,b)=>num(b.rating)-num(a.rating))[0];
  const expiring=all.filter(r=>r.contractEndDate&&r.contractEndDate>=today()&&r.contractEndDate<=addDays(today(),30));
  const notEvaluated=all.filter(r=>!Partners.evaluations(r.id).length&&r.status==='Active');
  const priorityRegions=allProvs.map(p=>Partners.regionPriority(p)).filter(r=>['Urgent','High'].includes(r.level));
  return {active,prospect,inactive,provincesCovered:provs.length,provincesTotal:allProvs.length,citiesCovered:cities.length,topRated,expiring,notEvaluated,priorityRegions};
 }
};
