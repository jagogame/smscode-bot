'use strict';
/* =========================================================
   KENTFORD ERP - Tahap 3: Purchasing, Supplier, Incoming,
   Inventory lanjutan (barang masuk/keluar, transfer, opname, barcode)
   ========================================================= */
const PR_ITEM_COLS=[{k:'productId',l:'Produk',t:'ref',ref:'products',w:'220px'},{k:'desc',l:'Keterangan',t:'text',w:'200px'},{k:'qty',l:'Qty',t:'number',w:'80px'}];
const supName=id=>DB.get('suppliers',id)?.name||'-';
const whName=id=>DB.get('warehouses',id)?.name||'-';

/* ================= PURCHASE REQUEST ================= */
const PR={
 fields:()=>[F.s('source','Sumber',['Manual','Sales Order','Permintaan Gudang','Permintaan Teknisi','Kebutuhan Rental','Minimum Stock'],{req:true,def:'Manual'}),
  F.d('neededBy','Dibutuhkan tanggal',{req:true,def:()=>addDays(today(),14)}),{k:'items',l:'Barang yang diminta',t:'lines',cols:PR_ITEM_COLS,min:1},F.ta('notes','Catatan / alasan')],
 amount(items){return sum(items,i=>num(i.qty)*num(DB.get('products',i.productId)?.lastCost))},
 async submit(rec){
  const need=DB.all('approvalLimits').some(x=>x.type==='purchase_request');
  if(!need){DB.update('pr',rec.id,{status:'Disetujui'},'Tidak ada aturan approval','Disetujui otomatis');UI.toast('PR disetujui otomatis (tanpa aturan approval).');return}
  DB.update('pr',rec.id,{status:'Menunggu Approval'},'Diajukan','Ajukan approval');
  Approval.request({type:'purchase_request',refCol:'pr',refId:rec.id,title:`PR ${rec.no} — ${rec.items.length} item`,amount:this.amount(rec.items),reason:rec.notes||''});
  UI.toast('PR diajukan untuk approval.');
 }
};
Approval.hooks.purchase_request={
 approved(a){const p=DB.get('pr',a.refId);if(p)DB.update('pr',p.id,{status:'Disetujui'},'Approval disetujui','Disetujui');Notify.user(p?.requesterId,`PR ${p?.no} disetujui.`,'#/pr/'+a.refId)},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('pr',a.refId,{status:'Ditolak',rejectReason:s?.note||''},s?.note||'','Ditolak')}
};
PAGES.pr.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   if(!can('pr','w'))return v.innerHTML=UI.empty('Anda tidak berhak membuat Purchase Request.');
   const fields=PR.fields();PR._ctx={fields};
   v.innerHTML=UI.pghead('Purchase Request baru',`<a class="btn btn-o" href="#/pr">‹ Batal</a>`)+`<div class="card"><div id="prform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn btn-o" data-act="pr-save">Simpan draft</button><button class="btn" data-act="pr-submit">Simpan & ajukan</button></div></div>`;
   Form.hydrate($('#prform'),fields,{});return;
  }
  v.innerHTML=UI.pghead('Purchase Request',can('pr','w')?'<a class="btn" href="#/pr/new">+ PR baru</a>':'')+'<div class="card" id="prl"></div>';
  new DT($('#prl'),{title:'Purchase Request',rows:()=>DB.all('pr').slice().reverse(),onRow:id=>Router.go('pr/'+id),
   filters:[{k:'s',l:'Status',opts:()=>['Draft','Menunggu Approval','Disetujui','Ditolak','Selesai'],get:r=>r.status},{k:'src',l:'Sumber',opts:()=>['Manual','Sales Order','Permintaan Gudang','Permintaan Teknisi','Kebutuhan Rental','Minimum Stock'],get:r=>r.source}],
   cols:[{k:'no',l:'No. PR'},{k:'src',l:'Sumber',text:r=>r.source},{k:'req',l:'Pemohon',text:r=>userName(r.requesterId)},{k:'nb',l:'Dibutuhkan',text:r=>fdate(r.neededBy),sortv:r=>r.neededBy},
    {k:'n',l:'Jumlah item',num:true,text:r=>String(r.items.length)},{k:'val',l:'Estimasi nilai',num:true,hide:()=>!seeCost(),text:r=>rp(PR.amount(r.items))},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const r=DB.get('pr',param);if(!r)return v.innerHTML=UI.empty('PR tidak ditemukan.');
 const sqs=DB.all('sq').filter(x=>x.prId===r.id),pos=DB.all('po').filter(x=>x.prId===r.id);
 const acts=[`<a class="btn btn-o" href="#/pr">‹ Kembali</a>`];
 if(can('sq','w')&&r.status==='Disetujui')acts.push(`<button class="btn btn-o" data-act="sq-new" data-pr="${r.id}">+ Supplier Quotation</button>`);
 if(can('po','w')&&r.status==='Disetujui'&&!pos.length)acts.push(`<a class="btn" href="#/pc/${r.id}">Bandingkan & buat PO</a>`);
 v.innerHTML=UI.pghead('PR '+r.no,acts.join(''))+`<div class="card"><div class="ch"><span>Detail permintaan</span>${UI.badge(r.status)}</div>${UI.kv([['Sumber',esc(r.source)],['Pemohon',esc(userName(r.requesterId))],['Dibutuhkan',fdate(r.neededBy)],['Catatan',esc(r.notes||'-')]])}
  <div class="tblw" style="margin-top:8px"><table><tr><th>Produk</th><th>Keterangan</th><th class="num">Qty</th></tr>${r.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name||'-')}</td><td>${esc(i.desc||'')}</td><td class="num">${nf(i.qty)}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>Supplier Quotation (${sqs.length})</h3>${sqs.length?sqs.map(s=>`<div>${esc(supName(s.supplierId))} — ${rp(sum(s.items,i=>num(i.qty)*num(i.price)))} <span class="mut">(lead time ${esc(s.leadTime||'-')})</span></div>`).join(''):'<div class="empty">Belum ada penawaran supplier.</div>'}</div>
  <div class="card"><h3>Purchase Order (${pos.length})</h3>${pos.length?pos.map(p=>`<div>${docLink('po',p)} — ${supName(p.supplierId)} ${UI.badge(p.status)}</div>`).join(''):'<div class="empty">Belum ada PO.</div>'}</div>
  <div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('pr',r.id)}</div>`;
};
ACT['pr-save']=()=>{
 const {fields}=PR._ctx,{v}=Form.collect($('#prform'),fields);
 const rec=DB.insert('pr',{...v,no:Num.next('PR'),requesterId:Auth.uid(),status:'Draft'});
 UI.toast('Draft PR tersimpan.');Router.go('pr/'+rec.id);
};
ACT['pr-submit']=async()=>{
 const {fields}=PR._ctx,{v,err}=Form.collect($('#prform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 if(v.items.some(i=>!i.productId||!(num(i.qty)>0)))return UI.toast('Setiap baris harus memiliki produk dan qty > 0.','err');
 const rec=DB.insert('pr',{...v,no:Num.next('PR'),requesterId:Auth.uid(),status:'Draft'});
 await PR.submit(rec);Router.go('pr/'+rec.id);
};
docLink; // referenced below too

/* ================= SUPPLIER QUOTATION & PRICE COMPARISON ================= */
PAGES.sq.render=async v=>{
 v.innerHTML=UI.pghead('Supplier Quotation')+'<div class="card" id="sql"></div>';
 new DT($('#sql'),{title:'Supplier Quotation',rows:()=>DB.all('sq').slice().reverse(),onRow:id=>{const s=DB.get('sq',id);Router.go('pr/'+s.prId)},
  cols:[{k:'pr',l:'PR',text:r=>DB.get('pr',r.prId)?.no||'-'},{k:'s',l:'Supplier',text:r=>supName(r.supplierId)},{k:'n',l:'Item',num:true,text:r=>String(r.items.length)},
   {k:'total',l:'Total',num:true,text:r=>rp(sum(r.items,i=>num(i.qty)*num(i.price))),sortv:r=>sum(r.items,i=>num(i.qty)*num(i.price))},{k:'lt',l:'Lead time',text:r=>r.leadTime||'-'},{k:'w',l:'Warranty',text:r=>r.warranty||'-'},{k:'pt',l:'Payment terms',text:r=>r.paymentTerms||'-'}]});
};
ACT['sq-new']=async el=>{
 const pr=DB.get('pr',el.dataset.pr);
 const cols=[{k:'productId',l:'Produk',t:'ref',ref:'products',w:'200px'},{k:'qty',l:'Qty',t:'number',w:'70px'},{k:'price',l:'Harga satuan',t:'number',w:'120px'}];
 const v=await UI.ask({title:'Supplier Quotation — '+pr.no,ok:'Simpan',wide:true,fields:[F.r('supplierId','Supplier','suppliers',{req:true}),F.t('leadTime','Lead time',{ph:'mis. 6 minggu'}),F.t('warranty','Garansi',{ph:'mis. 12 bulan'}),
  F.s('paymentTerms','Payment terms',()=>DB.all('payterms').map(p=>p.name)),{k:'items',l:'Item & harga',t:'lines',cols,min:1},F.fl('files','Dokumen penawaran')],
  vals:{items:pr.items.map(i=>({productId:i.productId,qty:i.qty,price:DB.get('products',i.productId)?.lastCost||0}))}});
 if(!v)return;
 if(v.items.some(i=>!i.productId||!(num(i.qty)>0)||num(i.price)<0))return UI.toast('Lengkapi produk, qty, dan harga pada setiap baris.','err');
 DB.insert('sq',{...v,prId:pr.id});UI.toast('Supplier quotation tersimpan.');Router.render();
};
PAGES.pc.render=async(v,param)=>{
 const prs=DB.all('pr').filter(p=>p.status==='Disetujui'&&!DB.all('po').some(o=>o.prId===p.id));
 const pr=param?DB.get('pr',param):prs[0];
 v.innerHTML=UI.pghead('Price Comparison')+`<div class="card"><label>Pilih PR</label><select id="pcsel">${prs.map(p=>`<option value="${p.id}" ${pr&&p.id===pr.id?'selected':''}>${esc(p.no)} — ${p.items.length} item</option>`).join('')||'<option value="">Tidak ada PR yang siap dibandingkan</option>'}</select></div><div id="pcbody"></div>`;
 $('#pcsel').addEventListener('change',e=>Router.go('pc/'+e.target.value));
 if(!pr)return;
 const sqs=DB.all('sq').filter(s=>s.prId===pr.id);
 $('#pcbody').innerHTML=!sqs.length?UI.empty('Belum ada Supplier Quotation untuk PR ini.'):
  `<div class="card"><div class="tblw"><table><tr><th>Supplier</th><th class="num">Total harga</th><th>Lead time</th><th>Warranty</th><th>Payment terms</th><th></th></tr>
   ${sqs.map(s=>{const t=sum(s.items,i=>num(i.qty)*num(i.price));return `<tr><td>${esc(supName(s.supplierId))}</td><td class="num">${rp(t)}</td><td>${esc(s.leadTime||'-')}</td><td>${esc(s.warranty||'-')}</td><td>${esc(s.paymentTerms||'-')}</td><td>${can('po','w')?`<button class="btn btn-sm" data-act="pc-choose" data-id="${s.id}">Pilih & buat PO</button>`:''}</td></tr>`}).join('')}</table></div></div>`;
};
ACT['pc-choose']=async el=>{
 const s=DB.get('sq',el.dataset.id),pr=DB.get('pr',s.prId),sup=DB.get('suppliers',s.supplierId);
 const po=DB.insert('po',{no:Num.next('PO'),prId:pr.id,supplierId:s.supplierId,currency:sup?.currency||'IDR',kurs:1,taxPct:S().defaultTaxPct??11,
  dpPct:DB.get('payterms',sup?.paymentTermId)?.dpPct||0,incoterm:'',etaDate:'',items:s.items.map(i=>({productId:i.productId,qty:i.qty,price:i.price,received:0})),status:'Draft',trackingNotes:[]});
 DB.update('pr',pr.id,{status:'Selesai'},'PO dibuat: '+po.no,'PO dibuat');
 UI.toast('PO dibuat: '+po.no);Router.go('po/'+po.id);
};

/* ================= PURCHASE ORDER ================= */
const POH={
 calc(po){const sub=sum(po.items,i=>num(i.qty)*num(i.price)),idr=sub*num(po.kurs||1),tax=idr*num(po.taxPct)/100,total=idr+tax;return {sub,idr,tax,total,dp:total*num(po.dpPct)/100}},
 async submit(po){
  const c=this.calc(po);
  if(!DB.all('approvalLimits').some(x=>x.type==='purchase_order')){DB.update('po',po.id,{status:'Disetujui'},'Tanpa aturan approval','Disetujui otomatis');UI.toast('PO disetujui otomatis.');return}
  DB.update('po',po.id,{status:'Menunggu Approval'},'Diajukan','Ajukan approval');
  Approval.request({type:'purchase_order',refCol:'po',refId:po.id,title:`PO ${po.no} — ${supName(po.supplierId)}`,amount:c.total});
  UI.toast('PO diajukan untuk approval.');
 }
};
Approval.hooks.purchase_order={
 approved(a){DB.update('po',a.refId,{status:'Disetujui'},'Approval disetujui','Disetujui');Notify.role('purchasing',`PO ${DB.get('po',a.refId)?.no} disetujui.`,'#/po/'+a.refId)},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('po',a.refId,{status:'Ditolak',rejectReason:s?.note||''},s?.note||'','Ditolak')}
};
PAGES.po.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead('Purchase Order')+'<div class="card" id="pol"></div>';
  new DT($('#pol'),{title:'Purchase Order',rows:()=>DB.all('po').slice().reverse(),onRow:id=>Router.go('po/'+id),
   filters:[{k:'s',l:'Status',opts:()=>['Draft','Menunggu Approval','Disetujui','Dikirim Supplier','Sebagian Diterima','Diterima','Ditolak','Dibatalkan'],get:r=>r.status}],
   cols:[{k:'no',l:'No. PO'},{k:'s',l:'Supplier',text:r=>supName(r.supplierId)},{k:'cur',l:'Mata uang',text:r=>r.currency},{k:'total',l:'Total (Rp)',num:true,text:r=>rp(POH.calc(r).total),sortv:r=>POH.calc(r).total},
    {k:'eta',l:'ETA',text:r=>r.etaDate?fdate(r.etaDate):'-'},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const po=DB.get('po',param);if(!po)return v.innerHTML=UI.empty('PO tidak ditemukan.');
 const c=POH.calc(po),grs=DB.all('gr').filter(g=>g.poId===po.id);
 const acts=[`<a class="btn btn-o" href="#/po">‹ Kembali</a>`,`<button class="btn btn-o" data-act="po-print" data-id="${po.id}">Cetak / PDF</button>`];
 if(po.status==='Draft'&&can('po','w')){acts.push(`<button class="btn" data-act="po-submit" data-id="${po.id}">Ajukan approval</button>`);}
 if(po.status==='Disetujui'&&can('po','w'))acts.push(`<button class="btn" data-act="po-send" data-id="${po.id}">Tandai dikirim ke supplier</button>`);
 if(['Dikirim Supplier','Sebagian Diterima'].includes(po.status)&&can('gr','w'))acts.push(`<a class="btn" href="#/gr/new/${po.id}">Barang Masuk (GR)</a>`);
 if(['Sebagian Diterima','Diterima'].includes(po.status)&&can('si','w'))acts.push(`<button class="btn btn-o" data-act="si-fromPO" data-id="${po.id}">Buat Supplier Invoice</button>`);
 v.innerHTML=UI.pghead('PO '+po.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>Informasi PO</span>${UI.badge(po.status)}</div>${UI.kv([['Supplier',esc(supName(po.supplierId))],['PR terkait',po.prId?docLink('pr',DB.get('pr',po.prId)):'-'],['Mata uang',esc(po.currency)+(po.currency!=='IDR'?' • kurs '+nf(po.kurs):'')],
   ['Incoterm',esc(po.incoterm||'-')],['ETA',po.etaDate?fdate(po.etaDate):'-'],['DP',pct(po.dpPct)+' = '+rp(c.dp)]])}</div>
  <div class="card"><h3>Item</h3><div class="tblw"><table><tr><th>Produk</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Diterima</th></tr>${po.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name||'-')}</td><td class="num">${nf(i.qty)}</td><td class="num">${rp(i.price)}</td><td class="num">${num(i.received)}/${nf(i.qty)}</td></tr>`).join('')}
   <tr><td colspan="3" class="right">Subtotal (${esc(po.currency)})</td><td class="num">${nf(c.sub)}</td></tr>${po.currency!=='IDR'?`<tr><td colspan="3" class="right">Dalam Rupiah</td><td class="num">${rp(c.idr)}</td></tr>`:''}<tr><td colspan="3" class="right">PPN ${pct(po.taxPct)}</td><td class="num">${rp(c.tax)}</td></tr><tr><td colspan="3" class="right"><b>Total</b></td><td class="num"><b>${rp(c.total)}</b></td></tr></table></div></div>
  <div class="card"><h3>Tracking pengiriman</h3>${(po.trackingNotes||[]).map(t=>`<div class="ev">${esc(t.text)}<br><small class="mut">${fdt(t.at)} — ${esc(t.by)}</small></div>`).join('')||'<div class="empty">Belum ada catatan.</div>'}
   ${['Disetujui','Dikirim Supplier','Sebagian Diterima'].includes(po.status)&&can('po','w')?`<div class="acts" style="margin-top:8px"><button class="btn btn-o btn-sm" data-act="po-track" data-id="${po.id}">+ Update ETA / catatan</button></div>`:''}</div>
  <div class="card"><h3>Barang masuk (GR)</h3>${grs.length?grs.map(g=>`<div>${docLink('gr',g)} — ${fdate(g.date)} — ${g.items.length} item</div>`).join(''):'<div class="empty">Belum ada penerimaan.</div>'}</div></div>
  <div><div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('po',po.id)}</div></div></div>`;
};
ACT['po-submit']=el=>POH.submit(DB.get('po',el.dataset.id)).then(()=>Router.render());
ACT['po-send']=el=>{DB.update('po',el.dataset.id,{status:'Dikirim Supplier'},'Dikirim ke supplier','Dikirim ke supplier');UI.toast('Status: Dikirim Supplier.');Router.render()};
ACT['po-track']=async el=>{
 const po=DB.get('po',el.dataset.id);
 const v=await UI.ask({title:'Update tracking PO',fields:[F.d('etaDate','Estimasi kedatangan',{def:po.etaDate}),F.ta('note','Catatan (mis. status produksi/pengiriman)')]});
 if(!v)return;
 const notes=[...(po.trackingNotes||[])];if(v.note)notes.push({at:nowISO(),by:Auth.user.name,text:v.note});
 DB.update('po',po.id,{etaDate:v.etaDate,trackingNotes:notes},v.note||'','Update tracking');UI.toast('Tracking diperbarui.');Router.render();
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
 v.innerHTML=UI.pghead('Incoming Shipment')+'<div class="card" id="incl"></div>';
 new DT($('#incl'),{title:'Incoming Shipment',rows:()=>DB.all('po').filter(p=>['Disetujui','Dikirim Supplier','Sebagian Diterima'].includes(p.status)).slice().reverse(),onRow:id=>Router.go('po/'+id),
  cols:[{k:'no',l:'No. PO'},{k:'s',l:'Supplier',text:r=>supName(r.supplierId)},{k:'eta',l:'ETA',text:r=>r.etaDate?fdate(r.etaDate):'Belum ada',sortv:r=>r.etaDate||''},
   {k:'n',l:'Catatan terakhir',text:r=>(r.trackingNotes||[]).slice(-1)[0]?.text||'-'},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
};

/* ================= BARANG MASUK (GR) ================= */
PAGES.gr.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead('Barang Masuk')+'<div class="card" id="grl"></div>';
  new DT($('#grl'),{title:'Barang Masuk',rows:()=>DB.all('gr').slice().reverse(),onRow:id=>Router.go('gr/'+id),
   cols:[{k:'no',l:'No. GR'},{k:'po',l:'PO',text:r=>DB.get('po',r.poId)?.no||'-'},{k:'w',l:'Gudang',text:r=>whName(r.whId)},{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'n',l:'Item',num:true,text:r=>String(r.items.length)}]});
  return;
 }
 if(param.startsWith('new/')){
  if(!can('gr','w'))return v.innerHTML=UI.empty('Anda tidak berhak mencatat barang masuk.');
  const po=DB.get('po',param.slice(4));if(!po)return v.innerHTML=UI.empty('PO tidak ditemukan.');
  const cols=[{k:'productId',l:'Produk',t:'select',sort:false,opts:()=>po.items.map(i=>({v:i.productId,l:DB.get('products',i.productId)?.name})),w:'220px'},{k:'qty',l:'Qty diterima',t:'number',w:'90px'},{k:'serial',l:'No. seri',t:'text',w:'150px'}];
  const fields=[F.r('whId','Terima di gudang','warehouses',{req:true,def:'w_ckr'}),F.d('date','Tanggal terima',{req:true,def:()=>today()}),
   {k:'items',l:'Barang diterima',t:'lines',cols,min:1},F.fl('files','Foto / dokumen (packing list, invoice)')];
  const vals={items:po.items.filter(i=>num(i.received)<num(i.qty)).map(i=>({productId:i.productId,qty:num(i.qty)-num(i.received),serial:''}))};
  GR._ctx={po,fields};
  v.innerHTML=UI.pghead('Barang Masuk — '+po.no,`<a class="btn btn-o" href="#/po/${po.id}">‹ Batal</a>`)+`<div class="card"><div class="info">Sisa belum diterima: ${po.items.map(i=>`${esc(DB.get('products',i.productId)?.name)} ${num(i.qty)-num(i.received)}/${nf(i.qty)}`).join(', ')}</div><div id="grform" style="margin-top:10px">${Form.render(fields,vals)}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="gr-save">Simpan penerimaan</button></div></div>`;
  Form.hydrate($('#grform'),fields,vals);return;
 }
 const g=DB.get('gr',param);if(!g)return v.innerHTML=UI.empty('GR tidak ditemukan.');
 v.innerHTML=UI.pghead('GR '+g.no,`<a class="btn btn-o" href="#/gr">‹ Kembali</a>`)+`<div class="card">${UI.kv([['PO',docLink('po',DB.get('po',g.poId))],['Gudang',esc(whName(g.whId))],['Tanggal',fdate(g.date)]])}<div class="tblw" style="margin-top:8px"><table><tr><th>Produk</th><th class="num">Qty</th><th>Serial</th></tr>${g.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name||'')}</td><td class="num">${nf(i.qty)}</td><td>${esc(i.serial||'-')}</td></tr>`).join('')}</table></div></div>`;
};
const GR={_ctx:null};
ACT['gr-save']=()=>{
 const {po,fields}=GR._ctx,{v,err}=Form.collect($('#grform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 const items=v.items.filter(i=>i.productId&&num(i.qty)>0);
 if(!items.length)return UI.toast('Isi minimal satu barang diterima.','err');
 for(const i of items){const line=po.items.find(x=>x.productId===i.productId);const max=num(line?.qty)-num(line?.received);if(num(i.qty)>max)return UI.toast(`Qty ${DB.get('products',i.productId)?.name} melebihi sisa PO (maks ${max}).`,'err')}
 const gr=DB.insert('gr',{...v,items,no:Num.next('GR'),poId:po.id});
 items.forEach(i=>{Stock.change(i.productId,v.whId,num(i.qty),'Barang masuk',gr.no,'PO '+po.no);
  const line=po.items.find(x=>x.productId===i.productId);if(line){line.received=num(line.received)+num(i.qty);DB.update('products',i.productId,{lastCost:line.price},'Update harga beli dari PO '+po.no,'Update harga beli')}});
 DB.save('po');
 const done=po.items.every(i=>num(i.received)>=num(i.qty));
 DB.update('po',po.id,{status:done?'Diterima':'Sebagian Diterima'},'Barang masuk '+gr.no,'Barang masuk');
 UI.toast('Barang masuk dicatat: '+gr.no);Router.go('gr/'+gr.id);
};

/* ================= BARANG KELUAR (manual, non New Order) ================= */
PAGES.gi.render=async v=>{
 v.innerHTML=UI.pghead('Barang Keluar',can('gi','w')?'<button class="btn" data-act="gi-new">+ Barang Keluar</button>':'')+'<div class="card" id="gil"></div>';
 new DT($('#gil'),{title:'Barang Keluar',rows:()=>DB.all('stock_moves').filter(m=>m.type==='Keluar manual').slice().reverse(),
  cols:[{k:'at',l:'Waktu',text:r=>fdt(r.at),sortv:r=>r.at},{k:'p',l:'Produk',text:r=>DB.get('products',r.productId)?.name},{k:'w',l:'Gudang',text:r=>whName(r.whId)},{k:'q',l:'Qty',num:true,text:r=>String(-r.delta)},{k:'note',l:'Keperluan'},{k:'by',l:'Oleh',text:r=>r.byName}]});
};
ACT['gi-new']=async()=>{
 const v=await UI.ask({title:'Barang Keluar (manual)',ok:'Simpan',fields:[F.r('productId','Produk','products',{req:true}),F.r('whId','Dari gudang','warehouses',{req:true,def:'w_ckr'}),F.n('qty','Qty',{req:true}),F.ta('note','Keperluan / referensi',{req:true})]});
 if(!v)return;
 if(!(num(v.qty)>0))return UI.toast('Qty harus lebih dari 0.','err');
 try{Stock.change(v.productId,v.whId,-num(v.qty),'Keluar manual','',v.note)}catch(e){return UI.toast(e.message,'err')}
 UI.toast('Barang keluar dicatat.');Router.render();
};

/* ================= TRANSFER LOKASI ================= */
PAGES.transfer.render=async v=>{
 v.innerHTML=UI.pghead('Transfer Lokasi',can('transfer','w')?'<button class="btn" data-act="transfer-new">+ Transfer</button>':'')+'<div class="card" id="trl"></div>';
 new DT($('#trl'),{title:'Transfer Lokasi',rows:()=>DB.all('transfers').slice().reverse(),
  cols:[{k:'no',l:'No.'},{k:'f',l:'Dari',text:r=>whName(r.fromWh)},{k:'t',l:'Ke',text:r=>whName(r.toWh)},{k:'n',l:'Item',num:true,text:r=>String(r.items.length)},{k:'at',l:'Waktu',text:r=>fdt(r.createdAt),sortv:r=>r.createdAt}],
  onRow:id=>{const t=DB.get('transfers',id);UI.modal({title:'Transfer '+t.no,body:UI.kv([['Dari',whName(t.fromWh)],['Ke',whName(t.toWh)]])+`<div class="tblw"><table><tr><th>Produk</th><th class="num">Qty</th></tr>${t.items.map(i=>`<tr><td>${esc(DB.get('products',i.productId)?.name)}</td><td class="num">${nf(i.qty)}</td></tr>`).join('')}</table></div>`,foot:'<button class="btn btn-o" data-x="c">Tutup</button>'});}});
};
ACT['transfer-new']=async()=>{
 const cols=[{k:'productId',l:'Produk',t:'ref',ref:'products',w:'220px'},{k:'qty',l:'Qty',t:'number',w:'90px'}];
 const v=await UI.ask({title:'Transfer Lokasi',ok:'Proses transfer',wide:true,fields:[F.r('fromWh','Dari gudang','warehouses',{req:true}),F.r('toWh','Ke gudang','warehouses',{req:true}),{k:'items',l:'Barang',t:'lines',cols,min:1},F.ta('notes','Catatan')]});
 if(!v)return;
 if(v.fromWh===v.toWh)return UI.toast('Gudang asal dan tujuan tidak boleh sama.','err');
 const items=v.items.filter(i=>i.productId&&num(i.qty)>0);if(!items.length)return UI.toast('Isi minimal satu barang.','err');
 for(const i of items)if(Stock.qty(i.productId,v.fromWh)<num(i.qty))return UI.toast(`Stok ${DB.get('products',i.productId)?.name} di ${whName(v.fromWh)} tidak cukup.`,'err');
 const no=Num.next('TR');
 items.forEach(i=>{Stock.change(i.productId,v.fromWh,-num(i.qty),'Transfer keluar',no,whName(v.toWh));Stock.change(i.productId,v.toWh,num(i.qty),'Transfer masuk',no,whName(v.fromWh))});
 DB.insert('transfers',{no,fromWh:v.fromWh,toWh:v.toWh,items,notes:v.notes});
 UI.toast('Transfer selesai: '+no);Router.render();
};

/* ================= STOCK OPNAME ================= */
PAGES.opname.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   if(!can('opname','w'))return v.innerHTML=UI.empty('Anda tidak berhak membuat stock opname.');
   v.innerHTML=UI.pghead('Stock Opname baru',`<a class="btn btn-o" href="#/opname">‹ Batal</a>`)+`<div class="card"><label>Gudang</label><select id="opwh">${DB.all('warehouses').filter(w=>w.type==='Gudang').map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select><div class="acts" style="margin-top:10px"><button class="btn" data-act="opname-start">Mulai hitung</button></div></div>`;
   return;
  }
  v.innerHTML=UI.pghead('Stock Opname',can('opname','w')?'<a class="btn" href="#/opname/new">+ Opname baru</a>':'')+'<div class="card" id="opl"></div>';
  new DT($('#opl'),{title:'Stock Opname',rows:()=>DB.all('opnames').slice().reverse(),onRow:id=>Router.go('opname/'+id),
   cols:[{k:'no',l:'No.'},{k:'w',l:'Gudang',text:r=>whName(r.whId)},{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'n',l:'Selisih item',num:true,text:r=>String(r.items.filter(i=>i.diff!==0).length)},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const o=DB.get('opnames',param);if(!o)return v.innerHTML=UI.empty('Opname tidak ditemukan.');
 const editable=o.status==='Draft'&&can('opname','w');
 v.innerHTML=UI.pghead('Opname '+o.no,`<a class="btn btn-o" href="#/opname">‹ Kembali</a>`)+`<div class="card"><div class="ch"><span>${esc(whName(o.whId))} — ${fdate(o.date)}</span>${UI.badge(o.status)}</div>
  <div class="tblw"><table><tr><th>Produk</th><th class="num">Sistem</th><th class="num">Hasil hitung</th><th class="num">Selisih</th></tr>${o.items.map((i,idx)=>`<tr><td>${esc(DB.get('products',i.productId)?.name)}</td><td class="num">${i.systemQty}</td><td class="num">${editable?`<input type="number" data-op="${idx}" value="${i.countedQty??i.systemQty}" style="width:90px;text-align:right">`:num(i.countedQty)}</td><td class="num" data-opd="${idx}">${num(i.countedQty??i.systemQty)-i.systemQty}</td></tr>`).join('')}</table></div>
  ${editable?`<div class="acts" style="margin-top:12px"><button class="btn" data-act="opname-finish" data-id="${o.id}">Selesaikan opname</button></div>`:''}</div>`;
 if(editable)v.addEventListener('input',e=>{if(e.target.dataset.op===undefined)return;const idx=e.target.dataset.op;$(`[data-opd="${idx}"]`).textContent=num(e.target.value)-o.items[idx].systemQty});
};
ACT['opname-start']=()=>{
 const whId=$('#opwh').value;
 const items=DB.all('products').filter(p=>Stock.qty(p.id,whId)>0||num(p.minStock)>0).map(p=>({productId:p.id,systemQty:Stock.qty(p.id,whId),countedQty:null}));
 if(!items.length)return UI.toast('Tidak ada produk dengan stok di gudang ini.','err');
 const o=DB.insert('opnames',{no:Num.next('OP'),whId,date:today(),items,status:'Draft'});
 Router.go('opname/'+o.id);
};
ACT['opname-finish']=async el=>{
 const o=DB.get('opnames',el.dataset.id);
 const items=o.items.map((i,idx)=>{const c=parseFloat($(`[data-op="${idx}"]`).value);return {...i,countedQty:isNaN(c)?i.systemQty:c,diff:(isNaN(c)?i.systemQty:c)-i.systemQty}});
 if(items.some(i=>i.countedQty<0))return UI.toast('Hasil hitung tidak boleh negatif.','err');
 const diffLines=items.filter(i=>i.diff!==0);
 if(!diffLines.length){DB.update('opnames',o.id,{items,status:'Selesai'},'Tidak ada selisih','Selesai');UI.toast('Opname selesai, tidak ada selisih.');Router.go('opname/'+o.id);return}
 const r=await UI.confirm({title:'Selesaikan opname',msg:`Ditemukan ${diffLines.length} item selisih (nilai ${rp(sum(diffLines,i=>Math.abs(i.diff)*num(DB.get('products',i.productId)?.lastCost)))}). Penyesuaian stok memerlukan approval Manager. Lanjutkan?`});
 if(!r)return;
 DB.update('opnames',o.id,{items,status:'Menunggu Approval'},'Diajukan untuk approval','Ajukan approval');
 const a=Approval.request({type:'stock_adjust',refCol:'opnames',refId:o.id,title:`Stock Opname ${o.no} — ${whName(o.whId)} (${diffLines.length} item selisih)`,
  amount:sum(diffLines,i=>Math.abs(i.diff)*num(DB.get('products',i.productId)?.lastCost)),reason:'Hasil stock opname',meta:{opnameId:o.id}});
 UI.toast('Opname diajukan untuk approval: '+a.no);Router.go('opname/'+o.id);
};
const _stockAdjustHook=Approval.hooks.stock_adjust;
Approval.hooks.stock_adjust={
 approved(a){
  if(a.meta?.opnameId){
   const o=DB.get('opnames',a.meta.opnameId);
   o.items.filter(i=>i.diff).forEach(i=>Stock.change(i.productId,o.whId,i.diff,'Penyesuaian (opname)',o.no,'Stock opname '+o.no));
   DB.update('opnames',o.id,{status:'Selesai'},'Approval disetujui','Selesai');
   return;
  }
  _stockAdjustHook.approved(a);
 },
 rejected(a){
  if(a.meta?.opnameId){DB.update('opnames',a.meta.opnameId,{status:'Ditolak'},a.reason,'Ditolak');return}
  _stockAdjustHook.rejected(a);
 }
};

/* ================= BARCODE ================= */
function pseudoBarcode(text){
 let bars='';for(const ch of String(text)){const c=ch.charCodeAt(0);for(let b=0;b<6;b++)bars+=`<i style="width:${1+((c>>b)&1)*2}px;background:${b%2===0?'#111':'transparent'}"></i>`}
 return `<div style="display:flex;height:46px;align-items:stretch;gap:0">${bars}</div>`;
}
PAGES.barcode.render=async v=>{
 v.innerHTML=UI.pghead('Barcode')+`<div class="card"><label>Pindai / ketik barcode atau SKU</label><input id="bcscan" autocomplete="off" placeholder="Klik di sini lalu pindai dengan barcode scanner…"><div id="bcresult" style="margin-top:10px"></div></div>
  <div class="card"><div class="ch"><span>Cetak label barcode</span><button class="btn btn-o btn-sm" data-act="bc-printsel">Cetak label terpilih</button></div><div id="bcl"></div></div>`;
 const dt=new DT($('#bcl'),{title:'Produk',size:12,rows:()=>DB.all('products'),cols:[{k:'chk',l:'',sort:false,html:r=>`<input type="checkbox" data-bcchk value="${r.id}">`},{k:'sku',l:'SKU'},{k:'name',l:'Produk'},{k:'bc',l:'Barcode',text:r=>r.barcode||r.sku},{k:'label',l:'',sort:false,html:r=>`<div style="text-align:center">${pseudoBarcode(r.barcode||r.sku)}<small>${esc(r.barcode||r.sku)}</small></div>`}]});
 const input=$('#bcscan');
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();Barcode.lookup(input.value);input.value='';input.focus()}});
 input.focus();
};
const Barcode={
 lookup(code){
  code=(code||'').trim();if(!code)return;
  const p=DB.all('products').find(x=>x.barcode===code||x.sku.toLowerCase()===code.toLowerCase());
  const box=$('#bcresult');
  if(!p){box.innerHTML=`<div class="errbox">Barcode/SKU "${esc(code)}" tidak ditemukan.</div>`;return}
  box.innerHTML=`<div class="info"><b>${esc(p.name)}</b> (${esc(p.sku)}) — ${esc(p.kind)}<br>Stok total: <b>${Stock.qty(p.id)}</b> ${seeCost()?'• Harga beli: '+rp(p.lastCost)+' • Harga jual: '+rp(p.price):''}
   <div class="tblw" style="margin-top:6px"><table>${DB.all('warehouses').filter(w=>Stock.qty(p.id,w.id)>0).map(w=>`<tr><td>${esc(w.name)}</td><td class="num">${Stock.qty(p.id,w.id)}</td></tr>`).join('')||'<tr><td colspan=2 class="mut">Tidak ada stok</td></tr>'}</table></div></div>`;
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
 if(!low.length)return UI.toast('Tidak ada stok yang menipis saat ini.');
 const rec=DB.insert('pr',{source:'Minimum Stock',neededBy:addDays(today(),14),items:low.map(p=>({productId:p.id,desc:'Restock (stok '+Stock.qty(p.id)+' / min '+p.minStock+')',qty:Math.max(1,num(p.minStock)*2-Stock.qty(p.id))})),notes:'Dibuat otomatis dari daftar stok menipis.',requesterId:Auth.uid(),status:'Draft',no:Num.next('PR')});
 UI.toast('Draft PR dibuat dari stok menipis: '+rec.no);Router.go('pr/'+rec.id);
};
