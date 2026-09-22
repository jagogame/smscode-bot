'use strict';
/* =========================================================
   KENTFORD ERP - Tahap 3: Purchasing, Supplier, Incoming,
   Inventory lanjutan (barang masuk/keluar, transfer, opname, barcode)
   ========================================================= */
const PR_ITEM_COLS=[{k:'productId',l:t('common.product'),t:'ref',ref:'products',w:'220px'},{k:'desc',l:t('common.description'),t:'text',w:'200px'},{k:'qty',l:t('common.qty'),t:'number',w:'80px'}];
const supName=id=>DB.get('suppliers',id)?.name||'-';
const whName=id=>DB.get('warehouses',id)?.name||'-';

/* ================= PURCHASE REQUEST ================= */
const PR={
 fields:()=>[F.s('source',t('pr.source'),['Manual','Sales Order','Permintaan Gudang','Permintaan Teknisi','Kebutuhan Rental','Minimum Stock'],{req:true,def:'Manual'}),
  F.d('neededBy',t('pr.needed_by'),{req:true,def:()=>addDays(today(),14)}),{k:'items',l:t('pr.items_requested'),t:'lines',cols:PR_ITEM_COLS,min:1},F.ta('notes',t('pr.notes_reason'))],
 amount(items){return sum(items,i=>num(i.qty)*num(DB.get('products',i.productId)?.lastCost))},
 async submit(rec){
  const need=DB.all('approvalLimits').some(x=>x.type==='purchase_request');
  if(!need){DB.update('pr',rec.id,{status:'Disetujui'},t('pr.reason_no_rule'),t('common.auto_approved_action'));UI.toast(t('pr.auto_approved'));return}
  DB.update('pr',rec.id,{status:'Menunggu Approval'},t('common.action_submitted_reason'),t('common.action_request_approval'));
  Approval.request({type:'purchase_request',refCol:'pr',refId:rec.id,title:`PR ${rec.no} — ${rec.items.length} item`,amount:this.amount(rec.items),reason:rec.notes||''});
  UI.toast(t('pr.submitted'));
 }
};
Approval.hooks.purchase_request={
 approved(a){const p=DB.get('pr',a.refId);if(p)DB.update('pr',p.id,{status:'Disetujui'},t('quot.reason_approval_approved'),t('quot.action_approved'));Notify.user(p?.requesterId,t('pr.notify_approved',{no:p?.no}),'#/pr/'+a.refId)},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('pr',a.refId,{status:'Ditolak',rejectReason:s?.note||''},s?.note||'',t('quot.action_rejected'))}
};
PAGES.pr.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   if(!can('pr','w'))return v.innerHTML=UI.empty(t('pr.no_right_create'));
   const fields=PR.fields();PR._ctx={fields};
   v.innerHTML=UI.pghead(t('pr.new'),`<a class="btn btn-o" href="#/pr">‹ ${t('common.cancel')}</a>`)+`<div class="card"><div id="prform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn btn-o" data-act="pr-save">${t('common.save_draft')}</button><button class="btn" data-act="pr-submit">${t('common.save_submit')}</button></div></div>`;
   Form.hydrate($('#prform'),fields,{});return;
  }
  v.innerHTML=UI.pghead(t('nav.pr'),can('pr','w')?`<a class="btn" href="#/pr/new">+ ${t('pr.new')}</a>`:'')+'<div class="card" id="prl"></div>';
  new DT($('#prl'),{title:t('nav.pr'),rows:()=>DB.all('pr').slice().reverse(),onRow:id=>Router.go('pr/'+id),
   filters:[{k:'s',l:t('common.status'),opts:()=>['Draft','Menunggu Approval','Disetujui','Ditolak','Selesai'],get:r=>r.status},{k:'src',l:t('pr.source'),opts:()=>['Manual','Sales Order','Permintaan Gudang','Permintaan Teknisi','Kebutuhan Rental','Minimum Stock'],get:r=>r.source}],
   cols:[{k:'no',l:t('pr.no_pr')},{k:'src',l:t('pr.source'),text:r=>r.source},{k:'req',l:t('pr.requester'),text:r=>userName(r.requesterId)},{k:'nb',l:t('pr.needed_by'),text:r=>fdate(r.neededBy),sortv:r=>r.neededBy},
    {k:'n',l:t('pr.item_count'),num:true,text:r=>String(r.items.length)},{k:'val',l:t('pr.est_value'),num:true,hide:()=>!seeCost(),text:r=>rp(PR.amount(r.items))},{k:'st',l:t('common.status'),text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const r=DB.get('pr',param);if(!r)return v.innerHTML=UI.empty(t('pr.not_found'));
 const sqs=DB.all('sq').filter(x=>x.prId===r.id),pos=DB.all('po').filter(x=>x.prId===r.id);
 const acts=[`<a class="btn btn-o" href="#/pr">‹ ${t('common.back')}</a>`];
 if(can('sq','w')&&r.status==='Disetujui')acts.push(`<button class="btn btn-o" data-act="sq-new" data-pr="${r.id}">+ ${t('nav.sq')}</button>`);
 if(can('po','w')&&r.status==='Disetujui'&&!pos.length)acts.push(`<a class="btn" href="#/pc/${r.id}">${t('pr.compare_make_po')}</a>`);
 v.innerHTML=UI.pghead('PR '+r.no,acts.join(''))+`<div class="card"><div class="ch"><span>${t('pr.request_detail')}</span>${UI.badge(r.status)}</div>${UI.kv([[t('pr.source'),esc(r.source)],[t('pr.requester'),esc(userName(r.requesterId))],[t('pr.needed_by'),fdate(r.neededBy)],[t('common.notes'),esc(r.notes||'-')]])}
  <div class="tblw" style="margin-top:8px"><table><tr><th>${t('common.product')}</th><th>${t('common.description')}</th><th class="num">${t('common.qty')}</th></tr>${r.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name||'-')}</td><td>${esc(i.desc||'')}</td><td class="num">${nf(i.qty)}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>${t('nav.sq')} (${sqs.length})</h3>${sqs.length?sqs.map(s=>`<div>${esc(supName(s.supplierId))} — ${rp(sum(s.items,i=>num(i.qty)*num(i.price)))} <span class="mut">(${t('quot.lead_time').toLowerCase()} ${esc(s.leadTime||'-')})</span></div>`).join(''):`<div class="empty">${t('pr.no_supplier_quote')}</div>`}</div>
  <div class="card"><h3>${t('nav.po')} (${pos.length})</h3>${pos.length?pos.map(p=>`<div>${docLink('po',p)} — ${supName(p.supplierId)} ${UI.badge(p.status)}</div>`).join(''):`<div class="empty">${t('pr.no_po')}</div>`}</div>
  <div class="card"><h3>${t('common.activity_comments')}</h3>${UI.activity('pr',r.id)}</div>`;
};
ACT['pr-save']=()=>{
 const {fields}=PR._ctx,{v}=Form.collect($('#prform'),fields);
 const rec=DB.insert('pr',{...v,no:Num.next('PR'),requesterId:Auth.uid(),status:'Draft'});
 UI.toast(t('pr.draft_saved'));Router.go('pr/'+rec.id);
};
ACT['pr-submit']=async()=>{
 const {fields}=PR._ctx,{v,err}=Form.collect($('#prform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 if(v.items.some(i=>!i.productId||!(num(i.qty)>0)))return UI.toast(t('pr.err_line_incomplete'),'err');
 const rec=DB.insert('pr',{...v,no:Num.next('PR'),requesterId:Auth.uid(),status:'Draft'});
 await PR.submit(rec);Router.go('pr/'+rec.id);
};
docLink; // referenced below too

/* ================= SUPPLIER QUOTATION & PRICE COMPARISON ================= */
PAGES.sq.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.sq'))+'<div class="card" id="sql"></div>';
 new DT($('#sql'),{title:t('nav.sq'),rows:()=>DB.all('sq').slice().reverse(),onRow:id=>{const s=DB.get('sq',id);Router.go('pr/'+s.prId)},
  cols:[{k:'pr',l:'PR',text:r=>DB.get('pr',r.prId)?.no||'-'},{k:'s',l:t('common.supplier'),text:r=>supName(r.supplierId)},{k:'n',l:t('so.items'),num:true,text:r=>String(r.items.length)},
   {k:'total',l:t('common.total'),num:true,text:r=>rp(sum(r.items,i=>num(i.qty)*num(i.price))),sortv:r=>sum(r.items,i=>num(i.qty)*num(i.price))},{k:'lt',l:t('quot.lead_time'),text:r=>r.leadTime||'-'},{k:'w',l:t('common.warranty'),text:r=>r.warranty||'-'},{k:'pt',l:t('common.payment_terms'),text:r=>r.paymentTerms||'-'}]});
};
ACT['sq-new']=async el=>{
 const pr=DB.get('pr',el.dataset.pr);
 const cols=[{k:'productId',l:t('common.product'),t:'ref',ref:'products',w:'200px'},{k:'qty',l:t('common.qty'),t:'number',w:'70px'},{k:'price',l:t('sq.unit_price'),t:'number',w:'120px'}];
 const v=await UI.ask({title:t('nav.sq')+' — '+pr.no,ok:t('common.save'),wide:true,fields:[F.r('supplierId',t('common.supplier'),'suppliers',{req:true}),F.t('leadTime',t('quot.lead_time'),{ph:t('sq.lead_time_ph')}),F.t('warranty',t('sq.warranty_label'),{ph:t('sq.warranty_ph')}),
  F.s('paymentTerms',t('common.payment_terms'),()=>DB.all('payterms').map(p=>p.name)),{k:'items',l:t('sq.items_prices'),t:'lines',cols,min:1},F.fl('files',t('sq.offer_doc'))],
  vals:{items:pr.items.map(i=>({productId:i.productId,qty:i.qty,price:DB.get('products',i.productId)?.lastCost||0}))}});
 if(!v)return;
 if(v.items.some(i=>!i.productId||!(num(i.qty)>0)||num(i.price)<0))return UI.toast(t('sq.err_incomplete_line'),'err');
 DB.insert('sq',{...v,prId:pr.id});UI.toast(t('sq.saved'));Router.render();
};
PAGES.pc.render=async(v,param)=>{
 const prs=DB.all('pr').filter(p=>p.status==='Disetujui'&&!DB.all('po').some(o=>o.prId===p.id));
 const pr=param?DB.get('pr',param):prs[0];
 v.innerHTML=UI.pghead(t('nav.pc'))+`<div class="card"><label>${t('pc.select_pr')}</label><select id="pcsel">${prs.map(p=>`<option value="${p.id}" ${pr&&p.id===pr.id?'selected':''}>${esc(p.no)} — ${p.items.length} item</option>`).join('')||`<option value="">${t('pc.no_pr_ready')}</option>`}</select></div><div id="pcbody"></div>`;
 $('#pcsel').addEventListener('change',e=>Router.go('pc/'+e.target.value));
 if(!pr)return;
 const sqs=DB.all('sq').filter(s=>s.prId===pr.id);
 $('#pcbody').innerHTML=!sqs.length?UI.empty(t('pc.no_sq_for_pr')):
  `<div class="card"><div class="tblw"><table><tr><th>${t('common.supplier')}</th><th class="num">${t('pc.total_price')}</th><th>${t('quot.lead_time')}</th><th>${t('common.warranty')}</th><th>${t('common.payment_terms')}</th><th></th></tr>
   ${sqs.map(s=>{const t2=sum(s.items,i=>num(i.qty)*num(i.price));return `<tr><td>${esc(supName(s.supplierId))}</td><td class="num">${rp(t2)}</td><td>${esc(s.leadTime||'-')}</td><td>${esc(s.warranty||'-')}</td><td>${esc(s.paymentTerms||'-')}</td><td>${can('po','w')?`<button class="btn btn-sm" data-act="pc-choose" data-id="${s.id}">${t('pc.choose_make_po')}</button>`:''}</td></tr>`}).join('')}</table></div></div>`;
};
ACT['pc-choose']=async el=>{
 const s=DB.get('sq',el.dataset.id),pr=DB.get('pr',s.prId),sup=DB.get('suppliers',s.supplierId);
 const po=DB.insert('po',{no:Num.next('PO'),prId:pr.id,supplierId:s.supplierId,currency:sup?.currency||'IDR',kurs:1,taxPct:S().defaultTaxPct??11,
  dpPct:DB.get('payterms',sup?.paymentTermId)?.dpPct||0,incoterm:'',etaDate:'',items:s.items.map(i=>({productId:i.productId,qty:i.qty,price:i.price,received:0})),status:'Draft',trackingNotes:[]});
 DB.update('pr',pr.id,{status:'Selesai'},t('pc.po_created_reason',{no:po.no}),t('pc.po_created_action'));
 UI.toast(t('pc.po_created_toast',{no:po.no}));Router.go('po/'+po.id);
};

/* ================= PURCHASE ORDER ================= */
const POH={
 calc(po){const sub=sum(po.items,i=>num(i.qty)*num(i.price)),idr=sub*num(po.kurs||1),tax=idr*num(po.taxPct)/100,total=idr+tax;return {sub,idr,tax,total,dp:total*num(po.dpPct)/100}},
 async submit(po){
  const c=this.calc(po);
  if(!DB.all('approvalLimits').some(x=>x.type==='purchase_order')){DB.update('po',po.id,{status:'Disetujui'},t('po.reason_no_rule'),t('common.auto_approved_action'));UI.toast(t('po.auto_approved'));return}
  DB.update('po',po.id,{status:'Menunggu Approval'},t('common.action_submitted_reason'),t('common.action_request_approval'));
  Approval.request({type:'purchase_order',refCol:'po',refId:po.id,title:`PO ${po.no} — ${supName(po.supplierId)}`,amount:c.total});
  UI.toast(t('po.submitted'));
 }
};
Approval.hooks.purchase_order={
 approved(a){DB.update('po',a.refId,{status:'Disetujui'},t('quot.reason_approval_approved'),t('quot.action_approved'));Notify.role('admin_hr_sales',t('po.notify_approved',{no:DB.get('po',a.refId)?.no}),'#/po/'+a.refId)},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('po',a.refId,{status:'Ditolak',rejectReason:s?.note||''},s?.note||'',t('quot.action_rejected'))}
};
PAGES.po.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead(t('nav.po'))+'<div class="card" id="pol"></div>';
  new DT($('#pol'),{title:t('nav.po'),rows:()=>DB.all('po').slice().reverse(),onRow:id=>Router.go('po/'+id),
   filters:[{k:'s',l:t('common.status'),opts:()=>['Draft','Menunggu Approval','Disetujui','Dikirim Supplier','Sebagian Diterima','Diterima','Ditolak','Dibatalkan'],get:r=>r.status}],
   cols:[{k:'no',l:t('po.no_po')},{k:'s',l:t('common.supplier'),text:r=>supName(r.supplierId)},{k:'cur',l:t('po.currency'),text:r=>r.currency},{k:'total',l:t('po.total_idr'),num:true,text:r=>rp(POH.calc(r).total),sortv:r=>POH.calc(r).total},
    {k:'eta',l:'ETA',text:r=>r.etaDate?fdate(r.etaDate):'-'},{k:'st',l:t('common.status'),text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const po=DB.get('po',param);if(!po)return v.innerHTML=UI.empty(t('po.not_found'));
 const c=POH.calc(po),grs=DB.all('gr').filter(g=>g.poId===po.id);
 const acts=[`<a class="btn btn-o" href="#/po">‹ ${t('common.back')}</a>`,`<button class="btn btn-o" data-act="po-print" data-id="${po.id}">${t('common.print_pdf')}</button>`];
 if(po.status==='Draft'&&can('po','w')){acts.push(`<button class="btn" data-act="po-submit" data-id="${po.id}">${t('common.action_request_approval')}</button>`);}
 if(po.status==='Disetujui'&&can('po','w'))acts.push(`<button class="btn" data-act="po-send" data-id="${po.id}">${t('po.mark_sent')}</button>`);
 if(['Dikirim Supplier','Sebagian Diterima'].includes(po.status)&&can('gr','w'))acts.push(`<a class="btn" href="#/gr/new/${po.id}">${t('nav.gr')} (GR)</a>`);
 if(['Sebagian Diterima','Diterima'].includes(po.status)&&can('si','w'))acts.push(`<button class="btn btn-o" data-act="si-fromPO" data-id="${po.id}">${t('po.make_si')}</button>`);
 v.innerHTML=UI.pghead('PO '+po.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>${t('po.info_title')}</span>${UI.badge(po.status)}</div>${UI.kv([[t('common.supplier'),esc(supName(po.supplierId))],[t('po.related_pr'),po.prId?docLink('pr',DB.get('pr',po.prId)):'-'],[t('po.currency'),esc(po.currency)+(po.currency!=='IDR'?' • '+t('po.rate')+' '+nf(po.kurs):'')],
   [t('po.incoterm'),esc(po.incoterm||'-')],['ETA',po.etaDate?fdate(po.etaDate):'-'],['DP',pct(po.dpPct)+' = '+rp(c.dp)]])}</div>
  <div class="card"><h3>${t('so.items')}</h3><div class="tblw"><table><tr><th>${t('common.product')}</th><th class="num">${t('common.qty')}</th><th class="num">${t('common.price')}</th><th class="num">${t('po.received')}</th></tr>${po.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name||'-')}</td><td class="num">${nf(i.qty)}</td><td class="num">${rp(i.price)}</td><td class="num">${num(i.received)}/${nf(i.qty)}</td></tr>`).join('')}
   <tr><td colspan="3" class="right">${t('common.subtotal')} (${esc(po.currency)})</td><td class="num">${nf(c.sub)}</td></tr>${po.currency!=='IDR'?`<tr><td colspan="3" class="right">${t('po.in_rupiah')}</td><td class="num">${rp(c.idr)}</td></tr>`:''}<tr><td colspan="3" class="right">${t('common.ppn')} ${pct(po.taxPct)}</td><td class="num">${rp(c.tax)}</td></tr><tr><td colspan="3" class="right"><b>${t('common.total')}</b></td><td class="num"><b>${rp(c.total)}</b></td></tr></table></div></div>
  <div class="card"><h3>${t('po.shipment_tracking')}</h3>${(po.trackingNotes||[]).map(tr=>`<div class="ev">${esc(tr.text)}<br><small class="mut">${fdt(tr.at)} — ${esc(tr.by)}</small></div>`).join('')||`<div class="empty">${t('po.no_notes')}</div>`}
   ${['Disetujui','Dikirim Supplier','Sebagian Diterima'].includes(po.status)&&can('po','w')?`<div class="acts" style="margin-top:8px"><button class="btn btn-o btn-sm" data-act="po-track" data-id="${po.id}">${t('po.update_eta')}</button></div>`:''}</div>
  <div class="card"><h3>${t('po.gr_title')}</h3>${grs.length?grs.map(g=>`<div>${docLink('gr',g)} — ${fdate(g.date)} — ${g.items.length} item</div>`).join(''):`<div class="empty">${t('po.no_receipts')}</div>`}</div></div>
  <div><div class="card"><h3>${t('common.activity_comments')}</h3>${UI.activity('po',po.id)}</div></div></div>`;
};
ACT['po-submit']=el=>POH.submit(DB.get('po',el.dataset.id)).then(()=>Router.render());
ACT['po-send']=el=>{DB.update('po',el.dataset.id,{status:'Dikirim Supplier'},t('po.reason_sent'),t('po.reason_sent'));UI.toast(t('po.status_sent_toast'));Router.render()};
ACT['po-track']=async el=>{
 const po=DB.get('po',el.dataset.id);
 const v=await UI.ask({title:t('po.update_tracking'),fields:[F.d('etaDate',t('po.eta_estimate'),{def:po.etaDate}),F.ta('note',t('po.tracking_note_ph'))]});
 if(!v)return;
 const notes=[...(po.trackingNotes||[])];if(v.note)notes.push({at:nowISO(),by:Auth.user.name,text:v.note});
 DB.update('po',po.id,{etaDate:v.etaDate,trackingNotes:notes},v.note||'',t('po.update_tracking'));UI.toast(t('po.tracking_updated'));Router.render();
};
ACT['po-print']=el=>{
 const po=DB.get('po',el.dataset.id),c=POH.calc(po),s=DB.get('suppliers',po.supplierId)||{};
 Print.html(Print.header('PURCHASE ORDER',po.no)+`<p><b>Kepada:</b> ${esc(s.name)}<br>${esc(s.address||'')}<br>u.p. ${esc(s.pic||'')}</p>
  <table><tr><th>Produk</th><th class="right">Qty</th><th class="right">Harga (${esc(po.currency)})</th><th class="right">Jumlah</th></tr>${po.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name||'')}</td><td class="right">${nf(i.qty)}</td><td class="right">${nf(i.price)}</td><td class="right">${nf(i.qty*i.price)}</td></tr>`).join('')}
  <tr><td colspan="3" class="right">PPN ${pct(po.taxPct)}</td><td class="right">${nf(c.tax/(po.currency==='IDR'?1:po.kurs||1))}</td></tr><tr><td colspan="3" class="right"><b>TOTAL</b></td><td class="right"><b>${nf(c.sub+c.tax/(po.currency==='IDR'?1:po.kurs||1))} ${esc(po.currency)}</b></td></tr></table>
  <p>Incoterm: ${esc(po.incoterm||'-')} • Payment terms: DP ${pct(po.dpPct)} • ETA: ${po.etaDate?fdate(po.etaDate):'-'}</p>`);
};

/* ================= INCOMING SHIPMENT ================= */
PAGES.incoming.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.incoming'))+'<div class="card" id="incl"></div>';
 new DT($('#incl'),{title:t('nav.incoming'),rows:()=>DB.all('po').filter(p=>['Disetujui','Dikirim Supplier','Sebagian Diterima'].includes(p.status)).slice().reverse(),onRow:id=>Router.go('po/'+id),
  cols:[{k:'no',l:t('po.no_po')},{k:'s',l:t('common.supplier'),text:r=>supName(r.supplierId)},{k:'eta',l:'ETA',text:r=>r.etaDate?fdate(r.etaDate):t('po.eta_none'),sortv:r=>r.etaDate||''},
   {k:'n',l:t('po.last_note'),text:r=>(r.trackingNotes||[]).slice(-1)[0]?.text||'-'},{k:'st',l:t('common.status'),text:r=>r.status,html:r=>UI.badge(r.status)}]});
};

/* ================= BARANG MASUK (GR) ================= */
PAGES.gr.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead(t('nav.gr'))+'<div class="card" id="grl"></div>';
  new DT($('#grl'),{title:t('nav.gr'),rows:()=>DB.all('gr').slice().reverse(),onRow:id=>Router.go('gr/'+id),
   cols:[{k:'no',l:t('gr.no_gr')},{k:'po',l:'PO',text:r=>DB.get('po',r.poId)?.no||'-'},{k:'w',l:t('common.warehouse'),text:r=>whName(r.whId)},{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'n',l:t('so.items'),num:true,text:r=>String(r.items.length)}]});
  return;
 }
 if(param.startsWith('new/')){
  if(!can('gr','w'))return v.innerHTML=UI.empty(t('gr.no_right'));
  const po=DB.get('po',param.slice(4));if(!po)return v.innerHTML=UI.empty(t('po.not_found'));
  const cols=[{k:'productId',l:t('common.product'),t:'select',sort:false,opts:()=>po.items.map(i=>({v:i.productId,l:DB.get('products',i.productId)?.name})),w:'220px'},{k:'qty',l:t('gr.qty_received'),t:'number',w:'90px'},{k:'serial',l:t('gr.serial_no'),t:'text',w:'150px'}];
  const fields=[F.r('whId',t('gr.receive_at'),'warehouses',{req:true,def:'w_ckr'}),F.d('date',t('gr.receive_date'),{req:true,def:()=>today()}),
   {k:'items',l:t('gr.items_received'),t:'lines',cols,min:1},F.fl('files',t('gr.docs_hint'))];
  const vals={items:po.items.filter(i=>num(i.received)<num(i.qty)).map(i=>({productId:i.productId,qty:num(i.qty)-num(i.received),serial:''}))};
  GR._ctx={po,fields};
  v.innerHTML=UI.pghead(t('nav.gr')+' — '+po.no,`<a class="btn btn-o" href="#/po/${po.id}">‹ ${t('common.cancel')}</a>`)+`<div class="card"><div class="info">${t('gr.remaining_info')}: ${po.items.map(i=>`${esc(DB.get('products',i.productId)?.name)} ${num(i.qty)-num(i.received)}/${nf(i.qty)}`).join(', ')}</div><div id="grform" style="margin-top:10px">${Form.render(fields,vals)}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="gr-save">${t('gr.save_receipt')}</button></div></div>`;
  Form.hydrate($('#grform'),fields,vals);return;
 }
 const g=DB.get('gr',param);if(!g)return v.innerHTML=UI.empty(t('gr.not_found'));
 v.innerHTML=UI.pghead('GR '+g.no,`<a class="btn btn-o" href="#/gr">‹ ${t('common.back')}</a>`)+`<div class="card">${UI.kv([['PO',docLink('po',DB.get('po',g.poId))],[t('common.warehouse'),esc(whName(g.whId))],[t('common.date'),fdate(g.date)]])}<div class="tblw" style="margin-top:8px"><table><tr><th>${t('common.product')}</th><th class="num">${t('common.qty')}</th><th>${t('gr.serial_no')}</th></tr>${g.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name||'')}</td><td class="num">${nf(i.qty)}</td><td>${esc(i.serial||'-')}</td></tr>`).join('')}</table></div></div>`;
};
const GR={_ctx:null};
ACT['gr-save']=()=>{
 const {po,fields}=GR._ctx,{v,err}=Form.collect($('#grform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 const items=v.items.filter(i=>i.productId&&num(i.qty)>0);
 if(!items.length)return UI.toast(t('gr.err_min_one'),'err');
 for(const i of items){const line=po.items.find(x=>x.productId===i.productId);const max=num(line?.qty)-num(line?.received);if(num(i.qty)>max)return UI.toast(t('gr.err_exceeds_remaining',{name:DB.get('products',i.productId)?.name,max}),'err')}
 const gr=DB.insert('gr',{...v,items,no:Num.next('GR'),poId:po.id});
 items.forEach(i=>{Stock.change(i.productId,v.whId,num(i.qty),t('gr.stock_move_type'),gr.no,'PO '+po.no);
  const line=po.items.find(x=>x.productId===i.productId);if(line){line.received=num(line.received)+num(i.qty);DB.update('products',i.productId,{lastCost:line.price},t('gr.reason_price_update',{no:po.no}),t('gr.action_price_update'))}});
 DB.save('po');
 const done=po.items.every(i=>num(i.received)>=num(i.qty));
 DB.update('po',po.id,{status:done?'Diterima':'Sebagian Diterima'},t('gr.reason_received',{no:gr.no}),t('gr.stock_move_type'));
 UI.toast(t('gr.recorded',{no:gr.no}));Router.go('gr/'+gr.id);
};

/* ================= BARANG KELUAR (manual, non New Order) ================= */
PAGES.gi.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.gi'),can('gi','w')?`<button class="btn" data-act="gi-new">+ ${t('nav.gi')}</button>`:'')+'<div class="card" id="gil"></div>';
 new DT($('#gil'),{title:t('nav.gi'),rows:()=>DB.all('stock_moves').filter(m=>m.type==='Keluar manual').slice().reverse(),
  cols:[{k:'at',l:t('gi.time'),text:r=>fdt(r.at),sortv:r=>r.at},{k:'p',l:t('common.product'),text:r=>DB.get('products',r.productId)?.name},{k:'w',l:t('common.warehouse'),text:r=>whName(r.whId)},{k:'q',l:t('common.qty'),num:true,text:r=>String(-r.delta)},{k:'note',l:t('gi.purpose')},{k:'by',l:t('common.recorded_by'),text:r=>r.byName}]});
};
ACT['gi-new']=async()=>{
 const v=await UI.ask({title:t('gi.new_title'),ok:t('common.save'),fields:[F.r('productId',t('common.product'),'products',{req:true}),F.r('whId',t('gi.from_warehouse'),'warehouses',{req:true,def:'w_ckr'}),F.n('qty',t('common.qty'),{req:true}),F.ta('note',t('gi.purpose_ref'),{req:true})]});
 if(!v)return;
 if(!(num(v.qty)>0))return UI.toast(t('quot.err_qty_positive'),'err');
 try{Stock.change(v.productId,v.whId,-num(v.qty),'Keluar manual','',v.note)}catch(e){return UI.toast(e.message,'err')}
 UI.toast(t('gi.recorded'));Router.render();
};

/* ================= TRANSFER LOKASI ================= */
PAGES.transfer.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.transfer'),can('transfer','w')?`<button class="btn" data-act="transfer-new">+ ${t('nav.transfer')}</button>`:'')+'<div class="card" id="trl"></div>';
 new DT($('#trl'),{title:t('nav.transfer'),rows:()=>DB.all('transfers').slice().reverse(),
  cols:[{k:'no',l:t('common.no_dot')},{k:'f',l:t('transfer.from'),text:r=>whName(r.fromWh)},{k:'t',l:t('transfer.to'),text:r=>whName(r.toWh)},{k:'n',l:t('so.items'),num:true,text:r=>String(r.items.length)},{k:'at',l:t('gi.time'),text:r=>fdt(r.createdAt),sortv:r=>r.createdAt}],
  onRow:id=>{const tr=DB.get('transfers',id);UI.modal({title:t('nav.transfer')+' '+tr.no,body:UI.kv([[t('transfer.from'),whName(tr.fromWh)],[t('transfer.to'),whName(tr.toWh)]])+`<div class="tblw"><table><tr><th>${t('common.product')}</th><th class="num">${t('common.qty')}</th></tr>${tr.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name)}</td><td class="num">${nf(i.qty)}</td></tr>`).join('')}</table></div>`,foot:`<button class="btn btn-o" data-x="c">${t('common.close')}</button>`});}});
};
ACT['transfer-new']=async()=>{
 const cols=[{k:'productId',l:t('common.product'),t:'ref',ref:'products',w:'220px'},{k:'qty',l:t('common.qty'),t:'number',w:'90px'}];
 const v=await UI.ask({title:t('nav.transfer'),ok:t('transfer.process'),wide:true,fields:[F.r('fromWh',t('transfer.from'),'warehouses',{req:true}),F.r('toWh',t('transfer.to'),'warehouses',{req:true}),{k:'items',l:t('transfer.goods'),t:'lines',cols,min:1},F.ta('notes',t('common.notes'))]});
 if(!v)return;
 if(v.fromWh===v.toWh)return UI.toast(t('transfer.err_same_wh'),'err');
 const items=v.items.filter(i=>i.productId&&num(i.qty)>0);if(!items.length)return UI.toast(t('transfer.err_min_one'),'err');
 for(const i of items)if(Stock.qty(i.productId,v.fromWh)<num(i.qty))return UI.toast(t('transfer.err_stock_insufficient',{name:DB.get('products',i.productId)?.name,wh:whName(v.fromWh)}),'err');
 const no=Num.next('TR');
 items.forEach(i=>{Stock.change(i.productId,v.fromWh,-num(i.qty),t('transfer.type_out'),no,whName(v.toWh));Stock.change(i.productId,v.toWh,num(i.qty),t('transfer.type_in'),no,whName(v.fromWh))});
 DB.insert('transfers',{no,fromWh:v.fromWh,toWh:v.toWh,items,notes:v.notes});
 UI.toast(t('transfer.done',{no}));Router.render();
};

/* ================= STOCK OPNAME ================= */
PAGES.opname.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   if(!can('opname','w'))return v.innerHTML=UI.empty(t('opname.no_right'));
   v.innerHTML=UI.pghead(t('opname.new'),`<a class="btn btn-o" href="#/opname">‹ ${t('common.cancel')}</a>`)+`<div class="card"><label>${t('common.warehouse')}</label><select id="opwh">${DB.all('warehouses').filter(w=>w.type==='Gudang').map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select><div class="acts" style="margin-top:10px"><button class="btn" data-act="opname-start">${t('opname.start_count')}</button></div></div>`;
   return;
  }
  v.innerHTML=UI.pghead(t('nav.opname'),can('opname','w')?`<a class="btn" href="#/opname/new">+ ${t('opname.new')}</a>`:'')+'<div class="card" id="opl"></div>';
  new DT($('#opl'),{title:t('nav.opname'),rows:()=>DB.all('opnames').slice().reverse(),onRow:id=>Router.go('opname/'+id),
   cols:[{k:'no',l:t('common.no_dot')},{k:'w',l:t('common.warehouse'),text:r=>whName(r.whId)},{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'n',l:t('opname.diff_items'),num:true,text:r=>String(r.items.filter(i=>i.diff!==0).length)},{k:'st',l:t('common.status'),text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const o=DB.get('opnames',param);if(!o)return v.innerHTML=UI.empty(t('opname.not_found'));
 const editable=o.status==='Draft'&&can('opname','w');
 v.innerHTML=UI.pghead(t('nav.opname')+' '+o.no,`<a class="btn btn-o" href="#/opname">‹ ${t('common.back')}</a>`)+`<div class="card"><div class="ch"><span>${esc(whName(o.whId))} — ${fdate(o.date)}</span>${UI.badge(o.status)}</div>
  <div class="tblw"><table><tr><th>${t('common.product')}</th><th class="num">${t('opname.system_qty')}</th><th class="num">${t('opname.counted_qty')}</th><th class="num">${t('opname.diff')}</th></tr>${o.items.map((i,idx)=>`<tr><td>${esc(DB.get('products',i.productId)?.name)}</td><td class="num">${i.systemQty}</td><td class="num">${editable?`<input type="number" data-op="${idx}" value="${i.countedQty??i.systemQty}" style="width:90px;text-align:right">`:num(i.countedQty)}</td><td class="num" data-opd="${idx}">${num(i.countedQty??i.systemQty)-i.systemQty}</td></tr>`).join('')}</table></div>
  ${editable?`<div class="acts" style="margin-top:12px"><button class="btn" data-act="opname-finish" data-id="${o.id}">${t('opname.finish')}</button></div>`:''}</div>`;
 if(editable)v.addEventListener('input',e=>{if(e.target.dataset.op===undefined)return;const idx=e.target.dataset.op;$(`[data-opd="${idx}"]`).textContent=num(e.target.value)-o.items[idx].systemQty});
};
ACT['opname-start']=()=>{
 const whId=$('#opwh').value;
 const items=DB.all('products').filter(p=>Stock.qty(p.id,whId)>0||num(p.minStock)>0).map(p=>({productId:p.id,systemQty:Stock.qty(p.id,whId),countedQty:null}));
 if(!items.length)return UI.toast(t('opname.no_stock'),'err');
 const o=DB.insert('opnames',{no:Num.next('OP'),whId,date:today(),items,status:'Draft'});
 Router.go('opname/'+o.id);
};
ACT['opname-finish']=async el=>{
 const o=DB.get('opnames',el.dataset.id);
 const items=o.items.map((i,idx)=>{const c=parseFloat($(`[data-op="${idx}"]`).value);return {...i,countedQty:isNaN(c)?i.systemQty:c,diff:(isNaN(c)?i.systemQty:c)-i.systemQty}});
 if(items.some(i=>i.countedQty<0))return UI.toast(t('opname.err_negative'),'err');
 const diffLines=items.filter(i=>i.diff!==0);
 if(!diffLines.length){DB.update('opnames',o.id,{items,status:'Selesai'},t('opname.reason_no_diff'),t('opname.done_action'));UI.toast(t('opname.no_diff_toast'));Router.go('opname/'+o.id);return}
 const r=await UI.confirm({title:t('opname.finish'),msg:t('opname.diff_confirm_msg',{n:diffLines.length,val:rp(sum(diffLines,i=>Math.abs(i.diff)*num(DB.get('products',i.productId)?.lastCost)))})});
 if(!r)return;
 DB.update('opnames',o.id,{items,status:'Menunggu Approval'},t('common.action_submitted_reason'),t('common.action_request_approval'));
 const a=Approval.request({type:'stock_adjust',refCol:'opnames',refId:o.id,title:t('opname.approval_title',{no:o.no,wh:whName(o.whId),n:diffLines.length}),
  amount:sum(diffLines,i=>Math.abs(i.diff)*num(DB.get('products',i.productId)?.lastCost)),reason:t('opname.approval_reason'),meta:{opnameId:o.id}});
 UI.toast(t('opname.submitted',{no:a.no}));Router.go('opname/'+o.id);
};
const _stockAdjustHook=Approval.hooks.stock_adjust;
Approval.hooks.stock_adjust={
 approved(a){
  if(a.meta?.opnameId){
   const o=DB.get('opnames',a.meta.opnameId);
   o.items.filter(i=>i.diff).forEach(i=>Stock.change(i.productId,o.whId,i.diff,t('opname.adjustment_type'),o.no,t('opname.adjustment_ref',{no:o.no})));
   DB.update('opnames',o.id,{status:'Selesai'},t('quot.reason_approval_approved'),t('opname.done_action'));
   return;
  }
  _stockAdjustHook.approved(a);
 },
 rejected(a){
  if(a.meta?.opnameId){DB.update('opnames',a.meta.opnameId,{status:'Ditolak'},a.reason,t('quot.action_rejected'));return}
  _stockAdjustHook.rejected(a);
 }
};

/* ================= BARCODE ================= */
function pseudoBarcode(text){
 let bars='';for(const ch of String(text)){const c=ch.charCodeAt(0);for(let b=0;b<6;b++)bars+=`<i style="width:${1+((c>>b)&1)*2}px;background:${b%2===0?'#111':'transparent'}"></i>`}
 return `<div style="display:flex;height:46px;align-items:stretch;gap:0">${bars}</div>`;
}
PAGES.barcode.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.barcode'))+`<div class="card"><label>${t('barcode.scan_hint')}</label><input id="bcscan" autocomplete="off" placeholder="${t('barcode.scan_ph')}"><div id="bcresult" style="margin-top:10px"></div></div>
  <div class="card"><div class="ch"><span>${t('barcode.print_labels')}</span><button class="btn btn-o btn-sm" data-act="bc-printsel">${t('barcode.print_selected')}</button></div><div id="bcl"></div></div>`;
 const dt=new DT($('#bcl'),{title:t('common.product'),size:12,rows:()=>DB.all('products'),cols:[{k:'chk',l:'',sort:false,html:r=>`<input type="checkbox" data-bcchk value="${r.id}">`},{k:'sku',l:'SKU'},{k:'name',l:t('common.product')},{k:'bc',l:t('nav.barcode'),text:r=>r.barcode||r.sku},{k:'label',l:'',sort:false,html:r=>`<div style="text-align:center">${pseudoBarcode(r.barcode||r.sku)}<small>${esc(r.barcode||r.sku)}</small></div>`}]});
 const input=$('#bcscan');
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();Barcode.lookup(input.value);input.value='';input.focus()}});
 input.focus();
};
const Barcode={
 lookup(code){
  code=(code||'').trim();if(!code)return;
  const p=DB.all('products').find(x=>x.barcode===code||x.sku.toLowerCase()===code.toLowerCase());
  const box=$('#bcresult');
  if(!p){box.innerHTML=`<div class="errbox">${t('barcode.not_found',{code:esc(code)})}</div>`;return}
  box.innerHTML=`<div class="info"><b>${esc(p.name)}</b> (${esc(p.sku)}) — ${esc(p.kind)}<br>${t('barcode.total_stock')}: <b>${Stock.qty(p.id)}</b> ${seeCost()?'• '+t('quot.buy_price')+': '+rp(p.lastCost)+' • '+t('quot.sell_price_rp').replace(' (Rp)','')+': '+rp(p.price):''}
   <div class="tblw" style="margin-top:6px"><table>${DB.all('warehouses').filter(w=>Stock.qty(p.id,w.id)>0).map(w=>`<tr><td>${esc(w.name)}</td><td class="num">${Stock.qty(p.id,w.id)}</td></tr>`).join('')||`<tr><td colspan=2 class="mut">${t('barcode.no_stock')}</td></tr>`}</table></div></div>`;
 }
};
ACT['bc-printsel']=()=>{
 const ids=$$('[data-bcchk]:checked').map(c=>c.value);
 const list=ids.length?DB.all('products').filter(p=>ids.includes(p.id)):DB.all('products');
 Print.html(`<div style="display:flex;flex-wrap:wrap;gap:10px">${list.map(p=>`<div style="border:1px solid #ccc;padding:8px;width:220px;text-align:center"><b>${esc(p.name)}</b><br><small>${esc(p.sku)}</small>${pseudoBarcode(p.barcode||p.sku)}<small>${esc(p.barcode||p.sku)}</small></div>`).join('')}</div>`);
};

/* ================= Aksi bantu: buat PR dari stok minim ================= */
ACT['pr-from-lowstock']=()=>{
 const low=DB.all('products').filter(p=>num(p.minStock)>0&&Stock.qty(p.id)<=num(p.minStock));
 if(!low.length)return UI.toast(t('pr.no_lowstock'));
 const rec=DB.insert('pr',{source:'Minimum Stock',neededBy:addDays(today(),14),items:low.map(p=>({productId:p.id,desc:t('pr.restock_desc',{stock:Stock.qty(p.id),min:p.minStock}),qty:Math.max(1,num(p.minStock)*2-Stock.qty(p.id))})),notes:t('pr.auto_lowstock_notes'),requesterId:Auth.uid(),status:'Draft',no:Num.next('PR')});
 UI.toast(t('pr.draft_from_lowstock',{no:rec.no}));Router.go('pr/'+rec.id);
};
