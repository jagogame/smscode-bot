'use strict';
/* =========================================================
   KENTFORD ERP - Laporan (filter, Excel, cetak/PDF)
   ========================================================= */
const inRange=(d,f)=>(!f.from||(d||'')>=f.from)&&(!f.to||(d||'')<=f.to);
const R_COL=(k,l,text,o={})=>({k,l,text,...o});
const REPORTS=[
 {key:'sales',label:'Sales report',f:['date','customer','sales','status'],st:['Baru','Diproses','Dikirim','Selesai','Dibatalkan'],
  rows:f=>Scope.rows('salesorders').filter(s=>inRange(s.date,f)&&(!f.customerId||s.customerId===f.customerId)&&(!f.salesId||s.salesId===f.salesId)&&(!f.status||s.status===f.status)),
  cols:[R_COL('no','No. SO',r=>r.no),R_COL('date','Tanggal',r=>fdate(r.date),{sortv:r=>r.date}),R_COL('c','Customer',r=>custName(r.customerId)),R_COL('s','Sales',r=>userName(r.salesId)),
   R_COL('dpp','DPP',r=>rp(r.dpp),{num:true,sortv:r=>r.dpp}),R_COL('tax','PPN',r=>rp(r.tax),{num:true}),R_COL('total','Total',r=>rp(r.total),{num:true,sortv:r=>r.total}),R_COL('st','Status',r=>r.status)],
  sum:rows=>`Jumlah SO: <b>${rows.length}</b> • Total DPP: <b>${rp(sum(rows,r=>r.dpp))}</b> • Total: <b>${rp(sum(rows,r=>r.total))}</b>`},
 {key:'quoteconv',label:'Quotation conversion',f:['date','sales'],
  rows:f=>{const qs=Scope.rows('quotations').filter(q=>inRange(q.date,f)&&(!f.salesId||q.salesId===f.salesId));const m={};qs.forEach(q=>{(m[q.salesId]=m[q.salesId]||[]).push(q)});
   return Object.entries(m).map(([id,a])=>({id,name:userName(id),n:a.length,appr:a.filter(q=>['Disetujui','Dikirim','Diterima','Direvisi'].includes(q.status)).length,won:a.filter(q=>q.status==='Diterima').length,lost:a.filter(q=>q.status==='Ditolak').length,val:sum(a,q=>q.total),wonVal:sum(a.filter(q=>q.status==='Diterima'),q=>q.total)}))},
  cols:[R_COL('name','Sales',r=>r.name),R_COL('n','Jumlah quotation',r=>String(r.n),{num:true}),R_COL('appr','Disetujui',r=>String(r.appr),{num:true}),R_COL('won','Diterima customer',r=>String(r.won),{num:true}),R_COL('lost','Ditolak',r=>String(r.lost),{num:true}),
   R_COL('val','Nilai quotation',r=>rp(r.val),{num:true,sortv:r=>r.val}),R_COL('wv','Nilai diterima',r=>rp(r.wonVal),{num:true}),R_COL('cv','Konversi',r=>r.n?pct(r.won/r.n*100):'0%',{num:true})]},
 {key:'margin',label:'Gross profit & margin',need:()=>seeCost(),f:['date','customer','sales'],
  rows:f=>Scope.rows('salesorders').filter(s=>s.status!=='Dibatalkan'&&inRange(s.date,f)&&(!f.customerId||s.customerId===f.customerId)&&(!f.salesId||s.salesId===f.salesId)),
  cols:[R_COL('no','No. SO',r=>r.no),R_COL('c','Customer',r=>custName(r.customerId)),R_COL('s','Sales',r=>userName(r.salesId)),R_COL('dpp','Penjualan (DPP)',r=>rp(r.dpp),{num:true,sortv:r=>r.dpp}),
   R_COL('cost','Harga beli',r=>rp(r.costTotal),{num:true}),R_COL('gp','Gross profit',r=>rp(r.gp),{num:true,sortv:r=>r.gp}),R_COL('m','Margin',r=>pct(r.gpPct),{num:true,sortv:r=>r.gpPct})],
  sum:rows=>`Penjualan: <b>${rp(sum(rows,r=>r.dpp))}</b> • Gross profit: <b>${rp(sum(rows,r=>r.gp))}</b> • Margin: <b>${pct(sum(rows,r=>r.dpp)?sum(rows,r=>r.gp)/sum(rows,r=>r.dpp)*100:0)}</b>`},
 {key:'salesperf',label:'Sales performance',f:['date'],
  rows:f=>{const u=DB.all('users').filter(x=>x.roleId==='sales'&&(!Auth.role.scopeOwn||x.id===Auth.uid()));
   return u.map(x=>{const so=DB.all('salesorders').filter(s=>s.salesId===x.id&&s.status!=='Dibatalkan'&&inRange(s.date,f));
    return {id:x.id,name:x.name,so:so.length,dpp:sum(so,s=>s.dpp),gp:sum(so,s=>s.gp),q:DB.all('quotations').filter(q=>q.salesId===x.id&&inRange(q.date,f)).length,fu:DB.all('followups').filter(q=>q.salesId===x.id&&q.status==='Selesai'&&inRange(q.date,f)).length,leads:DB.all('leads').filter(l=>l.salesId===x.id).length}})},
  cols:[R_COL('name','Sales',r=>r.name),R_COL('leads','Lead',r=>String(r.leads),{num:true}),R_COL('q','Quotation',r=>String(r.q),{num:true}),R_COL('so','Sales Order',r=>String(r.so),{num:true}),R_COL('dpp','Nilai penjualan',r=>rp(r.dpp),{num:true,sortv:r=>r.dpp}),
   R_COL('gp','Gross profit',r=>rp(r.gp),{num:true,hide:()=>!seeCost()}),R_COL('fu','Follow-up selesai',r=>String(r.fu),{num:true})]},
 {key:'followup',label:'Customer follow-up',f:['date','customer','sales','status'],st:['Terjadwal','Selesai','Dibatalkan'],
  rows:f=>Scope.rows('followups').filter(x=>inRange(x.date,f)&&(!f.customerId||x.customerId===f.customerId)&&(!f.salesId||x.salesId===f.salesId)&&(!f.status||x.status===f.status)),
  cols:[R_COL('d','Tanggal',r=>fdate(r.date),{sortv:r=>r.date}),R_COL('c','Customer',r=>custName(r.customerId)),R_COL('t','Jenis',r=>r.type),R_COL('s','Sales',r=>userName(r.salesId)),
   R_COL('st','Status',r=>r.status==='Terjadwal'&&r.date<today()?'Terlambat':r.status),R_COL('n','Catatan',r=>r.notes||''),R_COL('nx','Berikutnya',r=>fdate(r.nextDate))]},
 {key:'orderprog',label:'New Order progress',f:['date','customer','sales','status'],st:()=>[...STAGES.map(s=>s.status),'Perlu Revisi Sales','Dibatalkan'],
  rows:f=>Scope.rows('orders').filter(o=>inRange((o.createdAt||'').slice(0,10),f)&&(!f.customerId||o.customerId===f.customerId)&&(!f.salesId||o.salesId===f.salesId)&&(!f.status||(o.cancelled?'Dibatalkan':o.statusText)===f.status)),
  cols:[R_COL('no','No. Order',r=>r.no),R_COL('c','Customer',r=>custName(r.customerId)),R_COL('n','Kebutuhan',r=>r.needType),R_COL('s','Sales',r=>userName(r.salesId)),R_COL('st','Status',r=>r.cancelled?'Dibatalkan':r.statusText),
   R_COL('td','Target delivery',r=>fdate(r.targetDelivery),{sortv:r=>r.targetDelivery}),R_COL('age','Hari di tahap',r=>r.stage==='done'?'-':String(daysBetween((r.stageAt||r.createdAt).slice(0,10),today())),{num:true}),R_COL('l','Keterlambatan',r=>Order.late(r)?'Terlambat':'-')]},
 {key:'delivery',label:'Delivery & installation report',f:['date','customer'],
  rows:f=>Scope.rows('orders').filter(o=>o.data?.delivery&&inRange(o.data.delivery.receivedDate,f)&&(!f.customerId||o.customerId===f.customerId)),
  cols:[R_COL('no','No. Order',r=>r.no),R_COL('dr','Delivery report',r=>r.deliveryReportNo||'-'),R_COL('c','Customer',r=>custName(r.customerId)),R_COL('dt','Tanggal diterima',r=>fdate(r.data.delivery.receivedDate),{sortv:r=>r.data.delivery.receivedDate}),
   R_COL('rc','Penerima',r=>r.data.delivery.receiver),R_COL('sj','SJ / DO',r=>(r.data.shipping?.sjNo||'-')+' / '+(r.data.shipping?.doNo||'-')),R_COL('in','Instalasi',r=>!r.installNeeded?'Tidak ada':r.data.install_plan?'Terencana':'Belum direncanakan')]},
 {key:'stockval',label:'Stock valuation',need:()=>seeCost(),f:['branch'],
  rows:f=>DB.all('products').map(p=>{const q=Stock.qty(p.id,f.whId||null);return {id:p.id,sku:p.sku,name:p.name,kind:p.kind,qty:q,cost:num(p.lastCost),val:q*num(p.lastCost)}}).filter(r=>r.qty>0),
  cols:[R_COL('sku','SKU',r=>r.sku),R_COL('name','Produk',r=>r.name),R_COL('kind','Jenis',r=>r.kind),R_COL('q','Qty',r=>String(r.qty),{num:true,sortv:r=>r.qty}),R_COL('c','Harga beli',r=>rp(r.cost),{num:true}),R_COL('v','Nilai',r=>rp(r.val),{num:true,sortv:r=>r.val})],
  sum:rows=>`Total nilai persediaan: <b>${rp(sum(rows,r=>r.val))}</b>`},
 {key:'lowstock',label:'Low stock',f:[],
  rows:()=>DB.all('products').filter(p=>num(p.minStock)>0&&Stock.qty(p.id)<=num(p.minStock)).map(p=>({id:p.id,sku:p.sku,name:p.name,qty:Stock.qty(p.id),min:num(p.minStock)})),
  cols:[R_COL('sku','SKU',r=>r.sku),R_COL('name','Produk',r=>r.name),R_COL('q','Stok',r=>String(r.qty),{num:true}),R_COL('m','Minimum',r=>String(r.min),{num:true}),R_COL('k','Kekurangan',r=>String(Math.max(0,r.min-r.qty)),{num:true})]},
 {key:'invmove',label:'Inventory movement',f:['date','branch'],
  rows:f=>DB.all('stock_moves').filter(m=>inRange((m.at||'').slice(0,10),f)&&(!f.whId||m.whId===f.whId)).slice().reverse(),
  cols:[R_COL('at','Waktu',r=>fdt(r.at),{sortv:r=>r.at}),R_COL('p','Produk',r=>DB.get('products',r.productId)?.name||''),R_COL('w','Lokasi',r=>DB.get('warehouses',r.whId)?.name||''),R_COL('t','Jenis',r=>r.type),R_COL('d','Perubahan',r=>(r.delta>0?'+':'')+r.delta,{num:true}),R_COL('r','Referensi',r=>r.ref||''),R_COL('by','Oleh',r=>r.byName)]},
 {key:'apaging',label:'AP aging',f:['supplier'],
  rows:f=>DB.all('si').filter(i=>SInv.outstanding(i)>0&&(!f.supplierId||i.supplierId===f.supplierId)),
  cols:[R_COL('no','Invoice',r=>r.no),R_COL('s','Supplier',r=>supName(r.supplierId)),R_COL('due','Jatuh tempo',r=>fdate(r.dueDate),{sortv:r=>r.dueDate}),R_COL('o','Sisa',r=>rp(SInv.outstanding(r)),{num:true,sortv:r=>SInv.outstanding(r)}),R_COL('b','Aging',r=>SInv.aging(r)),R_COL('st','Status',r=>SInv.status(r))],
  sum:rows=>['Belum jatuh tempo','1–30 hari','31–60 hari','61–90 hari','> 90 hari'].map(b=>`${b}: <b>${rp(sum(rows.filter(r=>SInv.aging(r)===b),r=>SInv.outstanding(r)))}</b>`).join(' • ')},
 {key:'cashflow',label:'Cash flow',f:['date'],
  rows:f=>DB.all('bank_tx').filter(t=>inRange(t.date,f)).slice().reverse(),
  cols:[R_COL('date','Tanggal',r=>fdate(r.date),{sortv:r=>r.date}),R_COL('b','Rekening',r=>bankName(r.bankId)),R_COL('t','Jenis',r=>r.type),R_COL('amt','Jumlah',r=>rp(r.amount),{num:true,sortv:r=>r.amount}),R_COL('desc','Keterangan',r=>r.desc),R_COL('src','Sumber',r=>r.source)],
  sum:rows=>`Masuk: <b>${rp(sum(rows.filter(r=>r.type==='Masuk'),r=>r.amount))}</b> • Keluar: <b>${rp(sum(rows.filter(r=>r.type==='Keluar'),r=>r.amount))}</b> • Bersih: <b>${rp(sum(rows,r=>r.type==='Masuk'?r.amount:-r.amount))}</b>`},
 {key:'pettyreport',label:'Petty cash',f:['date'],
  rows:f=>DB.all('petty_ledger').filter(t=>inRange(t.date,f)).slice().reverse(),
  cols:[R_COL('date','Tanggal',r=>fdate(r.date),{sortv:r=>r.date}),R_COL('t','Jenis',r=>r.type),R_COL('amt','Jumlah',r=>rp(r.amount),{num:true,sortv:r=>r.amount}),R_COL('desc','Keterangan',r=>r.desc),R_COL('by','Oleh',r=>r.byName)],
  sum:rows=>`Saldo akhir periode: <b>${rp(Petty.balance())}</b>`},
 {key:'taxsummary',label:'Tax summary',f:['date'],
  rows:f=>DB.all('tax_docs').filter(t=>inRange(t.date,f)).slice().reverse(),
  cols:[R_COL('no','No. Dokumen',r=>r.no),R_COL('t','Jenis',r=>r.type),R_COL('date','Tanggal',r=>fdate(r.date),{sortv:r=>r.date}),R_COL('amt','Nilai',r=>rp(r.amount),{num:true,sortv:r=>r.amount})],
  sum:rows=>['Faktur Pajak','Bukti Potong PPh 21','Bukti Potong PPh 23'].map(t=>`${t}: <b>${rp(sum(rows.filter(r=>r.type===t),r=>r.amount))}</b>`).join(' • ')},
 {key:'aging',label:'AR aging',f:['customer'],
  rows:f=>Scope.rows('invoices').filter(i=>Inv.outstanding(i)>0&&(!f.customerId||i.customerId===f.customerId)),
  cols:[R_COL('no','Invoice',r=>r.no),R_COL('c','Customer',r=>custName(r.customerId)),R_COL('due','Jatuh tempo',r=>fdate(r.dueDate),{sortv:r=>r.dueDate}),R_COL('o','Sisa tagihan',r=>rp(Inv.outstanding(r)),{num:true,sortv:r=>Inv.outstanding(r)}),R_COL('b','Aging',r=>Inv.aging(r)),R_COL('st','Status',r=>Inv.status(r))],
  sum:rows=>['Belum jatuh tempo','1–30 hari','31–60 hari','61–90 hari','> 90 hari'].map(b=>`${b}: <b>${rp(sum(rows.filter(r=>Inv.aging(r)===b),r=>Inv.outstanding(r)))}</b>`).join(' • ')}
];
PAGES.reports.render=async(v,param)=>{
 const avail=REPORTS.filter(r=>!r.need||r.need());
 const rep=avail.find(r=>r.key===param)||avail[0];
 const extra=rep.key==='lowstock'&&can('pr','w')?'<button class="btn btn-sm" data-act="pr-from-lowstock" style="margin-left:8px">Buat PR dari daftar ini</button>':'';
 const fl=[];
 if(rep.f.includes('date')){fl.push(F.d('from','Dari tanggal',{def:()=>today().slice(0,8)+'01'}),F.d('to','Sampai tanggal',{def:()=>today()}))}
 if(rep.f.includes('customer'))fl.push(F.r('customerId','Customer','customers'));
 if(rep.f.includes('supplier'))fl.push(F.r('supplierId','Supplier','suppliers'));
 if(rep.f.includes('sales')&&!Auth.role.scopeOwn)fl.push(F.r('salesId','PIC (sales)','users',{filter:salesUsers}));
 if(rep.f.includes('status'))fl.push(F.s('status','Status',typeof rep.st==='function'?rep.st:rep.st));
 if(rep.f.includes('branch'))fl.push(F.r('whId','Cabang / gudang','warehouses'));
 v.innerHTML=UI.pghead('Reports')+`<div class="tabs">${avail.map(r=>`<a href="#/reports/${r.key}" class="${r.key===rep.key?'on':''}">${esc(r.label)}</a>`).join('')}</div>
  <div class="card"><div class="ch"><span>${esc(rep.label)}</span>${extra}</div>${fl.length?`<div id="rf">${Form.render(fl,{})}</div><div class="acts" style="margin-top:10px"><button class="btn" data-act="rep-run">Terapkan filter</button></div>`:''}</div>
  <div class="card"><div id="rsum" style="margin-bottom:8px"></div><div id="rt"></div></div>`;
 const run=()=>{
  const f=fl.length?Form.collect($('#rf'),fl).v:{};Object.keys(f).forEach(k=>{if(f[k]==='')delete f[k]});
  const rows=rep.rows(f);
  $('#rsum').innerHTML=rep.sum?rep.sum(rows):`Jumlah data: <b>${rows.length}</b>`;
  $('#rt').innerHTML='';
  new DT($('#rt'),{title:rep.label+(f.from?` (${fdate(f.from)} – ${fdate(f.to)})`:''),rows:()=>rows,cols:rep.cols,size:20});
 };
 REP.run=run;run();
};
const REP={run:null};
ACT['rep-run']=()=>REP.run&&REP.run();
