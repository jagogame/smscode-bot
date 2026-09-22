'use strict';
/* =========================================================
   KENTFORD ERP - Tahap 5b: Service & Aftersales, Teknisi, PM
   ========================================================= */
const SVC_STATUSES=['Request masuk','Dijadwalkan','Teknisi menuju lokasi','Sedang dikerjakan','Menunggu spare part','Menunggu persetujuan customer','Selesai','Ditutup'];
const SVC_PART_COLS=[{k:'productId',l:'Spare part',t:'ref',ref:'products',w:'220px'},{k:'qty',l:'Qty',t:'number',w:'70px'},{k:'whId',l:'Ambil dari','t':'ref',ref:'warehouses',w:'160px'}];

const Svc={
 canAssignedTech(r){return r.technicianId&&r.technicianId!==Auth.uid()&&Auth.user.roleId==='technician'},
 fields:()=>[F.r('customerId','Customer','customers',{req:true}),F.t('unitDesc','Unit / mesin',{req:true,ph:'mis. Genset Cummins 500 kVA'}),F.t('serialNumber','Nomor seri'),
  F.s('type','Jenis service',()=>DB.all('servicetypes').map(s=>s.name),{req:true}),F.s('warrantyStatus','Status warranty',['Dalam Garansi','Habis Garansi','Tidak berlaku'],{req:true,def:'Tidak berlaku'}),
  F.s('priority','Prioritas',['Tinggi','Sedang','Rendah'],{req:true,def:'Sedang'}),F.ta('location','Lokasi',{req:true}),F.ta('complaint','Keluhan customer',{req:true}),F.fl('files','Lampiran (opsional)')],
 create(v){return DB.insert('svc_req',{...v,no:Num.next('SR'),status:'Request masuk',parts:[],laborCost:0,history:[{at:nowISO(),by:Auth.user.name,text:'Request masuk'}]})},
 log(r,text){return [...(r.history||[]),{at:nowISO(),by:Auth.user.name,text}]},
 setStatus(r,status,text){DB.update('svc_req',r.id,{status,history:this.log(r,text||status)},text||'',status)}
};

PAGES.svc_req.render=async(v,param)=>renderSvcList(v,param,()=>true,'Service Request',true);
PAGES.wo.render=async(v,param)=>renderSvcList(v,param,r=>r.status!=='Request masuk','Work Order');
PAGES.survey.render=async(v,param)=>renderSvcList(v,param,r=>r.type==='Survey lokasi','Survey');
PAGES.install.render=async(v,param)=>renderSvcList(v,param,r=>r.type==='Instalasi','Installation');
PAGES.warranty.render=async(v,param)=>renderSvcList(v,param,r=>r.type==='Warranty claim'||r.warrantyStatus==='Dalam Garansi','Warranty Claim');
PAGES.svc_report.render=async(v,param)=>renderSvcList(v,param,r=>['Selesai','Ditutup'].includes(r.status),'Service Report',false,true);
PAGES.tech_sched.render=async v=>{
 v.innerHTML=UI.pghead('Jadwal Teknisi')+'<div class="card" id="tsl"></div>';
 new DT($('#tsl'),{title:'Jadwal Teknisi',rows:()=>DB.all('svc_req').filter(r=>r.scheduledDate&&!['Selesai','Ditutup'].includes(r.status)).sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate)),onRow:id=>Router.go('svc_req/'+id),
  filters:[{k:'t',l:'Teknisi',opts:()=>DB.all('users').filter(u=>u.roleId==='technician').map(u=>u.name),get:r=>userName(r.technicianId)}],
  cols:[{k:'no',l:'No.'},{k:'date',l:'Jadwal',text:r=>fdate(r.scheduledDate),sortv:r=>r.scheduledDate},{k:'tech',l:'Teknisi',text:r=>userName(r.technicianId)},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'type',l:'Jenis',text:r=>r.type},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
};
function renderSvcList(v,param,filter,title,allowNew,isReport){
 if(!param||param==='new'){
  if(param==='new'){
   if(!allowNew||!can('svc_req','w'))return v.innerHTML=UI.empty('Anda tidak berhak membuat Service Request.');
   const fields=Svc.fields();Svc._ctx={fields};
   v.innerHTML=UI.pghead('Service Request baru',`<a class="btn btn-o" href="#/svc_req">‹ Batal</a>`)+`<div class="card"><div id="svform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="svc-new">Simpan</button></div></div>`;
   Form.hydrate($('#svform'),fields,{});return;
  }
  v.innerHTML=UI.pghead(title,allowNew&&can('svc_req','w')?'<a class="btn" href="#/svc_req/new">+ Service Request baru</a>':'')+`<div class="card" id="svl"></div>`;
  new DT($('#svl'),{title,rows:()=>DB.all('svc_req').filter(filter).slice().reverse(),onRow:id=>Router.go('svc_req/'+id),
   filters:[{k:'s',l:'Status',opts:()=>SVC_STATUSES,get:r=>r.status},{k:'p',l:'Prioritas',opts:()=>['Tinggi','Sedang','Rendah'],get:r=>r.priority}],
   cols:[{k:'no',l:'No.'},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'type',l:'Jenis',text:r=>r.type},{k:'tech',l:'Teknisi',text:r=>userName(r.technicianId)||'-'},{k:'pr',l:'Prioritas',text:r=>r.priority,html:r=>UI.badge(r.priority==='Tinggi'?'Terlambat':r.priority==='Sedang'?'Menunggu':'Disetujui').replace(/Terlambat|Menunggu|Disetujui/,r.priority)},
    {k:'sd',l:'Jadwal',text:r=>r.scheduledDate?fdate(r.scheduledDate):'-',sortv:r=>r.scheduledDate||''},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const r=DB.get('svc_req',param);if(!r||!filter(r)&&!isReport&&title!=='Service Request')return v.innerHTML=UI.empty('Service Request tidak ditemukan.');
 svcDetail(v,DB.get('svc_req',param)||r);
}
function svcDetail(v,r){
 if(!r)return v.innerHTML=UI.empty('Service Request tidak ditemukan.');
 const idx=SVC_STATUSES.indexOf(r.status);
 const stepper=SVC_STATUSES.map((s,i)=>`<div class="st ${i<idx?'done':i===idx?'cur':''}"><i>${i<idx?'✓':i+1}</i><div>${esc(s)}</div></div>`).join('');
 const isTech=Auth.user.roleId==='technician',mine=!r.technicianId||r.technicianId===Auth.uid();
 const canOps=can('svc_req','r')&&(!isTech||mine)&&r.status!=='Selesai'&&r.status!=='Ditutup';
 const canSchedule=canOps&&isRole('admin_aftersales','tech_manager','deputy_director','director')&&r.status==='Request masuk';
 const canTech=canOps&&(isTech||isRole('tech_manager'));
 const wApr=Approval.forRef('svc_req',r.id).filter(a=>a.type==='warranty_free');
 const wPend=wApr.find(a=>a.status==='Menunggu'),wOk=wApr.some(a=>a.status==='Disetujui');
 const partsDone=(r.parts||[]).every(p=>p.status==='Disiapkan');
 const acts=[`<a class="btn btn-o" href="#/wo">‹ Kembali</a>`,`<button class="btn btn-o" data-act="svc-print" data-id="${r.id}">Cetak Service Report</button>`];
 if(canSchedule)acts.push(`<button class="btn" data-act="svc-schedule" data-id="${r.id}">Jadwalkan & tugaskan teknisi</button>`);
 if(canTech&&r.status==='Dijadwalkan')acts.push(`<button class="btn" data-act="svc-status" data-id="${r.id}" data-s="Teknisi menuju lokasi">Menuju lokasi</button>`);
 if(canTech&&r.status==='Teknisi menuju lokasi')acts.push(`<button class="btn" data-act="svc-status" data-id="${r.id}" data-s="Sedang dikerjakan">Mulai pengerjaan</button>`);
 if(canTech&&['Sedang dikerjakan','Menunggu spare part','Menunggu persetujuan customer'].includes(r.status)){
  if(r.status==='Menunggu spare part'&&partsDone)acts.push(`<button class="btn" data-act="svc-status" data-id="${r.id}" data-s="Sedang dikerjakan">Spare part siap, lanjutkan</button>`);
  acts.push(`<button class="btn btn-o" data-act="svc-parts" data-id="${r.id}">Minta spare part</button>`);
  if(r.status!=='Menunggu persetujuan customer')acts.push(`<button class="btn btn-o" data-act="svc-status" data-id="${r.id}" data-s="Menunggu persetujuan customer">Butuh persetujuan customer</button>`);
  else acts.push(`<button class="btn btn-o" data-act="svc-status" data-id="${r.id}" data-s="Sedang dikerjakan">Customer setuju, lanjutkan</button>`);
  acts.push(`<button class="btn" data-act="svc-finish" data-id="${r.id}">Selesaikan pekerjaan</button>`);
 }
 if(r.status==='Selesai'&&isRole('tech_manager','admin_aftersales','deputy_director','director')&&can('svc_req','w'))acts.push(`<button class="btn" data-act="svc-close" data-id="${r.id}">Tutup tiket</button>`);
 if(r.warrantyStatus==='Dalam Garansi'&&!wOk&&!wPend&&canOps)acts.push(`<button class="btn btn-o" data-act="svc-warranty" data-id="${r.id}">Ajukan service gratis (warranty)</button>`);
 // H. Rekomendasi Aftersales Partner (lihat js/partners.js Partners.recommend) — hanya Admin Aftersales/Manager Teknisi/Direksi
 if(canEnt(ENT.partners)&&isRole('admin_aftersales','tech_manager','deputy_director','director'))acts.push(`<button class="btn btn-o" data-act="svc-assign-partner" data-id="${r.id}">${esc(t('partner.assign_btn'))}</button>`);
 // I. Buat evaluasi partner setelah service request selesai & sudah ada partner ditugaskan
 if(r.partnerId&&['Selesai','Ditutup'].includes(r.status)&&can('partner_evaluations','w'))acts.push(`<button class="btn btn-o" data-act="partner-eval-new" data-id="${r.id}">${esc(t('partner.evaluate_btn'))}</button>`);
 v.innerHTML=UI.pghead('Service '+r.no,acts.join(''))+`<div class="card"><div class="ch"><span>${esc(custName(r.customerId))} — ${esc(r.unitDesc)}</span>${UI.badge(r.status)}</div><div class="stepper">${stepper}</div>
  ${wPend?`<div class="warnbox">Pengajuan servis gratis <a href="#" data-act="appr-open" data-id="${wPend.id}">${esc(wPend.no)}</a> menunggu approval Manager.</div>`:''}${wOk?'<div class="info">Servis GRATIS (warranty) — disetujui.</div>':''}</div>
  <div class="grid split"><div>
  <div class="card">${UI.kv([['Jenis',esc(r.type)],['Prioritas',UI.badge(r.priority)],['Status warranty',esc(r.warrantyStatus)],['Serial',esc(r.serialNumber||'-')],['Lokasi',esc(r.location)],['Keluhan',esc(r.complaint)],
   ['Teknisi',esc(userName(r.technicianId)||'-')],['Jadwal',r.scheduledDate?fdate(r.scheduledDate):'-'],
   [t('partner.assigned_partner'),r.partnerId?`${esc(r.partnerCode||'')} — ${esc(r.partnerName||'')} <small class="mut">(${esc(r.partnerPic||'-')}, ${phoneOrHidden(r.partnerContact)})</small>`:'-']])}</div>
  <div class="card"><h3>Diagnosis & rekomendasi</h3>${canTech?`<div id="svdiag">${Form.render([F.ta('diagnosis','Hasil diagnosis'),F.ta('recommendation','Rekomendasi'),F.m('laborCost','Biaya jasa (Rp)')],r)}</div><div class="acts" style="margin-top:8px"><button class="btn btn-o btn-sm" data-act="svc-savediag" data-id="${r.id}">Simpan</button></div>`:UI.kv([['Diagnosis',esc(r.diagnosis||'-')],['Rekomendasi',esc(r.recommendation||'-')],['Biaya jasa',rp(r.laborCost)]])}</div>
  <div class="card"><h3>Spare part</h3>${(r.parts||[]).length?`<div class="tblw"><table><tr><th>Produk</th><th class="num">Qty</th><th>Gudang</th><th>Status</th><th></th></tr>${r.parts.map((p,i)=>`<tr><td>${esc(DB.get('products',p.productId)?.name)}</td><td class="num">${nf(p.qty)}</td><td>${esc(whName(p.whId))}</td><td>${UI.badge(p.status)}</td><td>${p.status==='Diminta'&&can('gi','w')?`<button class="btn btn-sm" data-act="svc-part-ready" data-id="${r.id}" data-i="${i}">Siapkan (gudang)</button>`:''}</td></tr>`).join('')}</table></div>`:'<div class="empty">Belum ada permintaan spare part.</div>'}</div>
  <div class="card"><h3>Foto & tanda tangan</h3><div class="fg"><div class="fld full"><label>Foto sebelum</label><div class="files" data-files="photosBefore" data-ro="${canTech?0:1}"></div></div><div class="fld full"><label>Foto sesudah</label><div class="files" data-files="photosAfter" data-ro="${canTech?0:1}"></div></div>
   <div class="fld full"><label>Tanda tangan customer</label>${Sig.html({k:'customerSig'},r.customerSig,!canTech)}</div></div>${canTech?`<div class="acts" style="margin-top:8px"><button class="btn btn-o btn-sm" data-act="svc-savemedia" data-id="${r.id}">Simpan foto & tanda tangan</button></div>`:''}</div></div>
  <div><div class="card"><h3>Riwayat</h3><div class="tl">${[...(r.history||[])].reverse().map(h=>`<div class="ev">${esc(h.text)}<br><small>${esc(h.by)} • ${fdt(h.at)}</small></div>`).join('')}</div></div>
  <div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('svc_req',r.id)}</div></div></div>`;
 ['photosBefore','photosAfter'].forEach(k=>{const el=$(`[data-files="${k}"]`);if(el){el._files=r[k]||[];Files.render(el)}});
 if(canTech){const cv=$('[data-sig="customerSig"] canvas');if(cv)Sig.mount(cv,r.customerSig)}
}
ACT['svc-new']=()=>{
 const {fields}=Svc._ctx,{v,err}=Form.collect($('#svform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 const r=Svc.create(v);UI.toast('Service Request dibuat: '+r.no);Router.go('svc_req/'+r.id);
};
ACT['svc-schedule']=async el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const v=await UI.ask({title:'Jadwalkan & tugaskan teknisi',ok:'Simpan',fields:[F.r('technicianId','Teknisi','users',{req:true,filter:u=>u.roleId==='technician'}),F.d('scheduledDate','Tanggal jadwal',{req:true,def:addDays(today(),1)})]});
 if(!v)return;
 DB.update('svc_req',r.id,{...v,history:Svc.log(r,`Dijadwalkan ${fdate(v.scheduledDate)} — teknisi ${userName(v.technicianId)}`)},'','Dijadwalkan');
 DB.update('svc_req',r.id,{status:'Dijadwalkan'},'','Dijadwalkan');
 Notify.user(v.technicianId,`Tugas servis baru: ${r.no} — ${custName(r.customerId)} (${fdate(v.scheduledDate)})`,'#/svc_req/'+r.id);
 UI.toast('Dijadwalkan.');Router.render();
};
ACT['svc-status']=el=>{const r=DB.get('svc_req',el.dataset.id);Svc.setStatus(r,el.dataset.s);UI.toast('Status: '+el.dataset.s);Router.render()};
ACT['svc-savediag']=el=>{
 const {v}=Form.collect($('#svdiag'),[F.ta('diagnosis',''),F.ta('recommendation',''),F.m('laborCost','')]);
 DB.update('svc_req',el.dataset.id,v,'','Simpan diagnosis');UI.toast('Diagnosis tersimpan.');Router.render();
};
ACT['svc-savemedia']=el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const photosBefore=$('[data-files="photosBefore"]')._files||[],photosAfter=$('[data-files="photosAfter"]')._files||[];
 const cv=$('[data-sig="customerSig"] canvas'),sig=cv&&cv._dirty?cv.toDataURL('image/png'):r.customerSig;
 DB.update('svc_req',r.id,{photosBefore,photosAfter,customerSig:sig},'','Simpan foto & tanda tangan');UI.toast('Tersimpan.');Router.render();
};
ACT['svc-parts']=async el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const v=await UI.ask({title:'Minta spare part ke gudang',ok:'Kirim permintaan',wide:true,fields:[{k:'items',l:'Spare part dibutuhkan',t:'lines',cols:SVC_PART_COLS,min:1}]});
 if(!v)return;
 const items=v.items.filter(i=>i.productId&&num(i.qty)>0&&i.whId);
 if(!items.length)return UI.toast('Isi minimal satu baris (produk, qty, gudang).','err');
 const parts=[...(r.parts||[]),...items.map(i=>({...i,status:'Diminta'}))];
 DB.update('svc_req',r.id,{parts,status:'Menunggu spare part',history:Svc.log(r,'Meminta spare part ke gudang')},'','Menunggu spare part');
 Notify.role('warehouse',`Permintaan spare part untuk ${r.no}`,'#/svc_req/'+r.id);
 UI.toast('Permintaan spare part terkirim.');Router.render();
};
ACT['svc-part-ready']=el=>{
 const r=DB.get('svc_req',el.dataset.id),i=+el.dataset.i,p=r.parts[i];
 try{Stock.change(p.productId,p.whId,-num(p.qty),'Keluar (service)',r.no,'Service '+r.no)}catch(e){return UI.toast(e.message,'err')}
 const parts=clone(r.parts);parts[i].status='Disiapkan';
 DB.update('svc_req',r.id,{parts,history:Svc.log(r,`Spare part disiapkan: ${DB.get('products',p.productId)?.name}`)},'','Spare part disiapkan');
 UI.toast('Spare part disiapkan, stok berkurang.');Router.render();
};
ACT['svc-warranty']=async el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const v=await UI.ask({title:'Ajukan service gratis (warranty)',ok:'Ajukan approval',fields:[F.ta('reason','Alasan / bukti masih dalam garansi',{req:true})]});
 if(!v)return;
 Approval.request({type:'warranty_free',refCol:'svc_req',refId:r.id,title:`Service gratis (warranty) — ${r.no}`,amount:num(r.laborCost)+sum(r.parts||[],p=>num(p.qty)*num(DB.get('products',p.productId)?.price)),reason:v.reason});
 UI.toast('Diajukan untuk approval Manager.');Router.render();
};
Approval.hooks.warranty_free={
 approved(a){DB.update('svc_req',a.refId,{freeOfCharge:true},'Approval disetujui','Servis gratis disetujui')},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('svc_req',a.refId,{},s?.note||'','Servis gratis ditolak: '+(s?.note||''))}
};
ACT['svc-finish']=el=>{
 const r=DB.get('svc_req',el.dataset.id);
 if(!r.diagnosis||!r.recommendation)return UI.toast('Isi diagnosis dan rekomendasi terlebih dahulu.','err');
 if(!(r.photosAfter||[]).length)return UI.toast('Unggah foto sesudah pekerjaan terlebih dahulu.','err');
 if(!r.customerSig&&!$('[data-sig="customerSig"] canvas')?._dirty)return UI.toast('Tanda tangan customer wajib diisi.','err');
 if((r.parts||[]).some(p=>p.status!=='Disiapkan'))return UI.toast('Masih ada spare part yang belum disiapkan gudang.','err');
 const cv=$('[data-sig="customerSig"] canvas'),sig=cv&&cv._dirty?cv.toDataURL('image/png'):r.customerSig;
 DB.update('svc_req',r.id,{status:'Selesai',customerSig:sig,serviceReportNo:r.serviceReportNo||Num.next('SVR'),history:Svc.log(r,'Pekerjaan selesai')},'','Selesai');
 UI.toast('Service selesai.');Router.render();
};
ACT['svc-close']=el=>{const r=DB.get('svc_req',el.dataset.id);Svc.setStatus(r,'Ditutup','Tiket ditutup');UI.toast('Tiket ditutup.');Router.render()};
ACT['svc-print']=el=>{
 const r=DB.get('svc_req',el.dataset.id);
 Print.html(Print.header('SERVICE REPORT',r.serviceReportNo||r.no)+UI.kv([['Customer',esc(custName(r.customerId))],['Unit',esc(r.unitDesc)],['Serial',esc(r.serialNumber||'-')],['Jenis',esc(r.type)],['Teknisi',esc(userName(r.technicianId))],
   ['Keluhan',esc(r.complaint)],['Diagnosis',esc(r.diagnosis||'-')],['Rekomendasi',esc(r.recommendation||'-')],['Biaya jasa',r.freeOfCharge?'GRATIS (Warranty)':rp(r.laborCost)]])+
  `<h3 style="margin-top:12px">Spare part digunakan</h3><table><tr><th>Produk</th><th class="right">Qty</th></tr>${(r.parts||[]).map(p=>`<tr><td>${esc(DB.get('products',p.productId)?.name)}</td><td class="right">${nf(p.qty)}</td></tr>`).join('')||'<tr><td colspan=2>-</td></tr>'}</table>
   <p style="margin-top:12px"><b>Tanda tangan customer:</b><br>${r.customerSig?`<img src="${r.customerSig}" style="max-width:280px;border:1px solid #ccc">`:'-'}</p>`);
};

/* ================= PREVENTIVE MAINTENANCE ================= */
ENT.pm_schedules={col:'pm_schedules',page:'pm',title:'Jadwal PM',label:r=>`${custName(r.customerId)} — ${r.unitDesc}`,wr:['tech_manager','deputy_director','director','admin_aftersales'],
 fields:[F.r('customerId','Customer','customers',{req:true,list:true}),F.t('unitDesc','Unit / mesin',{req:true,list:true}),F.s('basis','Basis interval',['Tanggal','Hour Meter'],{req:true,def:'Tanggal',list:true}),
  F.n('intervalDays','Interval (hari)',{def:90,hide:()=>false}),F.n('intervalHours','Interval (jam)',{def:250}),F.r('rentContractId','Kontrak rental (bila basis Hour Meter)','rent_contracts'),
  F.d('lastDate','PM terakhir (tanggal)',{def:()=>today()}),F.n('lastHour','PM terakhir (hour meter)',{def:0}),F.c('active','Aktif',{def:true})]};
wireEntTitle('pm_schedules');
PAGES.pm.render=async v=>{
 const rows=DB.all('pm_schedules').filter(r=>!r.deletedAt);
 const due=r=>{
  if(r.basis==='Tanggal')return addDays(r.lastDate,num(r.intervalDays))<=today();
  const c=DB.get('rent_contracts',r.rentContractId);if(!c)return false;
  return (c.hourMeterStart+Rent.overtime(c).used)>=num(r.lastHour)+num(r.intervalHours);
 };
 v.innerHTML=UI.pghead('Preventive Maintenance',can('pm','w')?'<button class="btn" data-act="crud-new" data-e="pm_schedules">+ Jadwal PM</button>':'')+
  `<div class="card"><h3>Jatuh tempo PM</h3>${rows.filter(due).length?rows.filter(due).map(r=>`<div style="padding:6px 0;border-bottom:1px solid var(--bd)">${UI.badge('Jatuh tempo')} ${esc(custName(r.customerId))} — ${esc(r.unitDesc)} <button class="btn btn-sm" data-act="pm-create-svc" data-id="${r.id}" style="float:right">Buat Service Request</button></div>`).join(''):'<div class="empty">Tidak ada PM yang jatuh tempo.</div>'}</div>
  <div class="card" id="pml"></div>`;
 Crud.list($('#pml'),'pm_schedules');
};
/* ---------------- H. Rekomendasi & penugasan Aftersales Partner ke Service Request ---------------- */
ACT['svc-assign-partner']=el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const recs=Partners.recommend(r,8);
 if(!recs.length)return UI.toast(t('partner.no_recommendation'),'err');
 const body=`<div class="tblw"><table><tr><th></th><th>${t('partner.col_name')}</th><th>${t('partner.col_score')}</th><th>${t('partner.col_dist')}</th><th>${t('partner.rating')}</th><th>${t('common.status')}</th></tr>
  ${recs.map(x=>`<tr><td><button class="btn btn-sm" data-act="svc-partner-pick" data-id="${r.id}" data-pid="${x.partner.id}">${esc(t('partner.pick_btn'))}</button></td>
   <td>${esc(x.partner.code)} — ${esc(x.partner.name)}</td><td>${x.score}</td><td>${x.distKm!=null?x.distKm+' km':'-'}</td><td>${num(x.partner.rating)||'-'}</td><td>${UI.badge(x.partner.status)}</td></tr>`).join('')}
  </table></div><p class="mut" style="margin-top:8px">${t('partner.pick_other_hint')}</p>
  <div class="fld full" style="margin-top:6px"><label>${t('partner.pick_other_label')}</label>${Form.select('id="svcOtherPartner"',{t:'ref',ref:'partners'},'','','')}</div>
  <div class="fld full"><label>${t('partner.override_reason')}</label><textarea id="svcOverrideReason" rows="2"></textarea></div>
  <div class="acts" style="margin-top:8px"><button class="btn btn-o" data-act="svc-partner-pick-other" data-id="${r.id}">${esc(t('partner.assign_other_btn'))}</button></div>`;
 UI.modal({title:t('partner.recommend_title'),wide:true,body,foot:`<button class="btn btn-o" data-x="c">${t('admin.close')}</button>`}).el.addEventListener('click',e=>{
  if(e.target.closest('[data-x="c"]'))e.target.closest('.ov')._m.close();
 });
};
function assignPartnerToSvc(svcId,partnerId,reason){
 const p=DB.get('partners',partnerId);if(!p)return UI.toast(t('err.notfound'),'err');
 const r=DB.get('svc_req',svcId);
 DB.update('svc_req',svcId,{partnerId:p.id,partnerCode:p.code,partnerName:p.name,partnerPic:p.pic,partnerContact:p.whatsapp,partnerAssignReason:reason||''},reason||'','Partner ditugaskan');
 UI.toast(t('partner.assigned_success',{name:p.name}));
 $$('.ov').forEach(o=>o._m&&o._m.close());
 Router.render();
}
ACT['svc-partner-pick']=el=>assignPartnerToSvc(el.dataset.id,el.dataset.pid);
ACT['svc-partner-pick-other']=el=>{
 const sel=$('#svcOtherPartner'),reason=$('#svcOverrideReason')?.value.trim();
 if(!sel||!sel.value)return UI.toast(t('partner.pick_other_required'),'err');
 if(!reason)return UI.toast(t('partner.override_reason_required'),'err');
 assignPartnerToSvc(el.dataset.id,sel.value,reason);
};
/* ---------------- I. Evaluasi partner dari Service Request selesai ---------------- */
ACT['partner-eval-new']=async el=>{
 const r=DB.get('svc_req',el.dataset.id);if(!r.partnerId)return;
 Crud.open('partner_evaluations',null,{partnerId:r.partnerId,svcReqId:r.id});
};
ACT['pm-create-svc']=el=>{
 const p=DB.get('pm_schedules',el.dataset.id);
 const r=Svc.create({customerId:p.customerId,unitDesc:p.unitDesc,serialNumber:'',type:'Servis berkala',warrantyStatus:'Tidak berlaku',priority:'Sedang',location:'-',complaint:'Preventive maintenance terjadwal',files:[]});
 DB.update('pm_schedules',p.id,{lastDate:today(),lastHour:p.basis==='Hour Meter'?(DB.get('rent_contracts',p.rentContractId)?.hourMeterStart||0)+Rent.overtime(DB.get('rent_contracts',p.rentContractId)||{}).used:p.lastHour},'PM dijadwalkan ulang','Buat Service Request');
 UI.toast('Service Request PM dibuat: '+r.no);Router.go('svc_req/'+r.id);
};
