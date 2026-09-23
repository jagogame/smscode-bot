'use strict';
/* =========================================================
   KENTFORD ERP - New Order Tracking: alur 12 tahap dari input
   sales hingga selesai (instalasi genset, serah terima, invoice)
   ========================================================= */

/* ---------- Tahapan New Order ---------- */
const STAGES=[
 {key:'sales_input',roles:['sales','admin_hr_sales']},
 {key:'review',roles:['admin_hr_sales']},
 {key:'warehouse',roles:['warehouse']},
 {key:'finance',roles:['finance']},
 {key:'director',roles:['director']},
 {key:'prepare',roles:['warehouse']},
 {key:'shipping',roles:['warehouse','admin_hr_sales']},
 {key:'delivered',roles:['sales','admin_hr_sales']},
 {key:'install',roles:['technician']},
 {key:'handover',roles:['sales','admin_hr_sales']},
 {key:'invoice_final',roles:['finance']},
 {key:'done',roles:[]}
];
STAGES.forEach(s=>{
 Object.defineProperty(s,'short',{enumerable:true,get:()=>t('stage.'+s.key+'.short')});
 Object.defineProperty(s,'status',{enumerable:true,get:()=>t('stage.'+s.key+'.status')});
});
const STAGE_IDX=k=>STAGES.findIndex(s=>s.key===k);
const ORD_ITEM_COLS=[{k:'productId',l:t('ord.item_product'),'t':'ref',ref:'products',w:'220px'},{k:'desc',l:t('common.description'),t:'text',w:'200px'},{k:'qty',l:t('common.qty'),t:'number',w:'80px'}];

/* ---------- Objek Order (API publik dipakai dashboard/reports/finance) ---------- */
const Order={
 stageRoles(o){return (STAGES.find(s=>s.key===o.stage)||{}).roles||[]},
 canAct(o){return !o.cancelled&&o.stage!=='done'&&o.stage!=='director'&&isRole(...this.stageRoles(o),'deputy_director','director','sales_manager','tech_manager')},
 late(o){
  if(o.cancelled||o.stage==='done')return false;
  const sla=num(S().slaDays)||3;
  if(daysBetween((o.stageAt||o.createdAt||today()).slice(0,10),today())>sla)return true;
  if(o.targetDelivery&&o.targetDelivery<today()&&!['delivered','install','handover','invoice_final'].includes(o.stage))return true;
  return false;
 },
 myTasks(){
  return Scope.rows('orders').filter(o=>!o.cancelled&&o.stage!=='done'&&o.stage!=='director'&&this.stageRoles(o).some(r=>isRole(r)))
   .sort((a,b)=>(a.stageAt||'').localeCompare(b.stageAt||''));
 },
 /* Status yang ditampilkan dihitung LIVE dari stage/flag saat ini (bukan dari statusText yang
    dulu disimpan sebagai teks jadi-jadian pada bahasa aktif saat itu) supaya tetap ikut berganti
    bahasa kapan saja - lihat catatan di dalam _advance() di bawah. */
 statusLabel(o){
  if(o.cancelled)return t('common.cancelled');
  if(o.directorRejected)return t('ord.status.rejected_director');
  if(o.revisionNeeded)return t('ord.status.revision_needed');
  const st=STAGES.find(s=>s.key===o.stage);
  return st?st.status:o.stage;
 },
 /* dipanggil setelah pembayaran invoice tercatat (lihat finance.js / sales.js) */
 touch(id){
  const o=DB.get('orders',id);if(!o)return;
  if((o.stage==='finance'||o.stage==='director')&&Inv.orderPaid(o)){
   this._advance(o,'prepare','ord.hist.paid_auto_advance');
   Notify.user(o.salesId,t('ord.notif.paid_advance',{no:o.no}),'#/orders/'+o.id);
  }
 },
 /* pindah tahap: tandai tahap sekarang selesai, catat riwayat, gabungkan data tambahan.
    Riwayat disimpan sebagai KEY i18n (+ vars), bukan teks jadi-jadian, supaya "Riwayat tahap"
    tetap terbaca benar walau bahasa aplikasi diganti setelah entri riwayat itu dibuat - lihat
    renderHistory() di bawah yang menerjemahkannya ulang setiap kali dirender. Pindah tahap juga
    selalu membersihkan flag status khusus (revisionNeeded/directorRejected) karena begitu maju
    tahap, order sudah tidak lagi dalam kondisi itu. */
 _advance(o,nextKey,textKey,vars,dataPatch){
  const completed=[...(o.completed||[])];if(!completed.includes(o.stage))completed.push(o.stage);
  const history=[...(o.history||[]),{at:nowISO(),by:Auth.user?.name||'-',stage:o.stage,key:textKey,vars:vars||null}];
  const patch={stage:nextKey,stageAt:nowISO(),completed,history,revisionNeeded:false,directorRejected:false};
  if(dataPatch)patch.data={...(o.data||{}),...dataPatch};
  DB.update('orders',o.id,patch,'',t(textKey,vars));
  return DB.get('orders',o.id);
 },
 renderHistory(o){
  const rows=(o.history||[]).slice().reverse();
  if(!rows.length)return `<div class="empty">${t('ord.hist.no_history')}</div>`;
  return rows.map(h=>{
   const text=h.key?t(h.key,h.vars):esc(h.text||''); // h.text: entri lama sebelum refactor ini (data historis, dibiarkan apa adanya)
   return `<div style="padding:5px 0;border-bottom:1px solid var(--bd)"><b>${esc(STAGES.find(s=>s.key===h.stage)?.short||h.stage)}</b>: ${text}<br><small class="mut">${esc(h.by)} • ${fdt(h.at)}</small></div>`;
  }).join('');
 },
 create(v){
  return DB.insert('orders',{...v,no:Num.next('ORD'),salesId:Auth.uid(),stage:'sales_input',stageAt:nowISO(),
   completed:[],data:{},cancelled:false,history:[{at:nowISO(),by:Auth.user.name,stage:'sales_input',key:'ord.hist.order_created'}]});
 },
 progressHtml(o){
  const curIdx=STAGE_IDX(o.stage);
  return `<div class="stepper">${STAGES.map((s,i)=>{
   const done=(o.completed||[]).includes(s.key)||i<curIdx;
   const cur=s.key===o.stage;
   return `<div class="st ${done?'done':cur?'cur':''}"><i>${done?'✓':i+1}</i><div>${esc(s.short)}</div></div>`;
  }).join('')}</div>`;
 }
};

/* ---------- Approval: kirim tanpa pelunasan penuh (memerlukan Direktur) ---------- */
Approval.hooks.ship_no_payment={
 approved(a){const o=DB.get('orders',a.refId);if(!o)return;Order._advance(o,'prepare','ord.hist.director_approved')},
 rejected(a){
  const o=DB.get('orders',a.refId);if(!o)return;
  const s=a.steps.find(x=>x.status==='Ditolak');
  DB.update('orders',o.id,{stage:'finance',directorRejected:true,stageAt:nowISO(),
   history:[...(o.history||[]),{at:nowISO(),by:'-',stage:'director',key:'ord.hist.director_rejected',vars:{reason:s?.note||''}}]},s?.note||'',t('ord.hist.director_rejected',{reason:s?.note||''}));
  Notify.user(o.salesId,t('ord.notif.director_rejected',{no:o.no,reason:s?.note||''}),'#/orders/'+o.id);
 }
};

/* ================= FORM & AKSI ================= */
const ORD_CREATE_FIELDS=()=>[
 F.r('customerId','Customer','customers',{req:true}),
 F.t('pic',t('ord.pic_customer'),{req:true}),
 F.t('contact',t('ord.contact'),{t:'phone'}),
 F.s('needType',t('ord.need_type'),['Pembelian','Rental','Spare part','Service','Instalasi'],{req:true}),
 F.t('capacity',t('ord.capacity'),{ph:'mis. 250 kW'}),
 F.t('engine',t('ord.engine'),{ph:'mis. Yuchai'}),
 F.t('alternator',t('ord.alternator')),
 F.t('controller',t('ord.controller')),
 F.ta('location',t('ord.location'),{req:true}),
 F.ta('purpose',t('ord.purpose')),
 {k:'items',l:t('ord.items_needed'),t:'lines',min:1,cols:ORD_ITEM_COLS},
 F.d('targetDelivery',t('ord.target_delivery'),{req:true,def:()=>addDays(today(),14)}),
 F.c('installNeeded',t('ord.install_needed')),
 F.ta('notes',t('common.notes')),
 F.fl('files',t('ord.files_attachment'))
];

ACT['ord-save']=()=>{
 const fields=Order._ctx.fields,{v,err}=Form.collect($('#oform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 if(!v.items||!v.items.length)return UI.toast(t('ord.msg.add_item_required'),'err');
 const r=Order.create(v);
 UI.toast(t('ord.msg.created',{no:r.no}));Router.go('orders/'+r.id);
};
ACT['ord-update']=el=>{
 const o=DB.get('orders',el.dataset.id),fields=Order._ctx.fields,{v,err}=Form.collect($('#oform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 if(!v.items||!v.items.length)return UI.toast(t('ord.msg.add_item_required'),'err');
 DB.update('orders',o.id,v,'',t('ord.msg.changes_saved'));
 UI.toast(t('ord.msg.changes_saved'));Router.render();
};
ACT['ord-submit']=el=>{
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'review','ord.hist.submitted_to_sales_support');
 UI.toast(t('ord.msg.sent_verification'));Router.render();
};
ACT['ord-review-ok']=async el=>{
 const v=await UI.ask({title:t('ord.modal.review_title'),ok:t('ord.modal.review_ok'),fields:[F.ta('notes',t('ord.review_notes'))]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'warehouse','ord.hist.verified_sales_support',null,{review:{result:'Disetujui',notes:v.notes}});
 Router.render();
};
ACT['ord-review-back']=async el=>{
 const r=await UI.confirm({title:t('ord.modal.return_title'),msg:t('ord.modal.return_msg'),reason:true,danger:true});
 if(!r)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'sales_input','ord.hist.returned_for_revision',{reason:r.reason},{review:{result:'Perlu Revisi',notes:r.reason}});
 DB.update('orders',o.id,{revisionNeeded:true},'',t('ord.status.revision_needed'));
 Notify.user(o.salesId,t('ord.notif.returned_for_revision',{no:o.no,reason:r.reason}),'#/orders/'+o.id);
 Router.render();
};
ACT['ord-warehouse']=async el=>{
 const v=await UI.ask({title:t('ord.modal.warehouse_title'),ok:t('ord.modal.warehouse_ok'),fields:[
  F.s('availability',t('ord.stock_availability'),['Tersedia penuh','Stok sebagian tersedia','Tidak tersedia'],{req:true}),
  F.r('location',t('ord.warehouse_location'),'warehouses'),F.s('condition',t('ord.item_condition'),['Baru','Bekas layak','Perlu indent / beli'],{def:'Baru'}),
  F.ta('needBuy',t('ord.need_buy'))]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'finance','ord.hist.warehouse_check_done',null,{warehouse:v});
 Router.render();
};
ACT['ord-mk-quote']=el=>Router.go('quotations/new/'+el.dataset.id);
ACT['ord-finance-advance']=async el=>{
 const o=DB.get('orders',el.dataset.id);
 if(!o.quotationId)return UI.toast(t('ord.msg.create_quotation_first'),'err');
 if(!o.soId)return UI.toast(t('ord.msg.so_not_created'),'err');
 const so=DB.get('salesorders',o.soId);if(!so)return UI.toast(t('ord.msg.so_not_found'),'err');
 if(Inv.orderPaid(o)){Order._advance(o,'prepare','ord.hist.paid_auto_advance');UI.toast(t('ord.msg.proceed_prepare'));Router.render();return}
 if(Approval.forRef('orders',o.id).some(a=>a.type==='ship_no_payment'&&a.status==='Menunggu'))return UI.toast(t('ord.msg.approval_pending_exists'),'err');
 const remaining=so.total-sum(SO.invoices(so).filter(i=>!i.cancelled),i=>Inv.paid(i));
 const r=await UI.ask({title:t('ord.modal.ship_no_payment_title'),ok:t('ord.modal.ship_no_payment_ok'),danger:true,fields:[F.ta('reason',t('ord.reason_label'),{req:true})],
  pre:`<div class="info" style="margin-bottom:10px">${t('ord.modal.remaining_bill')}: <b>${rp(remaining)}</b></div>`});
 if(!r)return;
 Approval.request({type:'ship_no_payment',refCol:'orders',refId:o.id,title:`Pengiriman tanpa pelunasan — ${o.no}`,amount:remaining,reason:r.reason,meta:{forceDirector:true}});
 Order._advance(o,'director','ord.hist.ship_no_payment_requested',null,{finance:{note:r.reason}});
 UI.toast(t('ord.msg.submitted_to_director'));Router.render();
};
ACT['ord-prepare']=async el=>{
 const v=await UI.ask({title:t('ord.modal.prepare_title'),ok:t('ord.modal.prepare_ok'),fields:[
  F.d('schedule',t('ord.ship_date'),{req:true,def:()=>today()}),F.r('vehicleId',t('ord.vehicle'),'vehicles'),F.t('driver',t('ord.driver')),
  F.t('sjNo',t('ord.sj_no')),F.t('doNo',t('ord.do_no')),F.ta('notes',t('ord.prepare_notes'))]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'shipping','ord.hist.goods_prepared_shipped',null,{shipping:v});
 Router.render();
};
ACT['ord-delivered']=async el=>{
 const v=await UI.ask({title:t('ord.modal.delivered_title'),ok:t('ord.modal.delivered_ok'),fields:[
  F.d('receivedDate',t('ord.received_date'),{req:true,def:()=>today()}),F.t('receiver',t('ord.receiver_name'),{req:true}),F.ta('notes',t('common.notes'))]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id),next=o.installNeeded?'install':'handover';
 Order._advance(o,next,'ord.hist.received_by_customer',null,{delivery:v});
 DB.update('orders',o.id,{deliveryReportNo:Num.next('DR')},'','');
 Router.render();
};
ACT['ord-install-plan']=async el=>{
 const v=await UI.ask({title:t('ord.modal.install_plan_title'),ok:t('ord.modal.install_plan_ok'),fields:[
  F.r('technicianId',t('ord.technician'),'users',{filter:u=>u.roleId==='technician',req:true}),F.d('scheduledDate',t('ord.install_date'),{req:true,def:()=>addDays(today(),2)})]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 DB.update('orders',o.id,{data:{...(o.data||{}),install_plan:v}},'','');
 Notify.user(v.technicianId,t('ord.notif.install_scheduled',{no:o.no,date:fdate(v.scheduledDate)}),'#/orders/'+o.id);
 Router.render();
};
ACT['ord-install-done']=async el=>{
 const v=await UI.ask({title:t('ord.modal.install_done_title'),ok:t('ord.modal.install_done_ok'),fields:[F.ta('notes',t('ord.install_result_notes'),{req:true}),F.fl('files',t('ord.install_photos'))]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'handover','ord.hist.install_done',null,{install:{...v,by:Auth.user.name,at:nowISO()}});
 Router.render();
};
ACT['ord-handover']=async el=>{
 const o=DB.get('orders',el.dataset.id);
 // Tanda tangan customer selalu digambar ulang (customer tidak punya akun/tanda tangan tersimpan).
 // Tanda tangan pihak KENTFORD (staff yang menyerahkan) boleh memakai tanda tangan tersimpan di
 // profil user (Auth.user.savedSignature, lihat admin.js Users.fields) sbg isian cepat — dipakai
 // sebagai default canvas (masih bisa digambar ulang / dihapus lewat tombol "Hapus tanda tangan").
 const v=await UI.ask({title:t('ord.modal.handover_title'),ok:t('ord.modal.handover_ok'),
  fields:[F.t('signerName',t('ord.signer_name'),{req:true}),{k:'signature',l:t('ord.customer_signature'),t:'sig'},
   F.t('staffName',t('ord.staff_name'),{req:true,def:()=>Auth.user.name}),
   {k:'staffSignature',l:t('ord.staff_signature')+(Auth.user?.savedSignature?t('ord.staff_signature_saved_hint'):''),t:'sig',def:()=>Auth.user?.savedSignature||''}]});
 if(!v)return;
 if(!v.signature)return UI.toast(t('ord.msg.customer_signature_required'),'err');
 if(!v.staffSignature)return UI.toast(t('ord.msg.staff_signature_required'),'err');
 Order._advance(o,'invoice_final','ord.hist.handover_signed',null,{signature:{data:v.signature,signerName:v.signerName,at:nowISO()},
  staffSignature:{data:v.staffSignature,staffName:v.staffName,at:nowISO()}});
 // Reminder maintenance rutin: begitu unit diserahterimakan ke customer (poin ini yang paling
 // pas menandai "tanggal pembelian" selesai - bukan tanggal order dibuat), otomatis dijadwalkan
 // follow-up 1 bulan pertama dan seterusnya berulang tiap bulan lewat halaman PM yang sudah ada
 // (lihat ENT.pm_schedules/PAGES.pm.render di service.js) - setiap kali staff aftersales klik
 // "Buat Service Request" dari daftar jatuh tempo, lastDate direset ke hari itu sehingga jadwal
 // otomatis maju 30 hari lagi (berulang selama staff terus menindaklanjutinya).
 if(o.needType==='Pembelian'&&!DB.all('pm_schedules').some(p=>p.sourceOrderId===o.id)){
  DB.insert('pm_schedules',{customerId:o.customerId,unitDesc:[o.capacity,o.engine].filter(Boolean).join(' / ')||'Unit pembelian',
   basis:'Tanggal',intervalDays:30,lastDate:today(),lastHour:0,active:true,sourceOrderId:o.id,
   notes:'Follow-up maintenance & feedback pasca pembelian (otomatis dari New Order '+o.no+')'});
 }
 Router.render();
};
ACT['ord-finish']=el=>{
 const o=DB.get('orders',el.dataset.id),so=o.soId&&DB.get('salesorders',o.soId);
 if(so&&!Inv.orderPaid(o))return UI.toast(t('ord.msg.not_paid_off'),'err');
 Order._advance(o,'done','ord.hist.order_done');
 UI.toast(t('ord.msg.order_finished'));Router.render();
};

/* ================= HALAMAN ================= */
PAGES.orders.render=async(v,param)=>{
 if(!param){
  const w=isRole('sales','admin_hr_sales','sales_manager','deputy_director','director');
  v.innerHTML=UI.pghead(t('nav.orders'),w?`<a class="btn" href="#/orders/new">${esc(t('ord.btn.new_order'))}</a>`:'')+'<div class="card" id="ordl"></div>';
  new DT($('#ordl'),{title:t('nav.orders'),size:15,rows:()=>Scope.rows('orders').slice().reverse(),onRow:id=>Router.go('orders/'+id),
   filters:[{k:'s',l:t('ord.filter.status'),opts:()=>[...STAGES.map(s=>s.status),t('ord.status.revision_needed'),t('ord.status.rejected_director'),t('common.cancelled')],get:r=>Order.statusLabel(r)},
    {k:'c',l:t('ord.filter.customer'),opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
   cols:[{k:'no',l:t('ord.col.no')},{k:'c',l:t('ord.col.customer'),text:r=>custName(r.customerId)},{k:'n',l:t('ord.col.need'),text:r=>r.needType},{k:'s',l:t('ord.col.sales'),text:r=>userName(r.salesId)},
    {k:'td',l:t('ord.col.target_delivery'),text:r=>fdate(r.targetDelivery),sortv:r=>r.targetDelivery},
    {k:'st',l:t('ord.col.stage'),text:r=>Order.statusLabel(r),html:r=>UI.badge(Order.statusLabel(r))+(Order.late(r)?' '+UI.badge(t('ord.badge.late')):'')}]});
  return;
 }
 if(param==='new'){
  if(!isRole('sales','admin_hr_sales','sales_manager','deputy_director','director')){v.innerHTML=UI.empty(t('ord.msg.no_right_create'));return}
  const fields=ORD_CREATE_FIELDS();Order._ctx={fields};
  v.innerHTML=UI.pghead(t('ord.h.new_order_title'),`<a class="btn btn-o" href="#/orders">${esc(t('ord.btn.cancel_form'))}</a>`)+
   `<div class="card"><div id="oform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="ord-save">${esc(t('ord.btn.save_new_order'))}</button></div></div>`;
  Form.hydrate($('#oform'),fields,{});
  return;
 }
 const o=DB.get('orders',param);
 if(!o||!Scope.ok('orders',o)){v.innerHTML=UI.empty(t('ord.msg.not_found'));return}
 renderOrderDetail(v,o);
};

function renderOrderDetail(v,o){
 const canAct=Order.canAct(o),q=o.quotationId&&DB.get('quotations',o.quotationId),so=o.soId&&DB.get('salesorders',o.soId);
 const editable=o.stage==='sales_input'&&canAct;
 const fields=ORD_CREATE_FIELDS();
 const acts=[`<a class="btn btn-o" href="#/orders">‹ ${esc(t('common.back'))}</a>`];
 if(!o.cancelled&&o.stage!=='done')acts.push(`<button class="btn btn-d" data-act="cancel-req" data-col="orders" data-id="${o.id}" data-l="New Order">${esc(t('ord.btn.cancel_request'))}</button>`);
 if(editable){acts.push(`<button class="btn btn-o" data-act="ord-update" data-id="${o.id}">${esc(t('ord.btn.save_changes'))}</button>`);acts.push(`<button class="btn" data-act="ord-submit" data-id="${o.id}">${esc(t('ord.btn.send_to_sales_support'))}</button>`)}
 if(o.stage==='review'&&canAct){acts.push(`<button class="btn" data-act="ord-review-ok" data-id="${o.id}">${esc(t('ord.btn.approve_stock_check'))}</button>`);acts.push(`<button class="btn btn-o" data-act="ord-review-back" data-id="${o.id}">${esc(t('ord.btn.return_to_sales'))}</button>`)}
 if(o.stage==='warehouse'&&canAct)acts.push(`<button class="btn" data-act="ord-warehouse" data-id="${o.id}">${esc(t('ord.btn.fill_warehouse_check'))}</button>`);
 if(o.stage==='finance'&&canAct){
  if(!o.quotationId)acts.push(`<button class="btn" data-act="ord-mk-quote" data-id="${o.id}">${esc(t('ord.btn.make_quotation'))}</button>`);
  else acts.push(`<button class="btn" data-act="ord-finance-advance" data-id="${o.id}">${esc(t('ord.btn.check_payment_continue'))}</button>`);
 }
 if(o.stage==='prepare'&&canAct)acts.push(`<button class="btn" data-act="ord-prepare" data-id="${o.id}">${esc(t('ord.btn.schedule_ship'))}</button>`);
 if(o.stage==='shipping'&&canAct)acts.push(`<button class="btn" data-act="ord-delivered" data-id="${o.id}">${esc(t('ord.btn.mark_received'))}</button>`);
 if(o.stage==='install'&&canAct){
  if(!o.data?.install_plan)acts.push(`<button class="btn" data-act="ord-install-plan" data-id="${o.id}">${esc(t('ord.btn.schedule_install'))}</button>`);
  acts.push(`<button class="btn" data-act="ord-install-done" data-id="${o.id}">${esc(t('ord.btn.install_done'))}</button>`);
 }
 if(o.stage==='handover'&&canAct)acts.push(`<button class="btn" data-act="ord-handover" data-id="${o.id}">${esc(t('ord.btn.handover_sign'))}</button>`);
 if(o.stage==='invoice_final'&&canAct)acts.push(`<button class="btn" data-act="ord-finish" data-id="${o.id}">${esc(t('ord.btn.finish_order'))}</button>`);

 const appr=Approval.forRef('orders',o.id);
 const statusLabel=Order.statusLabel(o);
 v.innerHTML=UI.pghead(t('nav.orders')+' '+o.no,acts.join(''))+
  `<div class="card"><div class="ch"><span>${esc(custName(o.customerId))} — ${esc(o.needType||'')}</span>${UI.badge(statusLabel)}</div>${Order.progressHtml(o)}
   ${o.cancelled?`<div class="errbox">${esc(t('ord.errbox.cancelled',{reason:o.cancelReason?t('ord.errbox.cancel_reason',{reason:o.cancelReason}):''}))}</div>`:''}
   ${o.stage==='director'?`<div class="warnbox">${esc(t('ord.errbox.director_wait'))}</div>`:''}
   ${o.directorRejected?`<div class="errbox">${esc(t('ord.errbox.director_rejected'))}</div>`:''}</div>
  <div class="grid split"><div>
   <div class="card"><h3>${esc(t('ord.h.order_data'))}</h3><div id="oform">${Form.render(fields,clone(o),!editable)}</div></div>
   ${q||so?`<div class="card"><h3>${esc(t('ord.h.related_docs'))}</h3>${UI.kv([[t('nav.quotations'),q?docLink('quotations',q):'-'],[t('nav.salesorders'),so?docLink('salesorders',so):'-'],
    [t('ord.related.total_so'),so?rp(so.total):'-'],[t('ord.related.paid'),so?rp(sum(SO.invoices(so).filter(i=>!i.cancelled),i=>Inv.paid(i))):'-']])}</div>`:''}
   ${o.data?.warehouse?`<div class="card"><h3>${esc(t('ord.h.warehouse_result'))}</h3>${UI.kv([[t('ord.stock_availability'),esc(o.data.warehouse.availability||'-')],[t('ord.warehouse_location'),esc(DB.get('warehouses',o.data.warehouse.location)?.name||'-')],[t('ord.item_condition'),esc(o.data.warehouse.condition||'-')],[t('ord.need_buy'),esc(o.data.warehouse.needBuy||'-')]])}</div>`:''}
   ${o.data?.shipping?`<div class="card"><h3>${esc(t('ord.h.shipping'))}</h3>${UI.kv([[t('ord.ship_date'),fdate(o.data.shipping.schedule)],[t('ord.vehicle'),esc(DB.get('vehicles',o.data.shipping.vehicleId)?.plate||'-')],[t('ord.driver'),esc(o.data.shipping.driver||'-')],[t('ord.sj_no'),esc(o.data.shipping.sjNo||'-')],[t('ord.do_no'),esc(o.data.shipping.doNo||'-')]])}</div>`:''}
   ${o.data?.delivery?`<div class="card"><h3>${esc(t('ord.h.received_by_customer'))}</h3>${UI.kv([[t('ord.delivery_report_no'),esc(o.deliveryReportNo||'-')],[t('ord.received_date'),fdate(o.data.delivery.receivedDate)],[t('ord.receiver_name'),esc(o.data.delivery.receiver||'-')],[t('common.notes'),esc(o.data.delivery.notes||'-')]])}</div>`:''}
   ${o.data?.install_plan||o.data?.install?`<div class="card"><h3>${esc(t('ord.h.install_commissioning'))}</h3>${UI.kv([[t('ord.technician'),esc(userName(o.data.install_plan?.technicianId)||'-')],[t('ord.install_date'),o.data.install_plan?fdate(o.data.install_plan.scheduledDate):'-'],[t('ord.install_result_notes'),esc(o.data.install?.notes||t('ord.install_not_done'))]])}</div>`:''}
   ${o.data?.signature?`<div class="card"><h3>${esc(t('ord.h.handover_signature'))}</h3><div style="display:flex;gap:24px;flex-wrap:wrap">
    <div><img src="${o.data.signature.data}" style="max-width:320px;border:1px solid var(--bd)"><div class="mut">${esc(o.data.signature.signerName)} (customer) • ${fdt(o.data.signature.at)}</div></div>
    ${o.data?.staffSignature?`<div><img src="${o.data.staffSignature.data}" style="max-width:320px;border:1px solid var(--bd)"><div class="mut">${esc(o.data.staffSignature.staffName)} (KENTFORD) • ${fdt(o.data.staffSignature.at)}</div></div>`:''}
   </div></div>`:''}
   <div class="card"><h3>${esc(t('ord.h.activity_comments'))}</h3>${UI.activity('orders',o.id)}</div>
  </div><div>
   <div class="card"><h3>${esc(t('ord.h.stage_history'))}</h3>${Order.renderHistory(o)}</div>
   ${appr.length?`<div class="card"><h3>${esc(t('ord.h.approval'))}</h3>${appr.map(a=>`<div><a href="#" data-act="appr-open" data-id="${a.id}">${esc(a.no)}</a> ${UI.badge(apprStatusLabel(a.status))}</div>`).join('')}</div>`:''}
  </div></div>`;
 Form.hydrate($('#oform'),fields,clone(o));
 Order._ctx={fields};
}
