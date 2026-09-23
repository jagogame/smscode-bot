'use strict';
/* =========================================================
   KENTFORD ERP - Quotation, Sales Order, Customer Invoice
   ========================================================= */
const custName=id=>DB.get('customers',id)?.name||'-';
const docLink=(page,r)=>`<a href="#/${page}/${r.id}">${esc(r.no)}</a>`;

/* ================= KUNJUNGAN SITE (sales + teknisi) SEBELUM PENAWARAN ================= */
PAGES.site_visits.render=async(v,param)=>{
 v.innerHTML=UI.pghead(t('nav.site_visits'),can('site_visits','w')?`<button class="btn" data-act="crud-new" data-e="site_visits">${esc(t('visit.new_btn'))}</button>`:'')+
  `<div class="card"><h3>${esc(t('visit.ready_h'))}</h3><div id="visitReady"></div></div>
   <div class="card" id="crudbox"></div>`;
 const ready=Scope.rows('site_visits').filter(r=>r.status==='Selesai'&&!r.quotationId);
 $('#visitReady').innerHTML=ready.length?ready.map(r=>{
  const name=r.customerId?custName(r.customerId):(DB.get('leads',r.leadId)?.company||DB.get('leads',r.leadId)?.name||'-');
  return `<div style="padding:6px 0;border-bottom:1px solid var(--bd)">${esc(name)} — ${fdate(r.visitDate)} (${t('ord.technician')}: ${esc(userName(r.technicianId))})
   ${r.needVendorItems?`<span class="badge b-yellow">${esc(t('visit.check_vendor_price'))}</span> `:''}
   <button class="btn btn-sm" data-act="visit-mk-quote" data-id="${r.id}" style="float:right">${esc(t('visit.make_quote_btn'))}</button></div>`;
 }).join(''):`<div class="empty">${t('visit.none_ready')}</div>`;
 Crud.list($('#crudbox'),'site_visits');
 if(param)Crud.open('site_visits',param);
};
ACT['visit-mk-quote']=el=>{
 const r=DB.get('site_visits',el.dataset.id);
 if(!r.customerId)return UI.toast(t('visit.not_linked_customer'),'err');
 Router.go('quotations/new/visit/'+r.id);
};

/* ================= QUOTATION ================= */
const Quote={
 calc(lines,taxPct){
  let gross=0,disc=0,cost=0,maxDisc=0;
  (lines||[]).forEach(l=>{const g=num(l.qty)*num(l.price);gross+=g;disc+=g*num(l.discPct)/100;cost+=num(l.qty)*num(l.cost);maxDisc=Math.max(maxDisc,num(l.discPct))});
  const dpp=gross-disc,tax=dpp*num(taxPct)/100;
  return {gross,disc,dpp,tax,total:dpp+tax,cost,gp:dpp-cost,gpPct:dpp?(dpp-cost)/dpp*100:0,maxDisc};
 },
 applyCalc(q){const c=this.calc(q.lines,q.taxPct);Object.assign(q,{subtotal:c.gross,discountTotal:c.disc,dpp:c.dpp,tax:c.tax,total:c.total,costTotal:c.cost,gp:c.gp,gpPct:c.gpPct,maxDisc:c.maxDisc});return q},
 status(q){return q.status},
 expire(){
  DB.all('quotations').filter(q=>['Disetujui','Dikirim'].includes(q.status)&&q.validUntil&&q.validUntil<today()).forEach(q=>DB.update('quotations',q.id,{status:'Kedaluwarsa'},t('quot.reason_expired'),t('quot.action_auto_expired')));
 },
 fields(ro){
  const cols=[{k:'productId',l:t('common.product'),t:'ref',ref:'products',w:'190px'},{k:'desc',l:t('quot.desc_spec'),t:'text',w:'210px'},{k:'qty',l:t('common.qty'),t:'number',w:'70px'},
   {k:'cost',l:t('quot.buy_price_rp'),t:'number',cost:true,w:'120px'},{k:'price',l:t('quot.sell_price_rp'),t:'number',w:'130px'},{k:'discPct',l:t('quot.disc_pct'),t:'number',w:'80px'}];
  return [F.r('customerId',t('common.customer'),'customers',{req:true}),F.t('picName',t('quot.pic_customer')),
   F.r('salesId',t('quot.sales_pic'),'users',{filter:salesUsers,req:true,ro:isRole('sales'),def:()=>Auth.uid()}),
   F.d('date',t('common.date'),{req:true,def:()=>today()}),F.d('validUntil',t('quot.valid_until'),{req:true,def:()=>addDays(today(),S().quoteValidDays||14)}),F.pc('taxPct',t('quot.tax_pct'),{def:()=>S().defaultTaxPct??11}),
   F.s('paymentTerms',t('common.payment_terms'),()=>DB.all('payterms').map(p=>p.name)),F.t('leadTime',t('quot.lead_time'),{ph:t('quot.lead_time_ph')}),
   F.s('deliveryTerms',t('common.delivery_terms'),()=>DB.all('deliveryterms').map(p=>p.name)),F.t('warranty',t('common.warranty'),{ph:t('quot.warranty_ph')}),
   {k:'lines',l:t('quot.products_prices'),t:'lines',cols,calc:'quote',min:1},F.ta('notes',t('common.notes'))];
 },
 totalsHtml(c){
  const low=c.gpPct<num(S().minMarginPct),bigDisc=c.maxDisc>num(S().maxDiscPct);
  return `<dl class="kv"><dt>${t('common.subtotal')}</dt><dd>${rp(c.gross)}</dd><dt>${t('common.discount')}</dt><dd>${rp(c.disc)}</dd><dt>${t('common.dpp')}</dt><dd>${rp(c.dpp)}</dd><dt>${t('common.ppn')}</dt><dd>${rp(c.tax)}</dd><dt><b>${t('common.total')}</b></dt><dd><b>${rp(c.total)}</b></dd>
   ${seeCost()?`<dt>${t('quot.buy_price')}</dt><dd>${rp(c.cost)}</dd><dt>${t('common.gross_profit')}</dt><dd>${rp(c.gp)}</dd><dt>${t('common.margin')}</dt><dd>${pct(c.gpPct)} ${low?UI.badge(t('quot.badge_below_threshold')):''}</dd>`:''}</dl>
   ${bigDisc?`<div class="warnbox" style="margin-top:8px">${t('quot.warn_disc_exceeds',{disc:pct(c.maxDisc),max:pct(S().maxDiscPct)})}</div>`:''}
   ${!seeCost()&&low?`<div class="warnbox" style="margin-top:8px">${t('quot.warn_margin_below')}</div>`:''}`;
 },
 recalc(){
  const root=$('#qform');if(!root)return;
  const lines=Lines.collect($('[data-lines="lines"]',root)),tax=parseFloat($('[name="taxPct"]',root)?.value)||0;
  $('#qtot').innerHTML=this.totalsHtml(this.calc(lines,tax));
 },
 async save(rec,submit,fields){
  const root=$('#qform'),{v,err}=Form.collect(root,fields);
  if(err.length)return UI.toast(err[0],'err');
  if(!v.lines.length)return UI.toast(t('quot.err_min_one_product'),'err');
  for(const l of v.lines){if(!(num(l.qty)>0))return UI.toast(t('quot.err_qty_positive'),'err');if(num(l.price)<0||num(l.discPct)<0||num(l.discPct)>100)return UI.toast(t('quot.err_price_disc_invalid'),'err')}
  if(v.validUntil<v.date)return UI.toast(t('quot.err_valid_after_date'),'err');
  if(isRole('sales'))v.salesId=Auth.uid();
  v.lines=v.lines.map(l=>({...l,cost:num(l.cost)}));
  const q=rec?{...rec,...v}:{...v};this.applyCalc(q);
  const data={customerId:q.customerId,picName:q.picName,salesId:q.salesId,date:q.date,validUntil:q.validUntil,taxPct:q.taxPct,paymentTerms:q.paymentTerms,leadTime:q.leadTime,deliveryTerms:q.deliveryTerms,warranty:q.warranty,notes:q.notes,lines:q.lines,
   subtotal:q.subtotal,discountTotal:q.discountTotal,dpp:q.dpp,tax:q.tax,total:q.total,costTotal:q.costTotal,gp:q.gp,gpPct:q.gpPct,maxDisc:q.maxDisc};
  let r=rec;
  if(!rec){
   const no=Num.next('QUO');
   r=DB.insert('quotations',{...data,no,baseNo:no,rev:0,status:'Draft',orderId:Quote.pre?.orderId||'',visitId:Quote.pre?.visitId||''});
   if(Quote.pre?.visitId)DB.update('site_visits',Quote.pre.visitId,{quotationId:r.id},'','Quotation dibuat');
   Quote.pre=null;
  }
  else DB.update('quotations',rec.id,data,'',t('quot.action_update'));
  if(!submit){UI.toast(t('common.draft_saved'));Router.go('quotations/'+r.id);return}
  const need=r.gpPct<num(S().minMarginPct)||r.maxDisc>num(S().maxDiscPct);
  if(need){
   DB.update('quotations',r.id,{status:'Menunggu Approval'},t('common.action_submitted_reason'),t('common.action_request_approval'));
   Approval.request({type:'quotation',refCol:'quotations',refId:r.id,title:`Quotation ${r.no} — ${custName(r.customerId)}`,amount:r.total,
    reason:t('quot.approval_reason',{margin:pct(r.gpPct),marginLimit:pct(S().minMarginPct),disc:pct(r.maxDisc),discLimit:pct(S().maxDiscPct)}),meta:{forceDirector:r.gpPct<num(S().lowMarginDirectorPct)}});
   UI.toast(t('quot.submitted_for_approval'));
  }else{DB.update('quotations',r.id,{status:'Disetujui',approvedAt:nowISO()},t('quot.reason_auto_approve'),t('common.auto_approved_action'));UI.toast(t('quot.auto_approved'))}
  Router.go('quotations/'+r.id);
 },
 print(q){
  const c=DB.get('customers',q.customerId)||{};
  Print.html(Print.header('QUOTATION',q.no)+`<table style="margin-bottom:10px"><tr><td width="50%"><b>Kepada:</b><br>${esc(c.name)}<br>${esc(c.address||'')}<br>u.p. ${esc(q.picName||c.pic||'')}</td><td><b>Tanggal:</b> ${fdate(q.date)}<br><b>Berlaku s/d:</b> ${fdate(q.validUntil)}<br><b>Sales:</b> ${esc(userName(q.salesId))}</td></tr></table>
   <table><tr><th>No</th><th>Deskripsi</th><th>Qty</th><th class="right">Harga</th><th class="right">Diskon</th><th class="right">Jumlah</th></tr>
   ${q.lines.map((l,i)=>{const g=num(l.qty)*num(l.price),d=g*num(l.discPct)/100;return `<tr><td>${i+1}</td><td>${esc(l.desc||DB.get('products',l.productId)?.name||'')}</td><td>${nf(l.qty)}</td><td class="right">${rp(l.price)}</td><td class="right">${num(l.discPct)?pct(l.discPct):'-'}</td><td class="right">${rp(g-d)}</td></tr>`}).join('')}
   <tr><td colspan="5" class="right">DPP</td><td class="right">${rp(q.dpp)}</td></tr><tr><td colspan="5" class="right">PPN ${pct(q.taxPct)}</td><td class="right">${rp(q.tax)}</td></tr><tr><td colspan="5" class="right"><b>TOTAL</b></td><td class="right"><b>${rp(q.total)}</b></td></tr></table>
   <p><b>Syarat & ketentuan</b><br>Payment terms: ${esc(q.paymentTerms||'-')}<br>Lead time: ${esc(q.leadTime||'-')}<br>Delivery terms: ${esc(q.deliveryTerms||'-')}<br>Warranty: ${esc(q.warranty||'-')}<br>Catatan: ${esc(q.notes||'-')}</p>
   <table style="margin-top:30px;border:0"><tr><td style="border:0" width="60%"></td><td style="border:0" class="center">Hormat kami,<br><br><br><br>${esc(userName(q.salesId))}</td></tr></table>`);
 }
};
Approval.hooks.quotation={
 approved(a){DB.update('quotations',a.refId,{status:'Disetujui',approvedAt:nowISO()},t('quot.reason_approval_approved'),t('quot.action_approved'));const q=DB.get('quotations',a.refId);Notify.user(q.salesId,t('quot.notify_approved',{no:q.no}),'#/quotations/'+q.id)},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('quotations',a.refId,{status:'Ditolak',rejectReason:s?.note||''},s?.note||'',t('quot.action_rejected'));const q=DB.get('quotations',a.refId);Notify.user(q.salesId,t('quot.notify_rejected',{no:q.no,note:s?.note||''}),'#/quotations/'+q.id)}
};
CHANGE.qcust={match:t=>t.name==='customerId'&&t.closest('#qform'),run:t=>{const c=DB.get('customers',t.value),p=$('[name="picName"]',$('#qform'));if(c&&p&&!p.value)p.value=c.pic||''}};
CHANGE.qtax={match:t=>t.name==='taxPct'&&t.closest('#qform'),run:()=>Quote.recalc()};
CALC.quote=()=>Quote.recalc();

PAGES.quotations.render=async(v,param)=>{
 if(!param){
  const w=can('quotations','w');
  v.innerHTML=UI.pghead(t('nav.quotations'),w?`<a class="btn" href="#/quotations/new">+ ${t('quot.new')}</a>`:'')+'<div class="card" id="ql"></div>';
  new DT($('#ql'),{title:t('nav.quotations'),size:15,rows:()=>Scope.rows('quotations').slice().reverse(),onRow:id=>Router.go('quotations/'+id),
   filters:[{k:'s',l:t('common.status'),opts:stOpt(['Draft','Menunggu Approval','Disetujui','Dikirim','Direvisi','Diterima','Ditolak','Kedaluwarsa']),get:r=>r.status},{k:'c',l:t('common.customer'),opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
   cols:[{k:'no',l:t('common.no_dot')},{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'s',l:t('common.sales'),text:r=>userName(r.salesId)},
    {k:'total',l:t('common.total'),num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'gp',l:t('common.margin'),num:true,hide:()=>!seeCost(),text:r=>pct(r.gpPct),sortv:r=>r.gpPct},
    {k:'valid',l:t('quot.valid_until'),text:r=>fdate(r.validUntil),sortv:r=>r.validUntil},{k:'st',l:t('common.status'),text:r=>stLabel(r.status),html:r=>UI.badge(stLabel(r.status))+(r.rev?` <small class="mut">R${r.rev}</small>`:'')}]});
  return;
 }
 const isNew=param==='new'||param.startsWith('new/');
 let rec=isNew?null:DB.get('quotations',param);
 if(!isNew&&(!rec||!Scope.ok('quotations',rec))){v.innerHTML=UI.empty(t('quot.not_found'));return}
 if(isNew){
  if(!can('quotations','w')){v.innerHTML=UI.empty(t('quot.no_right_create'));return}
  const parts=param.split('/');
  if(parts[1]==='visit'){
   const visit=DB.get('site_visits',parts[2]);
   Quote.pre=visit?{visitId:visit.id}:null;
   rec=visit?{customerId:visit.customerId,salesId:visit.salesId,
    notes:'Berdasarkan kunjungan site '+fdate(visit.visitDate)+(visit.recommendation?(': '+visit.recommendation):'')+(visit.needVendorItems?' — CATATAN: cek harga vendor dulu (Purchasing > Price Comparison) sebelum kirim penawaran.':'')}:null;
  }else{
   const oid=parts[1],o=oid&&DB.get('orders',oid);
   Quote.pre=o?{orderId:o.id}:null;
   rec=o?{customerId:o.customerId,picName:o.pic,salesId:o.salesId,lines:o.items.map(i=>{const p=DB.get('products',i.productId);return {productId:i.productId,desc:i.desc||p?.name||'',qty:i.qty,cost:p?.lastCost||0,price:p?.price||0,discPct:0}}),notes:o.notes?('Ref. '+o.no):''}:null;
  }
 }
 const editable=isNew||(rec.status==='Draft'&&can('quotations','w'));
 const fields=Quote.fields(!editable);
 const st=rec&&rec.id?stLabel(rec.status):t('quot.new');
 const acts=[];
 if(rec&&rec.id){
  acts.push(`<button class="btn btn-o" data-act="q-print" data-id="${rec.id}">${t('common.print_pdf')}</button>`);
  if(can('quotations','w')&&Scope.ok('quotations',rec)){
   if(['Disetujui','Dikirim','Diterima','Ditolak','Kedaluwarsa'].includes(rec.status))acts.push(`<button class="btn btn-o" data-act="q-revise" data-id="${rec.id}">${t('quot.make_revision')}</button>`);
   if(['Disetujui'].includes(rec.status))acts.push(`<button class="btn" data-act="q-sent" data-id="${rec.id}">${t('quot.mark_sent')}</button>`);
   if(rec.status==='Dikirim')acts.push(`<button class="btn btn-d" data-act="q-lost" data-id="${rec.id}">${t('quot.rejected_by_customer')}</button><button class="btn" data-act="q-won" data-id="${rec.id}">${t('quot.accepted_by_customer')}</button>`);
  }
  if(can('salesorders','w')&&['Disetujui','Dikirim','Diterima'].includes(rec.status)&&!DB.all('salesorders').some(s=>s.quotationId===rec.id&&s.status!=='Dibatalkan'))acts.push(`<button class="btn" data-act="q-so" data-id="${rec.id}">${t('quot.make_so')}</button>`);
 }
 const vals=rec?clone(rec):{};
 const revs=rec&&rec.baseNo?DB.all('quotations').filter(q=>q.baseNo===rec.baseNo).sort((a,b)=>a.rev-b.rev):[];
 const appr=rec&&rec.id?Approval.forRef('quotations',rec.id):[];
 v.innerHTML=UI.pghead((rec&&rec.no)?`${t('nav.quotations')} ${rec.no}`:t('quot.new'),`<a class="btn btn-o" href="#/quotations">‹ ${t('common.back')}</a>${acts.join('')}`)+
  `<div class="grid split"><div><div class="card"><div class="ch"><span>${t('quot.data_title')}</span>${UI.badge(st)}</div>
   ${rec&&rec.status==='Ditolak'&&rec.rejectReason?`<div class="errbox">${t('quot.rejected_prefix')}: ${esc(rec.rejectReason)}</div>`:''}
   <div id="qform">${Form.render(fields,vals,!editable)}</div>
   ${editable?`<div class="acts" style="margin-top:12px"><button class="btn btn-o" data-act="q-save" data-id="${rec?.id||''}">${t('common.save_draft')}</button><button class="btn" data-act="q-submit" data-id="${rec?.id||''}">${t('common.save_submit')}</button></div>`:''}</div></div>
   <div><div class="card"><h3>${t('quot.value_summary')}</h3><div id="qtot"></div></div>
   ${revs.length>1?`<div class="card"><h3>${t('quot.revisions')}</h3>${revs.map(r=>`<div><a href="#/quotations/${r.id}">${esc(r.no)}</a> — ${UI.badge(stLabel(r.status))}</div>`).join('')}</div>`:''}
   ${appr.length?`<div class="card"><h3>${t('common.approval')}</h3>${appr.map(a=>`<div><a href="#" data-act="appr-open" data-id="${a.id}">${esc(a.no)}</a> ${UI.badge(apprStatusLabel(a.status))}</div>`).join('')}</div>`:''}
   ${rec&&rec.id?`<div class="card"><h3>${t('common.activity_comments')}</h3>${UI.activity('quotations',rec.id)}</div>`:''}</div></div>`;
 Form.hydrate($('#qform'),fields,vals);
 Quote.recalc();
 Quote._ctx={rec,fields};
};
ACT['appr-open']=el=>Appr.open(el.dataset.id);
ACT['q-save']=()=>Quote.save(Quote._ctx.rec&&Quote._ctx.rec.id?Quote._ctx.rec:null,false,Quote._ctx.fields);
ACT['q-submit']=()=>Quote.save(Quote._ctx.rec&&Quote._ctx.rec.id?Quote._ctx.rec:null,true,Quote._ctx.fields);
ACT['q-print']=el=>Quote.print(DB.get('quotations',el.dataset.id));
ACT['q-sent']=el=>{DB.update('quotations',el.dataset.id,{status:'Dikirim',sentAt:nowISO()},t('quot.reason_sent'),t('quot.action_sent'));UI.toast(t('quot.status_sent_toast'));Router.render()};
ACT['q-won']=el=>{DB.update('quotations',el.dataset.id,{status:'Diterima'},t('quot.reason_won'),t('quot.action_won'));UI.toast(t('quot.toast_won'));Router.render()};
ACT['q-lost']=async el=>{const r=await UI.confirm({title:t('quot.rejected_by_customer'),msg:t('quot.lost_confirm_msg'),reason:true,danger:true});if(!r)return;DB.update('quotations',el.dataset.id,{status:'Ditolak',rejectReason:t('quot.customer_prefix')+r.reason},r.reason,t('quot.action_lost'));Router.render()};
ACT['q-revise']=async el=>{
 const q=DB.get('quotations',el.dataset.id);
 const r=await UI.confirm({title:t('quot.make_revision'),msg:t('quot.revise_confirm_msg',{no:esc(q.no)}),reason:true});if(!r)return;
 const rev=q.rev+1,{id,createdAt,createdBy,updatedAt,updatedBy,approvedAt,sentAt,rejectReason,...rest}=q;
 const n=DB.insert('quotations',{...rest,no:`${q.baseNo}-R${rev}`,rev,status:'Draft',validUntil:addDays(today(),S().quoteValidDays||14),date:today()},r.reason);
 DB.update('quotations',q.id,{status:'Direvisi'},r.reason,t('quot.action_revised'));
 UI.toast(t('quot.revision_created'));Router.go('quotations/'+n.id);
};
ACT['q-so']=async el=>{const so=SO.fromQuote(DB.get('quotations',el.dataset.id));UI.toast(t('quot.so_created',{no:so.no}));Router.go('salesorders/'+so.id)};

/* ================= SALES ORDER ================= */
const SO={
 fromQuote(q){
  if(!['Disetujui','Dikirim','Diterima'].includes(q.status))throw new Error(t('so.err_quote_status'));
  if(DB.all('salesorders').some(s=>s.quotationId===q.id&&s.status!=='Dibatalkan'))throw new Error(t('so.err_already_exists'));
  const so=DB.insert('salesorders',{no:Num.next('SO'),quotationId:q.id,orderId:q.orderId||'',customerId:q.customerId,salesId:q.salesId,date:today(),lines:clone(q.lines),taxPct:q.taxPct,
   subtotal:q.subtotal,discountTotal:q.discountTotal,dpp:q.dpp,tax:q.tax,total:q.total,costTotal:q.costTotal,gp:q.gp,gpPct:q.gpPct,paymentTerms:q.paymentTerms,deliveryTerms:q.deliveryTerms,status:'Baru'});
  if(['Disetujui','Dikirim'].includes(q.status))DB.update('quotations',q.id,{status:'Diterima'},t('so.reason_created',{no:so.no}),t('so.action_accepted'));
  if(q.orderId){const o=DB.get('orders',q.orderId);if(o)DB.update('orders',o.id,{soId:so.id,quotationId:q.id},'',t('so.action_link'))}
  SO.deductStock(so);
  return so;
 },
 invoices(so){return DB.all('invoices').filter(i=>i.soId===so.id&&!i.cancelled)},
 // Sales Order = pesanan pasti (bukan penawaran) → stok langsung dikurangi. Quotation tidak menyentuh stok sama sekali.
 // Nonaktif sampai S().stockAutoDeductEnabled diaktifkan lewat Settings — sengaja ditunda sampai
 // migrasi data lama + penyesuaian stok fisik oleh tim gudang selesai, supaya tidak mengurangi
 // stok berdasarkan saldo yang belum diverifikasi.
 deductStock(so){
  if(!S().stockAutoDeductEnabled)return;
  (so.lines||[]).forEach(l=>{
   const p=l.productId&&DB.get('products',l.productId);
   if(!p||['Aset rental','Jasa'].includes(p.kind)||!num(l.qty))return;
   Stock.move(p.id,'w_ho',-num(l.qty),'Keluar - Sales Order',so.no,t('so.action_created',{no:so.no}));
  });
 },
 restockCancelled(so){
  if(!S().stockAutoDeductEnabled)return;
  (so.lines||[]).forEach(l=>{
   const p=l.productId&&DB.get('products',l.productId);
   if(!p||['Aset rental','Jasa'].includes(p.kind)||!num(l.qty))return;
   Stock.move(p.id,'w_ho',num(l.qty),'Masuk - Pembatalan SO',so.no,t('so.action_cancelled'));
  });
 }
};
Approval.hooks.cancellation={
 approved(a){
  if(a.refCol==='salesorders'){DB.update('salesorders',a.refId,{status:'Dibatalkan',cancelReason:a.reason},a.reason,t('so.action_cancelled'));const so=DB.get('salesorders',a.refId);if(so)SO.restockCancelled(so)}
  if(a.refCol==='invoices'){DB.update('invoices',a.refId,{cancelled:true,cancelReason:a.reason},a.reason,t('so.action_cancelled'))}
  if(a.refCol==='orders'){DB.update('orders',a.refId,{cancelled:true,statusText:'Dibatalkan',cancelReason:a.reason},a.reason,t('so.action_cancelled'))}
 },
 rejected(){}
};
async function requestCancel(col,id,label){
 const r=await UI.ask({title:t('common.request_cancellation'),ok:t('common.request_cancellation'),danger:true,fields:[F.ta('reason',t('common.cancellation_reason'),{req:true}),F.fl('files',t('common.attachment'))]});
 if(!r)return;
 if(Approval.forRef(col,id).some(a=>a.type==='cancellation'&&a.status==='Menunggu'))return UI.toast(t('common.cancellation_already_pending'),'err');
 const rec=DB.get(col,id);
 Approval.request({type:'cancellation',refCol:col,refId:id,title:t('common.cancellation_title',{label,no:rec.no}),amount:rec.total||0,reason:r.reason,files:r.files});
 UI.toast(t('common.cancellation_submitted'));Router.render();
}
ACT['cancel-req']=el=>requestCancel(el.dataset.col,el.dataset.id,el.dataset.l);

PAGES.salesorders.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead(t('nav.salesorders'))+'<div class="card" id="sl"></div>';
  new DT($('#sl'),{title:t('nav.salesorders'),rows:()=>Scope.rows('salesorders').slice().reverse(),onRow:id=>Router.go('salesorders/'+id),
   filters:[{k:'s',l:t('common.status'),opts:stOpt(['Baru','Diproses','Dikirim','Selesai','Dibatalkan']),get:r=>r.status},{k:'c',l:t('common.customer'),opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
   cols:[{k:'no',l:t('so.no_so')},{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'s',l:t('common.sales'),text:r=>userName(r.salesId)},
    {k:'total',l:t('common.total'),num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'gp',l:t('common.margin'),num:true,hide:()=>!seeCost(),text:r=>pct(r.gpPct),sortv:r=>r.gpPct},{k:'st',l:t('common.status'),text:r=>stLabel(r.status),html:r=>UI.badge(stLabel(r.status))}]});
  return;
 }
 const so=DB.get('salesorders',param);
 if(!so||!Scope.ok('salesorders',so)){v.innerHTML=UI.empty(t('so.not_found'));return}
 const invs=DB.all('invoices').filter(i=>i.soId===so.id),q=DB.get('quotations',so.quotationId),o=DB.get('orders',so.orderId);
 const active=invs.filter(i=>!i.cancelled),remaining=so.dpp-sum(active,i=>i.dpp);
 const acts=[`<a class="btn btn-o" href="#/salesorders">‹ ${t('common.back')}</a>`];
 if(can('invoices','w')&&so.status!=='Dibatalkan'&&remaining>0.5)acts.push(`<button class="btn" data-act="inv-new" data-so="${so.id}">${t('so.make_invoice')}</button>`);
 if(can('salesorders','w')&&!['Dibatalkan','Selesai'].includes(so.status))acts.push(`<button class="btn btn-d" data-act="cancel-req" data-col="salesorders" data-id="${so.id}" data-l="${t('nav.salesorders')}">${t('common.request_cancellation')}</button>`);
 v.innerHTML=UI.pghead(t('nav.salesorders')+' '+so.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>${t('so.order_info')}</span>${UI.badge(stLabel(so.status))}</div>${UI.kv([[t('common.customer'),esc(custName(so.customerId))],[t('common.sales'),esc(userName(so.salesId))],[t('common.date'),fdate(so.date)],[t('nav.quotations'),q?docLink('quotations',q):'-'],[t('nav.orders'),o?docLink('orders',o):'-'],[t('common.payment_terms'),esc(so.paymentTerms||'-')],[t('common.delivery_terms'),esc(so.deliveryTerms||'-')]])}</div>
  <div class="card"><h3>${t('so.items')}</h3><div class="tblw"><table><tr><th>${t('common.product')}</th><th class="num">${t('common.qty')}</th><th class="num">${t('common.price')}</th><th class="num">${t('common.discount')}</th><th class="num">${t('common.amount')}</th></tr>${so.lines.map(l=>{const g=num(l.qty)*num(l.price);return `<tr><td>${esc(l.desc||DB.get('products',l.productId)?.name||'')}</td><td class="num">${nf(l.qty)}</td><td class="num">${rp(l.price)}</td><td class="num">${num(l.discPct)?pct(l.discPct):'-'}</td><td class="num">${rp(g-g*num(l.discPct)/100)}</td></tr>`}).join('')}</table></div></div>
  <div class="card"><h3>${t('nav.invoices')}</h3>${invs.length?`<div class="tblw"><table><tr><th>${t('common.no_dot')}</th><th>${t('common.type')}</th><th>${t('inv.due_date')}</th><th class="num">${t('common.total')}</th><th class="num">${t('inv.paid')}</th><th>${t('common.status')}</th></tr>${invs.map(i=>`<tr><td>${docLink('invoices',i)}</td><td>${esc(stLabel(i.type))}</td><td>${fdate(i.dueDate)}</td><td class="num">${rp(i.total)}</td><td class="num">${rp(Inv.paid(i))}</td><td>${UI.badge(stLabel(Inv.status(i)))}</td></tr>`).join('')}</table></div>`:`<div class="empty">${t('inv.none_yet')}</div>`}</div></div>
  <div><div class="card"><h3>${t('common.value')}</h3><dl class="kv"><dt>${t('common.dpp')}</dt><dd>${rp(so.dpp)}</dd><dt>${t('common.ppn')}</dt><dd>${rp(so.tax)}</dd><dt><b>${t('common.total')}</b></dt><dd><b>${rp(so.total)}</b></dd><dt>${t('so.billed')}</dt><dd>${rp(sum(active,i=>i.total))}</dd><dt>${t('inv.paid')}</dt><dd>${rp(sum(active,i=>Inv.paid(i)))}</dd>
   ${seeCost()?`<dt>${t('quot.buy_price')}</dt><dd>${rp(so.costTotal)}</dd><dt>${t('common.gross_profit')}</dt><dd>${rp(so.gp)} (${pct(so.gpPct)})</dd>`:''}</dl></div>
  <div class="card"><h3>${t('common.activity_comments')}</h3>${UI.activity('salesorders',so.id)}</div></div></div>`;
};

/* ================= SALES LIST (Sales Order + status invoice/piutang gabungan) ================= */
PAGES.sales_list.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.sales_list'))+'<div class="card" id="sll"></div>';
 new DT($('#sll'),{title:t('nav.sales_list'),rows:()=>Scope.rows('salesorders').slice().reverse(),onRow:id=>Router.go('salesorders/'+id),
  filters:[{k:'s',l:t('common.status'),opts:stOpt(['Baru','Diproses','Dikirim','Selesai','Dibatalkan']),get:r=>r.status},{k:'c',l:t('common.customer'),opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
  cols:[{k:'date',l:t('sl.col_date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'no',l:t('sl.col_no')},{k:'c',l:t('sl.col_customer'),text:r=>custName(r.customerId)},
   {k:'total',l:t('sl.col_total'),num:true,text:r=>rp(r.total),sortv:r=>r.total},
   {k:'ist',l:t('sl.col_invoice_status'),sort:false,html:r=>{
    const invs=DB.all('invoices').filter(i=>i.soId===r.id&&!i.cancelled);
    if(!invs.length)return `<span class="mut">${t('sl.no_invoice_yet')}</span>`;
    const paid=sum(invs,i=>Inv.paid(i)),total=sum(invs,i=>i.total);
    return UI.badge(paid>=total-0.5?stLabel('Lunas'):rp(paid)+' / '+rp(total));
   }},
   {k:'st',l:t('common.status'),text:r=>stLabel(r.status),html:r=>UI.badge(stLabel(r.status))},
   {k:'act',l:'',sort:false,html:r=>{
    const invs=DB.all('invoices').filter(i=>i.soId===r.id&&!i.cancelled),first=invs[0];
    const remaining=r.dpp-sum(invs,i=>i.dpp);
    return (first?`<button class="btn btn-o btn-sm" data-act="inv-print" data-id="${first.id}">${t('common.print_pdf')}</button> `:'')+
     (r.status!=='Dibatalkan'&&remaining>0.5&&can('invoices','w')?`<button class="btn btn-sm" data-act="inv-new" data-so="${r.id}">${t('so.make_invoice')}</button>`:'');
   }}]});
};

/* ================= CUSTOMER INVOICE ================= */
const Inv={
 paid(i){return sum(i.payments||[],p=>p.amount)},
 outstanding(i){return i.cancelled?0:Math.max(0,num(i.total)-this.paid(i))},
 status(i){
  if(i.cancelled)return 'Dibatalkan';
  const paid=this.paid(i);
  if(paid>=num(i.total)-0.5)return 'Lunas';
  if(i.dueDate<today())return 'Terlambat';
  if(i.dueDate===today())return 'Jatuh tempo';
  if(paid>0)return i.type==='DP'?'DP diterima':'Dibayar sebagian';
  return 'Belum dibayar';
 },
 aging(i){
  if(this.outstanding(i)<=0)return '-';
  const d=daysBetween(i.dueDate,today());
  return d<=0?'Belum jatuh tempo':d<=30?'1–30 hari':d<=60?'31–60 hari':d<=90?'61–90 hari':'> 90 hari';
 },
 /* order dianggap sudah membayar jika seluruh nilai SO (termasuk PPN) telah dibayar */
 orderPaid(order){
  const so=DB.get('salesorders',order.soId);if(!so)return false;
  const invs=DB.all('invoices').filter(i=>i.soId===so.id&&!i.cancelled);
  return sum(invs,i=>this.paid(i))>=num(so.total)-0.5&&invs.length>0;
 },
 create(so,{type,pct:p,date,terms,note}){
  const active=DB.all('invoices').filter(i=>i.soId===so.id&&!i.cancelled),used=sum(active,i=>i.dpp);
  let dpp=type==='DP'?so.dpp*num(p)/100:type==='Pelunasan'?so.dpp-used:so.dpp;
  if(type==='Penuh'&&used>0)throw new Error(t('inv.err_full_only_if_none'));
  if(dpp<=0.5||dpp>so.dpp-used+0.5)throw new Error(t('inv.err_exceeds_remaining',{amt:rp(so.dpp-used)}));
  const tax=dpp*num(so.taxPct)/100;
  const inv=DB.insert('invoices',{no:Num.next('INV'),soId:so.id,orderId:so.orderId||'',customerId:so.customerId,salesId:so.salesId,type,date,dueDate:addDays(date,num(terms)),
   dpp,taxPct:so.taxPct,tax,total:dpp+tax,desc:note||(type==='DP'?`Down payment ${pct(p)}`:type==='Pelunasan'?t('inv.type_settlement'):t('inv.type_full'))+' — '+so.no,payments:[],cancelled:false});
  if(so.status==='Baru')DB.update('salesorders',so.id,{status:'Diproses'},t('so.reason_invoice_created'),t('so.action_processed'));
  return inv;
 }
};
ACT['inv-new']=async el=>{
 const so=DB.get('salesorders',el.dataset.so),used=sum(DB.all('invoices').filter(i=>i.soId===so.id&&!i.cancelled),i=>i.dpp);
 const cust=DB.get('customers',so.customerId),pt=DB.get('payterms',cust?.paymentTermId);
 const v=await UI.ask({title:t('so.make_invoice')+' — '+so.no,ok:t('so.make_invoice'),fields:[
  F.s('type',t('inv.type'),['DP','Pelunasan','Penuh'],{req:true,def:used>0?'Pelunasan':(pt&&pt.dpPct?'DP':'Penuh')}),F.pc('pct',t('inv.dp_pct'),{def:pt?.dpPct||30}),
  F.d('date',t('inv.invoice_date'),{req:true,def:today()}),F.n('terms',t('inv.due_days'),{req:true,def:pt?.days||0}),F.ta('note',t('inv.note_optional'))],
  pre:`<div class="info" style="margin-bottom:10px">${t('inv.pre_so_summary',{total:rp(so.dpp),used:rp(used),remaining:rp(so.dpp-used)})}</div>`});
 if(!v)return;
 if(v.type==='DP'&&!(num(v.pct)>0&&num(v.pct)<=100))return UI.toast(t('inv.err_dp_pct_invalid'),'err');
 const i=Inv.create(so,v);UI.toast(t('inv.created',{no:i.no}));
 if(so.orderId)Order.touch(so.orderId);
 Router.render();
};

PAGES.invoices.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead(t('nav.invoices'))+'<div class="card" id="il"></div>';
  new DT($('#il'),{title:t('nav.invoices'),rows:()=>Scope.rows('invoices').slice().reverse(),onRow:id=>Router.go('invoices/'+id),
   filters:[{k:'s',l:t('common.status'),opts:stOpt(['Belum dibayar','DP diterima','Dibayar sebagian','Lunas','Jatuh tempo','Terlambat','Dibatalkan']),get:r=>Inv.status(r)},{k:'c',l:t('common.customer'),opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
   cols:[{k:'no',l:t('inv.no_invoice')},{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'type',l:t('common.type')},{k:'due',l:t('inv.due_date'),text:r=>fdate(r.dueDate),sortv:r=>r.dueDate},
    {k:'total',l:t('common.total'),num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'paid',l:t('inv.paid'),num:true,text:r=>rp(Inv.paid(r)),sortv:r=>Inv.paid(r)},{k:'st',l:t('common.status'),text:r=>stLabel(Inv.status(r)),html:r=>UI.badge(stLabel(Inv.status(r)))}]});
  return;
 }
 const i=DB.get('invoices',param);
 if(!i||!Scope.ok('invoices',i)){v.innerHTML=UI.empty(t('inv.not_found'));return}
 const so=DB.get('salesorders',i.soId),st=Inv.status(i),stD=stLabel(st),canPay=can('invoices','w')&&isRole('finance','director','deputy_director');
 const acts=[`<a class="btn btn-o" href="#/invoices">‹ ${t('common.back')}</a>`,`<button class="btn btn-o" data-act="inv-print" data-id="${i.id}">${t('common.print_pdf')}</button>`];
 if(canPay&&!i.cancelled&&Inv.outstanding(i)>0)acts.push(`<button class="btn" data-act="inv-pay" data-id="${i.id}">${t('inv.record_payment')}</button>`);
 if(can('invoices','w')&&!i.cancelled&&!(i.payments||[]).length)acts.push(`<button class="btn btn-d" data-act="cancel-req" data-col="invoices" data-id="${i.id}" data-l="${t('nav.invoices')}">${t('common.request_cancellation')}</button>`);
 v.innerHTML=UI.pghead(t('nav.invoices')+' '+i.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>${t('inv.info_title')}</span>${UI.badge(stD)}</div>${UI.kv([[t('common.customer'),esc(custName(i.customerId))],[t('common.type'),esc(stLabel(i.type))],[t('nav.salesorders'),so?docLink('salesorders',so):'-'],[t('common.date'),fdate(i.date)],[t('inv.due_date'),fdate(i.dueDate)],[t('common.description'),esc(i.desc)],[t('inv.aging'),esc(stLabel(Inv.aging(i)))]])}</div>
  <div class="card"><h3>${t('inv.incoming_payments')}</h3>${(i.payments||[]).length?`<div class="tblw"><table><tr><th>${t('common.date')}</th><th>${t('common.method')}</th><th>${t('common.reference')}</th><th class="num">${t('common.amount')}</th><th>${t('inv.proof')}</th><th>${t('common.recorded_by')}</th></tr>${i.payments.map(p=>`<tr><td>${fdate(p.date)}</td><td>${esc(p.method)}</td><td>${esc(p.ref||'')}</td><td class="num">${rp(p.amount)}</td><td><div class="files" data-files="p${p.id}" data-ro="1"></div></td><td>${esc(p.byName)}</td></tr>`).join('')}</table></div>`:`<div class="empty">${t('inv.no_payments_yet')}</div>`}</div></div>
  <div><div class="card"><h3>${t('common.value')}</h3><dl class="kv"><dt>${t('common.dpp')}</dt><dd>${rp(i.dpp)}</dd><dt>${t('common.ppn')} ${pct(i.taxPct)}</dt><dd>${rp(i.tax)}</dd><dt><b>${t('common.total')}</b></dt><dd><b>${rp(i.total)}</b></dd><dt>${t('inv.paid')}</dt><dd>${rp(Inv.paid(i))}</dd><dt>${t('inv.outstanding')}</dt><dd><b>${rp(Inv.outstanding(i))}</b></dd></dl></div>
  <div class="card"><h3>${t('common.activity_comments')}</h3>${UI.activity('invoices',i.id)}</div></div></div>`;
 (i.payments||[]).forEach(p=>{const el=$(`[data-files="p${p.id}"]`);if(el){el._files=p.files||[];Files.render(el)}});
};
ACT['inv-print']=el=>{
 const i=DB.get('invoices',el.dataset.id),c=DB.get('customers',i.customerId)||{},b=DB.all('banks').find(x=>x.currency==='IDR'&&x.bank!=='Kas');
 Print.html(Print.header('INVOICE',i.no)+`<table style="margin-bottom:10px"><tr><td width="50%"><b>Ditagihkan kepada:</b><br>${esc(c.name)}<br>${esc(c.address||'')}<br>NPWP: ${esc(c.npwp||'-')}</td><td><b>Tanggal:</b> ${fdate(i.date)}<br><b>Jatuh tempo:</b> ${fdate(i.dueDate)}<br><b>Ref. SO:</b> ${esc(DB.get('salesorders',i.soId)?.no||'-')}</td></tr></table>
  <table><tr><th>Keterangan</th><th class="right">Jumlah</th></tr><tr><td>${esc(i.desc)}</td><td class="right">${rp(i.dpp)}</td></tr><tr><td class="right">PPN ${pct(i.taxPct)}</td><td class="right">${rp(i.tax)}</td></tr><tr><td class="right"><b>TOTAL</b></td><td class="right"><b>${rp(i.total)}</b></td></tr>
  <tr><td class="right">Sudah dibayar</td><td class="right">${rp(Inv.paid(i))}</td></tr><tr><td class="right"><b>SISA TAGIHAN</b></td><td class="right"><b>${rp(Inv.outstanding(i))}</b></td></tr></table>
  <p><b>Pembayaran ke:</b><br>${b?`${esc(b.bank)} — ${esc(b.accNo)} a.n. ${esc(S().company?.name||'')}`:'-'}</p>`);
};
ACT['inv-pay']=async el=>{
 const i=DB.get('invoices',el.dataset.id),out=Inv.outstanding(i);
 const v=await UI.ask({title:t('inv.record_payment')+' — '+i.no,ok:t('common.save_payment'),fields:[F.d('date',t('inv.date_received'),{req:true,def:today()}),F.m('amount',t('inv.amount_received_rp'),{req:true,def:out}),
  F.s('method',t('common.method'),['Transfer bank','Tunai','Giro / Cek','Virtual account'],{req:true,def:'Transfer bank'}),F.r('bankId',t('inv.destination_account'),'banks'),F.t('ref',t('inv.ref_no')),F.fl('files',t('inv.transfer_proof'))],
  pre:`<div class="info" style="margin-bottom:10px">${t('inv.pre_outstanding',{amt:rp(out)})}</div>`});
 if(!v)return;
 if(!(num(v.amount)>0))return UI.toast(t('inv.err_amount_positive'),'err');
 if(num(v.amount)>out+0.5)return UI.toast(t('inv.err_amount_exceeds',{amt:rp(out)}),'err');
 const before=clone(i.payments||[]),payments=[...before,{id:uid(),...v,amount:num(v.amount),by:Auth.uid(),byName:Auth.user.name,at:nowISO()}];
 DB.update('invoices',i.id,{payments},t('inv.reason_payment',{amt:rp(v.amount)}),t('inv.action_record_payment'));
 const upd=DB.get('invoices',i.id);
 UI.toast(t('inv.payment_recorded',{status:stLabel(Inv.status(upd))}));
 if(i.orderId){const o=DB.get('orders',i.orderId);if(o){Notify.user(o.salesId,t('inv.notify_payment_received',{amt:rp(v.amount),no:i.no,status:stLabel(Inv.status(upd))}),'#/orders/'+o.id);Order.touch(o.id)}}
 Router.render();
};
