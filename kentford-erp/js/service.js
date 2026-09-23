'use strict';
/* =========================================================
   KENTFORD ERP - Tahap 5b: Service & Aftersales, Teknisi, PM
   ========================================================= */
/* SVC_STATUSES/priority/part-status: nilai di array ini tetap dipakai sbg KODE internal (disimpan
   di DB, dipakai untuk perbandingan r.status==='Request masuk' dst) - tidak boleh diganti supaya
   data lama tetap valid. Label yang ditampilkan ke user selalu dihitung LIVE lewat svcStatusLabel()
   dkk di bawah, mengikuti pola Order.statusLabel() di js/neworder.js. */
const SVC_STATUSES=['Request masuk','Dijadwalkan','Teknisi menuju lokasi','Sedang dikerjakan','Menunggu spare part','Menunggu persetujuan customer','Selesai','Ditutup'];
const SVC_STATUS_KEYS=['svc.status.new','svc.status.scheduled','svc.status.enroute','svc.status.inprogress','svc.status.waiting_parts','svc.status.waiting_customer','svc.status.done','svc.status.closed'];
const svcStatusLabel=s=>{const i=SVC_STATUSES.indexOf(s);return i>=0?t(SVC_STATUS_KEYS[i]):s};
const SVC_PRIORITIES=['Tinggi','Sedang','Rendah'];
const SVC_PRIORITY_KEYS=['svc.priority.high','svc.priority.med','svc.priority.low'];
const svcPriorityLabel=p=>{const i=SVC_PRIORITIES.indexOf(p);return i>=0?t(SVC_PRIORITY_KEYS[i]):p};
const svcPartStatusLabel=s=>({'Diminta':t('svc.part_status.requested'),'Disiapkan':t('svc.part_status.ready')}[s]||s);
const SVC_PART_COLS=[{k:'productId',l:t('svc.item_part'),t:'ref',ref:'products',w:'220px'},{k:'qty',l:t('common.qty'),t:'number',w:'70px'},{k:'whId',l:t('svc.take_from'),'t':'ref',ref:'warehouses',w:'160px'}];

const Svc={
 canAssignedTech(r){return r.technicianId&&r.technicianId!==Auth.uid()&&Auth.user.roleId==='technician'},
 fields:()=>[F.r('customerId',t('common.customer'),'customers',{req:true}),F.t('unitDesc',t('svc.unit_desc'),{req:true,ph:'mis. Genset Cummins 500 kVA'}),F.t('serialNumber',t('svc.serial_number')),
  F.s('type',t('svc.service_type'),()=>DB.all('servicetypes').map(s=>s.name),{req:true}),F.s('warrantyStatus',t('svc.warranty_status'),['Dalam Garansi','Habis Garansi','Tidak berlaku'],{req:true,def:'Tidak berlaku'}),
  F.s('priority',t('svc.priority'),SVC_PRIORITIES,{req:true,def:'Sedang'}),F.ta('location',t('common.location'),{req:true}),F.ta('complaint',t('svc.complaint'),{req:true}),F.fl('files',t('svc.files_optional'))],
 create(v){return DB.insert('svc_req',{...v,no:Num.next('SR'),status:'Request masuk',parts:[],laborCost:0,history:[{at:nowISO(),by:Auth.user.name,key:'svc.status.new'}]})},
 log(r,key,vars){return [...(r.history||[]),{at:nowISO(),by:Auth.user.name,key,vars:vars||null}]},
 renderHistory(r){
  const rows=(r.history||[]).slice().reverse();
  if(!rows.length)return `<div class="empty">${t('ord.hist.no_history')}</div>`;
  return rows.map(h=>`<div class="ev">${h.key?esc(t(h.key,h.vars)):esc(h.text||'')}<br><small>${esc(h.by)} • ${fdt(h.at)}</small></div>`).join('');
 },
 setStatus(r,status,key,vars){DB.update('svc_req',r.id,{status,history:this.log(r,key,vars)},'',svcStatusLabel(status))}
};

PAGES.svc_req.render=async(v,param)=>renderSvcList(v,param,()=>true,'svc_req',true);
PAGES.wo.render=async(v,param)=>renderSvcList(v,param,r=>r.status!=='Request masuk','wo');
PAGES.survey.render=async(v,param)=>renderSvcList(v,param,r=>r.type==='Survey lokasi','survey');
PAGES.install.render=async(v,param)=>renderSvcList(v,param,r=>r.type==='Instalasi','install');
PAGES.warranty.render=async(v,param)=>renderSvcList(v,param,r=>r.type==='Warranty claim'||r.warrantyStatus==='Dalam Garansi','warranty');
PAGES.svc_report.render=async(v,param)=>renderSvcList(v,param,r=>['Selesai','Ditutup'].includes(r.status),'svc_report',false,true);
PAGES.tech_sched.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.tech_sched'))+'<div class="card" id="tsl"></div>';
 new DT($('#tsl'),{title:t('nav.tech_sched'),rows:()=>DB.all('svc_req').filter(r=>r.scheduledDate&&!['Selesai','Ditutup'].includes(r.status)).sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate)),onRow:id=>Router.go('svc_req/'+id),
  filters:[{k:'t',l:t('ord.technician'),opts:()=>DB.all('users').filter(u=>u.roleId==='technician').map(u=>u.name),get:r=>userName(r.technicianId)}],
  cols:[{k:'no',l:t('common.no_dot')},{k:'date',l:t('svc.label.schedule'),text:r=>fdate(r.scheduledDate),sortv:r=>r.scheduledDate},{k:'tech',l:t('ord.technician'),text:r=>userName(r.technicianId)},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'type',l:t('common.type'),text:r=>r.type},{k:'st',l:t('common.status'),text:r=>svcStatusLabel(r.status),html:r=>UI.badge(svcStatusLabel(r.status))}]});
};
function renderSvcList(v,param,filter,pageKey,allowNew,isReport){
 const title=t('nav.'+pageKey);
 if(!param||param==='new'){
  if(param==='new'){
   if(!allowNew||!can('svc_req','w'))return v.innerHTML=UI.empty(t('svc.msg.no_right_create'));
   const fields=Svc.fields();Svc._ctx={fields};
   v.innerHTML=UI.pghead(t('svc.h.new_title'),`<a class="btn btn-o" href="#/svc_req">${esc(t('ord.btn.cancel_form'))}</a>`)+`<div class="card"><div id="svform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="svc-new">${esc(t('common.save'))}</button></div></div>`;
   Form.hydrate($('#svform'),fields,{});return;
  }
  v.innerHTML=UI.pghead(title,allowNew&&can('svc_req','w')?`<a class="btn" href="#/svc_req/new">${esc(t('svc.btn.new_svc_req'))}</a>`:'')+`<div class="card" id="svl"></div>`;
  new DT($('#svl'),{title,rows:()=>DB.all('svc_req').filter(filter).slice().reverse(),onRow:id=>Router.go('svc_req/'+id),
   filters:[{k:'s',l:t('common.status'),opts:()=>SVC_STATUSES.map(svcStatusLabel),get:r=>svcStatusLabel(r.status)},{k:'p',l:t('svc.priority'),opts:()=>SVC_PRIORITIES.map(svcPriorityLabel),get:r=>svcPriorityLabel(r.priority)}],
   cols:[{k:'no',l:t('common.no_dot')},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'type',l:t('common.type'),text:r=>r.type},{k:'tech',l:t('ord.technician'),text:r=>userName(r.technicianId)||'-'},{k:'pr',l:t('svc.priority'),text:r=>svcPriorityLabel(r.priority),html:r=>UI.badge(svcPriorityLabel(r.priority))},
    {k:'sd',l:t('svc.label.schedule'),text:r=>r.scheduledDate?fdate(r.scheduledDate):'-',sortv:r=>r.scheduledDate||''},{k:'st',l:t('common.status'),text:r=>svcStatusLabel(r.status),html:r=>UI.badge(svcStatusLabel(r.status))}]});
  return;
 }
 const r=DB.get('svc_req',param);if(!r||!filter(r)&&!isReport&&pageKey!=='svc_req')return v.innerHTML=UI.empty(t('svc.msg.not_found'));
 svcDetail(v,DB.get('svc_req',param)||r);
}
function svcDetail(v,r){
 if(!r)return v.innerHTML=UI.empty(t('svc.msg.not_found'));
 const idx=SVC_STATUSES.indexOf(r.status);
 const stepper=SVC_STATUSES.map((s,i)=>`<div class="st ${i<idx?'done':i===idx?'cur':''}"><i>${i<idx?'✓':i+1}</i><div>${esc(svcStatusLabel(s))}</div></div>`).join('');
 const isTech=Auth.user.roleId==='technician',mine=!r.technicianId||r.technicianId===Auth.uid();
 const canOps=can('svc_req','r')&&(!isTech||mine)&&r.status!=='Selesai'&&r.status!=='Ditutup';
 const canSchedule=canOps&&isRole('admin_aftersales','tech_manager','deputy_director','director')&&r.status==='Request masuk';
 const canTech=canOps&&(isTech||isRole('tech_manager'));
 const wApr=Approval.forRef('svc_req',r.id).filter(a=>a.type==='warranty_free');
 const wPend=wApr.find(a=>a.status==='Menunggu'),wOk=wApr.some(a=>a.status==='Disetujui');
 const partsDone=(r.parts||[]).every(p=>p.status==='Disiapkan');
 const acts=[`<a class="btn btn-o" href="#/wo">‹ ${esc(t('common.back'))}</a>`,`<button class="btn btn-o" data-act="svc-print" data-id="${r.id}">${esc(t('svc.btn.print'))}</button>`];
 if(canSchedule)acts.push(`<button class="btn" data-act="svc-schedule" data-id="${r.id}">${esc(t('svc.btn.schedule_assign'))}</button>`);
 if(canTech&&r.status==='Dijadwalkan')acts.push(`<button class="btn" data-act="svc-status" data-id="${r.id}" data-s="Teknisi menuju lokasi">${esc(t('svc.btn.go_onsite'))}</button>`);
 if(canTech&&r.status==='Teknisi menuju lokasi')acts.push(`<button class="btn" data-act="svc-status" data-id="${r.id}" data-s="Sedang dikerjakan">${esc(t('svc.btn.start_work'))}</button>`);
 if(canTech&&['Sedang dikerjakan','Menunggu spare part','Menunggu persetujuan customer'].includes(r.status)){
  if(r.status==='Menunggu spare part'&&partsDone)acts.push(`<button class="btn" data-act="svc-status" data-id="${r.id}" data-s="Sedang dikerjakan">${esc(t('svc.btn.parts_ready_continue'))}</button>`);
  acts.push(`<button class="btn btn-o" data-act="svc-parts" data-id="${r.id}">${esc(t('svc.btn.request_parts'))}</button>`);
  if(r.status!=='Menunggu persetujuan customer')acts.push(`<button class="btn btn-o" data-act="svc-status" data-id="${r.id}" data-s="Menunggu persetujuan customer">${esc(t('svc.btn.need_customer_approval'))}</button>`);
  else acts.push(`<button class="btn btn-o" data-act="svc-status" data-id="${r.id}" data-s="Sedang dikerjakan">${esc(t('svc.btn.customer_agreed_continue'))}</button>`);
  acts.push(`<button class="btn" data-act="svc-finish" data-id="${r.id}">${esc(t('svc.btn.finish_work'))}</button>`);
 }
 if(r.status==='Selesai'&&isRole('tech_manager','admin_aftersales','deputy_director','director')&&can('svc_req','w'))acts.push(`<button class="btn" data-act="svc-close" data-id="${r.id}">${esc(t('svc.btn.close_ticket'))}</button>`);
 if(r.warrantyStatus==='Dalam Garansi'&&!wOk&&!wPend&&canOps)acts.push(`<button class="btn btn-o" data-act="svc-warranty" data-id="${r.id}">${esc(t('svc.btn.request_free_warranty'))}</button>`);
 // H. Rekomendasi Aftersales Partner (lihat js/partners.js Partners.recommend) — hanya Admin Aftersales/Manager Teknisi/Direksi
 if(canEnt(ENT.partners)&&isRole('admin_aftersales','tech_manager','deputy_director','director'))acts.push(`<button class="btn btn-o" data-act="svc-assign-partner" data-id="${r.id}">${esc(t('partner.assign_btn'))}</button>`);
 // I. Buat evaluasi partner setelah service request selesai & sudah ada partner ditugaskan
 if(r.partnerId&&['Selesai','Ditutup'].includes(r.status)&&can('partner_evaluations','w'))acts.push(`<button class="btn btn-o" data-act="partner-eval-new" data-id="${r.id}">${esc(t('partner.evaluate_btn'))}</button>`);
 v.innerHTML=UI.pghead(t('nav.svc_req')+' '+r.no,acts.join(''))+`<div class="card"><div class="ch"><span>${esc(custName(r.customerId))} — ${esc(r.unitDesc)}</span>${UI.badge(svcStatusLabel(r.status))}</div><div class="stepper">${stepper}</div>
  ${wPend?`<div class="warnbox">${t('svc.btn.request_free_warranty')} <a href="#" data-act="appr-open" data-id="${wPend.id}">${esc(wPend.no)}</a> ${t('admin.waiting').toLowerCase()}.</div>`:''}${wOk?`<div class="info">${esc(t('svc.free_warranty_label'))} — ${esc(t('admin.approvals_done'))}.</div>`:''}</div>
  <div class="grid split"><div>
  <div class="card">${UI.kv([[t('common.type'),esc(r.type)],[t('svc.priority'),UI.badge(svcPriorityLabel(r.priority))],[t('svc.warranty_status'),esc(stLabel(r.warrantyStatus))],[t('svc.serial_number'),esc(r.serialNumber||'-')],[t('common.location'),esc(r.location)],[t('svc.complaint'),esc(r.complaint)],
   [t('ord.technician'),esc(userName(r.technicianId)||'-')],[t('svc.label.schedule'),r.scheduledDate?fdate(r.scheduledDate):'-'],
   [t('partner.assigned_partner'),r.partnerId?`${esc(r.partnerCode||'')} — ${esc(r.partnerName||'')} <small class="mut">(${esc(r.partnerPic||'-')}, ${phoneOrHidden(r.partnerContact)})</small>`:'-']])}</div>
  <div class="card"><h3>${esc(t('svc.h.diagnosis'))}</h3>${canTech?`<div id="svdiag">${Form.render([F.ta('diagnosis',t('svc.diagnosis')),F.ta('recommendation',t('svc.recommendation')),F.m('laborCost',t('svc.labor_cost'))],r)}</div><div class="acts" style="margin-top:8px"><button class="btn btn-o btn-sm" data-act="svc-savediag" data-id="${r.id}">${esc(t('common.save'))}</button></div>`:UI.kv([[t('svc.diagnosis'),esc(r.diagnosis||'-')],[t('svc.recommendation'),esc(r.recommendation||'-')],[t('svc.labor_cost'),rp(r.laborCost)]])}</div>
  <div class="card"><h3>${esc(t('svc.h.parts'))}</h3>${(r.parts||[]).length?`<div class="tblw"><table><tr><th>${t('svc.col.product')}</th><th class="num">${t('common.qty')}</th><th>${t('svc.col.warehouse')}</th><th>${t('common.status')}</th><th></th></tr>${r.parts.map((p,i)=>`<tr><td>${esc(DB.get('products',p.productId)?.name)}</td><td class="num">${nf(p.qty)}</td><td>${esc(whName(p.whId))}</td><td>${UI.badge(svcPartStatusLabel(p.status))}</td><td>${p.status==='Diminta'&&can('gi','w')?`<button class="btn btn-sm" data-act="svc-part-ready" data-id="${r.id}" data-i="${i}">${esc(t('svc.btn.prepare_warehouse'))}</button>`:''}</td></tr>`).join('')}</table></div>`:`<div class="empty">${t('svc.msg.no_parts_request')}</div>`}</div>
  <div class="card"><h3>${esc(t('svc.h.photos_sig'))}</h3><div class="fg"><div class="fld full"><label>${t('svc.label.before_photo')}</label><div class="files" data-files="photosBefore" data-ro="${canTech?0:1}"></div></div><div class="fld full"><label>${t('svc.label.after_photo')}</label><div class="files" data-files="photosAfter" data-ro="${canTech?0:1}"></div></div>
   <div class="fld full"><label>${t('svc.label.customer_sig')}</label>${Sig.html({k:'customerSig'},r.customerSig,!canTech)}</div></div>${canTech?`<div class="acts" style="margin-top:8px"><button class="btn btn-o btn-sm" data-act="svc-savemedia" data-id="${r.id}">${esc(t('svc.btn.save_photos_sig'))}</button></div>`:''}</div></div>
  <div><div class="card"><h3>${esc(t('svc.h.history'))}</h3><div class="tl">${Svc.renderHistory(r)}</div></div>
  <div class="card"><h3>${esc(t('svc.h.activity'))}</h3>${UI.activity('svc_req',r.id)}</div></div></div>`;
 ['photosBefore','photosAfter'].forEach(k=>{const el=$(`[data-files="${k}"]`);if(el){el._files=r[k]||[];Files.render(el)}});
 if(canTech){const cv=$('[data-sig="customerSig"] canvas');if(cv)Sig.mount(cv,r.customerSig)}
}
ACT['svc-new']=()=>{
 const {fields}=Svc._ctx,{v,err}=Form.collect($('#svform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 const r=Svc.create(v);UI.toast(t('svc.msg.created',{no:r.no}));Router.go('svc_req/'+r.id);
};
ACT['svc-schedule']=async el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const v=await UI.ask({title:t('svc.btn.schedule_assign'),ok:t('common.save'),fields:[F.r('technicianId',t('ord.technician'),'users',{req:true,filter:u=>u.roleId==='technician'}),F.d('scheduledDate',t('svc.scheduled_date'),{req:true,def:addDays(today(),1)})]});
 if(!v)return;
 DB.update('svc_req',r.id,{...v,history:Svc.log(r,'svc.hist.scheduled',{date:fdate(v.scheduledDate),tech:userName(v.technicianId)})},'',svcStatusLabel('Dijadwalkan'));
 DB.update('svc_req',r.id,{status:'Dijadwalkan'},'',svcStatusLabel('Dijadwalkan'));
 Notify.user(v.technicianId,t('svc.notify.new_task',{no:r.no,cust:custName(r.customerId),date:fdate(v.scheduledDate)}),'#/svc_req/'+r.id);
 UI.toast(t('svc.msg.scheduled'));Router.render();
};
ACT['svc-status']=el=>{
 const r=DB.get('svc_req',el.dataset.id),s=el.dataset.s,key=SVC_STATUS_KEYS[SVC_STATUSES.indexOf(s)];
 Svc.setStatus(r,s,key);
 UI.toast(t('svc.msg.status_changed',{status:svcStatusLabel(s)}));Router.render();
};
ACT['svc-savediag']=el=>{
 const {v}=Form.collect($('#svdiag'),[F.ta('diagnosis',''),F.ta('recommendation',''),F.m('laborCost','')]);
 DB.update('svc_req',el.dataset.id,v,'',t('svc.msg.diagnosis_saved'));UI.toast(t('svc.msg.diagnosis_saved'));Router.render();
};
ACT['svc-savemedia']=el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const photosBefore=$('[data-files="photosBefore"]')._files||[],photosAfter=$('[data-files="photosAfter"]')._files||[];
 const cv=$('[data-sig="customerSig"] canvas'),sig=cv&&cv._dirty?cv.toDataURL('image/png'):r.customerSig;
 DB.update('svc_req',r.id,{photosBefore,photosAfter,customerSig:sig},'',t('svc.btn.save_photos_sig'));UI.toast(t('svc.msg.saved'));Router.render();
};
ACT['svc-parts']=async el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const v=await UI.ask({title:t('svc.modal.request_parts_title'),ok:t('svc.modal.send_request'),wide:true,fields:[{k:'items',l:t('svc.parts_needed'),t:'lines',cols:SVC_PART_COLS,min:1}]});
 if(!v)return;
 const items=v.items.filter(i=>i.productId&&num(i.qty)>0&&i.whId);
 if(!items.length)return UI.toast(t('svc.msg.fill_parts_row'),'err');
 const parts=[...(r.parts||[]),...items.map(i=>({...i,status:'Diminta'}))];
 DB.update('svc_req',r.id,{parts,status:'Menunggu spare part',history:Svc.log(r,'svc.hist.parts_requested')},'',svcStatusLabel('Menunggu spare part'));
 Notify.role('warehouse',t('svc.notify.parts_request',{no:r.no}),'#/svc_req/'+r.id);
 UI.toast(t('svc.msg.parts_request_sent'));Router.render();
};
ACT['svc-part-ready']=el=>{
 const r=DB.get('svc_req',el.dataset.id),i=+el.dataset.i,p=r.parts[i];
 try{Stock.change(p.productId,p.whId,-num(p.qty),'Keluar (service)',r.no,'Service '+r.no)}catch(e){return UI.toast(e.message,'err')}
 const parts=clone(r.parts);parts[i].status='Disiapkan';
 const partName=DB.get('products',p.productId)?.name||'';
 DB.update('svc_req',r.id,{parts,history:Svc.log(r,'svc.hist.parts_ready',{name:partName})},'',t('svc.hist.parts_ready',{name:partName}));
 UI.toast(t('svc.msg.parts_ready'));Router.render();
};
ACT['svc-warranty']=async el=>{
 const r=DB.get('svc_req',el.dataset.id);
 const v=await UI.ask({title:t('svc.btn.request_free_warranty'),ok:t('svc.modal.submit_approval'),fields:[F.ta('reason',t('svc.warranty_reason'),{req:true})]});
 if(!v)return;
 Approval.request({type:'warranty_free',refCol:'svc_req',refId:r.id,title:`Service gratis (warranty) — ${r.no}`,amount:num(r.laborCost)+sum(r.parts||[],p=>num(p.qty)*num(DB.get('products',p.productId)?.price)),reason:v.reason});
 UI.toast(t('svc.msg.submitted_for_approval'));Router.render();
};
Approval.hooks.warranty_free={
 approved(a){DB.update('svc_req',a.refId,{freeOfCharge:true},'Approval disetujui','Servis gratis disetujui')},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('svc_req',a.refId,{},s?.note||'','Servis gratis ditolak: '+(s?.note||''))}
};
ACT['svc-finish']=el=>{
 const r=DB.get('svc_req',el.dataset.id);
 if(!r.diagnosis||!r.recommendation)return UI.toast(t('svc.msg.fill_diag_first'),'err');
 if(!(r.photosAfter||[]).length)return UI.toast(t('svc.msg.upload_after_photo_first'),'err');
 if(!r.customerSig&&!$('[data-sig="customerSig"] canvas')?._dirty)return UI.toast(t('svc.msg.customer_sig_required'),'err');
 if((r.parts||[]).some(p=>p.status!=='Disiapkan'))return UI.toast(t('svc.msg.parts_not_ready'),'err');
 const cv=$('[data-sig="customerSig"] canvas'),sig=cv&&cv._dirty?cv.toDataURL('image/png'):r.customerSig;
 DB.update('svc_req',r.id,{status:'Selesai',customerSig:sig,serviceReportNo:r.serviceReportNo||Num.next('SVR'),history:Svc.log(r,'svc.hist.work_done')},'',svcStatusLabel('Selesai'));
 UI.toast(t('svc.msg.done'));Router.render();
};
ACT['svc-close']=el=>{const r=DB.get('svc_req',el.dataset.id);Svc.setStatus(r,'Ditutup','svc.status.closed');UI.toast(t('svc.msg.ticket_closed'));Router.render()};
ACT['svc-print']=el=>{
 const r=DB.get('svc_req',el.dataset.id);
 Print.html(Print.header('SERVICE REPORT',r.serviceReportNo||r.no)+UI.kv([[t('common.customer'),esc(custName(r.customerId))],[t('svc.unit_desc'),esc(r.unitDesc)],[t('svc.serial_number'),esc(r.serialNumber||'-')],[t('common.type'),esc(r.type)],[t('ord.technician'),esc(userName(r.technicianId))],
   [t('svc.complaint'),esc(r.complaint)],[t('svc.diagnosis'),esc(r.diagnosis||'-')],[t('svc.recommendation'),esc(r.recommendation||'-')],[t('svc.labor_cost'),r.freeOfCharge?esc(t('svc.free_warranty_label')):rp(r.laborCost)]])+
  `<h3 style="margin-top:12px">${esc(t('svc.h.parts_used'))}</h3><table><tr><th>${t('svc.col.product')}</th><th class="right">${t('common.qty')}</th></tr>${(r.parts||[]).map(p=>`<tr><td>${esc(DB.get('products',p.productId)?.name)}</td><td class="right">${nf(p.qty)}</td></tr>`).join('')||'<tr><td colspan=2>-</td></tr>'}</table>
   <p style="margin-top:12px"><b>${esc(t('svc.label.customer_sig'))}:</b><br>${r.customerSig?`<img src="${r.customerSig}" style="max-width:280px;border:1px solid #ccc">`:'-'}</p>`);
};

/* ================= PREVENTIVE MAINTENANCE ================= */
ENT.pm_schedules={col:'pm_schedules',page:'pm',title:'Jadwal PM',label:r=>`${custName(r.customerId)} — ${r.unitDesc}`,wr:['tech_manager','deputy_director','director','admin_aftersales'],
 fields:[F.r('customerId',t('common.customer'),'customers',{req:true,list:true}),F.t('unitDesc',t('svc.unit_desc'),{req:true,list:true}),F.s('basis',t('svc.pm_basis'),['Tanggal','Hour Meter'],{req:true,def:'Tanggal',list:true}),
  F.n('intervalDays',t('svc.pm_interval_days'),{def:90,hide:()=>false}),F.n('intervalHours',t('svc.pm_interval_hours'),{def:250}),F.r('rentContractId',t('svc.pm_rent_contract'),'rent_contracts'),
  F.d('lastDate',t('svc.pm_last_date'),{def:()=>today()}),F.n('lastHour',t('svc.pm_last_hour'),{def:0}),F.c('active',t('common.active'),{def:true})]};
wireEntTitle('pm_schedules');
PAGES.pm.render=async v=>{
 const rows=DB.all('pm_schedules').filter(r=>!r.deletedAt);
 const due=r=>{
  if(r.basis==='Tanggal')return addDays(r.lastDate,num(r.intervalDays))<=today();
  const c=DB.get('rent_contracts',r.rentContractId);if(!c)return false;
  return (c.hourMeterStart+Rent.overtime(c).used)>=num(r.lastHour)+num(r.intervalHours);
 };
 v.innerHTML=UI.pghead(t('nav.pm'),can('pm','w')?`<button class="btn" data-act="crud-new" data-e="pm_schedules">+ ${esc(t('nav.pm'))}</button>`:'')+
  `<div class="card"><h3>${esc(t('svc.h.pm_due'))}</h3>${rows.filter(due).length?rows.filter(due).map(r=>`<div style="padding:6px 0;border-bottom:1px solid var(--bd)">${UI.badge(t('svc.pm.due_badge'))} ${esc(custName(r.customerId))} — ${esc(r.unitDesc)} <button class="btn btn-sm" data-act="pm-create-svc" data-id="${r.id}" style="float:right">${esc(t('nav.svc_req'))}</button></div>`).join(''):`<div class="empty">${t('svc.msg.no_pm_due')}</div>`}</div>
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
   <td>${esc(x.partner.code)} — ${esc(x.partner.name)}</td><td>${x.score}</td><td>${x.distKm!=null?x.distKm+' km':'-'}</td><td>${num(x.partner.rating)||'-'}</td><td>${UI.badge(Crud.disp(ENT.partners.fields.find(f=>f.k==='status'),x.partner.status))}</td></tr>`).join('')}
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
 UI.toast(t('svc.msg.pm_created',{no:r.no}));Router.go('svc_req/'+r.id);
};
