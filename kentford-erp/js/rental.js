'use strict';
/* =========================================================
   KENTFORD ERP - Tahap 5a: Rental Genset
   ========================================================= */
const RENT_STAGES=['Draft','Aktif','Proses Pengembalian','Selesai','Dibatalkan'];

/* ================= UNIT RENTAL (registry serial number) ================= */
ENT.rent_units={col:'rent_units',page:'rent_units',title:'Unit Rental',label:r=>`${DB.get('products',r.productId)?.name||'-'} — ${r.serial}`,wr:['manager','president_director','warehouse'],
 fields:[F.r('productId','Produk (genset)','products',{req:true,list:true,filter:p=>p.kind==='Genset'||p.kind==='Aset rental'}),F.t('serial','Nomor seri',{req:true,list:true}),
  F.s('status','Status',['Tersedia','Disewa','Maintenance','Rusak'],{req:true,def:'Tersedia',list:true,badge:true}),F.r('whId','Lokasi saat ini','warehouses',{list:true,def:'w_ckr'}),F.n('hourMeter','Hour meter saat ini',{def:0,list:true}),F.ta('notes','Catatan kondisi')]};
crudPage('rent_units','Unit Rental');

/* ================= KONTRAK RENTAL ================= */
const Rent={
 monthsElapsed(c,uptoDate){const end=uptoDate||(c.status==='Selesai'?c.closedAt?.slice(0,10):today());return Math.max(0,daysBetween(c.startDate,end)/30)},
 usedHours(c){const logs=c.hourMeterLogs||[];return logs.length?logs[logs.length-1].reading-num(c.hourMeterStart):0},
 overtime(c){
  const months=this.monthsElapsed(c),allowed=months*num(c.hoursPerMonth),used=this.usedHours(c),hrs=Math.max(0,used-allowed);
  return {months,allowed,used,hrs,cost:hrs*num(c.overtimeRate)};
 },
 depositAmount(c){return num(c.monthlyRate)*num(c.depositMonths)},
 fields:()=>[F.r('customerId','Customer','customers',{req:true}),F.r('unitId','Unit rental','rent_units',{req:true,filter:u=>u.status==='Tersedia'}),
  F.d('startDate','Tanggal mulai',{req:true,def:()=>today()}),F.n('termMonths','Jangka waktu (bulan)',{req:true,def:()=>S().rental?.minMonths||3}),
  F.m('monthlyRate','Harga sewa / bulan (Rp)',{req:true}),F.n('depositMonths','Deposit (bulan)',{def:()=>S().rental?.depositMonths||2}),
  F.n('prepayMonths','Pembayaran di muka (bulan)',{def:()=>S().rental?.prepayMonths||1}),F.n('hoursPerMonth','Batas pemakaian (jam/bulan)',{def:()=>S().rental?.hoursPerMonth||280}),
  F.m('overtimeRate','Tarif overtime (Rp/jam)',{req:true}),F.t('operator','Operator',{ph:'Nama operator atau "Tanpa operator"'}),F.m('mobilizationFee','Biaya mobilisasi (Rp)',{def:0}),
  F.ta('location','Lokasi rental',{req:true}),F.ta('notes','Catatan')]
};
PAGES.rent_contracts.render=async(v,param)=>{
 if(!param||param==='new'){
  if(param==='new'){
   if(!can('rent_contracts','w'))return v.innerHTML=UI.empty('Anda tidak berhak membuat kontrak rental.');
   const fields=Rent.fields();
   v.innerHTML=UI.pghead('Kontrak Rental baru',`<a class="btn btn-o" href="#/rent_contracts">‹ Batal</a>`)+`<div class="card"><div id="rcform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="rent-new">Simpan</button></div></div>`;
   Form.hydrate($('#rcform'),fields,{});Rent._ctx={fields};return;
  }
  v.innerHTML=UI.pghead('Kontrak Rental',can('rent_contracts','w')?'<a class="btn" href="#/rent_contracts/new">+ Kontrak baru</a>':'')+'<div class="card" id="rcl"></div>';
  new DT($('#rcl'),{title:'Kontrak Rental',rows:()=>DB.all('rent_contracts').slice().reverse(),onRow:id=>Router.go('rent_contracts/'+id),
   filters:[{k:'s',l:'Status',opts:()=>RENT_STAGES,get:r=>r.status}],
   cols:[{k:'no',l:'No.'},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'u',l:'Unit',text:r=>{const u=DB.get('rent_units',r.unitId);return u?`${DB.get('products',u.productId)?.name} (${u.serial})`:'-'}},
    {k:'start',l:'Mulai',text:r=>fdate(r.startDate),sortv:r=>r.startDate},{k:'end',l:'Selesai (rencana)',text:r=>fdate(r.endDate)},{k:'rate',l:'Sewa/bulan',num:true,text:r=>rp(r.monthlyRate)},
    {k:'ot',l:'Overtime',num:true,text:r=>Rent.overtime(r).hrs?rp(Rent.overtime(r).cost):'-'},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)}]});
  return;
 }
 const c=DB.get('rent_contracts',param);if(!c)return v.innerHTML=UI.empty('Kontrak tidak ditemukan.');
 const unit=DB.get('rent_units',c.unitId),ot=Rent.overtime(c),invs=DB.all('invoices').filter(i=>i.rentContractId===c.id&&!i.cancelled);
 const acts=[`<a class="btn btn-o" href="#/rent_contracts">‹ Kembali</a>`];
 if(c.status==='Draft'&&can('rent_contracts','w')&&c.depositStatus==='Ditahan')acts.push(`<button class="btn" data-act="rent-activate" data-id="${c.id}">Aktifkan kontrak</button>`);
 if(c.status==='Draft'&&c.depositStatus!=='Ditahan'&&(can('rent_contracts','w')||isRole('finance')))acts.push(`<button class="btn btn-o" data-act="rent-deposit" data-id="${c.id}">Catat penerimaan deposit</button>`);
 if(c.status==='Aktif'){
  if(can('hourmeter','w'))acts.push(`<button class="btn btn-o" data-act="rent-hm" data-id="${c.id}">Catat hour meter</button>`);
  if(can('invoices','w'))acts.push(`<button class="btn btn-o" data-act="rent-invoice" data-id="${c.id}" data-type="Sewa">Buat invoice sewa</button>`);
  if(ot.hrs>0&&can('invoices','w'))acts.push(`<button class="btn btn-o" data-act="rent-invoice" data-id="${c.id}" data-type="Overtime">Buat invoice overtime</button>`);
  if(can('rent_return','w'))acts.push(`<a class="btn" href="#/rent_return/new/${c.id}">Proses pengembalian unit</a>`);
 }
 if(c.status==='Proses Pengembalian'&&c.depositStatus==='Ditahan'&&can('deposit','w')&&!Approval.forRef('rent_contracts',c.id).some(a=>a.type==='deposit_return'&&a.status==='Menunggu'))
  acts.push(`<button class="btn btn-d" data-act="rent-deposit-return" data-id="${c.id}">Ajukan pengembalian deposit</button>`);
 v.innerHTML=UI.pghead('Kontrak '+c.no,acts.join(''))+`<div class="grid split"><div>
  <div class="card"><div class="ch"><span>Informasi kontrak</span>${UI.badge(c.status)}</div>${UI.kv([['Customer',esc(custName(c.customerId))],['Unit',unit?`${esc(DB.get('products',unit.productId)?.name)} (${esc(unit.serial)})`:'-'],
   ['Periode',fdate(c.startDate)+' — '+fdate(c.endDate)+` (${c.termMonths} bulan)`],['Lokasi',esc(c.location)],['Sewa / bulan',rp(c.monthlyRate)],['Operator',esc(c.operator||'-')],['Biaya mobilisasi',rp(c.mobilizationFee)],
   ['Batas pemakaian',`${nf(c.hoursPerMonth)} jam/bulan`],['Tarif overtime',rp(c.overtimeRate)+'/jam']])}</div>
  <div class="card"><h3>Hour Meter & Overtime</h3>${UI.kv([['Hour meter awal',nf(c.hourMeterStart||0)],['Hour meter terakhir',nf(c.hourMeterStart+ot.used)],['Lama berjalan',nf(ot.months)+' bulan'],['Jam diizinkan',nf(ot.allowed)],['Pemakaian aktual',nf(ot.used)],['Overtime',`<b>${nf(ot.hrs)} jam</b> = ${rp(ot.cost)}`]])}
   <div class="tblw" style="margin-top:8px"><table><tr><th>Tanggal</th><th class="num">Reading</th><th>Oleh</th></tr>${(c.hourMeterLogs||[]).slice().reverse().map(l=>`<tr><td>${fdate(l.date)}</td><td class="num">${nf(l.reading)}</td><td>${esc(l.by)}</td></tr>`).join('')||'<tr><td colspan=3 class="empty">Belum ada catatan.</td></tr>'}</table></div></div>
  <div class="card"><h3>Invoice</h3>${invs.length?invs.map(i=>`<div>${docLink('invoices',i)} — ${esc(i.type)} — ${rp(i.total)} ${UI.badge(Inv.status(i))}</div>`).join(''):'<div class="empty">Belum ada invoice.</div>'}</div></div>
  <div><div class="card"><h3>Deposit</h3>${UI.kv([['Nilai deposit',rp(Rent.depositAmount(c))],['Status',UI.badge(c.depositStatus||'Belum Diterima')],['Diterima',c.depositReceivedAt?fdt(c.depositReceivedAt):'-'],['Dikembalikan',c.depositReturnedAt?fdt(c.depositReturnedAt):'-']])}</div>
  <div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('rent_contracts',c.id)}</div></div></div>`;
};
ACT['rent-new']=()=>{
 const {fields}=Rent._ctx,{v,err}=Form.collect($('#rcform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 if(num(v.termMonths)<num(S().rental?.minMonths||3))return UI.toast(`Minimal rental ${S().rental?.minMonths||3} bulan.`,'err');
 const c=DB.insert('rent_contracts',{...v,no:Num.next('RC'),endDate:addDays(v.startDate,num(v.termMonths)*30),hourMeterStart:0,hourMeterLogs:[],status:'Draft',depositStatus:'Belum Diterima'});
 UI.toast('Kontrak rental dibuat (Draft).');Router.go('rent_contracts/'+c.id);
};
ACT['rent-deposit']=async el=>{
 const c=DB.get('rent_contracts',el.dataset.id),amt=Rent.depositAmount(c);
 const v=await UI.ask({title:'Catat penerimaan deposit',ok:'Simpan',fields:[F.r('bankId','Rekening penerima','banks',{req:true}),F.d('date','Tanggal diterima',{req:true,def:today()}),F.t('ref','No. referensi')],
  pre:`<div class="info">Nilai deposit: <b>${rp(amt)}</b> (${c.depositMonths} bulan × ${rp(c.monthlyRate)})</div>`});
 if(!v)return;
 BankTx.add({bankId:v.bankId,date:v.date,type:'Masuk',amount:amt,desc:'Deposit rental '+c.no,ref:v.ref,source:'Deposit Rental'});
 DB.update('rent_contracts',c.id,{depositStatus:'Ditahan',depositReceivedAt:nowISO()},'Deposit diterima','Deposit diterima');
 UI.toast('Deposit tercatat.');Router.render();
};
ACT['rent-activate']=el=>{
 const c=DB.get('rent_contracts',el.dataset.id);
 DB.update('rent_contracts',c.id,{status:'Aktif'},'Kontrak diaktifkan','Aktif');
 DB.update('rent_units',c.unitId,{status:'Disewa'},'Kontrak '+c.no,'Disewa');
 UI.toast('Kontrak aktif. Unit ditandai Disewa.');Router.render();
};
ACT['rent-hm']=async el=>{
 const c=DB.get('rent_contracts',el.dataset.id),last=(c.hourMeterLogs||[]).slice(-1)[0];
 const v=await UI.ask({title:'Catat hour meter',ok:'Simpan',fields:[F.d('date','Tanggal',{req:true,def:today()}),F.n('reading','Angka hour meter',{req:true,def:c.hourMeterStart+(last?last.reading-c.hourMeterStart:0)})]});
 if(!v)return;
 const min=last?last.reading:c.hourMeterStart;
 if(num(v.reading)<min)return UI.toast(`Reading tidak boleh lebih kecil dari catatan terakhir (${nf(min)}).`,'err');
 const logs=[...(c.hourMeterLogs||[]),{date:v.date,reading:num(v.reading),by:Auth.user.name}];
 DB.update('rent_contracts',c.id,{hourMeterLogs:logs},'Hour meter: '+nf(v.reading),'Catat hour meter');
 DB.update('rent_units',c.unitId,{hourMeter:num(v.reading)},'','Update hour meter');
 UI.toast('Hour meter tercatat.');Router.render();
};
ACT['rent-invoice']=async el=>{
 const c=DB.get('rent_contracts',el.dataset.id),type=el.dataset.type,ot=Rent.overtime(c);
 const amount=type==='Sewa'?num(c.monthlyRate):ot.cost;
 if(type==='Overtime'&&amount<=0)return UI.toast('Tidak ada overtime yang perlu ditagih.','err');
 const dpp=amount/(1+(S().defaultTaxPct??11)/100),tax=amount-dpp,taxPct=S().defaultTaxPct??11;
 const inv=DB.insert('invoices',{no:Num.next('INV'),soId:'',orderId:'',rentContractId:c.id,customerId:c.customerId,salesId:c.salesId||Auth.uid(),type,date:today(),dueDate:addDays(today(),14),dpp,taxPct,tax,total:amount,payments:[],cancelled:false,desc:`${type} — ${c.no}`});
 UI.toast('Invoice dibuat: '+inv.no);Router.go('invoices/'+inv.id);
};
ACT['rent-deposit-return']=async el=>{
 const c=DB.get('rent_contracts',el.dataset.id);
 const v=await UI.ask({title:'Ajukan pengembalian deposit',ok:'Ajukan',fields:[F.ta('reason','Catatan kondisi unit / alasan',{req:true,def:c.returnCondition||''})]});
 if(!v)return;
 Approval.request({type:'deposit_return',refCol:'rent_contracts',refId:c.id,title:`Pengembalian deposit — ${c.no} (${custName(c.customerId)})`,amount:Rent.depositAmount(c),reason:v.reason});
 UI.toast('Pengajuan pengembalian deposit dikirim (Finance → Manager).');Router.render();
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
 v.innerHTML=UI.pghead('Jadwal Rental')+'<div class="card"><h3>Kontrak aktif & mendekati akhir masa sewa</h3>'+
  (active.length?`<div class="tblw"><table><tr><th>No.</th><th>Customer</th><th>Unit</th><th>Mulai</th><th>Rencana selesai</th><th>Sisa hari</th></tr>${active.map(c=>`<tr class="clk" data-act="go" data-h="rent_contracts/${c.id}"><td>${esc(c.no)}</td><td>${esc(custName(c.customerId))}</td><td>${esc(DB.get('products',DB.get('rent_units',c.unitId)?.productId)?.name||'-')}</td><td>${fdate(c.startDate)}</td><td>${fdate(c.endDate)}</td><td>${UI.badge(daysBetween(today(),c.endDate)<=7?'Segera berakhir':'Berjalan')} ${daysBetween(today(),c.endDate)} hari</td></tr>`).join('')}</table></div>`:UI.empty('Tidak ada kontrak aktif.'))+'</div>';
};

/* ================= HOUR METER (rekap semua kontrak) ================= */
PAGES.hourmeter.render=async v=>{
 v.innerHTML=UI.pghead('Hour Meter')+'<div class="card" id="hml"></div>';
 new DT($('#hml'),{title:'Hour Meter',rows:()=>DB.all('rent_contracts').filter(c=>['Aktif','Proses Pengembalian','Selesai'].includes(c.status)),onRow:id=>Router.go('rent_contracts/'+id),
  cols:[{k:'no',l:'Kontrak'},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'start',l:'HM awal',num:true,text:r=>nf(r.hourMeterStart)},{k:'cur',l:'HM terakhir',num:true,text:r=>nf(r.hourMeterStart+Rent.overtime(r).used)},
   {k:'used',l:'Pemakaian',num:true,text:r=>nf(Rent.overtime(r).used)},{k:'allow',l:'Diizinkan',num:true,text:r=>nf(Rent.overtime(r).allowed)},{k:'ot',l:'Overtime (jam)',num:true,text:r=>nf(Rent.overtime(r).hrs)}]});
};

/* ================= OVERTIME (rekap tagihan) ================= */
PAGES.overtime.render=async v=>{
 const rows=DB.all('rent_contracts').filter(c=>['Aktif','Proses Pengembalian','Selesai'].includes(c.status)).map(c=>({c,ot:Rent.overtime(c)})).filter(x=>x.ot.hrs>0);
 v.innerHTML=UI.pghead('Overtime')+'<div class="card">'+(rows.length?`<div class="tblw"><table><tr><th>Kontrak</th><th>Customer</th><th class="num">Jam overtime</th><th class="num">Tarif</th><th class="num">Total tagihan</th><th></th></tr>${rows.map(({c,ot})=>`<tr><td>${docLink('rent_contracts',c)}</td><td>${esc(custName(c.customerId))}</td><td class="num">${nf(ot.hrs)}</td><td class="num">${rp(c.overtimeRate)}</td><td class="num">${rp(ot.cost)}</td><td>${can('invoices','w')&&c.status==='Aktif'?`<button class="btn btn-sm" data-act="rent-invoice" data-id="${c.id}" data-type="Overtime">Buat invoice</button>`:''}</td></tr>`).join('')}</table></div>`:UI.empty('Tidak ada kontrak dengan overtime saat ini.'))+'</div>';
};

/* ================= DEPOSIT (rekap) ================= */
PAGES.deposit.render=async v=>{
 v.innerHTML=UI.pghead('Deposit')+'<div class="card" id="dpl"></div>';
 new DT($('#dpl'),{title:'Deposit Rental',rows:()=>DB.all('rent_contracts').filter(c=>c.status!=='Dibatalkan'),onRow:id=>Router.go('rent_contracts/'+id),
  filters:[{k:'s',l:'Status deposit',opts:()=>['Belum Diterima','Ditahan','Dikembalikan'],get:r=>r.depositStatus||'Belum Diterima'}],
  cols:[{k:'no',l:'Kontrak'},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'amt',l:'Nilai deposit',num:true,text:r=>rp(Rent.depositAmount(r)),sortv:r=>Rent.depositAmount(r)},{k:'st',l:'Status',text:r=>r.depositStatus||'Belum Diterima',html:r=>UI.badge(r.depositStatus||'Belum Diterima')}]});
};

/* ================= PENGEMBALIAN UNIT ================= */
PAGES.rent_return.render=async(v,param)=>{
 if(param&&param.startsWith('new/')){
  const c=DB.get('rent_contracts',param.slice(4));if(!c)return v.innerHTML=UI.empty('Kontrak tidak ditemukan.');
  if(!can('rent_return','w'))return v.innerHTML=UI.empty('Anda tidak berhak memproses pengembalian unit.');
  const fields=[F.d('date','Tanggal pengembalian',{req:true,def:today()}),F.n('finalReading','Hour meter akhir',{req:true,def:c.hourMeterStart+Rent.overtime(c).used}),
   F.s('condition','Kondisi unit',['Baik','Perlu perbaikan ringan','Rusak'],{req:true}),F.ta('conditionNotes','Catatan kondisi',{req:true}),F.fl('files','Foto unit saat kembali',{req:true})];
  RentReturn._ctx={c,fields};
  v.innerHTML=UI.pghead('Pengembalian Unit — '+c.no,`<a class="btn btn-o" href="#/rent_contracts/${c.id}">‹ Batal</a>`)+`<div class="card"><div id="rrform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="rent-return-save">Simpan & ajukan pengembalian deposit</button></div></div>`;
  Form.hydrate($('#rrform'),fields,{});return;
 }
 v.innerHTML=UI.pghead('Pengembalian Unit')+'<div class="card" id="rrl"></div>';
 new DT($('#rrl'),{title:'Pengembalian Unit',rows:()=>DB.all('rent_contracts').filter(c=>c.returnedInfo),onRow:id=>Router.go('rent_contracts/'+id),
  cols:[{k:'no',l:'Kontrak'},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'date',l:'Tanggal kembali',text:r=>fdate(r.returnedInfo?.date)},{k:'cond',l:'Kondisi',text:r=>r.returnedInfo?.condition},{k:'st',l:'Status kontrak',text:r=>r.status,html:r=>UI.badge(r.status)}]});
};
const RentReturn={_ctx:null};
ACT['rent-return-save']=async()=>{
 const {c,fields}=RentReturn._ctx,{v,err}=Form.collect($('#rrform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 const min=(c.hourMeterLogs||[]).slice(-1)[0]?.reading??c.hourMeterStart;
 if(num(v.finalReading)<min)return UI.toast(`Hour meter akhir tidak boleh kurang dari catatan terakhir (${nf(min)}).`,'err');
 const logs=[...(c.hourMeterLogs||[]),{date:v.date,reading:num(v.finalReading),by:Auth.user.name}];
 DB.update('rent_contracts',c.id,{status:'Proses Pengembalian',hourMeterLogs:logs,returnedInfo:v,returnCondition:v.conditionNotes},'Unit dikembalikan','Pengembalian unit');
 if(v.condition==='Rusak')DB.update('rent_units',c.unitId,{status:'Rusak'},'Kondisi saat kembali: rusak','Rusak');
 else if(v.condition==='Perlu perbaikan ringan')DB.update('rent_units',c.unitId,{status:'Maintenance'},'Kondisi saat kembali: perlu perbaikan','Maintenance');
 UI.toast('Pengembalian unit tercatat. Ajukan pengembalian deposit dari halaman kontrak.');Router.go('rent_contracts/'+c.id);
};
