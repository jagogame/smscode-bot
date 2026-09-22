'use strict';
/* =========================================================
   KENTFORD ERP - Laporan (filter, Excel, cetak/PDF)
   ========================================================= */
const inRange=(d,f)=>(!f.from||(d||'')>=f.from)&&(!f.to||(d||'')<=f.to);
const R_COL=(k,l,text,o={})=>({k,l,text,...o});
const REPORTS=[
 {key:'sales',label:t('reports.sales'),f:['date','customer','sales','status'],st:['Baru','Diproses','Dikirim','Selesai','Dibatalkan'],
  rows:f=>Scope.rows('salesorders').filter(s=>inRange(s.date,f)&&(!f.customerId||s.customerId===f.customerId)&&(!f.salesId||s.salesId===f.salesId)&&(!f.status||s.status===f.status)),
  cols:[R_COL('no',t('so.no_so'),r=>r.no),R_COL('date',t('common.date'),r=>fdate(r.date),{sortv:r=>r.date}),R_COL('c',t('common.customer'),r=>custName(r.customerId)),R_COL('s',t('common.sales'),r=>userName(r.salesId)),
   R_COL('dpp',t('common.dpp'),r=>rp(r.dpp),{num:true,sortv:r=>r.dpp}),R_COL('tax',t('common.ppn'),r=>rp(r.tax),{num:true}),R_COL('total',t('common.total'),r=>rp(r.total),{num:true,sortv:r=>r.total}),R_COL('st',t('common.status'),r=>r.status)],
  sum:rows=>t('reports.sum_so',{n:rows.length,dpp:rp(sum(rows,r=>r.dpp)),total:rp(sum(rows,r=>r.total))})},
 {key:'quoteconv',label:t('reports.quoteconv'),f:['date','sales'],
  rows:f=>{const qs=Scope.rows('quotations').filter(q=>inRange(q.date,f)&&(!f.salesId||q.salesId===f.salesId));const m={};qs.forEach(q=>{(m[q.salesId]=m[q.salesId]||[]).push(q)});
   return Object.entries(m).map(([id,a])=>({id,name:userName(id),n:a.length,appr:a.filter(q=>['Disetujui','Dikirim','Diterima','Direvisi'].includes(q.status)).length,won:a.filter(q=>q.status==='Diterima').length,lost:a.filter(q=>q.status==='Ditolak').length,val:sum(a,q=>q.total),wonVal:sum(a.filter(q=>q.status==='Diterima'),q=>q.total)}))},
  cols:[R_COL('name',t('common.sales'),r=>r.name),R_COL('n',t('reports.col_quote_count'),r=>String(r.n),{num:true}),R_COL('appr',t('reports.col_approved'),r=>String(r.appr),{num:true}),R_COL('won',t('reports.col_won'),r=>String(r.won),{num:true}),R_COL('lost',t('reports.col_lost'),r=>String(r.lost),{num:true}),
   R_COL('val',t('reports.col_quote_value'),r=>rp(r.val),{num:true,sortv:r=>r.val}),R_COL('wv',t('reports.col_won_value'),r=>rp(r.wonVal),{num:true}),R_COL('cv',t('reports.col_conversion'),r=>r.n?pct(r.won/r.n*100):'0%',{num:true})]},
 {key:'margin',label:t('reports.margin'),need:()=>seeCost(),f:['date','customer','sales'],
  rows:f=>Scope.rows('salesorders').filter(s=>s.status!=='Dibatalkan'&&inRange(s.date,f)&&(!f.customerId||s.customerId===f.customerId)&&(!f.salesId||s.salesId===f.salesId)),
  cols:[R_COL('no',t('so.no_so'),r=>r.no),R_COL('c',t('common.customer'),r=>custName(r.customerId)),R_COL('s',t('common.sales'),r=>userName(r.salesId)),R_COL('dpp',t('reports.col_sales_dpp'),r=>rp(r.dpp),{num:true,sortv:r=>r.dpp}),
   R_COL('cost',t('quot.buy_price'),r=>rp(r.costTotal),{num:true}),R_COL('gp',t('common.gross_profit'),r=>rp(r.gp),{num:true,sortv:r=>r.gp}),R_COL('m',t('common.margin'),r=>pct(r.gpPct),{num:true,sortv:r=>r.gpPct})],
  sum:rows=>t('reports.sum_margin',{dpp:rp(sum(rows,r=>r.dpp)),gp:rp(sum(rows,r=>r.gp)),m:pct(sum(rows,r=>r.dpp)?sum(rows,r=>r.gp)/sum(rows,r=>r.dpp)*100:0)})},
 {key:'salesperf',label:t('reports.salesperf'),f:['date'],
  rows:f=>{const u=DB.all('users').filter(x=>x.roleId==='sales'&&(!Auth.role.scopeOwn||x.id===Auth.uid()));
   return u.map(x=>{const so=DB.all('salesorders').filter(s=>s.salesId===x.id&&s.status!=='Dibatalkan'&&inRange(s.date,f));
    return {id:x.id,name:x.name,so:so.length,dpp:sum(so,s=>s.dpp),gp:sum(so,s=>s.gp),q:DB.all('quotations').filter(q=>q.salesId===x.id&&inRange(q.date,f)).length,fu:DB.all('followups').filter(q=>q.salesId===x.id&&q.status==='Selesai'&&inRange(q.date,f)).length,leads:DB.all('leads').filter(l=>l.salesId===x.id).length}})},
  cols:[R_COL('name',t('common.sales'),r=>r.name),R_COL('leads',t('ent.leads'),r=>String(r.leads),{num:true}),R_COL('q',t('nav.quotations'),r=>String(r.q),{num:true}),R_COL('so',t('nav.salesorders'),r=>String(r.so),{num:true}),R_COL('dpp',t('reports.col_sales_value'),r=>rp(r.dpp),{num:true,sortv:r=>r.dpp}),
   R_COL('gp',t('common.gross_profit'),r=>rp(r.gp),{num:true,hide:()=>!seeCost()}),R_COL('fu',t('reports.col_followups_done'),r=>String(r.fu),{num:true})]},
 {key:'followup',label:t('reports.followup'),f:['date','customer','sales','status'],st:['Terjadwal','Selesai','Dibatalkan'],
  rows:f=>Scope.rows('followups').filter(x=>inRange(x.date,f)&&(!f.customerId||x.customerId===f.customerId)&&(!f.salesId||x.salesId===f.salesId)&&(!f.status||x.status===f.status)),
  cols:[R_COL('d',t('common.date'),r=>fdate(r.date),{sortv:r=>r.date}),R_COL('c',t('common.customer'),r=>custName(r.customerId)),R_COL('t',t('common.type'),r=>r.type),R_COL('s',t('common.sales'),r=>userName(r.salesId)),
   R_COL('st',t('common.status'),r=>r.status==='Terjadwal'&&r.date<today()?t('common.late'):r.status),R_COL('n',t('common.notes'),r=>r.notes||''),R_COL('nx',t('reports.col_next'),r=>fdate(r.nextDate))]},
 {key:'orderprog',label:t('reports.orderprog'),f:['date','customer','sales','status'],st:()=>[...STAGES.map(s=>s.status),'Perlu Revisi Sales','Dibatalkan'],
  rows:f=>Scope.rows('orders').filter(o=>inRange((o.createdAt||'').slice(0,10),f)&&(!f.customerId||o.customerId===f.customerId)&&(!f.salesId||o.salesId===f.salesId)&&(!f.status||(o.cancelled?'Dibatalkan':o.statusText)===f.status)),
  cols:[R_COL('no',t('reports.col_order_no'),r=>r.no),R_COL('c',t('common.customer'),r=>custName(r.customerId)),R_COL('n',t('reports.col_need'),r=>r.needType),R_COL('s',t('common.sales'),r=>userName(r.salesId)),R_COL('st',t('common.status'),r=>r.cancelled?'Dibatalkan':r.statusText),
   R_COL('td',t('reports.col_target_delivery'),r=>fdate(r.targetDelivery),{sortv:r=>r.targetDelivery}),R_COL('age',t('reports.col_days_in_stage'),r=>r.stage==='done'?'-':String(daysBetween((r.stageAt||r.createdAt).slice(0,10),today())),{num:true}),R_COL('l',t('reports.col_lateness'),r=>Order.late(r)?t('common.late'):'-')]},
 {key:'delivery',label:t('reports.delivery'),f:['date','customer'],
  rows:f=>Scope.rows('orders').filter(o=>o.data?.delivery&&inRange(o.data.delivery.receivedDate,f)&&(!f.customerId||o.customerId===f.customerId)),
  cols:[R_COL('no',t('reports.col_order_no'),r=>r.no),R_COL('dr',t('reports.col_delivery_report'),r=>r.deliveryReportNo||'-'),R_COL('c',t('common.customer'),r=>custName(r.customerId)),R_COL('dt',t('reports.col_date_received'),r=>fdate(r.data.delivery.receivedDate),{sortv:r=>r.data.delivery.receivedDate}),
   R_COL('rc',t('reports.col_receiver'),r=>r.data.delivery.receiver),R_COL('sj',t('reports.col_sj_do'),r=>(r.data.shipping?.sjNo||'-')+' / '+(r.data.shipping?.doNo||'-')),R_COL('in',t('reports.col_installation'),r=>!r.installNeeded?t('reports.val_none'):r.data.install_plan?t('reports.val_planned'):t('reports.val_not_planned'))]},
 {key:'stockval',label:t('reports.stockval'),need:()=>seeCost(),f:['branch'],
  rows:f=>DB.all('products').map(p=>{const q=Stock.qty(p.id,f.whId||null);return {id:p.id,sku:p.sku,name:p.name,kind:p.kind,qty:q,cost:num(p.lastCost),val:q*num(p.lastCost)}}).filter(r=>r.qty>0),
  cols:[R_COL('sku',t('reports.col_sku'),r=>r.sku),R_COL('name',t('common.product'),r=>r.name),R_COL('kind',t('common.type'),r=>r.kind),R_COL('q',t('common.qty'),r=>String(r.qty),{num:true,sortv:r=>r.qty}),R_COL('c',t('quot.buy_price'),r=>rp(r.cost),{num:true}),R_COL('v',t('common.value'),r=>rp(r.val),{num:true,sortv:r=>r.val})],
  sum:rows=>t('reports.sum_stockval',{v:rp(sum(rows,r=>r.val))})},
 {key:'lowstock',label:t('reports.lowstock'),f:[],
  rows:()=>DB.all('products').filter(p=>num(p.minStock)>0&&Stock.qty(p.id)<=num(p.minStock)).map(p=>({id:p.id,sku:p.sku,name:p.name,qty:Stock.qty(p.id),min:num(p.minStock)})),
  cols:[R_COL('sku',t('reports.col_sku'),r=>r.sku),R_COL('name',t('common.product'),r=>r.name),R_COL('q',t('reports.col_stock'),r=>String(r.qty),{num:true}),R_COL('m',t('reports.col_minimum'),r=>String(r.min),{num:true}),R_COL('k',t('reports.col_shortage'),r=>String(Math.max(0,r.min-r.qty)),{num:true})]},
 {key:'invmove',label:t('reports.invmove'),f:['date','branch'],
  rows:f=>DB.all('stock_moves').filter(m=>inRange((m.at||'').slice(0,10),f)&&(!f.whId||m.whId===f.whId)).slice().reverse(),
  cols:[R_COL('at',t('reports.col_time'),r=>fdt(r.at),{sortv:r=>r.at}),R_COL('p',t('common.product'),r=>DB.get('products',r.productId)?.name||''),R_COL('w',t('common.location_'),r=>DB.get('warehouses',r.whId)?.name||''),R_COL('t',t('common.type'),r=>r.type),R_COL('d',t('reports.col_change'),r=>(r.delta>0?'+':'')+r.delta,{num:true}),R_COL('r',t('common.reference'),r=>r.ref||''),R_COL('by',t('reports.col_by'),r=>r.byName)]},
 {key:'apaging',label:t('reports.apaging'),f:['supplier'],
  rows:f=>DB.all('si').filter(i=>SInv.outstanding(i)>0&&(!f.supplierId||i.supplierId===f.supplierId)),
  cols:[R_COL('no',t('common.no_dot')+' '+t('nav.si'),r=>r.no),R_COL('s',t('common.supplier'),r=>supName(r.supplierId)),R_COL('due',t('inv.due_date'),r=>fdate(r.dueDate),{sortv:r=>r.dueDate}),R_COL('o',t('inv.outstanding'),r=>rp(SInv.outstanding(r)),{num:true,sortv:r=>SInv.outstanding(r)}),R_COL('b',t('inv.aging'),r=>SInv.aging(r)),R_COL('st',t('common.status'),r=>SInv.status(r))],
  sum:rows=>['Belum jatuh tempo','1–30 hari','31–60 hari','61–90 hari','> 90 hari'].map(b=>`${b}: <b>${rp(sum(rows.filter(r=>SInv.aging(r)===b),r=>SInv.outstanding(r)))}</b>`).join(' • ')},
 {key:'cashflow',label:t('reports.cashflow'),f:['date'],
  rows:f=>DB.all('bank_tx').filter(t=>inRange(t.date,f)).slice().reverse(),
  cols:[R_COL('date',t('common.date'),r=>fdate(r.date),{sortv:r=>r.date}),R_COL('b',t('common.account'),r=>bankName(r.bankId)),R_COL('t',t('common.type'),r=>r.type),R_COL('amt',t('common.amount'),r=>rp(r.amount),{num:true,sortv:r=>r.amount}),R_COL('desc',t('common.description'),r=>r.desc),R_COL('src',t('reports.col_source'),r=>r.source)],
  sum:rows=>t('reports.sum_cashflow',{in:rp(sum(rows.filter(r=>r.type==='Masuk'),r=>r.amount)),out:rp(sum(rows.filter(r=>r.type==='Keluar'),r=>r.amount)),net:rp(sum(rows,r=>r.type==='Masuk'?r.amount:-r.amount))})},
 {key:'pettyreport',label:t('reports.pettyreport'),f:['date'],
  rows:f=>DB.all('petty_ledger').filter(t=>inRange(t.date,f)).slice().reverse(),
  cols:[R_COL('date',t('common.date'),r=>fdate(r.date),{sortv:r=>r.date}),R_COL('t',t('common.type'),r=>r.type),R_COL('amt',t('common.amount'),r=>rp(r.amount),{num:true,sortv:r=>r.amount}),R_COL('desc',t('common.description'),r=>r.desc),R_COL('by',t('reports.col_by'),r=>r.byName)],
  sum:rows=>t('reports.sum_petty',{bal:rp(Petty.balance())})},
 {key:'taxsummary',label:t('reports.taxsummary'),f:['date'],
  rows:f=>DB.all('tax_docs').filter(t=>inRange(t.date,f)).slice().reverse(),
  cols:[R_COL('no',t('tax.doc_no'),r=>r.no),R_COL('t',t('common.type'),r=>r.type),R_COL('date',t('common.date'),r=>fdate(r.date),{sortv:r=>r.date}),R_COL('amt',t('common.value'),r=>rp(r.amount),{num:true,sortv:r=>r.amount})],
  sum:rows=>['Faktur Pajak','Bukti Potong PPh 21','Bukti Potong PPh 23'].map(ty=>`${ty}: <b>${rp(sum(rows.filter(r=>r.type===ty),r=>r.amount))}</b>`).join(' • ')},
 {key:'gl',label:t('reports.gl'),f:['date','account'],
  // Buku Besar (General Ledger) per akun: baris jurnal ter-posting saja, diurutkan tanggal, dengan saldo berjalan.
  // Saldo berjalan mengikuti normalBalance akun (Debit: +debit -credit, Kredit: +credit -debit).
  rows:f=>{
   if(!f.accountId)return [];
   const acc=DB.get('chart_of_accounts',f.accountId);if(!acc)return [];
   const entries=DB.all('journal_entries').filter(j=>j.status==='Posted'&&inRange(j.date,f)).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.no.localeCompare(b.no));
   let bal=0;const rows=[];
   entries.forEach(j=>{j.lines.filter(l=>l.accountId===f.accountId).forEach(l=>{
    bal+=acc.normalBalance==='Debit'?(num(l.debit)-num(l.credit)):(num(l.credit)-num(l.debit));
    rows.push({id:j.id+'-'+rows.length,jno:j.no,date:j.date,memo:j.memo,debit:num(l.debit),credit:num(l.credit),bal});
   })});
   return rows;
  },
  cols:[R_COL('date',t('common.date'),r=>fdate(r.date),{sortv:r=>r.date}),R_COL('no',t('reports.gl_col_journal_no'),r=>r.jno),R_COL('memo',t('journal.memo'),r=>r.memo),
   R_COL('d',t('journal.debit'),r=>rp(r.debit),{num:true}),R_COL('c',t('journal.credit'),r=>rp(r.credit),{num:true}),R_COL('bal',t('journal.total'),r=>rp(r.bal),{num:true})],
  sum:rows=>rows.length?t('reports.sum_gl',{n:rows.length,bal:rp(rows[rows.length-1].bal)}):t('reports.gl_pick_account')},
 {key:'aging',label:t('reports.aging'),f:['customer'],
  rows:f=>Scope.rows('invoices').filter(i=>Inv.outstanding(i)>0&&(!f.customerId||i.customerId===f.customerId)),
  cols:[R_COL('no',t('inv.no_invoice'),r=>r.no),R_COL('c',t('common.customer'),r=>custName(r.customerId)),R_COL('due',t('inv.due_date'),r=>fdate(r.dueDate),{sortv:r=>r.dueDate}),R_COL('o',t('inv.outstanding'),r=>rp(Inv.outstanding(r)),{num:true,sortv:r=>Inv.outstanding(r)}),R_COL('b',t('inv.aging'),r=>Inv.aging(r)),R_COL('st',t('common.status'),r=>Inv.status(r))],
  sum:rows=>['Belum jatuh tempo','1–30 hari','31–60 hari','61–90 hari','> 90 hari'].map(b=>`${b}: <b>${rp(sum(rows.filter(r=>Inv.aging(r)===b),r=>Inv.outstanding(r)))}</b>`).join(' • ')}
];
PAGES.reports.render=async(v,param)=>{
 const avail=REPORTS.filter(r=>!r.need||r.need());
 const rep=avail.find(r=>r.key===param)||avail[0];
 const label=typeof rep.label==='function'?rep.label():rep.label;
 const extra=rep.key==='lowstock'&&can('pr','w')?`<button class="btn btn-sm" data-act="pr-from-lowstock" style="margin-left:8px">${t('reports.make_pr_from_list')}</button>`:'';
 const fl=[];
 if(rep.f.includes('date')){fl.push(F.d('from',t('reports.f_from_date'),{def:()=>today().slice(0,8)+'01'}),F.d('to',t('reports.f_to_date'),{def:()=>today()}))}
 if(rep.f.includes('customer'))fl.push(F.r('customerId',t('common.customer'),'customers'));
 if(rep.f.includes('supplier'))fl.push(F.r('supplierId',t('common.supplier'),'suppliers'));
 if(rep.f.includes('sales')&&!Auth.role.scopeOwn)fl.push(F.r('salesId',t('reports.f_pic_sales'),'users',{filter:salesUsers}));
 if(rep.f.includes('status'))fl.push(F.s('status',t('common.status'),typeof rep.st==='function'?rep.st:rep.st));
 if(rep.f.includes('branch'))fl.push(F.r('whId',t('reports.f_branch_wh'),'warehouses'));
 if(rep.f.includes('account'))fl.push(F.r('accountId',t('journal.account'),'chart_of_accounts',{req:true}));
 v.innerHTML=UI.pghead(t('nav.reports'))+`<div class="tabs">${avail.map(r=>`<a href="#/reports/${r.key}" class="${r.key===rep.key?'on':''}">${esc(typeof r.label==='function'?r.label():r.label)}</a>`).join('')}</div>
  <div class="card"><div class="ch"><span>${esc(label)}</span>${extra}</div>${fl.length?`<div id="rf">${Form.render(fl,{})}</div><div class="acts" style="margin-top:10px"><button class="btn" data-act="rep-run">${t('reports.apply_filter')}</button></div>`:''}</div>
  <div class="card"><div id="rsum" style="margin-bottom:8px"></div><div id="rt"></div></div>`;
 const run=()=>{
  const f=fl.length?Form.collect($('#rf'),fl).v:{};Object.keys(f).forEach(k=>{if(f[k]==='')delete f[k]});
  const rows=rep.rows(f);
  $('#rsum').innerHTML=rep.sum?rep.sum(rows):t('reports.data_count',{n:rows.length});
  $('#rt').innerHTML='';
  new DT($('#rt'),{title:label+(f.from?` (${fdate(f.from)} – ${fdate(f.to)})`:''),rows:()=>rows,cols:rep.cols,size:20});
 };
 REP.run=run;run();
};
const REP={run:null};
ACT['rep-run']=()=>REP.run&&REP.run();
