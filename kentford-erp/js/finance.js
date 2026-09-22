'use strict';
/* =========================================================
   KENTFORD ERP - Tahap 4: Supplier Invoice/AP, Payment Request,
   Bank & Cash, Petty Cash, Tax, Bank Reconciliation
   ========================================================= */
const bankName=id=>{const b=DB.get('banks',id);return b?`${b.name} (${b.bank} ${b.accNo})`:'-'};

/* ================= BANK LEDGER (dipakai lintas modul) ================= */
const BankTx={
 add({bankId,date,type,amount,desc,ref,source}){
  if(!bankId)return null;
  return DB.insert('bank_tx',{bankId,date:date||today(),type,amount:num(amount),desc:desc||'',ref:ref||'',source:source||'',reconciled:false});
 },
 balance(bankId,uptoDate){
  const b=DB.get('banks',bankId);if(!b)return 0;
  const tx=DB.all('bank_tx').filter(t=>t.bankId===bankId&&(!uptoDate||t.date<=uptoDate));
  return num(b.openingBalance)+sum(tx,t=>t.type==='Masuk'?t.amount:-t.amount);
 }
};

/* ================= SUPPLIER INVOICE / ACCOUNT PAYABLE ================= */
const SInv={
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
 fromPO(po,{type,pct,date,terms,note}){
  const c=POH.calc(po),totalPO=c.total,dppPO=totalPO/(1+num(po.taxPct)/100);
  const active=DB.all('si').filter(x=>x.poId===po.id&&!x.cancelled),used=sum(active,x=>x.dpp);
  let dpp=type==='DP'?dppPO*num(pct)/100:type==='Pelunasan'?dppPO-used:dppPO;
  if(type==='Penuh'&&used>0)throw new Error('Invoice penuh hanya bisa dibuat bila belum ada invoice lain untuk PO ini.');
  if(dpp<=0.5||dpp>dppPO-used+0.5)throw new Error('Nilai invoice melebihi sisa PO ('+rp(dppPO-used)+' sebelum PPN).');
  const tax=dpp*num(po.taxPct)/100;
  return DB.insert('si',{no:Num.next('SI'),poId:po.id,supplierId:po.supplierId,type,date,dueDate:addDays(date,num(terms)),dpp,taxPct:po.taxPct,tax,total:dpp+tax,
   desc:note||(type==='DP'?`Down payment ${pct}%`:type==='Pelunasan'?'Pelunasan':'Pembayaran penuh')+' — '+po.no,payments:[],cancelled:false});
 },
 manual(v){
  const dpp=num(v.amount),tax=dpp*num(v.taxPct)/100;
  return DB.insert('si',{no:Num.next('SI'),poId:'',supplierId:v.supplierId,type:'Manual',date:v.date,dueDate:addDays(v.date,num(v.terms)),dpp,taxPct:v.taxPct,tax,total:dpp+tax,desc:v.desc,payments:[],cancelled:false});
 }
};
PAGES.si.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead('Supplier Invoice',can('si','w')?'<button class="btn" data-act="si-new">+ Invoice manual</button>':'')+'<div class="card" id="sil"></div>';
  new DT($('#sil'),{title:'Supplier Invoice',rows:()=>DB.all('si').slice().reverse(),onRow:id=>Router.go('si/'+id),
   filters:[{k:'s',l:'Status',opts:()=>['Belum dibayar','DP diterima','Dibayar sebagian','Lunas','Jatuh tempo','Terlambat','Dibatalkan'],get:r=>SInv.status(r)},{k:'sp',l:'Supplier',opts:()=>DB.all('suppliers').map(s=>s.name),get:r=>supName(r.supplierId)}],
   cols:[{k:'no',l:'No. Invoice'},{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'sp',l:'Supplier',text:r=>supName(r.supplierId)},{k:'po',l:'PO',text:r=>r.poId?DB.get('po',r.poId)?.no:'-'},
    {k:'due',l:'Jatuh tempo',text:r=>fdate(r.dueDate),sortv:r=>r.dueDate},{k:'total',l:'Total',num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'paid',l:'Dibayar',num:true,text:r=>rp(SInv.paid(r))},{k:'st',l:'Status',text:r=>SInv.status(r),html:r=>UI.badge(SInv.status(r))}]});
  return;
 }
 const i=DB.get('si',param);if(!i)return v.innerHTML=UI.empty('Supplier Invoice tidak ditemukan.');
 const st=SInv.status(i),hasPR=DB.all('payreq').some(p=>p.refCol==='si'&&p.refId===i.id&&!['Ditolak','Dibatalkan'].includes(p.status));
 const acts=[`<a class="btn btn-o" href="#/si">‹ Kembali</a>`];
 if(can('payreq','w')&&!i.cancelled&&SInv.outstanding(i)>0&&!hasPR)acts.push(`<button class="btn" data-act="payreq-from-si" data-id="${i.id}">Ajukan Payment Request</button>`);
 v.innerHTML=UI.pghead('Supplier Invoice '+i.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>Informasi invoice</span>${UI.badge(st)}</div>${UI.kv([['Supplier',esc(supName(i.supplierId))],['PO terkait',i.poId?docLink('po',DB.get('po',i.poId)):'-'],['Jenis',esc(i.type)],['Tanggal',fdate(i.date)],['Jatuh tempo',fdate(i.dueDate)],['Keterangan',esc(i.desc)],['Aging',esc(SInv.aging(i))]])}</div>
  <div class="card"><h3>Pembayaran keluar</h3>${(i.payments||[]).length?`<div class="tblw"><table><tr><th>Tanggal</th><th>Rekening</th><th class="num">Jumlah</th><th>Payment Request</th></tr>${i.payments.map(p=>`<tr><td>${fdate(p.date)}</td><td>${esc(bankName(p.bankId))}</td><td class="num">${rp(p.amount)}</td><td>${p.prNo?docLink('payreq',DB.get('payreq',p.prId)):'-'}</td></tr>`).join('')}</table></div>`:'<div class="empty">Belum ada pembayaran.</div>'}</div></div>
  <div><div class="card"><h3>Nilai</h3><dl class="kv"><dt>DPP</dt><dd>${rp(i.dpp)}</dd><dt>PPN</dt><dd>${rp(i.tax)}</dd><dt><b>Total</b></dt><dd><b>${rp(i.total)}</b></dd><dt>Dibayar</dt><dd>${rp(SInv.paid(i))}</dd><dt>Sisa</dt><dd><b>${rp(SInv.outstanding(i))}</b></dd></dl></div>
  <div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('si',i.id)}</div></div></div>`;
};
ACT['si-new']=async()=>{
 const v=await UI.ask({title:'Supplier Invoice manual',ok:'Simpan',fields:[F.r('supplierId','Supplier','suppliers',{req:true}),F.d('date','Tanggal',{req:true,def:today()}),F.n('terms','Jatuh tempo (hari)',{req:true,def:30}),
  F.m('amount','Nominal (DPP, Rp)',{req:true}),F.pc('taxPct','PPN (%)',{def:()=>S().defaultTaxPct??11}),F.ta('desc','Keterangan',{req:true}),F.fl('files','Lampiran invoice')]});
 if(!v)return;if(!(num(v.amount)>0))return UI.toast('Nominal harus lebih dari 0.','err');
 const i=SInv.manual(v);UI.toast('Supplier invoice dibuat: '+i.no);Router.go('si/'+i.id);
};
ACT['si-fromPO']=async el=>{
 const po=DB.get('po',el.dataset.id),used=sum(DB.all('si').filter(x=>x.poId===po.id&&!x.cancelled),x=>x.dpp),dppPO=POH.calc(po).total/(1+num(po.taxPct)/100);
 const v=await UI.ask({title:'Buat Supplier Invoice — '+po.no,ok:'Buat invoice',fields:[F.s('type','Jenis',['DP','Pelunasan','Penuh'],{req:true,def:used>0?'Pelunasan':(po.dpPct?'DP':'Penuh')}),
  F.pc('pct','Persentase DP (%)',{def:po.dpPct||30}),F.d('date','Tanggal invoice',{req:true,def:today()}),F.n('terms','Jatuh tempo (hari)',{req:true,def:30})],
  pre:`<div class="info" style="margin-bottom:10px">Total PO (DPP): <b>${rp(dppPO)}</b> • sudah ditagihkan: <b>${rp(used)}</b> • sisa: <b>${rp(dppPO-used)}</b></div>`});
 if(!v)return;
 try{const i=SInv.fromPO(po,v);UI.toast('Supplier invoice dibuat: '+i.no);Router.render()}catch(e){UI.toast(e.message,'err')}
};
PAGES.ap.render=async v=>{
 v.innerHTML=UI.pghead('Account Payable')+'<div class="card" id="apb"></div>';
 const rows=()=>DB.all('si').filter(i=>SInv.outstanding(i)>0&&!i.cancelled);
 new DT($('#apb'),{title:'Account Payable',rows,onRow:id=>Router.go('si/'+id),size:20,
  filters:[{k:'sp',l:'Supplier',opts:()=>DB.all('suppliers').map(s=>s.name),get:r=>supName(r.supplierId)}],
  cols:[{k:'no',l:'Invoice'},{k:'sp',l:'Supplier',text:r=>supName(r.supplierId)},{k:'due',l:'Jatuh tempo',text:r=>fdate(r.dueDate),sortv:r=>r.dueDate},
   {k:'total',l:'Total',num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'out',l:'Sisa',num:true,text:r=>rp(SInv.outstanding(r)),sortv:r=>SInv.outstanding(r)},{k:'b',l:'Aging',text:r=>SInv.aging(r)},{k:'st',l:'Status',text:r=>SInv.status(r),html:r=>UI.badge(SInv.status(r))}]});
};

/* ================= PAYMENT REQUEST ================= */
const PayReq={
 categories:['Bayar Supplier Invoice','Isi Ulang Petty Cash','Operasional / Lainnya'],
 async submit(rec){
  Approval.request({type:'payment_request',refCol:'payreq',refId:rec.id,title:`${rec.category} — ${rec.purpose}`,amount:rec.amount,reason:rec.purpose});
  DB.update('payreq',rec.id,{status:'Menunggu Approval'},'Diajukan','Ajukan approval');
  UI.toast('Payment Request diajukan.');
 },
 async pay(pr,{bankId,date,ref,files}){
  BankTx.add({bankId,date,type:'Keluar',amount:pr.amount,desc:pr.purpose,ref:pr.no,source:'Payment Request'});
  if(pr.refCol==='si'){
   const si=DB.get('si',pr.refId);
   const payments=[...(si.payments||[]),{id:uid(),date,amount:pr.amount,bankId,ref,files:files||[],prId:pr.id,prNo:pr.no,by:Auth.uid(),byName:Auth.user.name}];
   DB.update('si',si.id,{payments},'Dibayar via '+pr.no,'Pembayaran keluar');
  }else if(pr.category==='Isi Ulang Petty Cash'){
   DB.insert('petty_ledger',{date,type:'Masuk',amount:pr.amount,desc:'Isi ulang dari bank — '+pr.no,ref:pr.no,byName:Auth.user.name});
  }
  DB.update('payreq',pr.id,{status:'Dibayar',paidAt:nowISO(),paidVia:bankId,paidRef:ref},'Dibayar','Dibayar');
 }
};
Approval.hooks.payment_request={
 approved(a){DB.update('payreq',a.refId,{status:'Disetujui'},'Approval disetujui','Disetujui');Notify.role('finance',`Payment Request ${DB.get('payreq',a.refId)?.no} disetujui, siap dibayar.`,'#/payreq/'+a.refId)},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('payreq',a.refId,{status:'Ditolak',rejectReason:s?.note||''},s?.note||'','Ditolak')}
};
PAGES.payreq.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   if(!can('payreq','w'))return v.innerHTML=UI.empty('Anda tidak berhak membuat Payment Request.');
   v.innerHTML=UI.pghead('Payment Request baru',`<a class="btn btn-o" href="#/payreq">‹ Batal</a>`)+`<div class="card"><div id="pqform">${Form.render(PayReq_fields(),{})}</div><div class="acts" style="margin-top:12px"><button class="btn btn-o" data-act="payreq-save">Simpan draft</button><button class="btn" data-act="payreq-submit">Simpan & ajukan</button></div></div>`;
   Form.hydrate($('#pqform'),PayReq_fields(),{});return;
  }
  v.innerHTML=UI.pghead('Payment Request',can('payreq','w')?'<a class="btn" href="#/payreq/new">+ Payment Request</a>':'')+'<div class="card" id="pql"></div>';
  new DT($('#pql'),{title:'Payment Request',rows:()=>DB.all('payreq').slice().reverse(),onRow:id=>Router.go('payreq/'+id),
   filters:[{k:'s',l:'Status',opts:()=>['Draft','Menunggu Approval','Disetujui','Dibayar','Ditolak'],get:r=>r.status},{k:'c',l:'Kategori',opts:()=>PayReq.categories,get:r=>r.category}],
   cols:[{k:'no',l:'No.'},{k:'cat',l:'Kategori',text:r=>r.category},{k:'p',l:'Keperluan',text:r=>r.purpose},{k:'amt',l:'Nominal',num:true,text:r=>rp(r.amount),sortv:r=>r.amount},{k:'req',l:'Pemohon',text:r=>userName(r.requesterId||r.createdBy)},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const r=DB.get('payreq',param);if(!r)return v.innerHTML=UI.empty('Payment Request tidak ditemukan.');
 const acts=[`<a class="btn btn-o" href="#/payreq">‹ Kembali</a>`];
 if(r.status==='Disetujui'&&can('payreq','w')&&isRole('finance','president_director'))acts.push(`<button class="btn" data-act="payreq-pay" data-id="${r.id}">Tandai sudah dibayar</button>`);
 v.innerHTML=UI.pghead('Payment Request '+r.no,acts.join(''))+`<div class="card"><div class="ch"><span>Detail</span>${UI.badge(r.status)}</div>${UI.kv([['Kategori',esc(r.category)],['Keperluan',esc(r.purpose)],['Nominal',rp(r.amount)],['Referensi',r.refCol==='si'?docLink('si',DB.get('si',r.refId)):'-'],
  ['Rekening diminta',esc(bankName(r.bankId))],['Pemohon',esc(userName(r.requesterId||r.createdBy))],['Dibayar via',r.paidVia?esc(bankName(r.paidVia))+' • ref '+esc(r.paidRef||'-'):'-']])}
  <div class="files" data-files="pqf" data-ro="1"></div></div>
  <div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('payreq',r.id)}</div>`;
 const fw=$('[data-files="pqf"]');fw._files=r.files||[];Files.render(fw);
};
function PayReq_fields(){
 return [F.s('category','Kategori',PayReq.categories,{req:true}),
  F.r('siRef','Supplier Invoice (bila kategori Bayar Supplier Invoice)','si',{filter:i=>SInv.outstanding(i)>0,hide:()=>false}),
  F.t('purpose','Keperluan / deskripsi',{req:true}),F.m('amount','Nominal (Rp)',{req:true}),F.r('bankId','Rekening sumber dana','banks',{req:true}),F.d('neededBy','Dibutuhkan sebelum',{def:()=>addDays(today(),3)}),F.fl('files','Lampiran (invoice, kuitansi, dsb.)')];
}
CHANGE.pqcat={match:t=>t.name==='siRef'&&t.closest('#pqform'),run:t=>{const si=DB.get('si',t.value);if(si){const a=$('[name="amount"]',$('#pqform'));const p=$('[name="purpose"]',$('#pqform'));if(a)a.value=SInv.outstanding(si);if(p&&!p.value)p.value='Pembayaran '+si.no+' — '+supName(si.supplierId)}}};
ACT['payreq-save']=()=>{
 const {v}=Form.collect($('#pqform'),PayReq_fields());
 const refCol=v.category==='Bayar Supplier Invoice'&&v.siRef?'si':'',refId=refCol?v.siRef:'';
 const rec=DB.insert('payreq',{...v,no:Num.next('PQ'),refCol,refId,requesterId:Auth.uid(),status:'Draft'});
 UI.toast('Draft tersimpan.');Router.go('payreq/'+rec.id);
};
ACT['payreq-submit']=async()=>{
 const {v,err}=Form.collect($('#pqform'),PayReq_fields());
 if(err.length)return UI.toast(err[0],'err');
 if(!(num(v.amount)>0))return UI.toast('Nominal harus lebih dari 0.','err');
 if(v.category==='Bayar Supplier Invoice'&&!v.siRef)return UI.toast('Pilih Supplier Invoice yang akan dibayar.','err');
 const refCol=v.category==='Bayar Supplier Invoice'&&v.siRef?'si':'',refId=refCol?v.siRef:'';
 const rec=DB.insert('payreq',{...v,no:Num.next('PQ'),refCol,refId,requesterId:Auth.uid(),status:'Draft'});
 await PayReq.submit(rec);Router.go('payreq/'+rec.id);
};
ACT['payreq-from-si']=el=>{
 const si=DB.get('si',el.dataset.id);
 Router.go('payreq/new');
 setTimeout(()=>{
  const set=(n,v)=>{const x=$(`#pqform [name="${n}"]`);if(x){x.value=v;x.dispatchEvent(new Event('change',{bubbles:true}))}};
  set('category','Bayar Supplier Invoice');set('siRef',si.id);set('amount',SInv.outstanding(si));set('purpose','Pembayaran '+si.no+' — '+supName(si.supplierId));
 },60);
};
ACT['payreq-pay']=async el=>{
 const r=DB.get('payreq',el.dataset.id);
 const v=await UI.ask({title:'Konfirmasi pembayaran — '+r.no,ok:'Simpan',fields:[F.r('bankId','Dibayar dari rekening','banks',{req:true,def:r.bankId}),F.d('date','Tanggal bayar',{req:true,def:today()}),F.t('ref','No. referensi transfer'),F.fl('files','Bukti transfer')]});
 if(!v)return;
 const bal=BankTx.balance(v.bankId);
 if(bal<r.amount&&!(await UI.confirm({title:'Saldo tidak cukup',msg:`Saldo rekening saat ini ${rp(bal)}, kurang dari nominal ${rp(r.amount)}. Tetap lanjutkan?`,danger:true})))return;
 await PayReq.pay(r,v);UI.toast('Pembayaran dicatat.');Router.render();
};

/* ================= PETTY CASH ================= */
const Petty={balance(){return sum(DB.all('petty_ledger'),t=>t.type==='Masuk'?t.amount:-t.amount)}};
PAGES.petty.render=async v=>{
 v.innerHTML=UI.pghead('Petty Cash',(can('payreq','w')?`<button class="btn btn-o" data-act="petty-topup">Isi ulang (via Payment Request)</button>`:'')+(can('petty','w')?'<button class="btn" data-act="petty-out">Catat pengeluaran</button>':''))+
  `<div class="grid g3"><div class="kpi"><span>Saldo Petty Cash</span><b>${rp(Petty.balance())}</b></div><div class="kpi"><span>Pengeluaran menunggu approval</span><b>${DB.all('approvals').filter(a=>a.type==='petty_cash'&&a.status==='Menunggu').length}</b></div><div class="kpi"><span>Total transaksi</span><b>${DB.all('petty_ledger').length}</b></div></div>
  <div class="card" id="pl"></div>`;
 new DT($('#pl'),{title:'Petty Cash',rows:()=>DB.all('petty_ledger').slice().reverse(),cols:[{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'t',l:'Jenis',text:r=>r.type,html:r=>UI.badge(r.type==='Masuk'?'Disetujui':'Ditolak').replace(r.type==='Masuk'?'Disetujui':'Ditolak',r.type)},
  {k:'amt',l:'Jumlah',num:true,text:r=>rp(r.amount),sortv:r=>r.amount},{k:'desc',l:'Keterangan'},{k:'by',l:'Oleh',text:r=>r.byName}]});
};
ACT['petty-topup']=()=>{Router.go('payreq/new');setTimeout(()=>{const x=$('#pqform [name="category"]');if(x){x.value='Isi Ulang Petty Cash';x.dispatchEvent(new Event('change',{bubbles:true}))}},60)};
ACT['petty-out']=async()=>{
 const v=await UI.ask({title:'Catat pengeluaran Petty Cash (memerlukan approval)',ok:'Ajukan approval',fields:[F.d('date','Tanggal',{req:true,def:today()}),F.m('amount','Jumlah (Rp)',{req:true}),F.ta('desc','Keperluan',{req:true}),F.fl('files','Kuitansi / bukti')],
  pre:`<div class="info" style="margin-bottom:10px">Saldo saat ini: <b>${rp(Petty.balance())}</b></div>`});
 if(!v)return;
 if(!(num(v.amount)>0))return UI.toast('Jumlah harus lebih dari 0.','err');
 if(num(v.amount)>Petty.balance())return UI.toast('Jumlah melebihi saldo petty cash.','err');
 Approval.request({type:'petty_cash',refCol:'petty_ledger',refId:'',title:'Pengeluaran Petty Cash: '+v.desc,amount:v.amount,reason:v.desc,files:v.files,meta:{date:v.date,desc:v.desc,amount:v.amount}});
 UI.toast('Diajukan untuk approval.');Router.render();
};
Approval.hooks.petty_cash={
 approved(a){DB.insert('petty_ledger',{date:a.meta.date,type:'Keluar',amount:a.meta.amount,desc:a.meta.desc,byName:a.requesterName})},
 rejected(){}
};

/* ================= BANK & CASH ================= */
PAGES.bank.render=async(v,param)=>{
 const banks=DB.all('banks'),bk=param?DB.get('banks',param):banks[0];
 v.innerHTML=UI.pghead('Bank & Cash')+`<div class="grid g3">${banks.map(b=>`<div class="kpi ${bk&&b.id===bk.id?'':''}"><span>${esc(b.name)}</span><b>${rp(BankTx.balance(b.id))}</b><small>${esc(b.bank)} ${esc(b.accNo)}</small></div>`).join('')}</div>
  <div class="tabs">${banks.map(b=>`<a href="#/bank/${b.id}" class="${bk&&b.id===bk.id?'on':''}">${esc(b.name)}</a>`).join('')}</div>
  <div class="card"><div class="ch"><span>Mutasi — ${esc(bk?.name||'')}</span>${can('bank','w')?`<button class="btn btn-sm" data-act="bank-manual" data-id="${bk?.id||''}">+ Transaksi manual</button>`:''}</div><div id="bkt"></div></div>`;
 if(!bk)return;
 new DT($('#bkt'),{title:'Mutasi bank',size:20,rows:()=>DB.all('bank_tx').filter(t=>t.bankId===bk.id).slice().reverse(),
  cols:[{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'t',l:'Jenis',text:r=>r.type,html:r=>UI.badge(r.type==='Masuk'?'Lunas':'Ditolak').replace(/Lunas|Ditolak/,r.type)},
   {k:'amt',l:'Jumlah',num:true,text:r=>rp(r.amount),sortv:r=>r.amount},{k:'desc',l:'Keterangan'},{k:'ref',l:'Referensi'},{k:'rec',l:'Rekonsiliasi',html:r=>UI.badge(r.reconciled?'Sudah rekon':'Belum rekon')}]});
};
ACT['bank-manual']=async el=>{
 const v=await UI.ask({title:'Transaksi bank manual',ok:'Simpan',fields:[F.s('type','Jenis',['Masuk','Keluar'],{req:true}),F.d('date','Tanggal',{req:true,def:today()}),F.m('amount','Jumlah (Rp)',{req:true}),F.ta('desc','Keterangan',{req:true})]});
 if(!v)return;if(!(num(v.amount)>0))return UI.toast('Jumlah harus lebih dari 0.','err');
 BankTx.add({bankId:el.dataset.id,...v,source:'Manual'});UI.toast('Transaksi tersimpan.');Router.render();
};

/* ================= TAX ================= */
PAGES.tax.render=async v=>{
 const period=today().slice(0,7);
 const ppnOut=sum(DB.all('invoices').filter(i=>!i.cancelled&&(i.date||'').startsWith(period)),i=>i.tax);
 const ppnIn=sum(DB.all('si').filter(i=>!i.cancelled&&(i.date||'').startsWith(period)),i=>i.tax);
 v.innerHTML=UI.pghead('Tax',can('tax','w')?'<button class="btn" data-act="tax-new">+ Catat dokumen pajak</button>':'')+
  `<div class="grid g3"><div class="kpi"><span>PPN Keluaran (bulan ini)</span><b>${rp(ppnOut)}</b></div><div class="kpi"><span>PPN Masukan (bulan ini)</span><b>${rp(ppnIn)}</b></div><div class="kpi"><span>PPN kurang/lebih bayar</span><b>${rp(ppnOut-ppnIn)}</b></div></div>
  <div class="card"><h3>Tarif pajak</h3>${DB.all('taxes').map(t=>`<div>${esc(t.name)} — <b>${pct(t.rate)}</b> ${t.active?'':UI.badge('Nonaktif')}</div>`).join('')}<p class="mut">Ubah tarif di <a href="#/master/taxes">Master Data → Tax</a>.</p></div>
  <div class="card" id="txl"></div>`;
 new DT($('#txl'),{title:'Dokumen Pajak',rows:()=>DB.all('tax_docs').slice().reverse(),
  filters:[{k:'t',l:'Jenis',opts:()=>['Faktur Pajak','Bukti Potong PPh 21','Bukti Potong PPh 23'],get:r=>r.type}],
  cols:[{k:'no',l:'No. Dokumen'},{k:'t',l:'Jenis'},{k:'date',l:'Tanggal',text:r=>fdate(r.date),sortv:r=>r.date},{k:'ref',l:'Referensi',text:r=>r.refCol==='invoices'?DB.get('invoices',r.refId)?.no:r.refCol==='si'?DB.get('si',r.refId)?.no:'-'},
   {k:'amt',l:'Nilai',num:true,text:r=>rp(r.amount),sortv:r=>r.amount},{k:'files',l:'File',text:r=>(r.files||[]).length+' file'}]});
};
ACT['tax-new']=async()=>{
 const v=await UI.ask({title:'Catat dokumen pajak',ok:'Simpan',fields:[F.s('type','Jenis dokumen',['Faktur Pajak','Bukti Potong PPh 21','Bukti Potong PPh 23'],{req:true}),F.t('docNo','Nomor dokumen',{req:true}),
  F.d('date','Tanggal',{req:true,def:today()}),F.m('amount','Nilai (Rp)',{req:true}),F.ta('notes','Catatan'),F.fl('files','Unggah dokumen',{req:true})]});
 if(!v)return;
 DB.insert('tax_docs',{...v,no:v.docNo});UI.toast('Dokumen pajak tersimpan.');Router.render();
};

/* ================= BANK RECONCILIATION ================= */
PAGES.recon.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   const banks=DB.all('banks');
   v.innerHTML=UI.pghead('Rekonsiliasi baru',`<a class="btn btn-o" href="#/recon">‹ Batal</a>`)+
    `<div class="card"><div class="fg"><div class="fld"><label>Rekening</label><select id="rcbank">${banks.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
     <div class="fld"><label>Periode</label><input type="month" id="rcperiod" value="${today().slice(0,7)}"></div></div>
     <label style="margin-top:10px">Baris mutasi rekening koran (tempel dari statement bank: tanggal | keterangan | jumlah, satu baris per transaksi; nominal keluar tulis negatif)</label>
     <textarea id="rcstmt" rows="8" placeholder="2026-09-05 | Transfer masuk INV/2026/09/0001 | 500000000
2026-09-07 | Biaya admin | -50000"></textarea>
     <div class="acts" style="margin-top:10px"><button class="btn" data-act="recon-start">Mulai cocokkan</button></div></div>`;
   return;
  }
  v.innerHTML=UI.pghead('Bank Reconciliation',can('recon','w')?'<a class="btn" href="#/recon/new">+ Rekonsiliasi baru</a>':'')+'<div class="card" id="rcl"></div>';
  new DT($('#rcl'),{title:'Bank Reconciliation',rows:()=>DB.all('recons').slice().reverse(),onRow:id=>Router.go('recon/'+id),
   cols:[{k:'no',l:'No.'},{k:'b',l:'Rekening',text:r=>bankName(r.bankId)},{k:'p',l:'Periode',text:r=>r.period},{k:'match',l:'Cocok',num:true,text:r=>r.lines.filter(l=>l.matchedId).length+'/'+r.lines.length},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const rc=DB.get('recons',param);if(!rc)return v.innerHTML=UI.empty('Rekonsiliasi tidak ditemukan.');
 const sysTx=DB.all('bank_tx').filter(t=>t.bankId===rc.bankId&&t.date.startsWith(rc.period));
 const matchedSys=new Set(rc.lines.filter(l=>l.matchedId).map(l=>l.matchedId));
 v.innerHTML=UI.pghead('Rekonsiliasi '+rc.no,`<a class="btn btn-o" href="#/recon">‹ Kembali</a>`)+`<div class="card"><div class="ch"><span>${esc(bankName(rc.bankId))} — ${esc(rc.period)}</span>${UI.badge(rc.status)}</div>
  <div class="grid g2"><div><h3 class="mut">Rekening koran</h3><div class="tblw"><table><tr><th>Tanggal</th><th>Keterangan</th><th class="num">Jumlah</th><th>Status</th></tr>${rc.lines.map((l,idx)=>`<tr><td>${fdate(l.date)}</td><td>${esc(l.desc)}</td><td class="num">${rp(l.amount)}</td><td>${l.matchedId?UI.badge('Cocok'):(rc.status==='Draft'?`<select data-rcmatch="${idx}"><option value="">— pilih transaksi sistem —</option>${sysTx.filter(t=>!matchedSys.has(t.id)||t.id===l.matchedId).map(t=>`<option value="${t.id}" ${Math.abs((t.type==='Masuk'?t.amount:-t.amount)-l.amount)<1?'selected':''}>${fdate(t.date)} ${esc(t.desc)} (${t.type==='Masuk'?'':'-'}${rp(t.amount)})</option>`).join('')}</select>`:UI.badge('Belum cocok'))}</td></tr>`).join('')}</table></div></div>
  <div><h3 class="mut">Sistem (belum cocok)</h3><div class="tblw"><table><tr><th>Tanggal</th><th>Keterangan</th><th class="num">Jumlah</th></tr>${sysTx.filter(t=>!matchedSys.has(t.id)).map(t=>`<tr><td>${fdate(t.date)}</td><td>${esc(t.desc)}</td><td class="num">${t.type==='Masuk'?'':'-'}${rp(t.amount)}</td></tr>`).join('')||'<tr><td colspan=3 class="empty">Semua cocok</td></tr>'}</table></div></div></div>
  ${rc.status==='Draft'&&can('recon','w')?`<div class="acts" style="margin-top:12px"><button class="btn btn-o" data-act="recon-apply" data-id="${rc.id}">Simpan pencocokan</button><button class="btn" data-act="recon-finish" data-id="${rc.id}">Selesaikan rekonsiliasi</button></div>`:''}</div>`;
};
ACT['recon-start']=()=>{
 const bankId=$('#rcbank').value,period=$('#rcperiod').value,raw=$('#rcstmt').value.trim();
 if(!raw)return UI.toast('Isi minimal satu baris mutasi rekening koran.','err');
 const lines=raw.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const [d,desc,amt]=l.split('|').map(x=>x.trim());return {date:/^\d{4}-\d\d-\d\d$/.test(d)?d:period+'-01',desc:desc||'',amount:parseFloat(amt)||0,matchedId:''}});
 const sysTx=DB.all('bank_tx').filter(t=>t.bankId===bankId&&t.date.startsWith(period));
 lines.forEach(l=>{const m=sysTx.find(t=>!lines.some(x=>x.matchedId===t.id)&&Math.abs((t.type==='Masuk'?t.amount:-t.amount)-l.amount)<1);if(m)l.matchedId=m.id});
 const rc=DB.insert('recons',{no:Num.next('REC'),bankId,period,lines,status:'Draft'});
 UI.toast('Pencocokan awal dibuat otomatis untuk nominal yang sama persis.');Router.go('recon/'+rc.id);
};
ACT['recon-apply']=el=>{
 const rc=DB.get('recons',el.dataset.id);
 $$('[data-rcmatch]').forEach(s=>{rc.lines[+s.dataset.rcmatch].matchedId=s.value});
 DB.save('recons');UI.toast('Pencocokan disimpan.');Router.render();
};
ACT['recon-finish']=async el=>{
 const rc=DB.get('recons',el.dataset.id);
 $$('[data-rcmatch]').forEach(s=>{rc.lines[+s.dataset.rcmatch].matchedId=s.value});
 const unmatched=rc.lines.filter(l=>!l.matchedId).length;
 if(unmatched&&!(await UI.confirm({title:'Selesaikan rekonsiliasi',msg:`Masih ada ${unmatched} baris rekening koran yang belum cocok dengan sistem. Tetap selesaikan?`,danger:true})))return;
 rc.lines.filter(l=>l.matchedId).forEach(l=>{const t=DB.get('bank_tx',l.matchedId);if(t)t.reconciled=true});
 DB.save('bank_tx');DB.update('recons',rc.id,{status:'Selesai'},'Direkonsiliasi','Selesai');
 UI.toast('Rekonsiliasi selesai.');Router.render();
};

/* ================= Hook: pembayaran invoice customer -> bank ledger ================= */
const _oldInvPay=ACT['inv-pay'];
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
 if(v.bankId)BankTx.add({bankId:v.bankId,date:v.date,type:'Masuk',amount:v.amount,desc:'Pembayaran '+i.no,ref:v.ref,source:'Customer Invoice'});
 const upd=DB.get('invoices',i.id);
 UI.toast('Pembayaran dicatat. Status: '+Inv.status(upd));
 if(i.orderId){const o=DB.get('orders',i.orderId);if(o){Notify.user(o.salesId,`Pembayaran ${rp(v.amount)} diterima untuk ${i.no} (${Inv.status(upd)}).`,'#/orders/'+o.id);Order.touch(o.id)}}
 Router.render();
};
