'use strict';
/* =========================================================
   KENTFORD ERP - Tahap 5a: Rental Genset
   ========================================================= */
/* RENT_STAGES tetap kode internal (disimpan di DB, dipakai utk perbandingan c.status==='Aktif'
   dst) - label yang ditampilkan selalu dihitung live lewat rentStageLabel() (pakai key
   'rentstage.N' yang sudah ada), mengikuti pola Order.statusLabel()/svcStatusLabel(). */
const RENT_STAGES=['Draft','Aktif','Proses Pengembalian','Selesai','Dibatalkan'];
const rentStageLabel=s=>{const i=RENT_STAGES.indexOf(s);return i>=0?t('rentstage.'+i):s};
const RENT_DEPOSIT_STATUSES=['Belum Diterima','Ditahan','Dikembalikan'];
const RENT_DEPOSIT_STATUS_KEYS=['rent.deposit_status.not_received','rent.deposit_status.held','rent.deposit_status.returned'];
const rentDepositStatusLabel=s=>{const i=RENT_DEPOSIT_STATUSES.indexOf(s||'Belum Diterima');return i>=0?t(RENT_DEPOSIT_STATUS_KEYS[i]):(s||t('rent.deposit_status.not_received'))};

/* ================= UNIT RENTAL (registry serial number) ================= */
ENT.rent_units={col:'rent_units',page:'rent_units',title:'Unit Rental',label:r=>`${DB.get('products',r.productId)?.name||'-'} — ${r.serial}`,wr:['deputy_director','director','warehouse'],
 fields:[F.r('productId','Produk (genset)','products',{req:true,list:true,filter:p=>p.kind==='Genset'||p.kind==='Aset rental'}),F.t('serial','Nomor seri',{req:true,list:true}),
  F.s('status','Status',['Tersedia','Disewa','Maintenance','Rusak'],{req:true,def:'Tersedia',list:true,badge:true}),F.r('whId','Lokasi saat ini','warehouses',{list:true,def:'w_ckr'}),F.n('hourMeter','Hour meter saat ini',{def:0,list:true}),F.ta('notes','Catatan kondisi')]};
wireEntTitle('rent_units');
crudPage('rent_units');

/* ================= KONTRAK RENTAL ================= */
const Rent={
 monthsElapsed(c,uptoDate){const end=uptoDate||(c.status==='Selesai'?c.closedAt?.slice(0,10):today());return Math.max(0,daysBetween(c.startDate,end)/30)},
 usedHours(c){const logs=c.hourMeterLogs||[];return logs.length?logs[logs.length-1].reading-num(c.hourMeterStart):0},
 overtime(c){
  const months=this.monthsElapsed(c),allowed=months*num(c.hoursPerMonth),used=this.usedHours(c),hrs=Math.max(0,used-allowed);
  return {months,allowed,used,hrs,cost:hrs*num(c.overtimeRate)};
 },
 depositAmount(c){return num(c.monthlyRate)*num(c.depositMonths)},
 fields:()=>[F.r('customerId',t('common.customer'),'customers',{req:true}),F.r('unitId',t('rent.field.unit'),'rent_units',{req:true,filter:u=>u.status==='Tersedia'}),
  F.d('startDate',t('rent.field.start_date'),{req:true,def:()=>today()}),F.n('termMonths',t('rent.field.term_months'),{req:true,def:()=>S().rental?.minMonths||3}),
  F.m('monthlyRate',t('rent.field.monthly_rate'),{req:true}),F.n('depositMonths',t('rent.field.deposit_months'),{def:()=>S().rental?.depositMonths||2}),
  F.n('prepayMonths',t('rent.field.prepay_months'),{def:()=>S().rental?.prepayMonths||1}),F.n('hoursPerMonth',t('rent.field.hours_limit'),{def:()=>S().rental?.hoursPerMonth||280}),
  F.m('overtimeRate',t('rent.field.overtime_rate'),{req:true}),F.t('operator',t('rent.field.operator'),{ph:'Nama operator atau "Tanpa operator"'}),F.m('mobilizationFee',t('rent.field.mobilization_fee'),{def:0}),
  F.ta('location',t('common.location'),{req:true}),F.ta('notes',t('common.notes'))]
};
PAGES.rent_contracts.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   if(!can('rent_contracts','w'))return v.innerHTML=UI.empty(t('rent.msg.no_right_create_contract'));
   const fields=Rent.fields();
   v.innerHTML=UI.pghead(t('rent.modal.new_contract'),`<a class="btn btn-o" href="#/rent_contracts">${esc(t('ord.btn.cancel_form'))}</a>`)+`<div class="card"><div id="rcform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="rent-new">${esc(t('common.save'))}</button></div></div>`;
   Form.hydrate($('#rcform'),fields,{});Rent._ctx={fields};return;
  }
  v.innerHTML=UI.pghead(t('nav.rent_contracts'),can('rent_contracts','w')?`<a class="btn" href="#/rent_contracts/new">${esc(t('rent.btn.new_contract'))}</a>`:'')+'<div class="card" id="rcl"></div>';
  new DT($('#rcl'),{title:t('nav.rent_contracts'),rows:()=>DB.all('rent_contracts').slice().reverse(),onRow:id=>Router.go('rent_contracts/'+id),
   filters:[{k:'s',l:t('common.status'),opts:()=>RENT_STAGES.map(rentStageLabel),get:r=>rentStageLabel(r.status)}],
   cols:[{k:'no',l:t('common.no_dot')},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'u',l:t('rent.field.unit'),text:r=>{const u=DB.get('rent_units',r.unitId);return u?`${DB.get('products',u.productId)?.name} (${u.serial})`:'-'}},
    {k:'start',l:t('rent.col.start'),text:r=>fdate(r.startDate),sortv:r=>r.startDate},{k:'end',l:t('rent.col.end_planned'),text:r=>fdate(r.endDate)},{k:'rate',l:t('rent.col.rate'),num:true,text:r=>rp(r.monthlyRate)},
    {k:'ot',l:t('nav.overtime'),num:true,text:r=>Rent.overtime(r).hrs?rp(Rent.overtime(r).cost):'-'},{k:'st',l:t('common.status'),text:r=>rentStageLabel(r.status),html:r=>UI.badge(rentStageLabel(r.status))}]});
  return;
 }
 const c=DB.get('rent_contracts',param);if(!c)return v.innerHTML=UI.empty(t('rent.msg.contract_not_found'));
 const unit=DB.get('rent_units',c.unitId),ot=Rent.overtime(c),invs=DB.all('invoices').filter(i=>i.rentContractId===c.id&&!i.cancelled);
 const acts=[`<a class="btn btn-o" href="#/rent_contracts">‹ ${esc(t('common.back'))}</a>`];
 if(c.status==='Draft'&&can('rent_contracts','w')&&c.depositStatus==='Ditahan')acts.push(`<button class="btn" data-act="rent-activate" data-id="${c.id}">${esc(t('rent.btn.activate'))}</button>`);
 if(c.status==='Draft'&&c.depositStatus!=='Ditahan'&&(can('rent_contracts','w')||isRole('finance')))acts.push(`<button class="btn btn-o" data-act="rent-deposit" data-id="${c.id}">${esc(t('rent.btn.record_deposit'))}</button>`);
 if(c.status==='Aktif'){
  if(can('hourmeter','w'))acts.push(`<button class="btn btn-o" data-act="rent-hm" data-id="${c.id}">${esc(t('rent.btn.record_hm'))}</button>`);
  if(can('invoices','w'))acts.push(`<button class="btn btn-o" data-act="rent-invoice" data-id="${c.id}" data-type="Sewa">${esc(t('rent.btn.make_rent_invoice'))}</button>`);
  if(ot.hrs>0&&can('invoices','w'))acts.push(`<button class="btn btn-o" data-act="rent-invoice" data-id="${c.id}" data-type="Overtime">${esc(t('rent.btn.make_ot_invoice'))}</button>`);
  if(can('rent_return','w'))acts.push(`<a class="btn" href="#/rent_return/new/${c.id}">${esc(t('rent.btn.process_return'))}</a>`);
 }
 if(c.status==='Proses Pengembalian'&&c.depositStatus==='Ditahan'&&can('deposit','w')&&!Approval.forRef('rent_contracts',c.id).some(a=>a.type==='deposit_return'&&a.status==='Menunggu'))
  acts.push(`<button class="btn btn-d" data-act="rent-deposit-return" data-id="${c.id}">${esc(t('rent.btn.request_deposit_return'))}</button>`);
 v.innerHTML=UI.pghead(t('rent.col.contract')+' '+c.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>${esc(t('rent.h.contract_info'))}</span>${UI.badge(rentStageLabel(c.status))}</div>${UI.kv([[t('common.customer'),esc(custName(c.customerId))],[t('rent.field.unit'),unit?`${esc(DB.get('products',unit.productId)?.name)} (${esc(unit.serial)})`:'-'],
   [t('rent.kv.period'),fdate(c.startDate)+' — '+fdate(c.endDate)+' '+t('rent.period_months',{n:c.termMonths})],[t('common.location'),esc(c.location)],[t('rent.field.monthly_rate'),rp(c.monthlyRate)],[t('rent.field.operator'),esc(c.operator||'-')],[t('rent.field.mobilization_fee'),rp(c.mobilizationFee)],
   [t('rent.field.hours_limit'),`${nf(c.hoursPerMonth)} ${t('rent.hours_per_month_suffix')}`],[t('rent.field.overtime_rate'),rp(c.overtimeRate)+t('rent.per_hour')]])}</div>
  <div class="card"><h3>${esc(t('rent.h.hm_overtime'))}</h3>${UI.kv([[t('rent.kv.hm_start'),nf(c.hourMeterStart||0)],[t('rent.kv.hm_last'),nf(c.hourMeterStart+ot.used)],[t('rent.kv.duration'),t('rent.months_x',{n:nf(ot.months)})],[t('rent.kv.hours_allowed'),nf(ot.allowed)],[t('rent.kv.actual_usage'),nf(ot.used)],[t('nav.overtime'),`<b>${nf(ot.hrs)} ${t('rent.hours_per_month_suffix').split('/')[0]}</b> = ${rp(ot.cost)}`]])}
   <div class="tblw" style="margin-top:8px"><table><tr><th>${t('common.date')}</th><th class="num">${t('rent.col.reading')}</th><th>${t('admin.by_col')}</th></tr>${(c.hourMeterLogs||[]).slice().reverse().map(l=>`<tr><td>${fdate(l.date)}</td><td class="num">${nf(l.reading)}</td><td>${esc(l.by)}</td></tr>`).join('')||`<tr><td colspan=3 class="empty">${t('rent.msg.no_hm_log')}</td></tr>`}</table></div></div>
  <div class="card"><h3>${esc(t('rent.h.invoice'))}</h3>${invs.length?invs.map(i=>`<div>${docLink('invoices',i)} — ${esc(stLabel(i.type))} — ${rp(i.total)} ${UI.badge(stLabel(Inv.status(i)))}</div>`).join(''):`<div class="empty">${t('rent.msg.no_invoice_yet')}</div>`}</div></div>
  <div><div class="card"><h3>${esc(t('nav.deposit'))}</h3>${UI.kv([[t('rent.col.deposit_value'),rp(Rent.depositAmount(c))],[t('common.status'),UI.badge(rentDepositStatusLabel(c.depositStatus))],[t('rent.kv.received'),c.depositReceivedAt?fdt(c.depositReceivedAt):'-'],[t('rent.deposit_status.returned'),c.depositReturnedAt?fdt(c.depositReturnedAt):'-']])}</div>
  <div class="card"><h3>${esc(t('svc.h.activity'))}</h3>${UI.activity('rent_contracts',c.id)}</div></div></div>`;
};
ACT['rent-new']=()=>{
 const {fields}=Rent._ctx,{v,err}=Form.collect($('#rcform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 if(num(v.termMonths)<num(S().rental?.minMonths||3))return UI.toast(t('rent.msg.min_months',{n:S().rental?.minMonths||3}),'err');
 const c=DB.insert('rent_contracts',{...v,no:Num.next('RC'),endDate:addDays(v.startDate,num(v.termMonths)*30),hourMeterStart:0,hourMeterLogs:[],status:'Draft',depositStatus:'Belum Diterima'});
 UI.toast(t('rent.msg.contract_created'));Router.go('rent_contracts/'+c.id);
};
ACT['rent-deposit']=async el=>{
 const c=DB.get('rent_contracts',el.dataset.id),amt=Rent.depositAmount(c);
 const v=await UI.ask({title:t('rent.btn.record_deposit'),ok:t('common.save'),fields:[F.r('bankId',t('rent.field.receiving_bank'),'banks',{req:true}),F.d('date',t('rent.field.deposit_received_date'),{req:true,def:today()}),F.t('ref',t('rent.field.ref_no'))],
  pre:`<div class="info">${t('rent.col.deposit_value')}: <b>${rp(amt)}</b> (${t('rent.months_x',{n:c.depositMonths})} × ${rp(c.monthlyRate)})</div>`});
 if(!v)return;
 BankTx.add({bankId:v.bankId,date:v.date,type:'Masuk',amount:amt,desc:'Deposit rental '+c.no,ref:v.ref,source:'Deposit Rental'});
 DB.update('rent_contracts',c.id,{depositStatus:'Ditahan',depositReceivedAt:nowISO()},'',t('rent.msg.deposit_recorded'));
 UI.toast(t('rent.msg.deposit_recorded'));Router.render();
};
ACT['rent-activate']=el=>{
 const c=DB.get('rent_contracts',el.dataset.id);
 DB.update('rent_contracts',c.id,{status:'Aktif'},'',rentStageLabel('Aktif'));
 DB.update('rent_units',c.unitId,{status:'Disewa'},'Kontrak '+c.no,'Disewa');
 UI.toast(t('rent.msg.contract_active'));Router.render();
};
ACT['rent-hm']=async el=>{
 const c=DB.get('rent_contracts',el.dataset.id),last=(c.hourMeterLogs||[]).slice(-1)[0];
 const v=await UI.ask({title:t('rent.btn.record_hm'),ok:t('common.save'),fields:[F.d('date',t('common.date'),{req:true,def:today()}),F.n('reading',t('rent.col.reading'),{req:true,def:c.hourMeterStart+(last?last.reading-c.hourMeterStart:0)})]});
 if(!v)return;
 const min=last?last.reading:c.hourMeterStart;
 if(num(v.reading)<min)return UI.toast(t('rent.msg.reading_too_low',{n:nf(min)}),'err');
 const logs=[...(c.hourMeterLogs||[]),{date:v.date,reading:num(v.reading),by:Auth.user.name}];
 DB.update('rent_contracts',c.id,{hourMeterLogs:logs},'','Hour meter: '+nf(v.reading));
 DB.update('rent_units',c.unitId,{hourMeter:num(v.reading)},'','Update hour meter');
 UI.toast(t('rent.msg.hm_recorded'));Router.render();
};
ACT['rent-invoice']=async el=>{
 const c=DB.get('rent_contracts',el.dataset.id),type=el.dataset.type,ot=Rent.overtime(c);
 const amount=type==='Sewa'?num(c.monthlyRate):ot.cost;
 if(type==='Overtime'&&amount<=0)return UI.toast(t('rent.msg.no_overtime_to_bill'),'err');
 const dpp=amount/(1+(S().defaultTaxPct??11)/100),tax=amount-dpp,taxPct=S().defaultTaxPct??11;
 const inv=DB.insert('invoices',{no:Num.next('INV'),soId:'',orderId:'',rentContractId:c.id,customerId:c.customerId,salesId:c.salesId||Auth.uid(),type,date:today(),dueDate:addDays(today(),14),dpp,taxPct,tax,total:amount,payments:[],cancelled:false,desc:`${type} — ${c.no}`});
 UI.toast(t('rent.msg.invoice_created',{no:inv.no}));Router.go('invoices/'+inv.id);
};
ACT['rent-deposit-return']=async el=>{
 const c=DB.get('rent_contracts',el.dataset.id);
 const v=await UI.ask({title:t('rent.btn.request_deposit_return'),ok:t('rent.btn.request_deposit_return'),fields:[F.ta('reason',t('ord.reason_label'),{req:true,def:c.returnCondition||''})]});
 if(!v)return;
 Approval.request({type:'deposit_return',refCol:'rent_contracts',refId:c.id,title:`Pengembalian deposit — ${c.no} (${custName(c.customerId)})`,amount:Rent.depositAmount(c),reason:v.reason});
 UI.toast(t('rent.msg.deposit_return_submitted'));Router.render();
};
Approval.hooks.deposit_return={
 approved(a){
  const c=DB.get('rent_contracts',a.refId);if(!c)return;
  DB.update('rent_contracts',c.id,{status:'Selesai',depositStatus:'Dikembalikan',depositReturnedAt:nowISO(),closedAt:nowISO()},'Approval disetujui','Deposit dikembalikan');
  DB.update('rent_units',c.unitId,{status:'Tersedia'},'Kontrak '+c.no+' selesai','Tersedia kembali');
 },
 rejected(a){const s=a.steps.find(x=>x.status==='Ditolak');DB.update('rent_contracts',a.refId,{},'','Pengembalian deposit ditolak: '+(s?.note||''))}
};

/* ================= JADWAL RENTAL ================= */
PAGES.rent_schedule.render=async v=>{
 const active=DB.all('rent_contracts').filter(c=>['Aktif','Proses Pengembalian'].includes(c.status)).sort((a,b)=>a.endDate.localeCompare(b.endDate));
 v.innerHTML=UI.pghead(t('nav.rent_schedule'))+`<div class="card"><h3>${esc(t('rent.h.active_ending_soon'))}</h3>`+
  (active.length?`<div class="tblw"><table><tr><th>${t('common.no_dot')}</th><th>${t('common.customer')}</th><th>${t('rent.field.unit')}</th><th>${t('rent.col.start')}</th><th>${t('rent.col.end_planned')}</th><th>${t('rent.col.remaining_days')}</th></tr>${active.map(c=>`<tr class="clk" data-act="go" data-h="rent_contracts/${c.id}"><td>${esc(c.no)}</td><td>${esc(custName(c.customerId))}</td><td>${esc(DB.get('products',DB.get('rent_units',c.unitId)?.productId)?.name||'-')}</td><td>${fdate(c.startDate)}</td><td>${fdate(c.endDate)}</td><td>${UI.badge(daysBetween(today(),c.endDate)<=7?t('rent.badge.ending_soon'):t('rent.badge.ongoing'))} ${t('rent.days_count',{n:daysBetween(today(),c.endDate)})}</td></tr>`).join('')}</table></div>`:UI.empty(t('rent.msg.no_active_contracts')))+'</div>';
};

/* ================= HOUR METER (rekap semua kontrak) ================= */
PAGES.hourmeter.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.hourmeter'))+'<div class="card" id="hml"></div>';
 new DT($('#hml'),{title:t('nav.hourmeter'),rows:()=>DB.all('rent_contracts').filter(c=>['Aktif','Proses Pengembalian','Selesai'].includes(c.status)),onRow:id=>Router.go('rent_contracts/'+id),
  cols:[{k:'no',l:t('rent.col.contract')},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'start',l:t('rent.col.hm_start'),num:true,text:r=>nf(r.hourMeterStart)},{k:'cur',l:t('rent.col.hm_last'),num:true,text:r=>nf(r.hourMeterStart+Rent.overtime(r).used)},
   {k:'used',l:t('rent.col.usage'),num:true,text:r=>nf(Rent.overtime(r).used)},{k:'allow',l:t('rent.col.allowed'),num:true,text:r=>nf(Rent.overtime(r).allowed)},{k:'ot',l:t('rent.col.ot_hours'),num:true,text:r=>nf(Rent.overtime(r).hrs)}]});
};

/* ================= OVERTIME (rekap tagihan) ================= */
PAGES.overtime.render=async v=>{
 const rows=DB.all('rent_contracts').filter(c=>['Aktif','Proses Pengembalian','Selesai'].includes(c.status)).map(c=>({c,ot:Rent.overtime(c)})).filter(x=>x.ot.hrs>0);
 v.innerHTML=UI.pghead(t('nav.overtime'))+'<div class="card">'+(rows.length?`<div class="tblw"><table><tr><th>${t('rent.col.contract')}</th><th>${t('common.customer')}</th><th class="num">${t('rent.col.ot_hours')}</th><th class="num">${t('rent.field.overtime_rate')}</th><th class="num">${t('rent.col.total_bill')}</th><th></th></tr>${rows.map(({c,ot})=>`<tr><td>${docLink('rent_contracts',c)}</td><td>${esc(custName(c.customerId))}</td><td class="num">${nf(ot.hrs)}</td><td class="num">${rp(c.overtimeRate)}</td><td class="num">${rp(ot.cost)}</td><td>${can('invoices','w')&&c.status==='Aktif'?`<button class="btn btn-sm" data-act="rent-invoice" data-id="${c.id}" data-type="Overtime">${esc(t('rent.btn.make_invoice'))}</button>`:''}</td></tr>`).join('')}</table></div>`:UI.empty(t('rent.msg.no_overtime_contracts')))+'</div>';
};

/* ================= DEPOSIT (rekap) ================= */
PAGES.deposit.render=async v=>{
 v.innerHTML=UI.pghead(t('nav.deposit'))+'<div class="card" id="dpl"></div>';
 new DT($('#dpl'),{title:t('nav.deposit'),rows:()=>DB.all('rent_contracts').filter(c=>c.status!=='Dibatalkan'),onRow:id=>Router.go('rent_contracts/'+id),
  filters:[{k:'s',l:t('rent.col.deposit_status_filter'),opts:()=>RENT_DEPOSIT_STATUSES.map(rentDepositStatusLabel),get:r=>rentDepositStatusLabel(r.depositStatus)}],
  cols:[{k:'no',l:t('rent.col.contract')},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'amt',l:t('rent.col.deposit_value'),num:true,text:r=>rp(Rent.depositAmount(r)),sortv:r=>Rent.depositAmount(r)},{k:'st',l:t('common.status'),text:r=>rentDepositStatusLabel(r.depositStatus),html:r=>UI.badge(rentDepositStatusLabel(r.depositStatus))}]});
};

/* ================= PENGEMBALIAN UNIT ================= */
PAGES.rent_return.render=async(v,param)=>{
 if(param&&param.startsWith('new/')){
  const c=DB.get('rent_contracts',param.slice(4));if(!c)return v.innerHTML=UI.empty(t('rent.msg.contract_not_found'));
  if(!can('rent_return','w'))return v.innerHTML=UI.empty(t('rent.msg.no_right_return'));
  const fields=[F.d('date',t('rent.field.return_date'),{req:true,def:today()}),F.n('finalReading',t('rent.field.final_reading'),{req:true,def:c.hourMeterStart+Rent.overtime(c).used}),
   F.s('condition',t('rent.field.condition'),['Baik','Perlu perbaikan ringan','Rusak'],{req:true}),F.ta('conditionNotes',t('rent.field.condition_notes'),{req:true}),F.fl('files',t('rent.field.return_photos'),{req:true})];
  RentReturn._ctx={c,fields};
  v.innerHTML=UI.pghead(t('nav.rent_return')+' — '+c.no,`<a class="btn btn-o" href="#/rent_contracts/${c.id}">${esc(t('ord.btn.cancel_form'))}</a>`)+`<div class="card"><div id="rrform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="rent-return-save">${esc(t('rent.btn.save_return'))}</button></div></div>`;
  Form.hydrate($('#rrform'),fields,{});return;
 }
 v.innerHTML=UI.pghead(t('nav.rent_return'))+'<div class="card" id="rrl"></div>';
 new DT($('#rrl'),{title:t('nav.rent_return'),rows:()=>DB.all('rent_contracts').filter(c=>c.returnedInfo),onRow:id=>Router.go('rent_contracts/'+id),
  cols:[{k:'no',l:t('rent.col.contract')},{k:'c',l:t('common.customer'),text:r=>custName(r.customerId)},{k:'date',l:t('rent.field.return_date'),text:r=>fdate(r.returnedInfo?.date)},{k:'cond',l:t('rent.field.condition'),text:r=>r.returnedInfo?.condition},{k:'st',l:t('rent.col.contract_status'),text:r=>rentStageLabel(r.status),html:r=>UI.badge(rentStageLabel(r.status))}]});
};
const RentReturn={_ctx:null};
ACT['rent-return-save']=async()=>{
 const {c,fields}=RentReturn._ctx,{v,err}=Form.collect($('#rrform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 const min=(c.hourMeterLogs||[]).slice(-1)[0]?.reading??c.hourMeterStart;
 if(num(v.finalReading)<min)return UI.toast(t('rent.msg.final_reading_too_low',{n:nf(min)}),'err');
 const logs=[...(c.hourMeterLogs||[]),{date:v.date,reading:num(v.finalReading),by:Auth.user.name}];
 DB.update('rent_contracts',c.id,{status:'Proses Pengembalian',hourMeterLogs:logs,returnedInfo:v,returnCondition:v.conditionNotes},'',rentStageLabel('Proses Pengembalian'));
 if(v.condition==='Rusak')DB.update('rent_units',c.unitId,{status:'Rusak'},'Kondisi saat kembali: rusak','Rusak');
 else if(v.condition==='Perlu perbaikan ringan')DB.update('rent_units',c.unitId,{status:'Maintenance'},'Kondisi saat kembali: perlu perbaikan','Maintenance');
 UI.toast(t('rent.msg.return_recorded'));Router.go('rent_contracts/'+c.id);
};
