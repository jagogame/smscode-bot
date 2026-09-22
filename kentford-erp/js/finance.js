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
  if(type==='Penuh'&&used>0)throw new Error(t('inv.err_full_only_if_none'));
  if(dpp<=0.5||dpp>dppPO-used+0.5)throw new Error(t('si.err_exceeds_remaining',{amt:rp(dppPO-used)}));
  const tax=dpp*num(po.taxPct)/100;
  return DB.insert('si',{no:Num.next('SI'),poId:po.id,supplierId:po.supplierId,type,date,dueDate:addDays(date,num(terms)),dpp,taxPct:po.taxPct,tax,total:dpp+tax,
   desc:note||(type==='DP'?`Down payment ${pct}%`:type==='Pelunasan'?t('inv.type_settlement'):t('inv.type_full'))+' — '+po.no,payments:[],cancelled:false});
 },
 manual(v){
  const dpp=num(v.amount),tax=dpp*num(v.taxPct)/100;
  return DB.insert('si',{no:Num.next('SI'),poId:'',supplierId:v.supplierId,type:'Manual',date:v.date,dueDate:addDays(v.date,num(v.terms)),dpp,taxPct:v.taxPct,tax,total:dpp+tax,desc:v.desc,payments:[],cancelled:false});
 }
};
PAGES.si.render=async(v,param)=>{
 if(!param){
  v.innerHTML=UI.pghead(t('nav.si'),can('si','w')?`<button class="btn" data-act="si-new">+ ${t('si.manual_invoice')}</button>`:'')+'<div class="card" id="sil"></div>';
  new DT($('#sil'),{title:t('nav.si'),rows:()=>DB.all('si').slice().reverse(),onRow:id=>Router.go('si/'+id),
   filters:[{k:'s',l:t('common.status'),opts:()=>['Belum dibayar','DP diterima','Dibayar sebagian','Lunas','Jatuh tempo','Terlambat','Dibatalkan'],get:r=>SInv.status(r)},{k:'sp',l:t('common.supplier'),opts:()=>DB.all('suppliers').map(s=>s.name),get:r=>supName(r.supplierId)}],
   cols:[{k:'no',l:t('inv.no_invoice')},{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'sp',l:t('common.supplier'),text:r=>supName(r.supplierId)},{k:'po',l:'PO',text:r=>r.poId?DB.get('po',r.poId)?.no:'-'},
    {k:'due',l:t('inv.due_date'),text:r=>fdate(r.dueDate),sortv:r=>r.dueDate},{k:'total',l:t('common.total'),num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'paid',l:t('inv.paid'),num:true,text:r=>rp(SInv.paid(r))},{k:'st',l:t('common.status'),text:r=>SInv.status(r),html:r=>UI.badge(SInv.status(r))}]});
  return;
 }
 const i=DB.get('si',param);if(!i)return v.innerHTML=UI.empty(t('si.not_found'));
 const st=SInv.status(i),hasPR=DB.all('payreq').some(p=>p.refCol==='si'&&p.refId===i.id&&!['Ditolak','Dibatalkan'].includes(p.status));
 const acts=[`<a class="btn btn-o" href="#/si">‹ ${t('common.back')}</a>`];
 if(can('payreq','w')&&!i.cancelled&&SInv.outstanding(i)>0&&!hasPR)acts.push(`<button class="btn" data-act="payreq-from-si" data-id="${i.id}">${t('si.request_payreq')}</button>`);
 v.innerHTML=UI.pghead(t('nav.si')+' '+i.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>${t('inv.info_title')}</span>${UI.badge(st)}</div>${UI.kv([[t('common.supplier'),esc(supName(i.supplierId))],[t('po.related_pr').replace('PR','PO'),i.poId?docLink('po',DB.get('po',i.poId)):'-'],[t('common.type'),esc(i.type)],[t('common.date'),fdate(i.date)],[t('inv.due_date'),fdate(i.dueDate)],[t('common.description'),esc(i.desc)],[t('inv.aging'),esc(SInv.aging(i))]])}</div>
  <div class="card"><h3>${t('si.outgoing_payments')}</h3>${(i.payments||[]).length?`<div class="tblw"><table><tr><th>${t('common.date')}</th><th>${t('common.account')}</th><th class="num">${t('common.amount')}</th><th>${t('nav.payreq')}</th></tr>${i.payments.map(p=>`<tr><td>${fdate(p.date)}</td><td>${esc(bankName(p.bankId))}</td><td class="num">${rp(p.amount)}</td><td>${p.prNo?docLink('payreq',DB.get('payreq',p.prId)):'-'}</td></tr>`).join('')}</table></div>`:`<div class="empty">${t('inv.no_payments_yet')}</div>`}</div></div>
  <div><div class="card"><h3>${t('common.value')}</h3><dl class="kv"><dt>${t('common.dpp')}</dt><dd>${rp(i.dpp)}</dd><dt>${t('common.ppn')}</dt><dd>${rp(i.tax)}</dd><dt><b>${t('common.total')}</b></dt><dd><b>${rp(i.total)}</b></dd><dt>${t('inv.paid')}</dt><dd>${rp(SInv.paid(i))}</dd><dt>${t('inv.outstanding')}</dt><dd><b>${rp(SInv.outstanding(i))}</b></dd></dl></div>
  <div class="card"><h3>${t('common.activity_comments')}</h3>${UI.activity('si',i.id)}</div></div></div>`;
};
ACT['si-new']=async()=>{
 const v=await UI.ask({title:t('si.manual_invoice'),ok:t('common.save'),fields:[F.r('supplierId',t('common.supplier'),'suppliers',{req:true}),F.d('date',t('common.date'),{req:true,def:today()}),F.n('terms',t('inv.due_days'),{req:true,def:30}),
  F.m('amount',t('si.amount_dpp_rp'),{req:true}),F.pc('taxPct',t('quot.tax_pct'),{def:()=>S().defaultTaxPct??11}),F.ta('desc',t('common.description'),{req:true}),F.fl('files',t('si.invoice_attachment'))]});
 if(!v)return;if(!(num(v.amount)>0))return UI.toast(t('si.err_amount_positive'),'err');
 const i=SInv.manual(v);UI.toast(t('si.created',{no:i.no}));Router.go('si/'+i.id);
};
ACT['si-fromPO']=async el=>{
 const po=DB.get('po',el.dataset.id),used=sum(DB.all('si').filter(x=>x.poId===po.id&&!x.cancelled),x=>x.dpp),dppPO=POH.calc(po).total/(1+num(po.taxPct)/100);
 const v=await UI.ask({title:t('po.make_si')+' — '+po.no,ok:t('so.make_invoice'),fields:[F.s('type',t('common.type'),['DP','Pelunasan','Penuh'],{req:true,def:used>0?'Pelunasan':(po.dpPct?'DP':'Penuh')}),
  F.pc('pct',t('inv.dp_pct').replace(' — khusus jenis DP','').replace(' — DP type only',''),{def:po.dpPct||30}),F.d('date',t('inv.invoice_date'),{req:true,def:today()}),F.n('terms',t('inv.due_days'),{req:true,def:30})],
  pre:`<div class="info" style="margin-bottom:10px">${t('si.pre_po_summary',{total:rp(dppPO),used:rp(used),remaining:rp(dppPO-used)})}</div>`});
 if(!v)return;
 try{const i=SInv.fromPO(po,v);UI.toast(t('si.created',{no:i.no}));Router.render()}catch(e){UI.toast(e.message,'err')}
};
PAGES.ap.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.ap'))+'<div class="card" id="apb"></div>';
 const rows=()=>DB.all('si').filter(i=>SInv.outstanding(i)>0&&!i.cancelled);
 new DT($('#apb'),{title:t('nav.ap'),rows,onRow:id=>Router.go('si/'+id),size:20,
  filters:[{k:'sp',l:t('common.supplier'),opts:()=>DB.all('suppliers').map(s=>s.name),get:r=>supName(r.supplierId)}],
  cols:[{k:'no',l:t('common.no_dot')},{k:'sp',l:t('common.supplier'),text:r=>supName(r.supplierId)},{k:'due',l:t('inv.due_date'),text:r=>fdate(r.dueDate),sortv:r=>r.dueDate},
   {k:'total',l:t('common.total'),num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'out',l:t('inv.outstanding'),num:true,text:r=>rp(SInv.outstanding(r)),sortv:r=>SInv.outstanding(r)},{k:'b',l:t('inv.aging'),text:r=>SInv.aging(r)},{k:'st',l:t('common.status'),text:r=>SInv.status(r),html:r=>UI.badge(SInv.status(r))}]});
};

/* ================= PAYMENT REQUEST ================= */
const PayReq={
 categories:['Bayar Supplier Invoice','Isi Ulang Petty Cash','Operasional / Lainnya'],
 async submit(rec){
  Approval.request({type:'payment_request',refCol:'payreq',refId:rec.id,title:`${rec.category} — ${rec.purpose}`,amount:rec.amount,reason:rec.purpose});
  DB.update('payreq',rec.id,{status:'Menunggu Approval'},t('common.action_submitted_reason'),t('common.action_request_approval'));
  UI.toast(t('payreq.submitted'));
 },
 async pay(pr,{bankId,date,ref,files}){
  BankTx.add({bankId,date,type:'Keluar',amount:pr.amount,desc:pr.purpose,ref:pr.no,source:'Payment Request'});
  if(pr.refCol==='si'){
   const si=DB.get('si',pr.refId);
   const payments=[...(si.payments||[]),{id:uid(),date,amount:pr.amount,bankId,ref,files:files||[],prId:pr.id,prNo:pr.no,by:Auth.uid(),byName:Auth.user.name}];
   DB.update('si',si.id,{payments},t('payreq.reason_paid_via',{no:pr.no}),t('payreq.action_outgoing_payment'));
  }else if(pr.category==='Isi Ulang Petty Cash'){
   DB.insert('petty_ledger',{date,type:'Masuk',amount:pr.amount,desc:t('petty.topup_desc',{no:pr.no}),ref:pr.no,byName:Auth.user.name});
  }
  DB.update('payreq',pr.id,{status:'Dibayar',paidAt:nowISO(),paidVia:bankId,paidRef:ref},t('payreq.action_paid'),t('payreq.action_paid'));
 }
};
Approval.hooks.payment_request={
 approved(a){DB.update('payreq',a.refId,{status:'Disetujui'},t('quot.reason_approval_approved'),t('quot.action_approved'));Notify.role('finance',t('payreq.notify_approved',{no:DB.get('payreq',a.refId)?.no}),'#/payreq/'+a.refId)},
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('payreq',a.refId,{status:'Ditolak',rejectReason:s?.note||''},s?.note||'',t('quot.action_rejected'))}
};
PAGES.payreq.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   if(!can('payreq','w'))return v.innerHTML=UI.empty(t('payreq.no_right'));
   v.innerHTML=UI.pghead(t('payreq.new'),`<a class="btn btn-o" href="#/payreq">‹ ${t('common.cancel')}</a>`)+`<div class="card"><div id="pqform">${Form.render(PayReq_fields(),{})}</div><div class="acts" style="margin-top:12px"><button class="btn btn-o" data-act="payreq-save">${t('common.save_draft')}</button><button class="btn" data-act="payreq-submit">${t('common.save_submit')}</button></div></div>`;
   Form.hydrate($('#pqform'),PayReq_fields(),{});return;
  }
  v.innerHTML=UI.pghead(t('nav.payreq'),can('payreq','w')?`<a class="btn" href="#/payreq/new">+ ${t('nav.payreq')}</a>`:'')+'<div class="card" id="pql"></div>';
  new DT($('#pql'),{title:t('nav.payreq'),rows:()=>DB.all('payreq').slice().reverse(),onRow:id=>Router.go('payreq/'+id),
   filters:[{k:'s',l:t('common.status'),opts:()=>['Draft','Menunggu Approval','Disetujui','Dibayar','Ditolak'],get:r=>r.status},{k:'c',l:t('common.category'),opts:()=>PayReq.categories,get:r=>r.category}],
   cols:[{k:'no',l:t('common.no_dot')},{k:'cat',l:t('common.category'),text:r=>r.category},{k:'p',l:t('payreq.purpose'),text:r=>r.purpose},{k:'amt',l:t('payreq.nominal'),num:true,text:r=>rp(r.amount),sortv:r=>r.amount},{k:'req',l:t('pr.requester'),text:r=>userName(r.requesterId||r.createdBy)},{k:'st',l:t('common.status'),text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const r=DB.get('payreq',param);if(!r)return v.innerHTML=UI.empty(t('payreq.not_found'));
 const acts=[`<a class="btn btn-o" href="#/payreq">‹ ${t('common.back')}</a>`];
 if(r.status==='Disetujui'&&can('payreq','w')&&isRole('finance','director'))acts.push(`<button class="btn" data-act="payreq-pay" data-id="${r.id}">${t('payreq.mark_paid')}</button>`);
 v.innerHTML=UI.pghead(t('nav.payreq')+' '+r.no,acts.join(''))+`<div class="card"><div class="ch"><span>${t('payreq.detail')}</span>${UI.badge(r.status)}</div>${UI.kv([[t('common.category'),esc(r.category)],[t('payreq.purpose'),esc(r.purpose)],[t('payreq.nominal'),rp(r.amount)],[t('common.reference'),r.refCol==='si'?docLink('si',DB.get('si',r.refId)):'-'],
  [t('payreq.requested_account'),esc(bankName(r.bankId))],[t('pr.requester'),esc(userName(r.requesterId||r.createdBy))],[t('payreq.paid_via'),r.paidVia?esc(bankName(r.paidVia))+' • '+t('common.reference').toLowerCase()+' '+esc(r.paidRef||'-'):'-']])}
  <div class="files" data-files="pqf" data-ro="1"></div></div>
  <div class="card"><h3>${t('common.activity_comments')}</h3>${UI.activity('payreq',r.id)}</div>`;
 const fw=$('[data-files="pqf"]');fw._files=r.files||[];Files.render(fw);
};
function PayReq_fields(){
 return [F.s('category',t('common.category'),PayReq.categories,{req:true}),
  F.r('siRef',t('payreq.si_ref_label'),'si',{filter:i=>SInv.outstanding(i)>0,hide:()=>false}),
  F.t('purpose',t('payreq.purpose_desc'),{req:true}),F.m('amount',t('payreq.nominal_rp'),{req:true}),F.r('bankId',t('payreq.source_account'),'banks',{req:true}),F.d('neededBy',t('payreq.needed_before'),{def:()=>addDays(today(),3)}),F.fl('files',t('payreq.attachment_hint'))];
}
CHANGE.pqcat={match:el=>el.name==='siRef'&&el.closest('#pqform'),run:el=>{const si=DB.get('si',el.value);if(si){const a=$('[name="amount"]',$('#pqform'));const p=$('[name="purpose"]',$('#pqform'));if(a)a.value=SInv.outstanding(si);if(p&&!p.value)p.value=t('payreq.purpose_pay',{no:si.no,sup:supName(si.supplierId)})}}};
ACT['payreq-save']=()=>{
 const {v}=Form.collect($('#pqform'),PayReq_fields());
 const refCol=v.category==='Bayar Supplier Invoice'&&v.siRef?'si':'',refId=refCol?v.siRef:'';
 const rec=DB.insert('payreq',{...v,no:Num.next('PQ'),refCol,refId,requesterId:Auth.uid(),status:'Draft'});
 UI.toast(t('common.draft_saved'));Router.go('payreq/'+rec.id);
};
ACT['payreq-submit']=async()=>{
 const {v,err}=Form.collect($('#pqform'),PayReq_fields());
 if(err.length)return UI.toast(err[0],'err');
 if(!(num(v.amount)>0))return UI.toast(t('quot.err_qty_positive'),'err');
 if(v.category==='Bayar Supplier Invoice'&&!v.siRef)return UI.toast(t('payreq.err_pick_si'),'err');
 const refCol=v.category==='Bayar Supplier Invoice'&&v.siRef?'si':'',refId=refCol?v.siRef:'';
 const rec=DB.insert('payreq',{...v,no:Num.next('PQ'),refCol,refId,requesterId:Auth.uid(),status:'Draft'});
 await PayReq.submit(rec);Router.go('payreq/'+rec.id);
};
ACT['payreq-from-si']=el=>{
 const si=DB.get('si',el.dataset.id);
 Router.go('payreq/new');
 setTimeout(()=>{
  const set=(n,v)=>{const x=$(`#pqform [name="${n}"]`);if(x){x.value=v;x.dispatchEvent(new Event('change',{bubbles:true}))}};
  set('category','Bayar Supplier Invoice');set('siRef',si.id);set('amount',SInv.outstanding(si));set('purpose',t('payreq.purpose_pay',{no:si.no,sup:supName(si.supplierId)}));
 },60);
};
ACT['payreq-pay']=async el=>{
 const r=DB.get('payreq',el.dataset.id);
 const v=await UI.ask({title:t('payreq.confirm_payment')+' — '+r.no,ok:t('common.save'),fields:[F.r('bankId',t('payreq.paid_from_account'),'banks',{req:true,def:r.bankId}),F.d('date',t('payreq.pay_date'),{req:true,def:today()}),F.t('ref',t('inv.ref_no')),F.fl('files',t('inv.transfer_proof'))]});
 if(!v)return;
 const bal=BankTx.balance(v.bankId);
 if(bal<r.amount&&!(await UI.confirm({title:t('payreq.balance_insufficient'),msg:t('payreq.balance_insufficient_msg',{bal:rp(bal),amt:rp(r.amount)}),danger:true})))return;
 await PayReq.pay(r,v);UI.toast(t('payreq.payment_recorded'));Router.render();
};

/* ================= PETTY CASH ================= */
const Petty={balance(){return sum(DB.all('petty_ledger'),t=>t.type==='Masuk'?t.amount:-t.amount)}};
PAGES.petty.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.petty'),(can('payreq','w')?`<button class="btn btn-o" data-act="petty-topup">${t('petty.topup_via_payreq')}</button>`:'')+(can('petty','w')?`<button class="btn" data-act="petty-out">${t('petty.record_expense')}</button>`:''))+
  `<div class="grid g3"><div class="kpi"><span>${t('petty.balance')}</span><b>${rp(Petty.balance())}</b></div><div class="kpi"><span>${t('petty.pending_approval')}</span><b>${DB.all('approvals').filter(a=>a.type==='petty_cash'&&a.status==='Menunggu').length}</b></div><div class="kpi"><span>${t('petty.total_tx')}</span><b>${DB.all('petty_ledger').length}</b></div></div>
  <div class="card" id="pl"></div>`;
 new DT($('#pl'),{title:t('nav.petty'),rows:()=>DB.all('petty_ledger').slice().reverse(),cols:[{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'t',l:t('common.type'),text:r=>r.type,html:r=>UI.badge(r.type==='Masuk'?'Disetujui':'Ditolak').replace(r.type==='Masuk'?'Disetujui':'Ditolak',r.type)},
  {k:'amt',l:t('payreq.nominal'),num:true,text:r=>rp(r.amount),sortv:r=>r.amount},{k:'desc',l:t('common.description')},{k:'by',l:t('common.recorded_by'),text:r=>r.byName}]});
};
ACT['petty-topup']=()=>{Router.go('payreq/new');setTimeout(()=>{const x=$('#pqform [name="category"]');if(x){x.value='Isi Ulang Petty Cash';x.dispatchEvent(new Event('change',{bubbles:true}))}},60)};
ACT['petty-out']=async()=>{
 const v=await UI.ask({title:t('petty.record_expense_title'),ok:t('common.action_request_approval'),fields:[F.d('date',t('common.date'),{req:true,def:today()}),F.m('amount',t('petty.amount_rp'),{req:true}),F.ta('desc',t('gi.purpose'),{req:true}),F.fl('files',t('petty.receipt_hint'))],
  pre:`<div class="info" style="margin-bottom:10px">${t('petty.pre_balance',{bal:rp(Petty.balance())})}</div>`});
 if(!v)return;
 if(!(num(v.amount)>0))return UI.toast(t('quot.err_qty_positive'),'err');
 if(num(v.amount)>Petty.balance())return UI.toast(t('petty.err_exceeds_balance'),'err');
 Approval.request({type:'petty_cash',refCol:'petty_ledger',refId:'',title:t('petty.expense_title',{desc:v.desc}),amount:v.amount,reason:v.desc,files:v.files,meta:{date:v.date,desc:v.desc,amount:v.amount}});
 UI.toast(t('common.action_submitted_reason'));Router.render();
};
Approval.hooks.petty_cash={
 approved(a){DB.insert('petty_ledger',{date:a.meta.date,type:'Keluar',amount:a.meta.amount,desc:a.meta.desc,byName:a.requesterName})},
 rejected(){}
};

/* ================= BANK & CASH ================= */
PAGES.bank.render=async(v,param)=>{
 const banks=DB.all('banks'),bk=param?DB.get('banks',param):banks[0];
 v.innerHTML=UI.pghead(t('nav.bank'))+`<div class="grid g3">${banks.map(b=>`<div class="kpi ${bk&&b.id===bk.id?'':''}"><span>${esc(b.name)}</span><b>${rp(BankTx.balance(b.id))}</b><small>${esc(b.bank)} ${esc(b.accNo)}</small></div>`).join('')}</div>
  <div class="tabs">${banks.map(b=>`<a href="#/bank/${b.id}" class="${bk&&b.id===bk.id?'on':''}">${esc(b.name)}</a>`).join('')}</div>
  <div class="card"><div class="ch"><span>${t('bank.mutation')} — ${esc(bk?.name||'')}</span>${can('bank','w')?`<button class="btn btn-sm" data-act="bank-manual" data-id="${bk?.id||''}">+ ${t('bank.manual_tx')}</button>`:''}</div><div id="bkt"></div></div>`;
 if(!bk)return;
 new DT($('#bkt'),{title:t('bank.mutation'),size:20,rows:()=>DB.all('bank_tx').filter(t=>t.bankId===bk.id).slice().reverse(),
  cols:[{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'t',l:t('common.type'),text:r=>r.type,html:r=>UI.badge(r.type==='Masuk'?'Lunas':'Ditolak').replace(/Lunas|Ditolak/,r.type)},
   {k:'amt',l:t('payreq.nominal'),num:true,text:r=>rp(r.amount),sortv:r=>r.amount},{k:'desc',l:t('common.description')},{k:'ref',l:t('common.reference')},{k:'rec',l:t('bank.recon'),html:r=>UI.badge(r.reconciled?t('bank.reconciled'):t('bank.not_reconciled'))}]});
};
ACT['bank-manual']=async el=>{
 const v=await UI.ask({title:t('bank.manual_tx'),ok:t('common.save'),fields:[F.s('type',t('common.type'),['Masuk','Keluar'],{req:true}),F.d('date',t('common.date'),{req:true,def:today()}),F.m('amount',t('petty.amount_rp'),{req:true}),F.ta('desc',t('common.description'),{req:true})]});
 if(!v)return;if(!(num(v.amount)>0))return UI.toast(t('quot.err_qty_positive'),'err');
 BankTx.add({bankId:el.dataset.id,...v,source:'Manual'});UI.toast(t('bank.tx_saved'));Router.render();
};

/* ================= TAX ================= */
PAGES.tax.render=async v=>{
 const period=today().slice(0,7);
 const ppnOut=sum(DB.all('invoices').filter(i=>!i.cancelled&&(i.date||'').startsWith(period)),i=>i.tax);
 const ppnIn=sum(DB.all('si').filter(i=>!i.cancelled&&(i.date||'').startsWith(period)),i=>i.tax);
 v.innerHTML=UI.pghead(t('nav.tax'),can('tax','w')?`<button class="btn" data-act="tax-new">+ ${t('tax.record_doc')}</button>`:'')+
  `<div class="grid g3"><div class="kpi"><span>${t('tax.output_vat')}</span><b>${rp(ppnOut)}</b></div><div class="kpi"><span>${t('tax.input_vat')}</span><b>${rp(ppnIn)}</b></div><div class="kpi"><span>${t('tax.balance')}</span><b>${rp(ppnOut-ppnIn)}</b></div></div>
  <div class="card"><h3>${t('tax.rates')}</h3>${DB.all('taxes').map(t2=>`<div>${esc(t2.name)} — <b>${pct(t2.rate)}</b> ${t2.active?'':UI.badge(t('tax.inactive'))}</div>`).join('')}<p class="mut">${t('tax.change_rate_hint')} <a href="#/master/taxes">Master Data → Tax</a>.</p></div>
  <div class="card" id="txl"></div>`;
 new DT($('#txl'),{title:t('tax.docs'),rows:()=>DB.all('tax_docs').slice().reverse(),
  filters:[{k:'t',l:t('common.type'),opts:()=>['Faktur Pajak','Bukti Potong PPh 21','Bukti Potong PPh 23'],get:r=>r.type}],
  cols:[{k:'no',l:t('tax.doc_no')},{k:'t',l:t('common.type')},{k:'date',l:t('common.date'),text:r=>fdate(r.date),sortv:r=>r.date},{k:'ref',l:t('common.reference'),text:r=>r.refCol==='invoices'?DB.get('invoices',r.refId)?.no:r.refCol==='si'?DB.get('si',r.refId)?.no:'-'},
   {k:'amt',l:t('common.value'),num:true,text:r=>rp(r.amount),sortv:r=>r.amount},{k:'files',l:t('common.file'),text:r=>(r.files||[]).length+' file'}]});
};
ACT['tax-new']=async()=>{
 const v=await UI.ask({title:t('tax.record_doc'),ok:t('common.save'),fields:[F.s('type',t('tax.doc_type'),['Faktur Pajak','Bukti Potong PPh 21','Bukti Potong PPh 23'],{req:true}),F.t('docNo',t('tax.doc_no_field'),{req:true}),
  F.d('date',t('common.date'),{req:true,def:today()}),F.m('amount',t('tax.value_rp'),{req:true}),F.ta('notes',t('common.notes')),F.fl('files',t('tax.upload_doc'),{req:true})]});
 if(!v)return;
 DB.insert('tax_docs',{...v,no:v.docNo});UI.toast(t('tax.doc_saved'));Router.render();
};

/* ================= BANK RECONCILIATION ================= */
PAGES.recon.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   const banks=DB.all('banks');
   v.innerHTML=UI.pghead(t('recon.new'),`<a class="btn btn-o" href="#/recon">‹ ${t('common.cancel')}</a>`)+
    `<div class="card"><div class="fg"><div class="fld"><label>${t('common.account')}</label><select id="rcbank">${banks.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
     <div class="fld"><label>${t('recon.period')}</label><input type="month" id="rcperiod" value="${today().slice(0,7)}"></div></div>
     <label style="margin-top:10px">${t('recon.stmt_hint')}</label>
     <textarea id="rcstmt" rows="8" placeholder="2026-09-05 | Transfer masuk INV/2026/09/0001 | 500000000
2026-09-07 | Biaya admin | -50000"></textarea>
     <div class="acts" style="margin-top:10px"><button class="btn" data-act="recon-start">${t('recon.start_match')}</button></div></div>`;
   return;
  }
  v.innerHTML=UI.pghead(t('nav.recon'),can('recon','w')?`<a class="btn" href="#/recon/new">+ ${t('recon.new')}</a>`:'')+'<div class="card" id="rcl"></div>';
  new DT($('#rcl'),{title:t('nav.recon'),rows:()=>DB.all('recons').slice().reverse(),onRow:id=>Router.go('recon/'+id),
   cols:[{k:'no',l:t('common.no_dot')},{k:'b',l:t('common.account'),text:r=>bankName(r.bankId)},{k:'p',l:t('recon.period'),text:r=>r.period},{k:'match',l:t('recon.matched'),num:true,text:r=>r.lines.filter(l=>l.matchedId).length+'/'+r.lines.length},{k:'st',l:t('common.status'),text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const rc=DB.get('recons',param);if(!rc)return v.innerHTML=UI.empty(t('recon.not_found'));
 const sysTx=DB.all('bank_tx').filter(t=>t.bankId===rc.bankId&&t.date.startsWith(rc.period));
 const matchedSys=new Set(rc.lines.filter(l=>l.matchedId).map(l=>l.matchedId));
 v.innerHTML=UI.pghead(t('nav.recon')+' '+rc.no,`<a class="btn btn-o" href="#/recon">‹ ${t('common.back')}</a>`)+`<div class="card"><div class="ch"><span>${esc(bankName(rc.bankId))} — ${esc(rc.period)}</span>${UI.badge(rc.status)}</div>
  <div class="grid g2"><div><h3 class="mut">${t('recon.statement')}</h3><div class="tblw"><table><tr><th>${t('common.date')}</th><th>${t('common.description')}</th><th class="num">${t('common.amount')}</th><th>${t('common.status')}</th></tr>${rc.lines.map((l,idx)=>`<tr><td>${fdate(l.date)}</td><td>${esc(l.desc)}</td><td class="num">${rp(l.amount)}</td><td>${l.matchedId?UI.badge(t('recon.match')):(rc.status==='Draft'?`<select data-rcmatch="${idx}"><option value="">— ${t('recon.select_system_tx')} —</option>${sysTx.filter(t=>!matchedSys.has(t.id)||t.id===l.matchedId).map(t=>`<option value="${t.id}" ${Math.abs((t.type==='Masuk'?t.amount:-t.amount)-l.amount)<1?'selected':''}>${fdate(t.date)} ${esc(t.desc)} (${t.type==='Masuk'?'':'-'}${rp(t.amount)})</option>`).join('')}</select>`:UI.badge(t('recon.unmatched')))}</td></tr>`).join('')}</table></div></div>
  <div><h3 class="mut">${t('recon.system_unmatched')}</h3><div class="tblw"><table><tr><th>${t('common.date')}</th><th>${t('common.description')}</th><th class="num">${t('common.amount')}</th></tr>${sysTx.filter(t=>!matchedSys.has(t.id)).map(t=>`<tr><td>${fdate(t.date)}</td><td>${esc(t.desc)}</td><td class="num">${t.type==='Masuk'?'':'-'}${rp(t.amount)}</td></tr>`).join('')||`<tr><td colspan=3 class="empty">${t('recon.all_matched')}</td></tr>`}</table></div></div></div>
  ${rc.status==='Draft'&&can('recon','w')?`<div class="acts" style="margin-top:12px"><button class="btn btn-o" data-act="recon-apply" data-id="${rc.id}">${t('recon.save_matching')}</button><button class="btn" data-act="recon-finish" data-id="${rc.id}">${t('recon.finish')}</button></div>`:''}</div>`;
};
ACT['recon-start']=()=>{
 const bankId=$('#rcbank').value,period=$('#rcperiod').value,raw=$('#rcstmt').value.trim();
 if(!raw)return UI.toast(t('recon.err_min_line'),'err');
 const lines=raw.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const [d,desc,amt]=l.split('|').map(x=>x.trim());return {date:/^\d{4}-\d\d-\d\d$/.test(d)?d:period+'-01',desc:desc||'',amount:parseFloat(amt)||0,matchedId:''}});
 const sysTx=DB.all('bank_tx').filter(t=>t.bankId===bankId&&t.date.startsWith(period));
 lines.forEach(l=>{const m=sysTx.find(t=>!lines.some(x=>x.matchedId===t.id)&&Math.abs((t.type==='Masuk'?t.amount:-t.amount)-l.amount)<1);if(m)l.matchedId=m.id});
 const rc=DB.insert('recons',{no:Num.next('REC'),bankId,period,lines,status:'Draft'});
 UI.toast(t('recon.auto_matched'));Router.go('recon/'+rc.id);
};
ACT['recon-apply']=el=>{
 const rc=DB.get('recons',el.dataset.id);
 $$('[data-rcmatch]').forEach(s=>{rc.lines[+s.dataset.rcmatch].matchedId=s.value});
 DB.save('recons');UI.toast(t('recon.matching_saved'));Router.render();
};
ACT['recon-finish']=async el=>{
 const rc=DB.get('recons',el.dataset.id);
 $$('[data-rcmatch]').forEach(s=>{rc.lines[+s.dataset.rcmatch].matchedId=s.value});
 const unmatched=rc.lines.filter(l=>!l.matchedId).length;
 if(unmatched&&!(await UI.confirm({title:t('recon.finish'),msg:t('recon.finish_confirm_msg',{n:unmatched}),danger:true})))return;
 rc.lines.filter(l=>l.matchedId).forEach(l=>{const t=DB.get('bank_tx',l.matchedId);if(t)t.reconciled=true});
 DB.save('bank_tx');DB.update('recons',rc.id,{status:'Selesai'},t('recon.reason_reconciled'),t('opname.done_action'));
 UI.toast(t('recon.finished'));Router.render();
};

/* ================= Hook: pembayaran invoice customer -> bank ledger ================= */
const _oldInvPay=ACT['inv-pay'];
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
 if(v.bankId)BankTx.add({bankId:v.bankId,date:v.date,type:'Masuk',amount:v.amount,desc:t('bank.desc_payment',{no:i.no}),ref:v.ref,source:'Customer Invoice'});
 const upd=DB.get('invoices',i.id);
 UI.toast(t('inv.payment_recorded',{status:Inv.status(upd)}));
 if(i.orderId){const o=DB.get('orders',i.orderId);if(o){Notify.user(o.salesId,t('inv.notify_payment_received',{amt:rp(v.amount),no:i.no,status:Inv.status(upd)}),'#/orders/'+o.id);Order.touch(o.id)}}
 Router.render();
};
