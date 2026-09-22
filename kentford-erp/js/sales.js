'use strict';
/* =========================================================
   KENTFORD ERP - Quotation, Sales Order, Customer Invoice
   ========================================================= */
const custName=id=>DB.get('customers',id)?.name||'-';
const docLink=(page,r)=>`<a href="#/${page}/${r.id}">${esc(r.no)}</a>`;

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
  DB.all('quotations').filter(q=>['Disetujui','Dikirim'].includes(q.status)&&q.validUntil&&q.validUntil<today()).forEach(q=>DB.update('quotations',q.id,{status:'Kedaluwarsa'},'Masa berlaku habis','Kedaluwarsa otomatis'));
 },
 fields(ro){
  const cols=[{k:'productId',l:'Produk',t:'ref',ref:'products',w:'190px'},{k:'desc',l:'Deskripsi / spesifikasi',t:'text',w:'210px'},{k:'qty',l:'Qty',t:'number',w:'70px'},
   {k:'cost',l:'Harga beli (Rp)',t:'number',cost:true,w:'120px'},{k:'price',l:'Harga jual (Rp)',t:'number',w:'130px'},{k:'discPct',l:'Diskon %',t:'number',w:'80px'}];
  return [F.r('customerId','Customer','customers',{req:true}),F.t('picName','PIC customer'),
   F.r('salesId','Sales PIC','users',{filter:salesUsers,req:true,ro:isRole('sales'),def:()=>Auth.uid()}),
   F.d('date','Tanggal',{req:true,def:()=>today()}),F.d('validUntil','Berlaku sampai',{req:true,def:()=>addDays(today(),S().quoteValidDays||14)}),F.pc('taxPct','PPN (%)',{def:()=>S().defaultTaxPct??11}),
   F.s('paymentTerms','Payment terms',()=>DB.all('payterms').map(p=>p.name)),F.t('leadTime','Lead time',{ph:'mis. 4 minggu'}),
   F.s('deliveryTerms','Delivery terms',()=>DB.all('deliveryterms').map(p=>p.name)),F.t('warranty','Warranty',{ph:'mis. 12 bulan / 2.000 jam'}),
   {k:'lines',l:'Produk & harga',t:'lines',cols,calc:'quote',min:1},F.ta('notes','Catatan')];
 },
 totalsHtml(c){
  const low=c.gpPct<num(S().minMarginPct),bigDisc=c.maxDisc>num(S().maxDiscPct);
  return `<dl class="kv"><dt>Subtotal</dt><dd>${rp(c.gross)}</dd><dt>Diskon</dt><dd>${rp(c.disc)}</dd><dt>DPP</dt><dd>${rp(c.dpp)}</dd><dt>PPN</dt><dd>${rp(c.tax)}</dd><dt><b>Total</b></dt><dd><b>${rp(c.total)}</b></dd>
   ${seeCost()?`<dt>Harga beli</dt><dd>${rp(c.cost)}</dd><dt>Gross profit</dt><dd>${rp(c.gp)}</dd><dt>Margin</dt><dd>${pct(c.gpPct)} ${low?UI.badge('Di bawah batas → perlu approval'):''}</dd>`:''}</dl>
   ${bigDisc?`<div class="warnbox" style="margin-top:8px">Diskon ${pct(c.maxDisc)} melebihi batas ${pct(S().maxDiscPct)} — quotation akan memerlukan approval.</div>`:''}
   ${!seeCost()&&low?'<div class="warnbox" style="margin-top:8px">Harga/margin berada di bawah batas — quotation akan memerlukan approval.</div>':''}`;
 },
 recalc(){
  const root=$('#qform');if(!root)return;
  const lines=Lines.collect($('[data-lines="lines"]',root)),tax=parseFloat($('[name="taxPct"]',root)?.value)||0;
  $('#qtot').innerHTML=this.totalsHtml(this.calc(lines,tax));
 },
 async save(rec,submit,fields){
  const root=$('#qform'),{v,err}=Form.collect(root,fields);
  if(err.length)return UI.toast(err[0],'err');
  if(!v.lines.length)return UI.toast('Tambahkan minimal satu produk.','err');
  for(const l of v.lines){if(!(num(l.qty)>0))return UI.toast('Qty setiap baris harus lebih dari 0.','err');if(num(l.price)<0||num(l.discPct)<0||num(l.discPct)>100)return UI.toast('Harga / diskon tidak valid.','err')}
  if(v.validUntil<v.date)return UI.toast('Tanggal berlaku harus setelah tanggal quotation.','err');
  if(isRole('sales'))v.salesId=Auth.uid();
  v.lines=v.lines.map(l=>({...l,cost:num(l.cost)}));
  const q=rec?{...rec,...v}:{...v};this.applyCalc(q);
  const data={customerId:q.customerId,picName:q.picName,salesId:q.salesId,date:q.date,validUntil:q.validUntil,taxPct:q.taxPct,paymentTerms:q.paymentTerms,leadTime:q.leadTime,deliveryTerms:q.deliveryTerms,warranty:q.warranty,notes:q.notes,lines:q.lines,
   subtotal:q.subtotal,discountTotal:q.discountTotal,dpp:q.dpp,tax:q.tax,total:q.total,costTotal:q.costTotal,gp:q.gp,gpPct:q.gpPct,maxDisc:q.maxDisc};
  let r=rec;
  if(!rec){const no=Num.next('QUO');r=DB.insert('quotations',{...data,no,baseNo:no,rev:0,status:'Draft',orderId:rec?.orderId||Quote.pre?.orderId||''});Quote.pre=null}
  else DB.update('quotations',rec.id,data,'','Ubah quotation');
  if(!submit){UI.toast('Draft tersimpan.');Router.go('quotations/'+r.id);return}
  const need=r.gpPct<num(S().minMarginPct)||r.maxDisc>num(S().maxDiscPct);
  if(need){
   DB.update('quotations',r.id,{status:'Menunggu Approval'},'Diajukan untuk approval','Ajukan approval');
   Approval.request({type:'quotation',refCol:'quotations',refId:r.id,title:`Quotation ${r.no} — ${custName(r.customerId)}`,amount:r.total,
    reason:`Margin ${pct(r.gpPct)} (batas ${pct(S().minMarginPct)}), diskon maks ${pct(r.maxDisc)} (batas ${pct(S().maxDiscPct)})`,meta:{forceDirector:r.gpPct<num(S().lowMarginDirectorPct)}});
   UI.toast('Quotation diajukan untuk approval.');
  }else{DB.update('quotations',r.id,{status:'Disetujui',approvedAt:nowISO()},'Memenuhi batas margin & diskon','Disetujui otomatis');UI.toast('Quotation disetujui otomatis (memenuhi batas margin & diskon).')}
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
 approved(a){DB.update('quotations',a.refId,{status:'Disetujui',approvedAt:nowISO()},'Approval disetujui','Disetujui');const q=DB.get('quotations',a.refId);Notify.user(q.salesId,`Quotation ${q.no} disetujui.`,'#/quotations/'+q.id)},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('quotations',a.refId,{status:'Ditolak',rejectReason:s?.note||''},s?.note||'','Ditolak');const q=DB.get('quotations',a.refId);Notify.user(q.salesId,`Quotation ${q.no} ditolak: ${s?.note||''}`,'#/quotations/'+q.id)}
};
CHANGE.qcust={match:t=>t.name==='customerId'&&t.closest('#qform'),run:t=>{const c=DB.get('customers',t.value),p=$('[name="picName"]',$('#qform'));if(c&&p&&!p.value)p.value=c.pic||''}};
CHANGE.qtax={match:t=>t.name==='taxPct'&&t.closest('#qform'),run:()=>Quote.recalc()};
CALC.quote=()=>Quote.recalc();

PAGES.quotations.render=async(v,param)=>{
 if(!param){
  const w=can('quotations','w');
  v.innerHTML=UI.pghead('Quotation',w?'<a class="btn" href="#/quotations/new">+ Quotation baru</a>':'')+'<div class="card" id="ql"></div>';
  new DT($('#ql'),{title:'Quotation',size:15,rows:()=>Scope.rows('quotations').slice().reverse(),onRow:id=>Router.go('quotations/'+id),
   filters:[{k:'s',l:'Status',opts:()=>['Draft','Menunggu Approval','Disetujui','Dikirim','Direvisi','Diterima','Ditolak','Kedaluwarsa'],get:r=>r.status},{k:'c',l:'Customer',opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
   cols:[{k:'no',l:'No.'},{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'s',l:'Sales',text:r=>userName(r.salesId)},
    {k:'total',l:'Total',num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'gp',l:'Margin',num:true,hide:()=>!seeCost(),text:r=>pct(r.gpPct),sortv:r=>r.gpPct},
    {k:'valid',l:'Berlaku s/d',text:r=>fdate(r.validUntil),sortv:r=>r.validUntil},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)+(r.rev?` <small class="mut">R${r.rev}</small>`:'')}]});
  return;
 }
 const isNew=param==='new'||param.startsWith('new/');
 let rec=isNew?null:DB.get('quotations',param);
 if(!isNew&&(!rec||!Scope.ok('quotations',rec))){v.innerHTML=UI.empty('Quotation tidak ditemukan.');return}
 if(isNew){
  if(!can('quotations','w')){v.innerHTML=UI.empty('Anda tidak berhak membuat quotation.');return}
  const oid=param.split('/')[1],o=oid&&DB.get('orders',oid);
  Quote.pre=o?{orderId:o.id}:null;
  rec=o?{customerId:o.customerId,picName:o.pic,salesId:o.salesId,lines:o.items.map(i=>{const p=DB.get('products',i.productId);return {productId:i.productId,desc:i.desc||p?.name||'',qty:i.qty,cost:p?.lastCost||0,price:p?.price||0,discPct:0}}),notes:o.notes?('Ref. '+o.no):''}:null;
 }
 const editable=isNew||(rec.status==='Draft'&&can('quotations','w'));
 const fields=Quote.fields(!editable);
 const st=rec&&rec.id?rec.status:'Baru';
 const acts=[];
 if(rec&&rec.id){
  acts.push(`<button class="btn btn-o" data-act="q-print" data-id="${rec.id}">Cetak / PDF</button>`);
  if(can('quotations','w')&&Scope.ok('quotations',rec)){
   if(['Disetujui','Dikirim','Diterima','Ditolak','Kedaluwarsa'].includes(rec.status))acts.push(`<button class="btn btn-o" data-act="q-revise" data-id="${rec.id}">Buat revisi</button>`);
   if(['Disetujui'].includes(rec.status))acts.push(`<button class="btn" data-act="q-sent" data-id="${rec.id}">Tandai dikirim ke customer</button>`);
   if(rec.status==='Dikirim')acts.push(`<button class="btn btn-d" data-act="q-lost" data-id="${rec.id}">Ditolak customer</button><button class="btn" data-act="q-won" data-id="${rec.id}">Diterima customer</button>`);
  }
  if(can('salesorders','w')&&['Disetujui','Dikirim','Diterima'].includes(rec.status)&&!DB.all('salesorders').some(s=>s.quotationId===rec.id&&s.status!=='Dibatalkan'))acts.push(`<button class="btn" data-act="q-so" data-id="${rec.id}">Buat Sales Order</button>`);
 }
 const vals=rec?clone(rec):{};
 const revs=rec&&rec.baseNo?DB.all('quotations').filter(q=>q.baseNo===rec.baseNo).sort((a,b)=>a.rev-b.rev):[];
 const appr=rec&&rec.id?Approval.forRef('quotations',rec.id):[];
 v.innerHTML=UI.pghead((rec&&rec.no)?`Quotation ${rec.no}`:'Quotation baru',`<a class="btn btn-o" href="#/quotations">‹ Kembali</a>${acts.join('')}`)+
  `<div class="grid split"><div><div class="card"><div class="ch"><span>Data quotation</span>${UI.badge(st)}</div>
   ${rec&&rec.status==='Ditolak'&&rec.rejectReason?`<div class="errbox">Ditolak: ${esc(rec.rejectReason)}</div>`:''}
   <div id="qform">${Form.render(fields,vals,!editable)}</div>
   ${editable?`<div class="acts" style="margin-top:12px"><button class="btn btn-o" data-act="q-save" data-id="${rec?.id||''}">Simpan draft</button><button class="btn" data-act="q-submit" data-id="${rec?.id||''}">Simpan & ajukan</button></div>`:''}</div></div>
   <div><div class="card"><h3>Ringkasan nilai</h3><div id="qtot"></div></div>
   ${revs.length>1?`<div class="card"><h3>Versi revisi</h3>${revs.map(r=>`<div><a href="#/quotations/${r.id}">${esc(r.no)}</a> — ${UI.badge(r.status)}</div>`).join('')}</div>`:''}
   ${appr.length?`<div class="card"><h3>Approval</h3>${appr.map(a=>`<div><a href="#" data-act="appr-open" data-id="${a.id}">${esc(a.no)}</a> ${UI.badge(a.status)}</div>`).join('')}</div>`:''}
   ${rec&&rec.id?`<div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('quotations',rec.id)}</div>`:''}</div></div>`;
 Form.hydrate($('#qform'),fields,vals);
 Quote.recalc();
 Quote._ctx={rec,fields};
};
ACT['appr-open']=el=>Appr.open(el.dataset.id);
ACT['q-save']=()=>Quote.save(Quote._ctx.rec&&Quote._ctx.rec.id?Quote._ctx.rec:null,false,Quote._ctx.fields);
ACT['q-submit']=()=>Quote.save(Quote._ctx.rec&&Quote._ctx.rec.id?Quote._ctx.rec:null,true,Quote._ctx.fields);
ACT['q-print']=el=>Quote.print(DB.get('quotations',el.dataset.id));
ACT['q-sent']=el=>{DB.update('quotations',el.dataset.id,{status:'Dikirim',sentAt:nowISO()},'Dikirim ke customer','Dikirim ke customer');UI.toast('Status: Dikirim.');Router.render()};
ACT['q-won']=el=>{DB.update('quotations',el.dataset.id,{status:'Diterima'},'Diterima customer','Diterima customer');UI.toast('Quotation diterima customer.');Router.render()};
ACT['q-lost']=async el=>{const r=await UI.confirm({title:'Ditolak customer',msg:'Catat alasan penolakan dari customer.',reason:true,danger:true});if(!r)return;DB.update('quotations',el.dataset.id,{status:'Ditolak',rejectReason:'Customer: '+r.reason},r.reason,'Ditolak customer');Router.render()};
ACT['q-revise']=async el=>{
 const q=DB.get('quotations',el.dataset.id);
 const r=await UI.confirm({title:'Buat revisi',msg:`Buat revisi baru dari <b>${esc(q.no)}</b>? Versi lama akan berstatus <i>Direvisi</i> dan tidak dapat diubah.`,reason:true});if(!r)return;
 const rev=q.rev+1,{id,createdAt,createdBy,updatedAt,updatedBy,approvedAt,sentAt,rejectReason,...rest}=q;
 const n=DB.insert('quotations',{...rest,no:`${q.baseNo}-R${rev}`,rev,status:'Draft',validUntil:addDays(today(),S().quoteValidDays||14),date:today()},r.reason);
 DB.update('quotations',q.id,{status:'Direvisi'},r.reason,'Direvisi');
 UI.toast('Revisi dibuat.');Router.go('quotations/'+n.id);
};
ACT['q-so']=async el=>{const so=SO.fromQuote(DB.get('quotations',el.dataset.id));UI.toast('Sales Order dibuat: '+so.no);Router.go('salesorders/'+so.id)};

/* ================= SALES ORDER ================= */
const SO={
 fromQuote(q){
  if(!['Disetujui','Dikirim','Diterima'].includes(q.status))throw new Error('Quotation harus berstatus Disetujui / Dikirim / Diterima.');
  if(DB.all('salesorders').some(s=>s.quotationId===q.id&&s.status!=='Dibatalkan'))throw new Error('Sales Order untuk quotation ini sudah ada.');
  const so=DB.insert('salesorders',{no:Num.next('SO'),quotationId:q.id,orderId:q.orderId||'',customerId:q.customerId,salesId:q.salesId,date:today(),lines:clone(q.lines),taxPct:q.taxPct,
   subtotal:q.subtotal,discountTotal:q.discountTotal,dpp:q.dpp,tax:q.tax,total:q.total,costTotal:q.costTotal,gp:q.gp,gpPct:q.gpPct,paymentTerms:q.paymentTerms,deliveryTerms:q.deliveryTerms,status:'Baru'});
  if(['Disetujui','Dikirim'].includes(q.status))DB.update('quotations',q.id,{status:'Diterima'},'Sales Order '+so.no+' dibuat','Diterima (SO dibuat)');
  if(q.orderId){const o=DB.get('orders',q.orderId);if(o)DB.update('orders',o.id,{soId:so.id,quotationId:q.id},'','Tautkan Sales Order')}
  return so;
 },
 invoices(so){return DB.all('invoices').filter(i=>i.soId===so.id&&!i.cancelled)}
};
Approval.hooks.cancellation={
 approved(a){
  if(a.refCol==='salesorders'){DB.update('salesorders',a.refId,{status:'Dibatalkan',cancelReason:a.reason},a.reason,'Dibatalkan')}
  if(a.refCol==='invoices'){DB.update('invoices',a.refId,{cancelled:true,cancelReason:a.reason},a.reason,'Dibatalkan')}
  if(a.refCol==='orders'){DB.update('orders',a.refId,{cancelled:true,statusText:'Dibatalkan',cancelReason:a.reason},a.reason,'Dibatalkan')}
 },
 rejected(){}
};
async function requestCancel(col,id,label){
 const r=await UI.ask({title:'Ajukan pembatalan (memerlukan approval)',ok:'Ajukan pembatalan',danger:true,fields:[F.ta('reason','Alasan pembatalan',{req:true}),F.fl('files','Lampiran')]});
 if(!r)return;
 if(Approval.forRef(col,id).some(a=>a.type==='cancellation'&&a.status==='Menunggu'))return UI.toast('Sudah ada pengajuan pembatalan yang menunggu.','err');
 const rec=DB.get(col,id);
 Approval.request({type:'cancellation',refCol:col,refId:id,title:`Pembatalan ${label} ${rec.no}`,amount:rec.total||0,reason:r.reason,files:r.files});
 UI.toast('Pengajuan pembatalan dikirim.');Router.render();
}
ACT['cancel-req']=el=>requestCancel(el.dataset.col,el.dataset.id,el.dataset.l);

PAGES.salesorders.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead('Sales Order')+'<div class="card" id="sl"></div>';
  new DT($('#sl'),{title:'Sales Order',rows:()=>Scope.rows('salesorders').slice().reverse(),onRow:id=>Router.go('salesorders/'+id),
   filters:[{k:'s',l:'Status',opts:()=>['Baru','Diproses','Dikirim','Selesai','Dibatalkan'],get:r=>r.status},{k:'c',l:'Customer',opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
   cols:[{k:'no',l:'No. SO'},{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'s',l:'Sales',text:r=>userName(r.salesId)},
    {k:'total',l:'Total',num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'gp',l:'Margin',num:true,hide:()=>!seeCost(),text:r=>pct(r.gpPct),sortv:r=>r.gpPct},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const so=DB.get('salesorders',param);
 if(!so||!Scope.ok('salesorders',so)){v.innerHTML=UI.empty('Sales Order tidak ditemukan.');return}
 const invs=DB.all('invoices').filter(i=>i.soId===so.id),q=DB.get('quotations',so.quotationId),o=DB.get('orders',so.orderId);
 const active=invs.filter(i=>!i.cancelled),remaining=so.dpp-sum(active,i=>i.dpp);
 const acts=[`<a class="btn btn-o" href="#/salesorders">‹ Kembali</a>`];
 if(can('invoices','w')&&so.status!=='Dibatalkan'&&remaining>0.5)acts.push(`<button class="btn" data-act="inv-new" data-so="${so.id}">Buat invoice</button>`);
 if(can('salesorders','w')&&!['Dibatalkan','Selesai'].includes(so.status))acts.push(`<button class="btn btn-d" data-act="cancel-req" data-col="salesorders" data-id="${so.id}" data-l="Sales Order">Ajukan pembatalan</button>`);
 v.innerHTML=UI.pghead('Sales Order '+so.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>Informasi order</span>${UI.badge(so.status)}</div>${UI.kv([['Customer',esc(custName(so.customerId))],['Sales',esc(userName(so.salesId))],['Tanggal',fdate(so.date)],['Quotation',q?docLink('quotations',q):'-'],['New Order',o?docLink('orders',o):'-'],['Payment terms',esc(so.paymentTerms||'-')],['Delivery terms',esc(so.deliveryTerms||'-')]])}</div>
  <div class="card"><h3>Item</h3><div class="tblw"><table><tr><th>Produk</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Diskon</th><th class="num">Jumlah</th></tr>${so.lines.map(l=>{const g=num(l.qty)*num(l.price);return `<tr><td>${esc(l.desc||DB.get('products',l.productId)?.name||'')}</td><td class="num">${nf(l.qty)}</td><td class="num">${rp(l.price)}</td><td class="num">${num(l.discPct)?pct(l.discPct):'-'}</td><td class="num">${rp(g-g*num(l.discPct)/100)}</td></tr>`}).join('')}</table></div></div>
  <div class="card"><h3>Invoice</h3>${invs.length?`<div class="tblw"><table><tr><th>No.</th><th>Jenis</th><th>Jatuh tempo</th><th class="num">Total</th><th class="num">Dibayar</th><th>Status</th></tr>${invs.map(i=>`<tr><td>${docLink('invoices',i)}</td><td>${esc(i.type)}</td><td>${fdate(i.dueDate)}</td><td class="num">${rp(i.total)}</td><td class="num">${rp(Inv.paid(i))}</td><td>${UI.badge(Inv.status(i))}</td></tr>`).join('')}</table></div>`:'<div class="empty">Belum ada invoice.</div>'}</div></div>
  <div><div class="card"><h3>Nilai</h3><dl class="kv"><dt>DPP</dt><dd>${rp(so.dpp)}</dd><dt>PPN</dt><dd>${rp(so.tax)}</dd><dt><b>Total</b></dt><dd><b>${rp(so.total)}</b></dd><dt>Ditagihkan</dt><dd>${rp(sum(active,i=>i.total))}</dd><dt>Dibayar</dt><dd>${rp(sum(active,i=>Inv.paid(i)))}</dd>
   ${seeCost()?`<dt>Harga beli</dt><dd>${rp(so.costTotal)}</dd><dt>Gross profit</dt><dd>${rp(so.gp)} (${pct(so.gpPct)})</dd>`:''}</dl></div>
  <div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('salesorders',so.id)}</div></div></div>`;
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
  if(type==='Penuh'&&used>0)throw new Error('Invoice penuh hanya bisa dibuat bila belum ada invoice lain untuk SO ini.');
  if(dpp<=0.5||dpp>so.dpp-used+0.5)throw new Error('Nilai invoice melebihi sisa tagihan Sales Order ('+rp(so.dpp-used)+' sebelum PPN).');
  const tax=dpp*num(so.taxPct)/100;
  const inv=DB.insert('invoices',{no:Num.next('INV'),soId:so.id,orderId:so.orderId||'',customerId:so.customerId,salesId:so.salesId,type,date,dueDate:addDays(date,num(terms)),
   dpp,taxPct:so.taxPct,tax,total:dpp+tax,desc:note||(type==='DP'?`Down payment ${pct(p)}`:type==='Pelunasan'?'Pelunasan':'Pembayaran penuh')+' — '+so.no,payments:[],cancelled:false});
  if(so.status==='Baru')DB.update('salesorders',so.id,{status:'Diproses'},'Invoice dibuat','Diproses');
  return inv;
 }
};
ACT['inv-new']=async el=>{
 const so=DB.get('salesorders',el.dataset.so),used=sum(DB.all('invoices').filter(i=>i.soId===so.id&&!i.cancelled),i=>i.dpp);
 const cust=DB.get('customers',so.customerId),pt=DB.get('payterms',cust?.paymentTermId);
 const v=await UI.ask({title:'Buat invoice — '+so.no,ok:'Buat invoice',fields:[
  F.s('type','Jenis invoice',['DP','Pelunasan','Penuh'],{req:true,def:used>0?'Pelunasan':(pt&&pt.dpPct?'DP':'Penuh')}),F.pc('pct','Persentase DP (%) — khusus jenis DP',{def:pt?.dpPct||30}),
  F.d('date','Tanggal invoice',{req:true,def:today()}),F.n('terms','Jatuh tempo (hari)',{req:true,def:pt?.days||0}),F.ta('note','Keterangan (opsional)')],
  pre:`<div class="info" style="margin-bottom:10px">Total SO (DPP): <b>${rp(so.dpp)}</b> • sudah ditagihkan: <b>${rp(used)}</b> • sisa: <b>${rp(so.dpp-used)}</b></div>`});
 if(!v)return;
 if(v.type==='DP'&&!(num(v.pct)>0&&num(v.pct)<=100))return UI.toast('Persentase DP tidak valid.','err');
 const i=Inv.create(so,v);UI.toast('Invoice dibuat: '+i.no);
 if(so.orderId)Order.touch(so.orderId);
 Router.render();
};

PAGES.invoices.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead('Customer Invoice')+'<div class="card" id="il"></div>';
  new DT($('#il'),{title:'Customer Invoice',rows:()=>Scope.rows('invoices').slice().reverse(),onRow:id=>Router.go('invoices/'+id),
   filters:[{k:'s',l:'Status',opts:()=>['Belum dibayar','DP diterima','Dibayar sebagian','Lunas','Jatuh tempo','Terlambat','Dibatalkan'],get:r=>Inv.status(r)},{k:'c',l:'Customer',opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
   cols:[{k:'no',l:'No. Invoice'},{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'type',l:'Jenis'},{k:'due',l:'Jatuh tempo',text:r=>fdate(r.dueDate),sortv:r=>r.dueDate},
    {k:'total',l:'Total',num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'paid',l:'Dibayar',num:true,text:r=>rp(Inv.paid(r)),sortv:r=>Inv.paid(r)},{k:'st',l:'Status',text:r=>Inv.status(r),html:r=>UI.badge(Inv.status(r))}]});
  return;
 }
 const i=DB.get('invoices',param);
 if(!i||!Scope.ok('invoices',i)){v.innerHTML=UI.empty('Invoice tidak ditemukan.');return}
 const so=DB.get('salesorders',i.soId),st=Inv.status(i),canPay=can('invoices','w')&&isRole('finance','president_director','manager');
 const acts=[`<a class="btn btn-o" href="#/invoices">‹ Kembali</a>`,`<button class="btn btn-o" data-act="inv-print" data-id="${i.id}">Cetak / PDF</button>`];
 if(canPay&&!i.cancelled&&Inv.outstanding(i)>0)acts.push(`<button class="btn" data-act="inv-pay" data-id="${i.id}">Catat pembayaran</button>`);
 if(can('invoices','w')&&!i.cancelled&&!(i.payments||[]).length)acts.push(`<button class="btn btn-d" data-act="cancel-req" data-col="invoices" data-id="${i.id}" data-l="Invoice">Ajukan pembatalan</button>`);
 v.innerHTML=UI.pghead('Invoice '+i.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>Informasi invoice</span>${UI.badge(st)}</div>${UI.kv([['Customer',esc(custName(i.customerId))],['Jenis',esc(i.type)],['Sales Order',so?docLink('salesorders',so):'-'],['Tanggal',fdate(i.date)],['Jatuh tempo',fdate(i.dueDate)],['Keterangan',esc(i.desc)],['Aging',esc(Inv.aging(i))]])}</div>
  <div class="card"><h3>Pembayaran masuk</h3>${(i.payments||[]).length?`<div class="tblw"><table><tr><th>Tanggal</th><th>Metode</th><th>Referensi</th><th class="num">Jumlah</th><th>Bukti</th><th>Dicatat oleh</th></tr>${i.payments.map(p=>`<tr><td>${fdate(p.date)}</td><td>${esc(p.method)}</td><td>${esc(p.ref||'')}</td><td class="num">${rp(p.amount)}</td><td><div class="files" data-files="p${p.id}" data-ro="1"></div></td><td>${esc(p.byName)}</td></tr>`).join('')}</table></div>`:'<div class="empty">Belum ada pembayaran.</div>'}</div></div>
  <div><div class="card"><h3>Nilai</h3><dl class="kv"><dt>DPP</dt><dd>${rp(i.dpp)}</dd><dt>PPN ${pct(i.taxPct)}</dt><dd>${rp(i.tax)}</dd><dt><b>Total</b></dt><dd><b>${rp(i.total)}</b></dd><dt>Dibayar</dt><dd>${rp(Inv.paid(i))}</dd><dt>Sisa tagihan</dt><dd><b>${rp(Inv.outstanding(i))}</b></dd></dl></div>
  <div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('invoices',i.id)}</div></div></div>`;
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
 const v=await UI.ask({title:'Catat pembayaran — '+i.no,ok:'Simpan pembayaran',fields:[F.d('date','Tanggal terima',{req:true,def:today()}),F.m('amount','Jumlah diterima (Rp)',{req:true,def:out}),
  F.s('method','Metode',['Transfer bank','Tunai','Giro / Cek','Virtual account'],{req:true,def:'Transfer bank'}),F.r('bankId','Rekening tujuan','banks'),F.t('ref','No. referensi / bukti transfer'),F.fl('files','Bukti transfer (upload)')],
  pre:`<div class="info" style="margin-bottom:10px">Sisa tagihan: <b>${rp(out)}</b></div>`});
 if(!v)return;
 if(!(num(v.amount)>0))return UI.toast('Jumlah harus lebih dari 0.','err');
 if(num(v.amount)>out+0.5)return UI.toast('Jumlah melebihi sisa tagihan ('+rp(out)+').','err');
 const before=clone(i.payments||[]),payments=[...before,{id:uid(),...v,amount:num(v.amount),by:Auth.uid(),byName:Auth.user.name,at:nowISO()}];
 DB.update('invoices',i.id,{payments},'Pembayaran '+rp(v.amount),'Catat pembayaran');
 const upd=DB.get('invoices',i.id);
 UI.toast('Pembayaran dicatat. Status: '+Inv.status(upd));
 if(i.orderId){const o=DB.get('orders',i.orderId);if(o){Notify.user(o.salesId,`Pembayaran ${rp(v.amount)} diterima untuk ${i.no} (${Inv.status(upd)}).`,'#/orders/'+o.id);Order.touch(o.id)}}
 Router.render();
};
