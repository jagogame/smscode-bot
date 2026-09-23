'use strict';
/* =========================================================
   KENTFORD ERP - skema: halaman, entitas, hak akses, data contoh
   ========================================================= */
const PAGE_GROUPS=[
 {gk:'',pages:['dashboard']},
 {gk:'crm_sales',pages:['customers','leads','site_visits','quotations','salesorders','orders','sales_list']},
 {gk:'purchasing',pages:['pr','projects','sq','pc','po','suppliers','incoming']},
 {gk:'inventory',pages:['products','stock_genset','stock_parts','gr','gi','transfer','opname','barcode']},
 {gk:'finance',pages:['invoices','ar','si','ap','payreq','bank','petty','tax','recon','coa','journal']},
 {gk:'admin',pages:['company_docs','leave']},
 {gk:'rental',pages:['rent_units','rent_contracts','rent_schedule','hourmeter','overtime','deposit','rent_return']},
 {gk:'service',pages:['svc_req','survey','wo','tech_sched','install','pm','warranty','svc_report','knowledge']},
 {gk:'aftersales_partners',pages:['partners','partners_map','partner_prospects','partner_evaluations','partner_payments']},
 {gk:'approval',pages:['approvals_pending','approvals_done','approvals_rejected','approvals_history']},
 {gk:'other',pages:['reports','master','users','audit','settings']}
];
PAGE_GROUPS.forEach(g=>Object.defineProperty(g,'g',{enumerable:true,get:()=>g.gk?t('grp.'+g.gk):''}));
const PAGES={};
['dashboard','leads','site_visits','customers','followups','quotations','salesorders','orders','sales_list','pr','projects','sq','pc','po','suppliers','incoming',
 'products','stock_genset','stock_parts','gr','gi','transfer','opname','barcode',
 'invoices','ar','si','ap','payreq','bank','petty','tax','recon','coa','journal',
 'rent_units','rent_contracts','rent_schedule','hourmeter','overtime','deposit','rent_return',
 'svc_req','survey','wo','tech_sched','install','pm','warranty','svc_report','knowledge',
 'partners','partners_map','partner_prospects','partner_evaluations','partner_payments',
 'approvals_pending','approvals_done','approvals_rejected','approvals_history',
 'company_docs','leave',
 'reports','master','users','audit','settings'
].forEach(key=>{
 PAGES[key]={key,stage:undefined,render:null};
 Object.defineProperty(PAGES[key],'label',{enumerable:true,get:()=>t('nav.'+key)});
});

/* ---------- Definisi entitas (CRUD generik) ---------- */
const F={
 t:(k,l,o={})=>({k,l,t:'text',...o}),ta:(k,l,o={})=>({k,l,t:'textarea',w:'full',...o}),
 n:(k,l,o={})=>({k,l,t:'number',...o}),m:(k,l,o={})=>({k,l,t:'money',...o}),d:(k,l,o={})=>({k,l,t:'date',...o}),
 s:(k,l,opts,o={})=>({k,l,t:'select',opts,...o}),r:(k,l,ref,o={})=>({k,l,t:'ref',ref,...o}),
 c:(k,l,o={})=>({k,l,t:'check',...o}),fl:(k,l,o={})=>({k,l,t:'files',...o}),pc:(k,l,o={})=>({k,l,t:'percent',...o})
};
const salesUsers=u=>['sales','sales_manager','admin_hr_sales'].includes(u.roleId);
// Kosakata status kerjasama partner aftersales persis dari spesifikasi bisnis (bukan diterjemahkan lewat t(),
// mengikuti konvensi opsi select lain di file ini yang berupa string literal statis).
const PARTNER_STATUS_OPTS=['Prospect','Contacted','Follow-up','Surveyed','Under Evaluation','Waiting for Agreement','Active','Temporarily Inactive','Blacklisted','Contract Ended'];
const ENT={
 users:{col:'users',label:r=>r.name},
 roles:{col:'roles',label:r=>r.name},
 leads:{col:'leads',page:'leads',title:'Lead',owner:'salesId',label:r=>r.company||r.name,status:'status',
  fields:[F.t('name','Nama kontak',{req:true,list:true}),F.t('company','Perusahaan',{list:true}),F.t('phone','Telepon / WA',{t:'phone',list:true}),F.t('email','Email',{t:'email'}),
   F.s('source','Sumber',['Website','Referral','Pameran','Cold call','WhatsApp','Lainnya']),F.s('dealType','Tipe',['End User','Partner','Tender'],{list:true,req:true,def:'End User'}),
   F.s('need','Kebutuhan',['Pembelian','Rental','Service','Spare part','Instalasi'],{list:true}),
   F.m('estValue','Estimasi nilai (Rp)',{list:true}),F.r('salesId','Sales PIC','users',{filter:salesUsers,req:true,list:true,def:()=>Auth.uid()}),
   F.s('status','Status',['Baru','Dihubungi','Kualifikasi','Quotation','Menang','Kalah'],{list:true,badge:true,def:'Baru',req:true}),F.ta('notes','Catatan kebutuhan')],
  wrPage:'leads'},
 /* Kunjungan sales+teknisi ke site SEBELUM penawaran dikirim (poin a) - beda dengan 'survey'
    (halaman Service, svc_req type='Survey lokasi') yang untuk keperluan purna-jual/instalasi
    terhadap customer yang sudah ada unit. site_visits ini dari leadId (belum tentu sudah jadi
    customer) atau customer existing yang mau nambah unit, hasilnya (findings/recommendation)
    jadi dasar bikin quotation detail lewat tombol "Buat Quotation" (lihat ACT['visit-mk-quote']
    di sales.js) begitu status kunjungan 'Selesai'. */
 site_visits:{col:'site_visits',page:'site_visits',title:'Kunjungan Site',owner:'salesId',status:'status',
  label:r=>(r.customerId?custName(r.customerId):DB.get('leads',r.leadId)?.company||DB.get('leads',r.leadId)?.name||'-')+' — '+fdate(r.visitDate),
  fields:[F.r('leadId','Lead terkait','leads',{hint:'Isi kalau kunjungan berasal dari lead baru'}),
   F.r('customerId','Customer','customers',{hint:'Isi kalau kunjungan ke customer existing / lead sudah jadi customer'}),
   F.d('visitDate','Tanggal kunjungan',{req:true,def:()=>today(),list:true}),
   F.r('salesId','Sales','users',{filter:salesUsers,req:true,list:true,def:()=>isRole('sales')?Auth.uid():''}),
   F.r('technicianId','Teknisi','users',{filter:u=>u.roleId==='technician',req:true,list:true}),
   F.s('status','Status',['Dijadwalkan','Selesai','Batal'],{def:'Dijadwalkan',list:true,badge:true,req:true}),
   F.ta('findings','Temuan teknis di lapangan'),
   F.ta('recommendation','Rekomendasi teknis untuk penawaran',{hint:'Jadi dasar sales bikin penawaran detail sesuai saran teknisi'}),
   F.c('needVendorItems','Ada barang yang perlu dibeli dari vendor lain',{def:false}),
   F.ta('vendorItemsNote','Catatan barang dari vendor lain',{hint:'Sebelum penawaran dikirim, cek harga vendor dulu di Purchasing > Price Comparison'}),
   F.fl('files','Foto/dokumen lokasi')],
  wr:['sales','sales_manager','technician','tech_manager','admin_hr_sales','deputy_director','director']},
 /* Knowledge Base internal (poin b): dokumen project & video tutorial (mis. cara benerin genset
    masuk angin). custom:true karena butuh field upload ke SERVER (bukan lokal IndexedDB seperti
    F.fl biasa - lihat ServerFiles di core.js), jadi halamannya dibikin manual di js/knowledge.js,
    bukan lewat generic Crud. Upload dibatasi role teknis+admin (lihat UPLOAD_ROLES di
    kentford-erp-auth/files.js), tapi SEMUA user login boleh baca/lihat. */
 knowledge_docs:{col:'knowledge_docs',page:'knowledge',title:'Knowledge Base',custom:true,label:r=>r.title},
 customers:{col:'customers',page:'customers',title:'Customer',owner:'salesId',label:r=>r.name,autoCode:{k:'code',type:'CUS'},wr:['sales','sales_manager','admin_hr_sales','deputy_director','director'],
  fields:[F.t('code','Kode',{ro:true,list:true,hint:'Otomatis'}),F.t('name','Nama perusahaan',{req:true,list:true}),F.s('type','Jenis usaha',['Data Center','Manufaktur','Rumah Sakit','Konstruksi','Perkantoran','Pemerintah','Lainnya'],{list:true}),
   F.t('pic','PIC customer',{list:true}),F.t('phone','Telepon',{t:'phone',list:true}),F.t('email','Email',{t:'email'}),F.t('city','Kota'),F.t('npwp','NPWP'),
   F.r('salesId','Sales PIC','users',{filter:salesUsers,list:true,def:()=>isRole('sales')?Auth.uid():''}),F.r('paymentTermId','Payment terms','payterms'),F.m('creditLimit','Credit limit (Rp)'),
   F.c('isPublic','Public (semua sales bisa lihat)',{def:false,hint:'Kalau aktif, customer ini terlihat oleh semua sales, bukan cuma Sales PIC-nya.'}),
   F.ta('address','Alamat'),F.c('active','Aktif',{def:true}),F.ta('notes','Catatan')]},
 suppliers:{col:'suppliers',page:'suppliers',title:'Supplier',label:r=>r.name,autoCode:{k:'code',type:'SUP'},wr:['admin_hr_sales','deputy_director','director'],
  fields:[F.t('code','Kode',{ro:true,list:true,hint:'Otomatis'}),F.t('name','Nama supplier',{req:true,list:true}),F.t('pic','PIC',{list:true}),F.t('phone','Telepon',{t:'phone',list:true}),F.t('email','Email',{t:'email'}),
   F.t('country','Negara',{def:'Indonesia',list:true}),F.s('currency','Mata uang',['IDR','USD','CNY','EUR']),F.r('paymentTermId','Payment terms','payterms'),F.ta('address','Alamat'),F.ta('notes','Catatan')]},
 products:{col:'products',page:'products',title:'Produk',label:r=>`${r.sku} — ${r.name}`,wr:['deputy_director','director','admin_hr_sales'],
  fields:[F.t('sku','SKU',{req:true,list:true}),F.t('name','Nama produk',{req:true,list:true}),
   F.s('kind','Jenis',['Genset','Engine','Alternator','Controller','Panel','Spare part','Kabel & material instalasi','Consumable','Aset rental','Jasa','Lainnya'],{req:true,list:true,hint:'Jasa = biaya layanan tanpa stok (mis. ongkos kirim, jasa servis). Lainnya = lini produk baru di luar genset (PV/EV charging/energy storage, dll)'}),
   F.r('catId','Kategori','categories'),F.r('brandId','Merek','brands',{list:true}),F.t('model','Model',{list:true}),F.t('capacity','Kapasitas',{list:true}),F.s('uom','Satuan',['unit','pcs','set','meter','liter','box'],{def:'pcs'}),
   F.r('supplierId','Supplier utama','suppliers'),F.m('lastCost','Harga beli terakhir (Rp)',{cost:true,list:true}),F.m('price','Harga jual (Rp)',{list:true}),F.n('minStock','Minimum stok',{def:0}),
   F.n('warranty','Garansi (bulan)'),F.c('serialTracked','Wajib nomor seri',{cl:'Unit memakai serial number'}),F.s('condition','Kondisi',['Baru','Bekas layak','Perlu perbaikan'],{def:'Baru'}),
   F.t('barcode','Barcode / QR',{hint:'Kosongkan = otomatis dari SKU'}),F.fl('photos','Foto produk'),F.c('active','Aktif',{def:true})],
  costFields:['lastCost']},
 categories:{col:'categories',page:'master',title:'Kategori Produk',label:r=>r.name,wr:['deputy_director','director','admin_hr_sales','warehouse'],fields:[F.t('name','Nama kategori',{req:true,list:true}),F.t('notes','Keterangan',{list:true})]},
 brands:{col:'brands',page:'master',title:'Brand',label:r=>r.name,wr:['deputy_director','director','admin_hr_sales','warehouse'],fields:[F.t('name','Nama brand',{req:true,list:true}),F.t('origin','Asal negara',{list:true})]},
 warehouses:{col:'warehouses',page:'master',title:'Warehouse / Lokasi',label:r=>r.name,wr:['deputy_director','director'],
  fields:[F.t('code','Kode',{req:true,list:true}),F.t('name','Nama lokasi',{req:true,list:true}),F.s('type','Jenis',['Gudang','Kantor','Customer Site','Transit','Rental','Service'],{list:true}),F.t('address','Alamat',{list:true})]},
 banks:{col:'banks',page:'master',title:'Rekening Bank',label:r=>`${r.bank} ${r.accNo}`,wr:['finance','director'],
  fields:[F.t('name','Nama akun',{req:true,list:true}),F.t('bank','Bank',{req:true,list:true}),F.t('accNo','No. rekening',{req:true,list:true}),F.s('currency','Mata uang',['IDR','USD'],{def:'IDR'}),F.m('openingBalance','Saldo awal (Rp)')]},
 taxes:{col:'taxes',page:'master',title:'Pajak',label:r=>`${r.name} (${r.rate}%)`,wr:['finance','director'],
  fields:[F.t('name','Nama pajak',{req:true,list:true}),F.s('type','Jenis',['PPN','PPh 21','PPh 23','PPh 4(2)','Lainnya'],{list:true}),F.pc('rate','Tarif (%)',{req:true,list:true,hint:'Dapat diubah sesuai regulasi'}),F.c('active','Aktif',{def:true})]},
 payterms:{col:'payterms',page:'master',title:'Payment Terms',label:r=>r.name,wr:['finance','deputy_director','director'],
  fields:[F.t('name','Nama',{req:true,list:true}),F.pc('dpPct','DP (%)',{list:true}),F.n('days','Jatuh tempo (hari)',{list:true}),F.t('desc','Keterangan',{list:true})]},
 deliveryterms:{col:'deliveryterms',page:'master',title:'Delivery Terms',label:r=>r.name,wr:['finance','deputy_director','director'],fields:[F.t('name','Nama',{req:true,list:true}),F.t('desc','Keterangan',{list:true})]},
 employees:{col:'employees',page:'master',title:'Karyawan',label:r=>r.name,wr:['admin_hr_sales'],
  fields:[F.t('name','Nama',{req:true,list:true}),F.t('position','Jabatan',{list:true}),F.r('deptId','Departemen','departments',{list:true}),F.t('phone','Telepon',{t:'phone'}),F.t('email','Email',{t:'email'}),F.d('joinDate','Tanggal masuk'),F.r('userId','Akun pengguna','users'),F.c('active','Aktif',{def:true})]},
 departments:{col:'departments',page:'master',title:'Departemen',label:r=>r.name,wr:['admin_hr_sales'],fields:[F.t('name','Nama departemen',{req:true,list:true}),F.t('head','Kepala departemen',{list:true})]},
 approvalLimits:{col:'approvalLimits',page:'master',title:'Batas Approval',label:r=>`${APPR_TYPES[r.type]||r.type} → ${r.role}`,wr:['director'],
  fields:[F.s('type','Jenis approval',()=>Object.entries(APPR_TYPES).map(([v,l])=>({v,l})),{req:true,list:true}),F.n('step','Urutan langkah',{req:true,list:true,def:1}),
   F.s('role','Approver (role)',()=>DB.all('roles').filter(r=>!['admin_hr_sales','admin_aftersales','warehouse','technician','sales'].includes(r.id)).map(r=>({v:r.id,l:r.name})),{req:true,list:true}),F.m('min','Berlaku bila nominal ≥ (Rp)',{list:true,hint:'0 = selalu berlaku'})]},
 numbering:{col:'numbering',page:'master',title:'Penomoran Dokumen',label:r=>r.name,wr:['director','deputy_director'],
  fields:[F.t('type','Kode jenis',{req:true,list:true,ro:false}),F.t('name','Nama dokumen',{req:true,list:true}),F.t('prefix','Prefix',{req:true,list:true}),
   F.t('format','Format',{req:true,list:true,hint:'Token: {P} prefix, {YYYY}, {MM}, {N4} nomor urut 4 digit'}),F.s('reset','Reset nomor',['bulanan','tahunan','tidak'],{def:'bulanan'})]},
 uoms:{col:'uoms',page:'master',title:'Satuan (UoM)',label:r=>r.name,wr:['deputy_director','director','admin_hr_sales','warehouse'],fields:[F.t('name','Satuan',{req:true,list:true}),F.t('desc','Keterangan',{list:true})]},
 vehicles:{col:'vehicles',page:'master',title:'Kendaraan',label:r=>`${r.plate} (${r.type})`,wr:['warehouse','deputy_director','director'],
  fields:[F.t('plate','Nomor polisi',{req:true,list:true}),F.t('type','Jenis kendaraan',{list:true}),F.t('driver','Driver default',{list:true}),F.c('active','Aktif',{def:true})]},
 tools:{col:'tools',page:'master',title:'Tools Teknisi',label:r=>r.name,wr:['tech_manager','warehouse','deputy_director','director'],
  fields:[F.t('name','Nama alat',{req:true,list:true}),F.n('qty','Jumlah',{def:1,list:true}),F.s('condition','Kondisi',['Baik','Rusak ringan','Rusak berat'],{def:'Baik',list:true}),F.r('technicianId','Dipegang teknisi','technicians',{list:true}),F.t('location','Lokasi/penyimpanan',{list:true}),F.ta('notes','Keterangan')]},
 office_assets:{col:'office_assets',page:'master',title:'Aset Kantor',label:r=>r.name,wr:['admin_hr_sales','deputy_director','director'],
  fields:[F.t('name','Nama aset',{req:true,list:true}),F.n('qty','Jumlah',{def:1,list:true}),F.s('condition','Kondisi',['Baik','Rusak ringan','Rusak berat'],{def:'Baik',list:true}),F.t('location','Lokasi',{list:true}),F.d('purchaseDate','Tanggal beli'),F.ta('notes','Keterangan')]},
 technicians:{col:'technicians',page:'master',title:'Teknisi',label:r=>userName(r.userId),wr:['tech_manager','admin_hr_sales'],
  fields:[F.r('userId','Akun pengguna','users',{filter:u=>u.roleId==='technician',req:true,list:true}),F.t('specialty','Keahlian',{list:true}),F.t('area','Area kerja',{list:true}),F.t('phone','Telepon',{t:'phone'})]},
 failcats:{col:'failcats',page:'master',title:'Kategori Kerusakan',label:r=>r.name,wr:['deputy_director','director'],fields:[F.t('name','Kategori kerusakan',{req:true,list:true}),F.t('desc','Keterangan',{list:true})]},
 servicetypes:{col:'servicetypes',page:'master',title:'Jenis Service',label:r=>r.name,wr:['deputy_director','director'],fields:[F.t('name','Jenis service',{req:true,list:true}),F.t('desc','Keterangan',{list:true})]},
 // Follow-up sekarang bisa terkait Lead (sebelum jadi Customer) ATAU Customer existing - lihat
 // leadId di bawah. Ditampilkan tertanam di dalam halaman Lead (js/admin.js Crud.open, bagian
 // k==='leads'), bukan lagi punya menu navigasi sendiri, tapi entitasnya tetap ada supaya data
 // & hak akses lama tidak berubah.
 followups:{col:'followups',page:'followups',title:'Follow-up',owner:'salesId',label:r=>`${fdate(r.date)} ${r.type||''}`,
  fields:[F.r('leadId','Lead terkait','leads',{hint:'Isi kalau follow-up untuk lead (belum jadi customer)'}),
   F.r('customerId','Customer','customers',{list:true,hint:'Isi kalau follow-up untuk customer existing'}),F.d('date','Tanggal',{req:true,list:true,def:()=>today()}),F.s('type','Jenis',['Telepon','WhatsApp','Email','Kunjungan','Meeting'],{list:true,req:true}),
   F.r('salesId','Sales PIC','users',{filter:salesUsers,req:true,list:true,def:()=>Auth.uid()}),F.s('status','Status',['Terjadwal','Selesai','Dibatalkan'],{def:'Terjadwal',req:true,list:true,badge:true}),
   F.ta('notes','Hasil / catatan',{list:true}),F.d('nextDate','Follow-up berikutnya')]},
 // Proyek: dipakai Purchase Request (js/purchasing.js) untuk menandai pembelian yang terkait proyek
 // sedang berjalan, supaya biaya (PR/PO/SI) bisa dikumpulkan per proyek dan dibandingkan dengan
 // target pendapatan proyek (lihat laporan 'Biaya Proyek' di js/reports.js).
 projects:{col:'projects',page:'projects',title:'Proyek',owner:'salesId',status:'status',label:r=>r.name,
  fields:[F.t('name','Nama Proyek',{req:true,list:true}),F.r('customerId','Customer','customers',{list:true}),
   F.r('salesOrderId','Sales Order terkait','salesorders',{hint:'Opsional - untuk pendapatan otomatis dari SO'}),
   F.r('salesId','PIC','users',{filter:salesUsers,list:true,def:()=>Auth.uid()}),
   F.d('startDate','Tanggal mulai',{def:()=>today(),list:true}),F.m('revenueTarget','Target pendapatan (Rp)',{list:true}),
   F.s('status','Status',['Berjalan','Selesai','Dibatalkan'],{def:'Berjalan',req:true,list:true,badge:true}),F.ta('notes','Catatan')]},
 // Chart of Accounts (COA) — master data akun untuk modul Jurnal Umum (lihat journal_entries & finance.js Journal).
 chart_of_accounts:{col:'chart_of_accounts',page:'coa',title:'Chart of Accounts',label:r=>`${r.code} — ${r.name}`,wr:['finance','director'],
  fields:[F.t('code','Kode Akun',{req:true,list:true}),F.t('name','Nama Akun',{req:true,list:true}),
   F.s('type','Jenis Akun',['Aset','Kewajiban','Ekuitas','Pendapatan','Beban'],{req:true,list:true,badge:true}),
   F.s('normalBalance','Saldo Normal',['Debit','Kredit'],{req:true,list:true}),F.c('active','Aktif',{def:true})]},
 // Dokumen umum General Admin (surat masuk/keluar, kontrak, dsb — modul General Admin minimal, lihat admin.js)
 company_documents:{col:'company_documents',page:'company_docs',title:'Dokumen Perusahaan',label:r=>r.title,wr:['admin_hr_sales','director'],
  fields:[F.t('no','No. Dokumen',{list:true}),F.t('title','Judul Dokumen',{req:true,list:true}),
   F.s('type','Jenis',['Surat Masuk','Surat Keluar','Kontrak','Lainnya'],{list:true}),F.d('date','Tanggal',{list:true,def:()=>today()}),
   F.t('party','Terkait Vendor / Pihak',{list:true}),F.fl('files','Lampiran'),F.ta('notes','Catatan')]},
 // Pengajuan cuti/izin — modul HR minimal (status diubah manual oleh atasan/HR, tidak dilewatkan lewat Approval engine — lihat catatan di finance.js/admin.js)
 leave_requests:{col:'leave_requests',page:'leave',title:'Cuti & Izin',label:r=>`${userName(r.userId)} — ${r.type}`,wr:['admin_hr_sales','director'],
  fields:[F.r('userId','Karyawan','users',{req:true,list:true}),F.s('type','Jenis',['Cuti Tahunan','Izin','Sakit','Lembur'],{req:true,list:true,badge:true}),
   F.d('startDate','Tanggal Mulai',{req:true,list:true}),F.d('endDate','Tanggal Selesai',{req:true,list:true}),F.ta('reason','Alasan'),
   F.s('status','Status',['Diajukan','Disetujui','Ditolak'],{def:'Diajukan',list:true,badge:true})]},
 // entitas khusus (halaman detail sendiri)
 journal_entries:{col:'journal_entries',page:'journal',custom:true,label:r=>r.no},
 si:{col:'si',page:'si',custom:true,label:r=>`${r.no} — ${supName(r.supplierId)} (sisa ${rp(SInv.outstanding(r))})`},
 rent_contracts:{col:'rent_contracts',page:'rent_contracts',custom:true,label:r=>`${r.no} — ${custName(r.customerId)}`},
 payreq:{col:'payreq',page:'payreq',custom:true,label:r=>r.no},
 quotations:{col:'quotations',page:'quotations',owner:'salesId',custom:true,label:r=>r.no},
 salesorders:{col:'salesorders',page:'salesorders',owner:'salesId',custom:true,label:r=>r.no},
 invoices:{col:'invoices',page:'invoices',owner:'salesId',custom:true,label:r=>r.no},
 orders:{col:'orders',page:'orders',owner:'salesId',custom:true,label:r=>r.no},
 // Sales List: halaman tracking gabungan Sales Order + Invoice (page 'sales_list'), render
 // custom di js/sales.js (bukan generic Crud) supaya bisa gabung data dari 2 koleksi sekaligus.
 partners:{col:'partners',page:'partners',title:'Aftersales Partner',label:r=>`${r.code||''} — ${r.name||''}`,status:'status',
  wr:['admin_aftersales','admin_hr_sales','deputy_director','director'],
  fields:[F.t('code','Kode Partner',{ro:true,list:true,hint:'Otomatis: PULAU-PROVINSI-NOMOR'}),F.t('name','Nama Perusahaan / Bengkel',{req:true,list:true}),F.t('pic','Nama PIC',{req:true,list:true}),
   F.t('whatsapp','No. WhatsApp',{t:'phone',req:true,list:true}),F.t('phone','No. Telepon',{t:'phone'}),F.t('email','Email',{t:'email'}),F.ta('address','Alamat Lengkap',{req:true}),
   F.t('province','Provinsi',{req:true,list:true}),F.t('city','Kota / Kabupaten',{req:true,list:true}),F.t('district','Kecamatan'),F.t('postalCode','Kode Pos'),
   F.t('gmapsLink','Link Google Maps',{hint:'Tempel link Google Maps atau share location, lokasi otomatis dititikkan di peta'}),
   F.n('techCount','Jumlah Teknisi',{list:true}),F.ta('techNotes','Kemampuan / Catatan Teknisi'),
   F.t('brands','Merek / Jenis Mesin Ditangani',{list:true,hint:'Pisahkan dengan koma'}),F.c('hasTools','Ketersediaan Alat Kerja'),F.c('hasVehicle','Ketersediaan Kendaraan Servis'),F.c('hasSparepart','Ketersediaan Spare Part'),
   F.c('isFullService','Partner Resmi (Kemampuan Servis Lengkap)',{hint:'Menentukan marker biru pada peta'}),
   F.s('status','Status Kerjasama',PARTNER_STATUS_OPTS,{req:true,def:'Prospect',list:true,badge:true}),
   F.d('coopStartDate','Tanggal Mulai Kerjasama'),F.d('contractEndDate','Tanggal Berakhir Kontrak',{list:true}),F.fl('contractDoc','Dokumen Kontrak'),F.fl('workshopPhotos','Foto Bengkel'),
   F.ta('evalNotes','Catatan Evaluasi'),F.n('rating','Rating Rata-rata',{ro:true,list:true,hint:'Otomatis dari Evaluasi Partner'}),
   {k:'coverageAreas',l:'Wilayah Cakupan',t:'lines',w:'full',cols:[{k:'area',l:'Provinsi/Kota',t:'text',w:'160px'},{k:'transportCost',l:'Biaya Transport (Rp)',t:'number',w:'120px'},{k:'etaHours',l:'Estimasi Tiba (jam)',t:'number',w:'100px'},{k:'notes',l:'Catatan (akomodasi/luar kota/emergency 24 jam)',t:'text'}]}]},
 partner_prospects:{col:'partner_prospects',page:'partner_prospects',title:'Prospek Partner',label:r=>r.name||'-',status:'status',wr:['admin_aftersales','admin_hr_sales','deputy_director','director'],
  fields:[F.t('name','Nama Perusahaan / Bengkel',{req:true,list:true}),F.t('pic','PIC',{list:true}),F.t('whatsapp','No. WhatsApp',{t:'phone',list:true}),F.t('province','Provinsi',{list:true}),F.t('city','Kota',{list:true}),
   F.t('gmapsLink','Link Google Maps',{hint:'Tempel link Google Maps'}),F.t('source','Sumber Informasi',{list:true}),F.d('firstContactDate','Tanggal Kontak Pertama',{def:()=>today()}),F.r('followupBy','Staff Follow-up','users',{list:true,def:()=>Auth.uid()}),
   F.ta('commResult','Hasil Komunikasi'),F.ta('techCapability','Kemampuan Teknis'),F.n('techCount','Jumlah Teknisi'),F.c('hasWorkshop','Punya Bengkel'),F.ta('toolList','Daftar Alat'),
   F.ta('experience','Pengalaman Servis Genset'),F.t('brands','Merek yang Biasa Ditangani'),F.fl('legalDocs','Dokumen Legal'),F.fl('workshopPhotos','Foto Bengkel'),
   F.s('status','Status Follow-up',['Baru','Dihubungi','Dijadwalkan Survey','Disurvey','Dalam Evaluasi','Diterima','Ditolak'],{def:'Baru',list:true,badge:true}),F.d('nextFollowupDate','Follow-up Berikutnya',{list:true}),
   F.ta('notes','Catatan'),F.ta('rejectReason','Alasan Diterima/Ditolak'),F.c('converted','Sudah Dikonversi',{ro:true})]},
 partner_evaluations:{col:'partner_evaluations',page:'partner_evaluations',title:'Evaluasi Partner',label:r=>`${fdate(r.date)} — ${DB.get('partners',r.partnerId)?.name||''}`,wr:['tech_manager','admin_aftersales','director','deputy_director'],
  fields:[F.r('partnerId','Partner','partners',{req:true,list:true}),F.r('svcReqId','Service Request Terkait','svc_req'),F.d('date','Tanggal Evaluasi',{def:()=>today(),req:true,list:true}),
   F.n('scoreSpeed','Kecepatan Respons (1-5)',{req:true,def:3}),F.n('scorePunctual','Ketepatan Waktu (1-5)',{req:true,def:3}),F.n('scoreTech','Kemampuan Teknis (1-5)',{req:true,def:3}),
   F.n('scoreTools','Kelengkapan Alat (1-5)',{req:true,def:3}),F.n('scoreQuality','Kualitas Pekerjaan (1-5)',{req:true,def:3}),F.n('scoreReport','Kelengkapan Laporan (1-5)',{req:true,def:3}),
   F.n('scoreComm','Komunikasi (1-5)',{req:true,def:3}),F.n('scoreSatisfaction','Kepuasan Customer (1-5)',{req:true,def:3}),F.n('scoreCost','Kewajaran Biaya (1-5)',{req:true,def:3}),
   F.n('scoreSop','Kepatuhan SOP (1-5)',{req:true,def:3}),F.n('avgScore','Rata-rata',{ro:true,list:true}),F.ta('notes','Catatan')]},
 partner_payments:{col:'partner_payments',page:'partner_payments',title:'Pembayaran Partner',label:r=>`${DB.get('partners',r.partnerId)?.name||''} — ${fdate(r.paymentDate)||''}`,wr:['finance','admin_aftersales','tech_manager','director','deputy_director'],
  fields:[F.r('svcReqId','Service Request','svc_req',{req:true,list:true}),F.r('partnerId','Partner','partners',{req:true,list:true}),F.m('serviceFee','Biaya Jasa (Rp)',{list:true}),F.m('transportCost','Biaya Transport (Rp)'),
   F.m('accomCost','Biaya Akomodasi (Rp)'),F.m('partsCost','Biaya Spare Part (Rp)'),F.m('taxDeduction','Potongan Pajak (Rp)'),F.m('total','Total Pembayaran (Rp)',{ro:true,list:true}),
   F.fl('partnerInvoice','Invoice Partner'),F.fl('workProof','Bukti Pekerjaan'),F.t('serviceReportNo','No. Service Report',{list:true}),
   F.c('techManagerApproved','Disetujui Manager Teknisi',{ro:true,list:true}),F.c('adminAftersalesApproved','Disetujui Admin Aftersales',{ro:true,list:true}),
   F.s('paymentStatus','Status Pembayaran',['Menunggu Approval','Siap Dibayar','Dibayar'],{def:'Menunggu Approval',list:true,badge:true}),F.d('paymentDate','Tanggal Bayar'),F.fl('transferProof','Bukti Transfer')]}
};
function wireEntTitle(k){const orig=ENT[k].title;delete ENT[k].title;Object.defineProperty(ENT[k],'title',{enumerable:true,get:()=>t('ent.'+k)||orig});}
Object.keys(ENT).forEach(wireEntTitle);
/* Terjemahan label field & opsi select entitas generik (ENT.*, dipakai Crud - lihat js/admin.js).
   Sama seperti Order.statusLabel/apprStatusLabel dkk: label field & opsi select TIDAK BOLEH
   dihitung sekali saat modul di-load (ENT dibangun sekali di awal), harus live lewat t() setiap
   dipakai supaya ikut berganti saat bahasa aplikasi diganti (Form.render/Form.opts memang sudah
   membaca f.l/f.opts() fresh di setiap render - lihat js/ui.js - jadi getter di bawah ini cukup).
   Kunci fld.<entitas>.<field> / opt.<entitas>.<field>.<slug nilai> (lihat js/core.js I18N). Kalau
   kunci belum ada (belum diterjemahkan), tetap fallback ke teks Indonesia asli, tidak pernah
   menampilkan kunci mentah. */
function slug(v){return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');}
function wireFieldLabel(nsKey,f){
 const orig=f.l;
 Object.defineProperty(f,'l',{enumerable:true,configurable:true,get(){const key='fld.'+nsKey+'.'+f.k;return I18N.id[key]!==undefined?t(key):orig;}});
 if(f.hint){
  const origHint=f.hint;
  Object.defineProperty(f,'hint',{enumerable:true,configurable:true,get(){const key='hint.'+nsKey+'.'+f.k;return I18N.id[key]!==undefined?t(key):origHint;}});
 }
}
function wireFieldOpts(nsKey,f){
 if(f.t!=='select'||!Array.isArray(f.opts))return;
 const orig=f.opts;
 f.opts=()=>orig.map(o=>{
  const isObj=o&&typeof o==='object';const v=isObj?o.v:o,origLbl=isObj?o.l:o;
  const key='opt.'+nsKey+'.'+f.k+'.'+slug(v);
  return {v,l:I18N.id[key]!==undefined?t(key):origLbl};
 });
}
function wireEntFieldI18n(k){
 (ENT[k].fields||[]).forEach(f=>{
  wireFieldLabel(k,f);wireFieldOpts(k,f);
  if(f.t==='lines'&&Array.isArray(f.cols))f.cols.forEach(c=>wireFieldLabel(k+'.'+f.k,c));
 });
}
Object.keys(ENT).forEach(wireEntFieldI18n);
const MASTER=['customers','suppliers','products','categories','brands','warehouses','banks','taxes','payterms','deliveryterms','employees','departments','approvalLimits','numbering','uoms','vehicles','tools','office_assets','technicians','failcats','servicetypes'];
const canEnt=e=>e.wr?e.wr.includes(Auth.user?.roleId):can(e.page,'w');
const Scope={
 /* Dua pengecualian di luar aturan owner biasa:
    - customers: r.isPublic - kalau aktif, semua sales boleh lihat walau bukan Sales PIC-nya
      (lihat field isPublic di ENT.customers, schema.js).
    - site_visits: owner-nya salesId, tapi teknisi (scopeOwn:true juga) perlu lihat kunjungan
      yang di-assign ke dia lewat r.technicianId, bukan cuma yang dia jadi salesId-nya. */
 ok(k,r){const e=ENT[k];if(!Auth.role?.scopeOwn||!e||!e.owner)return true;if(k==='customers'&&r.isPublic)return true;if(k==='site_visits'&&r.technicianId===Auth.uid())return true;return r[e.owner]===Auth.uid()},
 rows(k){return DB.all(ENT[k].col).filter(r=>this.ok(k,r))}
};
const SEARCH=[
 {col:'customers',ent:'customers',page:'customers',label:'Customer',title:r=>r.name,sub:r=>r.pic},
 {col:'leads',ent:'leads',page:'leads',label:'Lead',title:r=>r.company||r.name,sub:r=>r.name},
 {col:'quotations',ent:'quotations',page:'quotations',label:'Quotation',title:r=>r.no,sub:r=>DB.get('customers',r.customerId)?.name},
 {col:'orders',ent:'orders',page:'orders',label:'New Order',title:r=>r.no,sub:r=>DB.get('customers',r.customerId)?.name},
 {col:'salesorders',ent:'salesorders',page:'salesorders',label:'Sales Order',title:r=>r.no,sub:r=>DB.get('customers',r.customerId)?.name},
 {col:'invoices',ent:'invoices',page:'invoices',label:'Invoice',title:r=>r.no,sub:r=>DB.get('customers',r.customerId)?.name},
 {col:'products',ent:'products',page:'products',label:'Produk',title:r=>r.name,sub:r=>r.sku},
 {col:'suppliers',ent:'suppliers',page:'suppliers',label:'Supplier',title:r=>r.name,sub:r=>r.pic}
];

/* ---------- Role & hak akses bawaan ---------- */
const ALLK=Object.keys(PAGES);
const G_CRM=['leads','site_visits','customers','followups','quotations','salesorders','orders','sales_list'];
const G_PUR=['pr','projects','sq','pc','po','suppliers','incoming'];
const G_INV=['products','stock_genset','stock_parts','gr','gi','transfer','opname','barcode'];
const G_FIN=['invoices','ar','si','ap','payreq','bank','petty','tax','recon','coa','journal'];
const G_ADM=['company_docs','leave'];
const G_RENT=['rent_units','rent_contracts','rent_schedule','hourmeter','overtime','deposit','rent_return'];
const G_SVC=['svc_req','survey','wo','tech_sched','install','pm','warranty','svc_report'];
const G_APR=['approvals_pending','approvals_done','approvals_rejected','approvals_history'];
const G_PTN=['partners','partners_map','partner_prospects','partner_evaluations','partner_payments'];
const permOf=(r,w=[])=>{const o={};r.forEach(k=>o[k]='r');w.forEach(k=>o[k]='w');return o};
const ROLE_SEED=[
 // 1. Direktur — akses penuh, approval final, kelola user/role/departemen, lock periode, tidak bisa hapus audit log (tidak ada UI hapus audit)
 {id:'director',name:'Direktur',seeCost:true,scopeOwn:false,perm:permOf(ALLK,[...G_APR,'orders','quotations','master','settings','leads','site_visits','customers','followups','suppliers','invoices','salesorders','users','coa','journal','knowledge',...G_ADM,...G_PTN])},
 // 2. Asisten Direktur — luas seperti Direktur, approve sesuai limit (bukan final sign-off), kelola user/role/departemen
 {id:'deputy_director',name:'Asisten Direktur',seeCost:true,scopeOwn:false,perm:permOf(ALLK.filter(k=>!['settings'].includes(k)),[...G_APR,'orders','quotations','master','leads','site_visits','customers','followups','suppliers','invoices','salesorders','users','knowledge',...G_PTN])},
 // 3. Finance, Accounting & Tax — gabungan finance+accounting+tax, tidak bisa approve final payment
 {id:'finance',name:'Finance, Accounting & Tax',seeCost:true,scopeOwn:false,perm:permOf(['dashboard','customers','quotations','salesorders','orders','followups','suppliers','po','products','stock_genset','stock_parts','reports','master','knowledge',...G_FIN,...G_APR,'rent_contracts','deposit','overtime',...G_PTN],[...G_FIN,'invoices','partner_payments'])},
 // 4. General Admin, HR & Sales Support — gabungan general admin + HR + sales support + eks-purchasing (tidak lihat cost/margin/tax/bank)
 {id:'admin_hr_sales',name:'General Admin, HR & Sales Support',seeCost:false,scopeOwn:false,perm:permOf(['dashboard',...G_CRM,...G_PUR,'products','stock_genset','stock_parts','invoices','ar','reports','master','users','knowledge',...G_APR,...G_RENT,...G_SVC,...G_ADM,...G_PTN],['customers','followups','quotations','salesorders','orders','invoices','leads',...G_SVC,...G_PUR,'master',...G_ADM,'partners','partner_prospects'])},
 // 5. Admin Aftersales — service request/WO/warranty/spare part/service report, tidak approve teknis/final biaya service
 {id:'admin_aftersales',name:'Admin Aftersales',seeCost:false,scopeOwn:false,perm:permOf(['dashboard','customers','products','stock_genset','stock_parts','reports','knowledge',...G_SVC,...G_APR,...G_PTN],['svc_req','survey','install','pm','svc_report','knowledge','partners','partners_map','partner_prospects','partner_evaluations','partner_payments'])},
 // 6. Admin Gudang — master produk/genset/spare part, barcode, stok, DO; tidak boleh ubah harga jual/beli, tidak approve stock adjust sendiri
 {id:'warehouse',name:'Admin Gudang',seeCost:false,scopeOwn:false,perm:permOf(['dashboard','orders','products','stock_genset','stock_parts','reports','master','svc_req','wo','knowledge',...G_INV,...G_APR,'partners','partners_map'],[...G_INV.filter(k=>k!=='products')])},
 // 7. Manager Teknisi — jadwal/penugasan teknisi, approve survey/diagnosa/kebutuhan part/laporan servis, tidak sentuh keuangan
 {id:'tech_manager',name:'Manager Teknisi',seeCost:false,scopeOwn:false,perm:permOf(['dashboard','products','stock_genset','stock_parts','reports','knowledge',...G_SVC,...G_APR,...G_PTN],[...G_SVC,'knowledge','partner_evaluations'])},
 // 8. Staff Teknisi — hanya tugas yang di-assign (scopeOwn)
 {id:'technician',name:'Staff Teknisi',seeCost:false,scopeOwn:true,perm:permOf(['dashboard','orders','site_visits','products','stock_genset','stock_parts','knowledge',...G_SVC,...G_APR],[...G_SVC,'site_visits','knowledge'])},
 // 9. Manager Sales — lihat seluruh tim sales, reassign lead/PIC, approve quotation/diskon sesuai limit, lihat margin
 {id:'sales_manager',name:'Manager Sales',seeCost:true,scopeOwn:false,perm:permOf(['dashboard',...G_CRM,'products','stock_genset','stock_parts','invoices','reports','master','knowledge',...G_APR,'partners','partners_map'],[...G_CRM])},
 // 10. Staff Sales — hanya lead/customer/quotation/order milik sendiri (scopeOwn)
 {id:'sales',name:'Staff Sales',seeCost:false,scopeOwn:true,perm:permOf(['dashboard','leads','site_visits','customers','followups','quotations','salesorders','orders','products','stock_genset','stock_parts','invoices','reports','knowledge',...G_APR,'partners','partners_map'],['leads','site_visits','customers','followups','quotations','orders'])}
];

/* ---------- Data contoh ---------- */
/* sd(): pilih teks contoh sesuai bahasa aktif SAAT data contoh dibuat (sekali saja, lihat Seed.needed()).
   Teks yang sudah dibuat tidak berubah retroaktif bila bahasa aplikasi diganti kemudian. */
const sd=(id,en,zh)=>({id,en,zh}[Lang.cur()]||id);
const Seed={
 needed(){return !Store.mem.roles||!Store.mem.roles.length},
 async run(){
  const ts=nowISO(),add=(col,arr)=>{Store.mem[col]=arr.map(o=>({createdAt:ts,createdBy:'seed',...o}))};
  Store.mem.settings={company:{name:sd('PT KENTFORD GROUP INDONESIA','Kentford Group Indonesia Inc.','肯特福德集团印尼有限公司'),address:sd('Jakarta, Indonesia','Jakarta, Indonesia','印度尼西亚雅加达'),phone:'',email:'',npwp:''},
   minMarginPct:10,maxDiscPct:5,lowMarginDirectorPct:5,quoteValidDays:14,defaultTaxPct:11,slaDays:3,
   rental:{minMonths:3,hoursPerMonth:280,depositMonths:2,prepayMonths:1}};
  Store.mem.counters={};
  add('roles',ROLE_SEED);
  const pw=async(name)=>{const salt=uid();return {salt,pw:await Auth.hash('kentford123',salt)}};
  // [id,username,name,roleId,jabatan,deptId,location,approverId(atasan),approvalLimit]
  const U=[
   ['u_dir','direktur','Hendra Kusuma','director','Direktur Utama','d1','Head Office Jakarta',null,0],
   ['u_wadir','wadirektur','Sri Wulandari','deputy_director','Asisten Direktur','d1','Head Office Jakarta','u_dir',250000000],
   ['u_fin','finance','Dewi Lestari','finance','Manager Finance, Accounting & Tax','d3','Head Office Jakarta','u_wadir',25000000],
   ['u_gas','genadmin','Ratna Sari','admin_hr_sales','Staff General Admin, HR & Sales Support','d4','Head Office Jakarta','u_wadir',0],
   ['u_aft','aftersales','Bagus Setiawan','admin_aftersales','Admin Aftersales','d5','Head Office Jakarta','u_tm',0],
   ['u_wh','gudang','Yusuf Hidayat','warehouse','Admin Gudang','d6','Cikarang DCP','u_wadir',0],
   ['u_tm','teknisimgr','Agus Salim','tech_manager','Manager Teknisi','d7','Head Office Jakarta','u_wadir',15000000],
   ['u_t1','teknisi1','Dimas Nugroho','technician','Staff Teknisi','d7','Jabodetabek','u_tm',0],
   ['u_sm','salesmgr','Maya Anggraini','sales_manager','Manager Sales','d2','Head Office Jakarta','u_wadir',100000000],
   ['u_s1','sales1','Rizky Pratama','sales','Staff Sales','d2','Head Office Jakarta','u_sm',0]];
  /* PENTING: koleksi `users` lokal di bawah ini TIDAK LAGI dipakai untuk login/autentikasi
     (lihat Auth di js/core.js — login sekarang selalu lewat backend kentford-erp-auth/, real
     akun ada di server, bukan di sini). Tetap di-seed sebagai DATA REFERENSI READ-ONLY supaya
     lookup non-auth yang sudah ada di codebase tetap jalan terhadap data contoh: nama sales/
     approver/teknisi pada order & customer contoh (userName(), DB.all('users').find(...) di
     berbagai file), filter user di reports/service, delegatesFor()/Notify.role() untuk approval
     data contoh, dsb (lihat grep `DB.all('users')`/`DB.get('users'` di seluruh js/*.js). Akun
     BARU yang dibuat lewat Admin > Users (backend) TIDAK otomatis muncul di koleksi lokal ini,
     jadi lookup2 tsb tidak akan "melihat" user baru itu — keterbatasan yang diketahui, di luar
     scope tugas ini (yang hanya memindahkan identitas login, bukan seluruh data bisnis). */
  const users=[];for(const [id,username,name,roleId,position,deptId,location,approverId,approvalLimit] of U)
   users.push({id,username,name,roleId,position,jabatan:position,deptId,location,approverId,approverId:approverId||'',approvalLimit:approvalLimit||0,delegateTo:'',status:'active',active:true,email:username+'@contoh.co.id',...await pw()});
  add('users',users);
  add('departments',[{id:'d1',name:'Direksi',head:'Hendra Kusuma'},{id:'d2',name:'Sales',head:'Maya Anggraini'},{id:'d3',name:'Finance, Accounting & Tax',head:'Dewi Lestari'},
   {id:'d4',name:'General Admin, HR & Sales Support',head:'Ratna Sari'},{id:'d5',name:'Aftersales',head:'Bagus Setiawan'},{id:'d6',name:'Gudang',head:'Yusuf Hidayat'},{id:'d7',name:'Teknik',head:'Agus Salim'}]);
  add('employees',U.map(([id,un,name,role,position,deptId],i)=>({id:'e'+i,name,position,deptId,userId:id,active:true})));
  add('technicians',[{id:'t1',userId:'u_t1',specialty:'Genset, panel ATS/AMF',area:'Jabodetabek'}]);
  add('warehouses',[{id:'w_ho',code:'HO',name:'Head Office',type:'Kantor'},{id:'w_ckr',code:'CKR',name:'Cikarang DCP',type:'Gudang',address:'Cikarang, Bekasi'},{id:'w_plt',code:'PLT',name:'Pluit Warehouse',type:'Gudang',address:'Pluit, Jakarta Utara'},
   {id:'w_site',code:'SITE',name:'Customer Site',type:'Customer Site'},{id:'w_tr',code:'TRN',name:'Sedang Dikirim',type:'Transit'},{id:'w_rent',code:'RNT',name:'Sedang Disewa',type:'Rental'},{id:'w_svc',code:'SVC',name:'Sedang Diservice',type:'Service'}]);
  add('categories',[{id:'k1',name:'Genset'},{id:'k2',name:'Spare Part'},{id:'k3',name:'Panel & Kontrol'},{id:'k4',name:'Material Instalasi'},{id:'k5',name:'Consumable'}]);
  add('brands',[{id:'b1',name:'Yuchai',origin:'China'},{id:'b2',name:'Cummins',origin:'Amerika Serikat'},{id:'b3',name:'Deep Sea (DSE)',origin:'Inggris'},{id:'b4',name:'Generik',origin:'-'}]);
  add('uoms',[{id:'m1',name:'unit'},{id:'m2',name:'pcs'},{id:'m3',name:'set'},{id:'m4',name:'meter'},{id:'m5',name:'liter'}]);
  add('payterms',[{id:'pt1',name:'DP 30% - Pelunasan sebelum kirim',dpPct:30,days:0},{id:'pt2',name:'DP 50% - Sisa 30 hari',dpPct:50,days:30},{id:'pt3',name:'Net 30',dpPct:0,days:30},{id:'pt4',name:'Tunai / Cash',dpPct:0,days:0}]);
  add('deliveryterms',[{id:'dt1',name:'Franco Jabodetabek',desc:'Termasuk pengiriman Jabodetabek'},{id:'dt2',name:'Ex-Warehouse',desc:'Diambil di gudang'},{id:'dt3',name:'Franco Luar Kota',desc:'Biaya kirim sesuai lokasi'}]);
  add('taxes',[{id:'x1',name:'PPN 11%',type:'PPN',rate:11,active:true},{id:'x2',name:'PPh 21',type:'PPh 21',rate:5,active:true},{id:'x3',name:'PPh 23 Jasa',type:'PPh 23',rate:2,active:true}]);
  add('banks',[{id:'bk1',name:'Operasional IDR',bank:'Bank Contoh A',accNo:'000-111-2222',currency:'IDR',openingBalance:750000000},{id:'bk2',name:'Petty Cash',bank:'Kas',accNo:'KAS-01',currency:'IDR',openingBalance:15000000}]);
  add('vehicles',[{id:'v1',plate:'B 9001 KFD',type:'Truk Engkel',driver:'Slamet',active:true},{id:'v2',plate:'B 9002 KFD',type:'Truk Fuso + Crane',driver:'Joko',active:true}]);
  add('failcats',[{id:'f1',name:'Sistem bahan bakar'},{id:'f2',name:'Sistem pendingin'},{id:'f3',name:'Sistem kelistrikan / AVR'},{id:'f4',name:'Controller / panel'},{id:'f5',name:'Engine mekanik'}]);
  add('servicetypes',[{id:'sv1',name:'Servis berkala'},{id:'sv2',name:'Perbaikan (corrective)'},{id:'sv3',name:'Instalasi'},{id:'sv4',name:'Survey lokasi'},{id:'sv5',name:'Warranty claim'}]);
  add('numbering',[['QUO','Quotation','QUO'],['ORD','New Order','ORD'],['SO','Sales Order','SO'],['INV','Customer Invoice','INV'],['APR','Approval','APR'],['DO','Delivery Order','DO'],['SJ','Surat Jalan','SJ'],['DR','Delivery Report','DR'],['CUS','Kode Customer','C','{P}-{N4}','tidak'],['SUP','Kode Supplier','S','{P}-{N4}','tidak'],['PR','Purchase Request','PR'],['PO','Purchase Order','PO'],
   ['SI','Supplier Invoice','SI'],['PQ','Payment Request','PQ'],['REC','Bank Reconciliation','REC'],['GR','Barang Masuk','GR'],['TR','Transfer Lokasi','TR'],['OP','Stock Opname','OP'],['RC','Kontrak Rental','RC'],['SR','Service Request','SR'],['SVR','Service Report','SVR'],['JRN','Journal Entry','JE']]
   .map(([type,name,prefix,format,reset],i)=>({id:'n'+i,type,name,prefix,format:format||'{P}/{YYYY}/{MM}/{N4}',reset:reset||'bulanan'})));
  const AL=[['quotation',1,'sales_manager',0],['quotation',2,'director',250000000],['ship_no_payment',1,'director',0],['stock_adjust',1,'deputy_director',0],['stock_adjust',2,'director',0],
   ['cancellation',1,'deputy_director',0],['cancellation',2,'director',50000000],['purchase_request',1,'deputy_director',0],['purchase_order',1,'deputy_director',0],['purchase_order',2,'director',50000000],
   ['payment_request',1,'deputy_director',0],['payment_request',2,'director',25000000],['petty_cash',1,'deputy_director',0],['refund',1,'deputy_director',0],['refund',2,'director',10000000],
   ['deposit_return',1,'finance',0],['deposit_return',2,'deputy_director',0],['warranty_free',1,'tech_manager',0]];
  add('approvalLimits',AL.map(([type,step,role,min],i)=>({id:'al'+i,type,step,role,min})));
  add('customers',[
   ['c1','C-0001',sd('PT Nusantara Data Center Indonesia','Nusantara Data Center Inc.','努桑塔拉数据中心公司'),'Data Center','Andi Pratama','Jakarta','u_s1','pt2',1500000000],
   ['c2','C-0002',sd('PT Cipta Digital Infrastruktur','Cipta Digital Infrastructure Inc.','西普塔数字基础设施公司'),'Data Center','Melisa Tan','Bekasi','u_s1','pt1',800000000],
   ['c3','C-0003',sd('PT Mega Manufaktur Sejahtera','Mega Manufacturing Sejahtera Inc.','美嘉制造繁荣有限公司'),'Manufaktur','Hadi Purnomo','Cikarang','u_s1','pt3',500000000],
   ['c4','C-0004',sd('RS Sehat Sentosa','Sehat Sentosa Hospital','塞哈特森托萨医院'),'Rumah Sakit','dr. Lina Marlina','Tangerang','u_s1','pt1',300000000],
   ['c5','C-0005',sd('PT Bangun Persada Konstruksi','Bangun Persada Construction Inc.','邦滚佩尔萨达建筑有限公司'),'Konstruksi','Ferry Gunawan','Jakarta','u_s1','pt4',200000000]]
   .map(([id,code,name,type,pic,city,salesId,paymentTermId,creditLimit])=>({id,code,name,type,pic,city,salesId,paymentTermId,creditLimit,phone:'0812-0000-'+code.slice(-4),email:'kontak@'+id+'.co.id',active:true,address:city})));
  Store.mem.counters['CUS-all']=5;
  add('suppliers',[{id:'s1',code:'S-0001',name:'Shenzhen Powerlink Trading Co., Ltd',pic:'Mr. Chen',country:sd('China','China','中国'),currency:'USD',paymentTermId:'pt2'},
   {id:'s2',code:'S-0002',name:sd('PT Sumber Filter Abadi','Sumber Filter Abadi Inc.','苏姆贝尔过滤器有限公司'),pic:sd('Ibu Wati','Mrs. Wati','Wati 女士'),country:sd('Indonesia','Indonesia','印度尼西亚'),currency:'IDR',paymentTermId:'pt3'},
   {id:'s3',code:'S-0003',name:sd('PT Kontrol Daya Nusantara','Kontrol Daya Nusantara Inc.','努桑塔拉动力控制有限公司'),pic:sd('Pak Rudi','Mr. Rudi','Rudi 先生'),country:sd('Indonesia','Indonesia','印度尼西亚'),currency:'IDR',paymentTermId:'pt3'}]);
  Store.mem.counters['SUP-all']=3;
  const P=(id,sku,name,kind,cat,brand,model,cap,uom,sup,cost,price,min,ser,war)=>({id,sku,name,kind,catId:cat,brandId:brand,model,capacity:cap,uom,supplierId:sup,lastCost:cost,price,minStock:min,serialTracked:ser,warranty:war,condition:'Baru',active:true,barcode:sku});
  add('products',[
   P('pg1','GS-YC-250',sd('Genset Yuchai 250 kW Silent 3 Phase','Yuchai 250 kW Silent Genset, 3-Phase','裕柴 250 kW 静音三相发电机组'),'Genset','k1','b1','Silent Canopy','250 kW / 312,5 kVA','unit','s1',425000000,520000000,1,true,12),
   P('pg2','GS-CM-500',sd('Genset Cummins 500 kVA Open Type','Cummins 500 kVA Open-Type Genset','康明斯 500 kVA 开放式发电机组'),'Genset','k1','b2','Open Type','500 kVA','unit','s1',690000000,820000000,1,true,12),
   P('pg3','GS-YC-500',sd('Genset Yuchai 500 kW Silent','Yuchai 500 kW Silent Genset','裕柴 500 kW 静音发电机组'),'Genset','k1','b1','Silent Canopy','500 kW / 625 kVA','unit','s1',880000000,1050000000,1,true,12),
   P('pr1','RN-CM-250',sd('Genset Cummins 250 kW (Unit Rental)','Cummins 250 kW Genset (Rental Unit)','康明斯 250 kW 发电机组（租赁设备）'),'Aset rental','k1','b2','Rental','250 kW','unit','s1',380000000,0,0,true,0),
   P('sp1','SP-FO-001',sd('Filter Oli Genset 250 kW','Oil Filter for 250 kW Genset','250 kW 发电机组机油滤芯'),'Spare part','k2','b4','','250 kW','pcs','s2',185000,260000,20,false,3),
   P('sp2','SP-FS-001',sd('Filter Solar Genset 250 kW','Fuel Filter for 250 kW Genset','250 kW 发电机组柴油滤芯'),'Spare part','k2','b4','','250 kW','pcs','s2',210000,295000,20,false,3),
   P('sp3','SP-FU-001',sd('Filter Udara Genset 250 kW','Air Filter for 250 kW Genset','250 kW 发电机组空气滤芯'),'Spare part','k2','b4','','250 kW','pcs','s2',320000,450000,10,false,3),
   P('sp4','SP-ACT-001',sd('Actuator Governor','Governor Actuator','调速器执行器'),'Spare part','k2','b4','','Universal','pcs','s3',3200000,4500000,3,false,6),
   P('sp5','SP-AVR-001',sd('AVR Alternator','Alternator AVR','交流发电机自动调压器（AVR）'),'Spare part','k2','b4','','Universal','pcs','s3',1400000,2100000,3,false,6),
   P('sp6','SP-CTL-001',sd('Controller Deep Sea 7320','Deep Sea 7320 Controller','Deep Sea 7320 控制器'),'Controller','k3','b3','7320','-','pcs','s3',6800000,9500000,2,true,12),
   P('pn1','PN-ATS-400',sd('Panel ATS 400A','ATS Panel 400A','ATS 自动切换配电柜 400A'),'Panel','k3','b4','ATS 400A','400 A','unit','s3',28000000,39000000,1,true,12),
   P('mt1','MT-KBL-95',sd('Kabel NYY 4x95 mm','NYY Cable 4x95 mm','NYY 电缆 4x95 mm'),'Kabel & material instalasi','k4','b4','NYY 4x95','-','meter','s2',420000,560000,100,false,0),
   P('cs1','CS-COOL-20',sd('Coolant Genset (20 L)','Genset Coolant (20 L)','发电机组冷却液（20升）'),'Consumable','k5','b4','','20 L','pcs','s2',380000,520000,10,false,0)]);
  const st=[['pg1','w_ckr',2],['pg1','w_plt',1],['pg2','w_ckr',1],['pg3','w_plt',1],['pr1','w_ckr',2],['sp1','w_ckr',40],['sp1','w_plt',25],['sp2','w_ckr',35],['sp2','w_plt',8],['sp3','w_ckr',6],['sp3','w_plt',3],
   ['sp4','w_ckr',4],['sp5','w_plt',2],['sp6','w_ckr',3],['pn1','w_plt',2],['mt1','w_ckr',200],['cs1','w_ckr',30]];
  add('stock',st.map(([productId,whId,qty],i)=>({id:'st'+i,productId,whId,qty})));
  add('stock_moves',st.map(([productId,whId,qty],i)=>({id:'sm'+i,productId,whId,delta:qty,type:'Saldo awal',ref:'',note:'Data awal',at:ts,by:'seed',byName:'Sistem'})));
  add('leads',[{id:'l1',name:'Bambang S.',company:sd('PT Digital Kreasi Sentra','Digital Kreasi Sentra Inc.','数字创意中心有限公司'),phone:'0813-1111-2222',source:'Website',need:'Pembelian',estValue:1100000000,salesId:'u_s1',status:'Kualifikasi',notes:sd('Butuh genset 500 kW untuk data center tier 3.','Needs a 500 kW genset for a tier 3 data center.','需要一台 500 kW 发电机组，用于三级数据中心。')},
   {id:'l2',name:sd('Ibu Carolina','Mrs. Carolina','Carolina 女士'),company:sd('Hotel Bintang Nusa','Bintang Nusa Hotel','宾丹努萨酒店'),phone:'0811-3333-4444',source:'Referral',need:'Rental',estValue:180000000,salesId:'u_s1',status:'Baru',notes:sd('Rental genset 250 kW 6 bulan.','Rents a 250 kW genset for 6 months.','租赁 250 kW 发电机组，为期6个月。')},
   {id:'l3',name:sd('Pak Darmawan','Mr. Darmawan','Darmawan 先生'),company:sd('PT Logistik Prima','Logistik Prima Inc.','洛吉斯蒂克普里马物流有限公司'),phone:'0812-5555-6666',source:'Pameran',need:'Spare part',estValue:45000000,salesId:'u_s1',status:'Dihubungi',notes:sd('Butuh AVR & controller.','Needs an AVR & controller.','需要自动调压器（AVR）和控制器。')}]);
  add('followups',[{id:'fu1',customerId:'c1',date:addDays(today(),1),type:'Meeting',salesId:'u_s1',status:'Terjadwal',notes:sd('Presentasi penawaran 2 unit genset.','Presentation of the offer for 2 genset units.','演示2台发电机组的报价方案。')},
   {id:'fu2',customerId:'c3',date:addDays(today(),-2),type:'Telepon',salesId:'u_s1',status:'Terjadwal',notes:sd('Tanya kelanjutan quotation spare part.','Follow up on the spare part quotation.','跟进备件报价单的进展。')},
   {id:'fu3',customerId:'c4',date:addDays(today(),-5),type:'Kunjungan',salesId:'u_s1',status:'Selesai',notes:sd('Survey kebutuhan awal, akan dibuat order.','Initial needs survey completed, an order will be created.','已完成初步需求调研，即将下单。')}]);
  add('quotations',[]);add('salesorders',[]);add('invoices',[]);add('orders',[]);add('approvals',[]);add('notifications',[]);add('comments',[]);add('audit',[]);
  // quotation & order contoh
  const cu=Auth.user;Auth.user={id:'u_s1',name:'Rizky Pratama',roleId:'sales'};
  const q1={id:'q1',no:'QUO/'+today().slice(0,4)+'/'+today().slice(5,7)+'/0001',baseNo:'QUO/'+today().slice(0,4)+'/'+today().slice(5,7)+'/0001',rev:0,customerId:'c1',picName:'Andi Pratama',salesId:'u_s1',date:today(),validUntil:addDays(today(),14),
   lines:[{productId:'pg1',desc:'Genset Yuchai 250 kW Silent 3 Phase',qty:2,cost:425000000,price:520000000,discPct:0}],taxPct:11,paymentTerms:'DP 50% - Sisa 30 hari',leadTime:'4 minggu',deliveryTerms:'Franco Jabodetabek',warranty:'12 bulan / 2.000 jam',notes:'Harga belum termasuk instalasi.',status:'Disetujui',orderId:'o2'};
  Quote.applyCalc(q1);add('quotations',[{...q1,createdAt:ts,createdBy:'u_s1'}]);
  Store.mem.counters['QUO-'+today().slice(0,4)+today().slice(5,7)]=1;
  add('orders',[
   {id:'o1',no:'ORD/'+today().slice(0,4)+'/'+today().slice(5,7)+'/0001',customerId:'c3',pic:'Hadi Purnomo',contact:'0812-0000-0003',items:[{productId:'sp1',desc:'Filter Oli Genset 250 kW',qty:10},{productId:'sp5',desc:'AVR Alternator',qty:2}],needType:'Spare part',capacity:'250 kW',engine:'Yuchai',alternator:'-',controller:'DSE',location:'Cikarang',purpose:'Penggantian berkala',targetDelivery:addDays(today(),7),installNeeded:false,notes:'Mohon kirim minggu depan.',files:[],salesId:'u_s1',stage:'review',statusText:'Dalam Review Sales Support',stageAt:ts,completed:['sales_input'],data:{},history:[{at:ts,by:'Rizky Pratama',stage:'sales_input',text:'Order dikirim ke Sales Support'}],createdAt:ts,createdBy:'u_s1'},
   {id:'o2',no:'ORD/'+today().slice(0,4)+'/'+today().slice(5,7)+'/0002',customerId:'c1',pic:'Andi Pratama',contact:'0812-0000-0001',items:[{productId:'pg1',desc:'Genset Yuchai 250 kW Silent 3 Phase',qty:2}],needType:'Pembelian',capacity:'250 kW',engine:'Yuchai',alternator:'Stamford',controller:'Deep Sea 7320',location:'Data center, Jakarta Barat',purpose:'Backup daya data center',targetDelivery:addDays(today(),30),installNeeded:true,notes:'Termasuk panel ATS.',files:[],salesId:'u_s1',stage:'finance',statusText:'Pemeriksaan Finance',stageAt:ts,completed:['sales_input','review','warehouse'],quotationId:'q1',
    data:{review:{result:'Bisa langsung dibuatkan quotation',notes:'Data lengkap.'},warehouse:{availability:'Stok sebagian tersedia',location:'w_ckr',condition:'Baru',needBuy:'1 unit tambahan dari supplier'}},history:[{at:ts,by:'Rizky Pratama',stage:'sales_input',text:'Order dikirim ke Sales Support'}],createdAt:ts,createdBy:'u_s1'}]);
  Store.mem.counters['ORD-'+today().slice(0,4)+today().slice(5,7)]=2;
  Auth.user=cu;
  Store.putAll();
 }
};
