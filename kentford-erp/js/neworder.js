'use strict';
/* =========================================================
   KENTFORD ERP - New Order Tracking: alur 12 tahap dari input
   sales hingga selesai (instalasi genset, serah terima, invoice)
   ========================================================= */

/* ---------- Tahapan New Order ---------- */
const STAGES=[
 {key:'sales_input',short:'Input Sales',status:'Input Sales',roles:['sales','sales_support']},
 {key:'review',short:'Verifikasi Admin',status:'Dalam Review Sales Support',roles:['sales_support']},
 {key:'warehouse',short:'Cek Stok',status:'Pemeriksaan Gudang',roles:['warehouse']},
 {key:'finance',short:'Cek Finance',status:'Pemeriksaan Finance',roles:['finance']},
 {key:'director',short:'Approval Direktur',status:'Menunggu Approval Direktur',roles:['president_director']},
 {key:'prepare',short:'Persiapan Barang',status:'Persiapan Barang',roles:['warehouse']},
 {key:'shipping',short:'Pengiriman',status:'Dalam Pengiriman',roles:['warehouse','sales_support']},
 {key:'delivered',short:'Diterima Customer',status:'Diterima Customer',roles:['sales','sales_support']},
 {key:'install',short:'Instalasi',status:'Instalasi & Commissioning',roles:['technician']},
 {key:'handover',short:'Serah Terima',status:'Serah Terima & TTD',roles:['sales','sales_support']},
 {key:'invoice_final',short:'Invoice Final',status:'Penagihan Final',roles:['finance']},
 {key:'done',short:'Selesai',status:'Selesai',roles:[]}
];
const STAGE_IDX=k=>STAGES.findIndex(s=>s.key===k);
const ORD_ITEM_COLS=[{k:'productId',l:'Produk','t':'ref',ref:'products',w:'220px'},{k:'desc',l:'Deskripsi',t:'text',w:'200px'},{k:'qty',l:'Qty',t:'number',w:'80px'}];

/* ---------- Objek Order (API publik dipakai dashboard/reports/finance) ---------- */
const Order={
 stageRoles(o){return (STAGES.find(s=>s.key===o.stage)||{}).roles||[]},
 canAct(o){return !o.cancelled&&o.stage!=='done'&&o.stage!=='director'&&isRole(...this.stageRoles(o),'manager','president_director')},
 late(o){
  if(o.cancelled||o.stage==='done')return false;
  const sla=num(S().slaDays)||3;
  if(daysBetween((o.stageAt||o.createdAt||today()).slice(0,10),today())>sla)return true;
  if(o.targetDelivery&&o.targetDelivery<today()&&!['delivered','install','handover','invoice_final'].includes(o.stage))return true;
  return false;
 },
 myTasks(){
  return Scope.rows('orders').filter(o=>!o.cancelled&&o.stage!=='done'&&o.stage!=='director'&&this.stageRoles(o).some(r=>isRole(r)))
   .sort((a,b)=>(a.stageAt||'').localeCompare(b.stageAt||''));
 },
 /* dipanggil setelah pembayaran invoice tercatat (lihat finance.js / sales.js) */
 touch(id){
  const o=DB.get('orders',id);if(!o)return;
  if((o.stage==='finance'||o.stage==='director')&&Inv.orderPaid(o)){
   this._advance(o,'prepare','Pembayaran lunas — otomatis lanjut ke Persiapan Barang');
   Notify.user(o.salesId,`Order ${o.no}: pembayaran lunas, lanjut ke Persiapan Barang.`,'#/orders/'+o.id);
  }
 },
 /* pindah tahap: tandai tahap sekarang selesai, catat riwayat, gabungkan data tambahan */
 _advance(o,nextKey,text,dataPatch){
  const completed=[...(o.completed||[])];if(!completed.includes(o.stage))completed.push(o.stage);
  const st=STAGES.find(s=>s.key===nextKey);
  const history=[...(o.history||[]),{at:nowISO(),by:Auth.user?.name||'Sistem',stage:o.stage,text}];
  const patch={stage:nextKey,statusText:st?st.status:nextKey,stageAt:nowISO(),completed,history};
  if(dataPatch)patch.data={...(o.data||{}),...dataPatch};
  DB.update('orders',o.id,patch,text,'Tahap: '+(st?st.status:nextKey));
  return DB.get('orders',o.id);
 },
 create(v){
  return DB.insert('orders',{...v,no:Num.next('ORD'),salesId:Auth.uid(),stage:'sales_input',statusText:STAGES[0].status,stageAt:nowISO(),
   completed:[],data:{},cancelled:false,history:[{at:nowISO(),by:Auth.user.name,stage:'sales_input',text:'Order dibuat'}]});
 },
 progressHtml(o){
  const curIdx=STAGE_IDX(o.stage);
  return `<div class="stepper">${STAGES.map((s,i)=>{
   const done=(o.completed||[]).includes(s.key)||i<curIdx;
   const cur=s.key===o.stage;
   return `<div class="st ${done?'done':cur?'cur':''}"><i>${done?'✓':i+1}</i><div>${esc(s.short)}</div></div>`;
  }).join('')}</div>`;
 }
};

/* ---------- Approval: kirim tanpa pelunasan penuh (memerlukan Direktur) ---------- */
Approval.hooks.ship_no_payment={
 approved(a){const o=DB.get('orders',a.refId);if(!o)return;Order._advance(o,'prepare','Disetujui Direktur — lanjut ke Persiapan Barang')},
 rejected(a){
  const o=DB.get('orders',a.refId);if(!o)return;
  const s=a.steps.find(x=>x.status==='Ditolak');
  DB.update('orders',o.id,{stage:'finance',statusText:'Ditolak Direktur — Perlu Pelunasan',stageAt:nowISO(),
   history:[...(o.history||[]),{at:nowISO(),by:'Sistem',stage:'director',text:'Ditolak Direktur: '+(s?.note||'')}]},s?.note||'','Ditolak Direktur');
  Notify.user(o.salesId,`Pengiriman ${o.no} tanpa pelunasan DITOLAK direktur: ${s?.note||''}`,'#/orders/'+o.id);
 }
};

/* ================= FORM & AKSI ================= */
const ORD_CREATE_FIELDS=()=>[
 F.r('customerId','Customer','customers',{req:true}),
 F.t('pic','PIC customer',{req:true}),
 F.t('contact','No. telepon / WA PIC',{t:'phone'}),
 F.s('needType','Jenis kebutuhan',['Pembelian','Rental','Spare part','Service','Instalasi'],{req:true}),
 F.t('capacity','Kapasitas genset',{ph:'mis. 250 kW'}),
 F.t('engine','Engine',{ph:'mis. Yuchai'}),
 F.t('alternator','Alternator'),
 F.t('controller','Controller'),
 F.ta('location','Lokasi pemasangan / pengiriman',{req:true}),
 F.ta('purpose','Tujuan penggunaan / kebutuhan'),
 {k:'items',l:'Item yang dibutuhkan',t:'lines',min:1,cols:ORD_ITEM_COLS},
 F.d('targetDelivery','Target pengiriman',{req:true,def:()=>addDays(today(),14)}),
 F.c('installNeeded','Perlu instalasi / commissioning genset'),
 F.ta('notes','Catatan tambahan'),
 F.fl('files','Lampiran (PO customer, dsb.)')
];

ACT['ord-save']=()=>{
 const fields=Order._ctx.fields,{v,err}=Form.collect($('#oform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 if(!v.items||!v.items.length)return UI.toast('Tambahkan minimal satu item.','err');
 const r=Order.create(v);
 UI.toast('New Order dibuat: '+r.no);Router.go('orders/'+r.id);
};
ACT['ord-update']=el=>{
 const o=DB.get('orders',el.dataset.id),fields=Order._ctx.fields,{v,err}=Form.collect($('#oform'),fields);
 if(err.length)return UI.toast(err[0],'err');
 if(!v.items||!v.items.length)return UI.toast('Tambahkan minimal satu item.','err');
 DB.update('orders',o.id,v,'','Ubah data order');
 UI.toast('Perubahan disimpan.');Router.render();
};
ACT['ord-submit']=el=>{
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'review','Order dikirim ke Sales Support');
 UI.toast('Order dikirim untuk verifikasi.');Router.render();
};
ACT['ord-review-ok']=async el=>{
 const v=await UI.ask({title:'Verifikasi Sales Admin',ok:'Setujui & lanjut ke Cek Stok',fields:[F.ta('notes','Catatan verifikasi')]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'warehouse','Diverifikasi Sales Support',{review:{result:'Disetujui',notes:v.notes}});
 Router.render();
};
ACT['ord-review-back']=async el=>{
 const r=await UI.confirm({title:'Kembalikan ke Sales',msg:'Order akan dikembalikan ke Sales untuk direvisi.',reason:true,danger:true});
 if(!r)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'sales_input','Dikembalikan untuk revisi: '+r.reason,{review:{result:'Perlu Revisi',notes:r.reason}});
 DB.update('orders',o.id,{statusText:'Perlu Revisi Sales'},'','Perlu Revisi Sales');
 Notify.user(o.salesId,`Order ${o.no} dikembalikan untuk revisi: ${r.reason}`,'#/orders/'+o.id);
 Router.render();
};
ACT['ord-warehouse']=async el=>{
 const v=await UI.ask({title:'Pemeriksaan Gudang',ok:'Lanjut ke Finance',fields:[
  F.s('availability','Ketersediaan stok',['Tersedia penuh','Stok sebagian tersedia','Tidak tersedia'],{req:true}),
  F.r('location','Lokasi / gudang','warehouses'),F.s('condition','Kondisi barang',['Baru','Bekas layak','Perlu indent / beli'],{def:'Baru'}),
  F.ta('needBuy','Kebutuhan pembelian tambahan (jika ada)')]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'finance','Pemeriksaan gudang selesai',{warehouse:v});
 Router.render();
};
ACT['ord-mk-quote']=el=>Router.go('quotations/new/'+el.dataset.id);
ACT['ord-finance-advance']=async el=>{
 const o=DB.get('orders',el.dataset.id);
 if(!o.quotationId)return UI.toast('Buat quotation terlebih dahulu.','err');
 if(!o.soId)return UI.toast('Sales Order belum dibuat dari quotation ini.','err');
 const so=DB.get('salesorders',o.soId);if(!so)return UI.toast('Sales Order tidak ditemukan.','err');
 if(Inv.orderPaid(o)){Order._advance(o,'prepare','Pembayaran lunas, lanjut ke Persiapan Barang');UI.toast('Lanjut ke Persiapan Barang.');Router.render();return}
 if(Approval.forRef('orders',o.id).some(a=>a.type==='ship_no_payment'&&a.status==='Menunggu'))return UI.toast('Sudah ada pengajuan approval Direktur yang menunggu.','err');
 const remaining=so.total-sum(SO.invoices(so).filter(i=>!i.cancelled),i=>Inv.paid(i));
 const r=await UI.ask({title:'Ajukan pengiriman tanpa pelunasan penuh',ok:'Ajukan ke Direktur',danger:true,fields:[F.ta('reason','Alasan / catatan',{req:true})],
  pre:`<div class="info" style="margin-bottom:10px">Sisa tagihan: <b>${rp(remaining)}</b></div>`});
 if(!r)return;
 Approval.request({type:'ship_no_payment',refCol:'orders',refId:o.id,title:`Pengiriman tanpa pelunasan — ${o.no}`,amount:remaining,reason:r.reason,meta:{forceDirector:true}});
 Order._advance(o,'director','Menunggu approval Direktur (kirim tanpa lunas)',{finance:{note:r.reason}});
 UI.toast('Diajukan ke Direktur.');Router.render();
};
ACT['ord-prepare']=async el=>{
 const v=await UI.ask({title:'Persiapan & Jadwal Pengiriman',ok:'Kirim barang',fields:[
  F.d('schedule','Tanggal pengiriman',{req:true,def:()=>today()}),F.r('vehicleId','Kendaraan','vehicles'),F.t('driver','Driver'),
  F.t('sjNo','No. Surat Jalan'),F.t('doNo','No. Delivery Order'),F.ta('notes','Catatan persiapan')]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'shipping','Barang disiapkan & dikirim',{shipping:v});
 Router.render();
};
ACT['ord-delivered']=async el=>{
 const v=await UI.ask({title:'Konfirmasi Diterima Customer',ok:'Konfirmasi diterima',fields:[
  F.d('receivedDate','Tanggal diterima',{req:true,def:()=>today()}),F.t('receiver','Nama penerima',{req:true}),F.ta('notes','Catatan')]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id),next=o.installNeeded?'install':'handover';
 Order._advance(o,next,'Barang diterima customer',{delivery:v});
 DB.update('orders',o.id,{deliveryReportNo:Num.next('DR')},'','Nomor Delivery Report');
 Router.render();
};
ACT['ord-install-plan']=async el=>{
 const v=await UI.ask({title:'Rencana Instalasi / Commissioning',ok:'Simpan jadwal',fields:[
  F.r('technicianId','Teknisi','users',{filter:u=>u.roleId==='technician',req:true}),F.d('scheduledDate','Tanggal instalasi',{req:true,def:()=>addDays(today(),2)})]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 DB.update('orders',o.id,{data:{...(o.data||{}),install_plan:v}},'','Jadwal instalasi disimpan');
 Notify.user(v.technicianId,`Instalasi dijadwalkan untuk order ${o.no} — ${fdate(v.scheduledDate)}`,'#/orders/'+o.id);
 Router.render();
};
ACT['ord-install-done']=async el=>{
 const v=await UI.ask({title:'Instalasi & Commissioning Selesai',ok:'Selesai, lanjut Serah Terima',fields:[F.ta('notes','Catatan hasil instalasi',{req:true}),F.fl('files','Foto instalasi')]});
 if(!v)return;
 const o=DB.get('orders',el.dataset.id);
 Order._advance(o,'handover','Instalasi & commissioning selesai',{install:{...v,by:Auth.user.name,at:nowISO()}});
 Router.render();
};
ACT['ord-handover']=async el=>{
 const o=DB.get('orders',el.dataset.id);
 const v=await UI.ask({title:'Serah Terima & Tanda Tangan Digital',ok:'Simpan & lanjut ke Invoice Final',
  fields:[F.t('signerName','Nama penerima / penandatangan',{req:true}),{k:'signature',l:'Tanda tangan customer',t:'sig'}]});
 if(!v)return;
 if(!v.signature)return UI.toast('Tanda tangan wajib diisi.','err');
 Order._advance(o,'invoice_final','Serah terima ditandatangani',{signature:{data:v.signature,signerName:v.signerName,at:nowISO()}});
 Router.render();
};
ACT['ord-finish']=el=>{
 const o=DB.get('orders',el.dataset.id),so=o.soId&&DB.get('salesorders',o.soId);
 if(so&&!Inv.orderPaid(o))return UI.toast('Penagihan belum lunas — Order belum bisa diselesaikan.','err');
 Order._advance(o,'done','Order selesai');
 UI.toast('Order diselesaikan.');Router.render();
};

/* ================= HALAMAN ================= */
PAGES.orders.render=async(v,param)=>{
 if(!param){
  const w=isRole('sales','sales_support','manager','president_director');
  v.innerHTML=UI.pghead('New Order Tracking',w?'<a class="btn" href="#/orders/new">+ New Order</a>':'')+'<div class="card" id="ordl"></div>';
  new DT($('#ordl'),{title:'New Order',size:15,rows:()=>Scope.rows('orders').slice().reverse(),onRow:id=>Router.go('orders/'+id),
   filters:[{k:'s',l:'Status',opts:()=>[...STAGES.map(s=>s.status),'Perlu Revisi Sales','Ditolak Direktur — Perlu Pelunasan','Dibatalkan'],get:r=>r.cancelled?'Dibatalkan':r.statusText},
    {k:'c',l:'Customer',opts:()=>DB.all('customers').map(c=>c.name),get:r=>custName(r.customerId)}],
   cols:[{k:'no',l:'No. Order'},{k:'c',l:'Customer',text:r=>custName(r.customerId)},{k:'n',l:'Kebutuhan',text:r=>r.needType},{k:'s',l:'Sales',text:r=>userName(r.salesId)},
    {k:'td',l:'Target kirim',text:r=>fdate(r.targetDelivery),sortv:r=>r.targetDelivery},
    {k:'st',l:'Tahap',text:r=>r.cancelled?'Dibatalkan':r.statusText,html:r=>UI.badge(r.cancelled?'Dibatalkan':r.statusText)+(Order.late(r)?' '+UI.badge('Terlambat'):'')}]});
  return;
 }
 if(param==='new'){
  if(!isRole('sales','sales_support','manager','president_director')){v.innerHTML=UI.empty('Anda tidak berhak membuat New Order.');return}
  const fields=ORD_CREATE_FIELDS();Order._ctx={fields};
  v.innerHTML=UI.pghead('New Order baru',`<a class="btn btn-o" href="#/orders">‹ Batal</a>`)+
   `<div class="card"><div id="oform">${Form.render(fields,{})}</div><div class="acts" style="margin-top:12px"><button class="btn" data-act="ord-save">Simpan New Order</button></div></div>`;
  Form.hydrate($('#oform'),fields,{});
  return;
 }
 const o=DB.get('orders',param);
 if(!o||!Scope.ok('orders',o)){v.innerHTML=UI.empty('New Order tidak ditemukan.');return}
 renderOrderDetail(v,o);
};

function renderOrderDetail(v,o){
 const canAct=Order.canAct(o),q=o.quotationId&&DB.get('quotations',o.quotationId),so=o.soId&&DB.get('salesorders',o.soId);
 const editable=o.stage==='sales_input'&&canAct;
 const fields=ORD_CREATE_FIELDS();
 const acts=[`<a class="btn btn-o" href="#/orders">‹ Kembali</a>`];
 if(!o.cancelled&&o.stage!=='done')acts.push(`<button class="btn btn-d" data-act="cancel-req" data-col="orders" data-id="${o.id}" data-l="New Order">Ajukan pembatalan</button>`);
 if(editable){acts.push(`<button class="btn btn-o" data-act="ord-update" data-id="${o.id}">Simpan perubahan</button>`);acts.push(`<button class="btn" data-act="ord-submit" data-id="${o.id}">Kirim ke Sales Support</button>`)}
 if(o.stage==='review'&&canAct){acts.push(`<button class="btn" data-act="ord-review-ok" data-id="${o.id}">Setujui & lanjut Cek Stok</button>`);acts.push(`<button class="btn btn-o" data-act="ord-review-back" data-id="${o.id}">Kembalikan ke Sales</button>`)}
 if(o.stage==='warehouse'&&canAct)acts.push(`<button class="btn" data-act="ord-warehouse" data-id="${o.id}">Isi hasil pemeriksaan gudang</button>`);
 if(o.stage==='finance'&&canAct){
  if(!o.quotationId)acts.push(`<button class="btn" data-act="ord-mk-quote" data-id="${o.id}">Buat Quotation</button>`);
  else acts.push(`<button class="btn" data-act="ord-finance-advance" data-id="${o.id}">Cek pembayaran & lanjutkan</button>`);
 }
 if(o.stage==='prepare'&&canAct)acts.push(`<button class="btn" data-act="ord-prepare" data-id="${o.id}">Jadwalkan & kirim barang</button>`);
 if(o.stage==='shipping'&&canAct)acts.push(`<button class="btn" data-act="ord-delivered" data-id="${o.id}">Tandai diterima customer</button>`);
 if(o.stage==='install'&&canAct){
  if(!o.data?.install_plan)acts.push(`<button class="btn" data-act="ord-install-plan" data-id="${o.id}">Jadwalkan instalasi</button>`);
  acts.push(`<button class="btn" data-act="ord-install-done" data-id="${o.id}">Instalasi selesai</button>`);
 }
 if(o.stage==='handover'&&canAct)acts.push(`<button class="btn" data-act="ord-handover" data-id="${o.id}">Serah terima & TTD</button>`);
 if(o.stage==='invoice_final'&&canAct)acts.push(`<button class="btn" data-act="ord-finish" data-id="${o.id}">Selesaikan Order</button>`);

 const appr=Approval.forRef('orders',o.id);
 v.innerHTML=UI.pghead('New Order '+o.no,acts.join(''))+
  `<div class="card"><div class="ch"><span>${esc(custName(o.customerId))} — ${esc(o.needType||'')}</span>${UI.badge(o.cancelled?'Dibatalkan':o.statusText)}</div>${Order.progressHtml(o)}
   ${o.cancelled?`<div class="errbox">Order dibatalkan${o.cancelReason?': '+esc(o.cancelReason):''}.</div>`:''}
   ${o.stage==='director'?'<div class="warnbox">Menunggu approval Direktur untuk pengiriman tanpa pelunasan penuh.</div>':''}
   ${o.statusText==='Ditolak Direktur — Perlu Pelunasan'?'<div class="errbox">Pengiriman tanpa pelunasan DITOLAK Direktur — tunggu pelunasan customer lalu lanjutkan kembali.</div>':''}</div>
  <div class="grid split"><div>
   <div class="card"><h3>Data order</h3><div id="oform">${Form.render(fields,clone(o),!editable)}</div></div>
   ${q||so?`<div class="card"><h3>Dokumen terkait</h3>${UI.kv([['Quotation',q?docLink('quotations',q):'-'],['Sales Order',so?docLink('salesorders',so):'-'],
    ['Total SO',so?rp(so.total):'-'],['Dibayar',so?rp(sum(SO.invoices(so).filter(i=>!i.cancelled),i=>Inv.paid(i))):'-']])}</div>`:''}
   ${o.data?.warehouse?`<div class="card"><h3>Hasil pemeriksaan gudang</h3>${UI.kv([['Ketersediaan',esc(o.data.warehouse.availability||'-')],['Lokasi',esc(DB.get('warehouses',o.data.warehouse.location)?.name||'-')],['Kondisi',esc(o.data.warehouse.condition||'-')],['Kebutuhan beli',esc(o.data.warehouse.needBuy||'-')]])}</div>`:''}
   ${o.data?.shipping?`<div class="card"><h3>Pengiriman</h3>${UI.kv([['Jadwal',fdate(o.data.shipping.schedule)],['Kendaraan',esc(DB.get('vehicles',o.data.shipping.vehicleId)?.plate||'-')],['Driver',esc(o.data.shipping.driver||'-')],['No. SJ',esc(o.data.shipping.sjNo||'-')],['No. DO',esc(o.data.shipping.doNo||'-')]])}</div>`:''}
   ${o.data?.delivery?`<div class="card"><h3>Diterima customer</h3>${UI.kv([['Delivery report',esc(o.deliveryReportNo||'-')],['Tanggal diterima',fdate(o.data.delivery.receivedDate)],['Penerima',esc(o.data.delivery.receiver||'-')],['Catatan',esc(o.data.delivery.notes||'-')]])}</div>`:''}
   ${o.data?.install_plan||o.data?.install?`<div class="card"><h3>Instalasi & Commissioning</h3>${UI.kv([['Teknisi',esc(userName(o.data.install_plan?.technicianId)||'-')],['Jadwal',o.data.install_plan?fdate(o.data.install_plan.scheduledDate):'-'],['Hasil',esc(o.data.install?.notes||'Belum selesai')]])}</div>`:''}
   ${o.data?.signature?`<div class="card"><h3>Tanda tangan serah terima</h3><img src="${o.data.signature.data}" style="max-width:320px;border:1px solid var(--bd)"><div class="mut">${esc(o.data.signature.signerName)} • ${fdt(o.data.signature.at)}</div></div>`:''}
   <div class="card"><h3>Aktivitas & komentar</h3>${UI.activity('orders',o.id)}</div>
  </div><div>
   <div class="card"><h3>Riwayat tahap</h3>${(o.history||[]).slice().reverse().map(h=>`<div style="padding:5px 0;border-bottom:1px solid var(--bd)"><b>${esc(STAGES.find(s=>s.key===h.stage)?.short||h.stage)}</b>: ${esc(h.text)}<br><small class="mut">${esc(h.by)} • ${fdt(h.at)}</small></div>`).join('')||'<div class="empty">Belum ada riwayat.</div>'}</div>
   ${appr.length?`<div class="card"><h3>Approval</h3>${appr.map(a=>`<div><a href="#" data-act="appr-open" data-id="${a.id}">${esc(a.no)}</a> ${UI.badge(a.status)}</div>`).join('')}</div>`:''}
  </div></div>`;
 Form.hydrate($('#oform'),fields,clone(o));
 Order._ctx={fields};
}
