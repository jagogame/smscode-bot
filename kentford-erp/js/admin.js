'use strict';
/* =========================================================
   KENTFORD ERP - CRUD generik, master data, user & akses,
   audit log, settings, approval, stok
   ========================================================= */
const Crud={
 disp(f,v){
  if(v==null||v==='')return '';
  switch(f.t){
   case 'ref':{const e=ENT[f.ref],r=DB.get(f.ref,v);return e&&r?e.label(r):'-'}
   case 'money':return rp(v);case 'percent':return pct(v);case 'date':return fdate(v);case 'number':return nf(v);
   case 'check':return v?'Ya':'Tidak';
   case 'select':{const o=Form.opts(f).find(x=>String(x.v)===String(v));return o?o.l:String(v)}
   case 'files':return (v||[]).length?(v.length+' file'):'';
   default:return String(v);
  }
 },
 cols(e){
  return e.fields.filter(f=>f.list).map(f=>({k:f.k,l:f.l,num:f.t==='money'||f.t==='number'||f.t==='percent',hide:f.cost?()=>!seeCost():null,
   text:r=>this.disp(f,r[f.k]),html:f.badge?r=>UI.badge(r[f.k]):null}));
 },
 fieldsFor(e){return e.fields.filter(f=>!(f.cost&&!seeCost()))},
 list(el,k,opts={}){
  const e=ENT[k],w=canEnt(e);let dt;
  const cols=this.cols(e);
  if(e.status||e.followup)cols.push({k:'_d',l:'',sort:false,html:r=>r.deletedAt?UI.badge('Diarsipkan'):''});
  const cfg={title:e.title,cols,size:15,
   rows:()=>(opts.rows?opts.rows():DB.col(e.col).filter(r=>Scope.ok(k,r)&&((dt&&dt.arch)||!r.deletedAt))).slice().reverse(),
   onRow:id=>this.open(k,id),
   toolbar:(w?`<button class="btn btn-sm" data-act="crud-new" data-e="${k}">+ ${esc(e.title)} baru</button>`:'')+(w?`<label class="chk mut" style="font-size:12px"><input type="checkbox" data-act="crud-arch" data-dt="__ID__"> Tampilkan arsip</label>`:''),
   filters:e.status?[{k:'status',l:'Status',opts:()=>Form.opts(e.fields.find(f=>f.k===e.status)).map(o=>o.v),get:r=>r[e.status]}]:[]};
  el.innerHTML='';
  dt=new DT(el,cfg);
  // sisipkan id DT ke checkbox arsip
  const cb=$('[data-act="crud-arch"]',el);if(cb)cb.dataset.dt=dt.id;
  const nb=$('[data-act="crud-new"]',el);if(nb)nb.dataset.dt=dt.id;
  dt.refresh=()=>dt.draw();
  return dt;
 },
 async open(k,id,pre){
  const e=ENT[k];
  if(e.custom){Router.go(e.page+'/'+id);return}
  const rec=id?DB.get(e.col,id):null;
  const canW=canEnt(e)&&!(rec&&rec.deletedAt);
  const fields=this.fieldsFor(e).map(f=>f.k===(e.autoCode||{}).k?{...f,ro:true}:f);
  const vals=rec?clone(rec):{...(pre||{})};
  const foot=`<button class="btn btn-o" data-x="c">Tutup</button>`+
   (rec?`<button class="btn btn-o" data-x="h">Riwayat</button>`:'')+
   (rec&&rec.deletedAt&&canEnt(e)?`<button class="btn btn-o" data-x="r">Pulihkan</button>`:'')+
   (rec&&canW?`<button class="btn btn-d" data-x="d">Hapus</button>`:'')+
   (canW?`<button class="btn" data-x="s">Simpan</button>`:'');
  const m=UI.modal({title:(rec?'Detail ':'Tambah ')+e.title,wide:true,body:Form.render(fields,vals,!canW)+(k==='leads'&&rec?`<p style="margin-top:12px"><button class="btn btn-o btn-sm" data-x="conv">Konversi ke Customer</button></p>`:'')+(rec&&rec.deletedAt?'<div class="warnbox" style="margin-top:10px">Data ini diarsipkan (soft delete).</div>':''),foot});
  Form.hydrate(m.body,fields,vals);
  m.el.addEventListener('click',async ev=>{
   const b=ev.target.closest('[data-x]');if(!b)return;const x=b.dataset.x;
   if(x==='c'){m.close();return}
   if(x==='h'){UI.modal({title:'Riwayat perubahan',wide:true,body:Crud.history(e.col,id)});return}
   if(x==='r'){DB.restore(e.col,id);m.close();UI.toast('Data dipulihkan.');Crud.refresh();return}
   if(x==='conv'){m.close();Crud.convertLead(rec);return}
   if(x==='d'){
    const r=await UI.confirm({title:'Hapus data',msg:`Arsipkan <b>${esc(e.label(rec))}</b>? Data tidak dihapus permanen dan dapat dipulihkan.`,reason:true,ok:'Ya, hapus',danger:true});
    if(!r)return;DB.remove(e.col,id,r.reason);m.close();UI.toast('Data diarsipkan.');Crud.refresh();return;
   }
   if(x==='s'){
    const {v,err}=Form.collect(m.body,fields);
    if(err.length)return UI.toast(err[0],'err');
    try{
     if(e.autoCode&&!rec)v[e.autoCode.k]=Num.next(e.autoCode.type);
     if(e.autoCode&&rec)delete v[e.autoCode.k];
     if(k==='products'&&!v.barcode)v.barcode=v.sku;
     if(k==='products'&&DB.all('products').some(p=>p.sku===v.sku&&p.id!==id))throw new Error('SKU sudah dipakai produk lain.');
     if(k==='approvalLimits'&&num(v.step)<1)throw new Error('Urutan langkah minimal 1.');
     if(rec){DB.update(e.col,id,v,'')}else{DB.insert(e.col,v)}
     m.close();UI.toast('Data tersimpan.');Crud.refresh();
    }catch(er){UI.toast(er.message,'err')}
   }
  });
 },
 refresh(){const t=Object.values(DT.inst).filter(d=>document.body.contains(d.el)).pop();if(t)t.draw();App.refreshBell()},
 history(col,id){
  const a=DB.col('audit').filter(x=>x.col===col&&x.ref===id).reverse();
  if(!a.length)return '<div class="empty">Belum ada riwayat.</div>';
  return `<div class="tblw"><table><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Sebelum → Sesudah</th></tr>${a.map(x=>`<tr><td class="nowrap">${fdt(x.at)}</td><td>${esc(x.userName)}</td><td>${esc(x.action)}${x.reason?'<br><small class="mut">'+esc(x.reason)+'</small>':''}</td><td>${Crud.diff(x)}</td></tr>`).join('')}</table></div>`;
 },
 diff(x){
  if(!x.after&&!x.before)return '-';
  if(x.action==='Buat')return '<small class="mut">Data baru dibuat</small>';
  const keys=Object.keys(x.after||{});
  return keys.slice(0,8).map(k=>`<div><small><b>${esc(k)}</b>: ${esc(JSON.stringify(x.before?.[k])?.slice(0,60)??'')} → ${esc(JSON.stringify(x.after[k])?.slice(0,60)??'')}</small></div>`).join('')||'-';
 },
 async convertLead(l){
  const ok=await UI.confirm({title:'Konversi lead',msg:`Buat customer baru dari lead <b>${esc(l.company||l.name)}</b>?`});
  if(!ok)return;
  const c=DB.insert('customers',{code:Num.next('CUS'),name:l.company||l.name,pic:l.name,phone:l.phone,email:l.email,salesId:l.salesId,active:true,notes:'Dari lead. '+(l.notes||'')});
  DB.update('leads',l.id,{status:'Menang',customerId:c.id},'Konversi ke customer','Konversi');
  UI.toast('Customer dibuat: '+c.name);Router.go('customers/'+c.id);
 }
};
ACT['crud-new']=el=>{const k=el.dataset.e;Crud.open(k,null,el.dataset.pre?JSON.parse(el.dataset.pre):null)};
ACT['crud-arch']=el=>{const d=DT.inst[el.dataset.dt];d.arch=el.checked;d.draw()};

/* halaman entitas generik */
function crudPage(key,title){
 PAGES[key].render=async(v,param)=>{
  const e=ENT[key];
  v.innerHTML=UI.pghead(title||PAGES[key].label)+'<div class="card" id="crudbox"></div>';
  Crud.list($('#crudbox'),key);
  if(param)Crud.open(key,param);
 };
}
crudPage('leads');crudPage('customers');crudPage('followups');crudPage('suppliers');

/* follow-up: status terlambat diturunkan dari tanggal */
ENT.followups.fields.find(f=>f.k==='status').badge=true;

/* ---------------- Produk & stok ---------------- */
PAGES.products.render=async(v,param)=>{
 v.innerHTML=UI.pghead('Daftar Produk')+'<div class="card" id="crudbox"></div>';
 const e=ENT.products,dt=Crud.list($('#crudbox'),'products');
 dt.cfg.cols.splice(3,0,{k:'_stock',l:'Stok total',num:true,text:r=>String(Stock.qty(r.id)),sortv:r=>Stock.qty(r.id)});
 dt.cfg.filters=[{k:'kind',l:'Jenis',opts:()=>Form.opts(e.fields.find(f=>f.k==='kind')).map(o=>o.v),get:r=>r.kind}];
 dt.init();const cb=$('[data-act="crud-arch"]',dt.el);if(cb)cb.dataset.dt=dt.id;const nb=$('[data-act="crud-new"]',dt.el);if(nb)nb.dataset.dt=dt.id;
 if(param)Crud.open('products',param);
};
function stockPage(key,title,kinds){
 PAGES[key].render=async v=>{
  const canAdj=can('gi','w')||isRole('manager','warehouse');
  v.innerHTML=UI.pghead(title,(canAdj?`<button class="btn" data-act="stock-adjust">Penyesuaian stok</button>`:'')+(can('pr','w')?`<button class="btn btn-o" data-act="pr-from-lowstock">Buat PR dari stok menipis</button>`:''))+'<div class="card" id="stk"></div><div class="card"><h3>Riwayat pergerakan stok</h3><div id="mv"></div></div>';
  const whs=DB.all('warehouses');
  new DT($('#stk'),{title,size:20,
   rows:()=>DB.all('products').filter(p=>kinds.includes(p.kind)),
   filters:[{k:'kind',l:'Jenis',opts:()=>kinds,get:r=>r.kind}],
   cols:[{k:'sku',l:'SKU'},{k:'name',l:'Produk'},{k:'kind',l:'Jenis'},{k:'model',l:'Model'},
    ...whs.filter(w=>DB.all('stock').some(s=>s.whId===w.id)||['w_ho','w_ckr','w_plt'].includes(w.id)).map(w=>({k:'w'+w.id,l:w.code,num:true,text:r=>String(Stock.qty(r.id,w.id)),sortv:r=>Stock.qty(r.id,w.id)})),
    {k:'total',l:'Total',num:true,text:r=>String(Stock.qty(r.id)),sortv:r=>Stock.qty(r.id)},{k:'min',l:'Min.',num:true,text:r=>String(num(r.minStock))},
    {k:'st',l:'Status',text:r=>Stock.qty(r.id)<=0?'Habis':Stock.qty(r.id)<=num(r.minStock)&&num(r.minStock)>0?'Stok menipis':'Aman',html:r=>{const q=Stock.qty(r.id),m=num(r.minStock);return q<=0?UI.badge('Stok habis'):(m>0&&q<=m)?UI.badge('Perlu order (menipis)'):UI.badge('Tersedia')}},
    {k:'val',l:'Nilai (harga beli)',num:true,hide:()=>!seeCost(),text:r=>rp(Stock.qty(r.id)*num(r.lastCost)),sortv:r=>Stock.qty(r.id)*num(r.lastCost)}],
   onRow:id=>Router.go('products/'+id)});
  const mvRows=()=>DB.all('stock_moves').slice().reverse().filter(m=>{const p=DB.get('products',m.productId);return p&&kinds.includes(p.kind)});
  new DT($('#mv'),{title:'Pergerakan stok',size:10,rows:mvRows,cols:[{k:'at',l:'Waktu',text:r=>fdt(r.at),sortv:r=>r.at},{k:'p',l:'Produk',text:r=>DB.get('products',r.productId)?.name},{k:'w',l:'Lokasi',text:r=>DB.get('warehouses',r.whId)?.name},
   {k:'type',l:'Jenis'},{k:'delta',l:'Perubahan',num:true,text:r=>(r.delta>0?'+':'')+r.delta},{k:'ref',l:'Referensi'},{k:'note',l:'Catatan'},{k:'byName',l:'Oleh'}]});
 };
}
stockPage('stock_genset','Stok Genset',['Genset','Engine','Alternator','Aset rental']);
stockPage('stock_parts','Stok Spare Part & Material',['Spare part','Controller','Panel','Kabel & material instalasi','Consumable']);
ACT['stock-adjust']=async()=>{
 const v=await UI.ask({title:'Penyesuaian stok (memerlukan approval)',ok:'Ajukan approval',fields:[
  F.r('productId','Produk','products',{req:true}),F.r('whId','Lokasi','warehouses',{req:true,filter:w=>['Gudang','Kantor'].includes(w.type)}),F.n('newQty','Jumlah stok yang benar',{req:true}),
  F.ta('reason','Alasan penyesuaian',{req:true}),F.fl('files','Lampiran (opsional)')]});
 if(!v)return;
 if(v.newQty<0)return UI.toast('Jumlah stok tidak boleh negatif.','err');
 const p=DB.get('products',v.productId),cur=Stock.qty(v.productId,v.whId);
 const a=Approval.request({type:'stock_adjust',refCol:'products',refId:v.productId,title:`Penyesuaian stok ${p.name}: ${cur} → ${v.newQty}`,amount:Math.abs(v.newQty-cur)*num(p.lastCost),reason:v.reason,files:v.files,meta:{whId:v.whId,newQty:v.newQty}});
 UI.toast('Pengajuan dikirim: '+a.no);
};
Approval.hooks.stock_adjust={
 approved(a){const cur=Stock.qty(a.refId,a.meta.whId);const d=num(a.meta.newQty)-cur;if(d)Stock.change(a.refId,a.meta.whId,d,'Penyesuaian',a.no,a.reason)},
 rejected(){}
};

/* ---------------- Master Data ---------------- */
PAGES.master.render=async(v,param)=>{
 const key=MASTER.includes(param.split('/')[0])?param.split('/')[0]:'customers';
 v.innerHTML=UI.pghead('Master Data')+`<div class="tabs">${MASTER.map(k=>`<a href="#/master/${k}" class="${k===key?'on':''}">${esc(ENT[k].title)}</a>`).join('')}</div><div class="card" id="crudbox"></div>`;
 const dt=Crud.list($('#crudbox'),key);
 if(key==='products'){dt.cfg.filters=[];dt.init();}
};

/* ---------------- User & Access ---------------- */
PAGES.users.render=async(v,param)=>{
 const tab=param==='akses'?'akses':'user';
 v.innerHTML=UI.pghead('User & Access')+`<div class="tabs"><a href="#/users" class="${tab==='user'?'on':''}">Pengguna</a><a href="#/users/akses" class="${tab==='akses'?'on':''}">Hak Akses Role</a></div><div id="ub"></div>`;
 tab==='user'?Users.render($('#ub')):Users.roles($('#ub'));
};
const Users={
 fields(rec){
  return [F.t('name','Nama lengkap',{req:true}),F.t('username','Username',{req:true,hint:'Huruf kecil tanpa spasi'}),F.t('email','Email',{t:'email'}),
   F.s('roleId','Role',()=>DB.all('roles').map(r=>({v:r.id,l:r.name})),{req:true}),F.r('deptId','Departemen','departments'),F.t('phone','Telepon',{t:'phone'}),
   {k:'password',l:rec?'Password baru (kosongkan bila tidak diubah)':'Password (min. 6 karakter)',t:'password',req:!rec,auto:true},F.c('active','Akun aktif',{def:true})];
 },
 render(el){
  const w=can('users','w');
  el.innerHTML='<div class="card" id="ul"></div>';
  new DT($('#ul'),{title:'Pengguna',rows:()=>DB.all('users'),onRow:id=>w&&Users.edit(id),
   toolbar:w?'<button class="btn btn-sm" data-act="user-new">+ Pengguna baru</button>':'',
   filters:[{k:'role',l:'Role',opts:()=>DB.all('roles').map(r=>r.name),get:r=>DB.get('roles',r.roleId)?.name}],
   cols:[{k:'name',l:'Nama'},{k:'username',l:'Username'},{k:'role',l:'Role',text:r=>DB.get('roles',r.roleId)?.name},{k:'email',l:'Email'},{k:'active',l:'Status',text:r=>r.active===false?'Nonaktif':'Aktif',html:r=>UI.badge(r.active===false?'Nonaktif':'Aktif')}]});
 },
 async edit(id){
  const rec=id?DB.get('users',id):null,fields=this.fields(rec);
  const v=await UI.ask({title:rec?'Ubah pengguna':'Pengguna baru',fields,vals:rec||{active:true},wide:true});
  if(!v)return;
  v.username=v.username.toLowerCase().replace(/\s+/g,'');
  if(!/^[a-z0-9._-]{3,}$/.test(v.username))return UI.toast('Username minimal 3 karakter (huruf kecil, angka, titik, strip).','err');
  if(DB.all('users').some(u=>u.username===v.username&&u.id!==id))return UI.toast('Username sudah dipakai.','err');
  if(v.password&&v.password.length<6)return UI.toast('Password minimal 6 karakter.','err');
  if(rec&&id===Auth.user.id&&(v.active===false||v.roleId!==rec.roleId))return UI.toast('Anda tidak dapat menonaktifkan / mengganti role akun sendiri.','err');
  const pw=v.password;delete v.password;
  if(rec)DB.update('users',id,v,'','Ubah pengguna');else{const u=DB.insert('users',{...v});id=u.id}
  if(pw)await Auth.setPassword(id,pw);
  UI.toast('Pengguna tersimpan.');Router.render();
 },
 roles(el){
  const w=can('users','w'),roles=DB.all('roles'),pages=Object.keys(PAGES).filter(k=>PAGES[k].render||true);
  const sel=(r,k)=>`<select data-rp="${r.id}|${k}" ${w?'':'disabled'} style="min-width:64px"><option value="" ${!r.perm[k]?'selected':''}>—</option><option value="r" ${r.perm[k]==='r'?'selected':''}>Lihat</option><option value="w" ${r.perm[k]==='w'?'selected':''}>Ubah</option></select>`;
  el.innerHTML=`<div class="card"><div class="ch">Hak akses per role <span>${w?'<button class="btn btn-sm" data-act="roles-save">Simpan perubahan</button>':''}</span></div>
   <p class="mut">Atur akses tiap menu: <b>—</b> tidak tampil, <b>Lihat</b> hanya baca, <b>Ubah</b> boleh membuat/mengubah. Hak Ubah pada master data juga dibatasi per dataset. Perubahan berlaku pada login berikutnya.</p>
   <div class="tblw"><table><thead><tr><th>Menu</th>${roles.map(r=>`<th>${esc(r.name)}</th>`).join('')}</tr></thead><tbody>
   <tr><td><b>Lihat harga beli & margin</b></td>${roles.map(r=>`<td><input type="checkbox" data-rf="${r.id}|seeCost" ${r.seeCost?'checked':''} ${w?'':'disabled'}></td>`).join('')}</tr>
   <tr><td><b>Hanya data milik sendiri</b></td>${roles.map(r=>`<td><input type="checkbox" data-rf="${r.id}|scopeOwn" ${r.scopeOwn?'checked':''} ${w?'':'disabled'}></td>`).join('')}</tr>
   ${pages.map(k=>`<tr><td>${esc(PAGES[k].label)}${PAGES[k].render?'':' <small class="mut">(Tahap '+PAGES[k].stage+')</small>'}</td>${roles.map(r=>`<td>${sel(r,k)}</td>`).join('')}</tr>`).join('')}
   </tbody></table></div></div>`;
 }
};
ACT['user-new']=()=>Users.edit(null);
ACT['roles-save']=()=>{
 const roles=DB.all('roles');
 roles.forEach(r=>{
  const perm={};let changed=false;
  $$(`[data-rp^="${r.id}|"]`).forEach(s=>{const k=s.dataset.rp.split('|')[1];if(s.value)perm[k]=s.value});
  const sc=$(`[data-rf="${r.id}|scopeOwn"]`).checked,sk=$(`[data-rf="${r.id}|seeCost"]`).checked;
  if(JSON.stringify(perm)!==JSON.stringify(r.perm)||sc!==!!r.scopeOwn||sk!==!!r.seeCost)DB.update('roles',r.id,{perm,scopeOwn:sc,seeCost:sk},'Perubahan hak akses','Ubah hak akses');
 });
 Auth.set(DB.get('users',Auth.user.id));App.nav();UI.toast('Hak akses tersimpan.');
};

/* ---------------- Audit log ---------------- */
PAGES.audit.render=async v=>{
 v.innerHTML=UI.pghead('Audit Log')+'<div class="card" id="al"></div>';
 new DT($('#al'),{title:'Audit Log',size:20,rows:()=>DB.col('audit').slice().reverse(),
  filters:[{k:'u',l:'Pengguna',opts:()=>DB.all('users').map(u=>u.name),get:r=>r.userName},{k:'a',l:'Aksi',opts:()=>[...new Set(DB.col('audit').map(a=>a.action.split(':')[0]))],get:r=>r.action.split(':')[0]},{k:'c',l:'Data',opts:()=>[...new Set(DB.col('audit').map(a=>a.col))],get:r=>r.col}],
  onRow:id=>{const a=DB.get('audit',id);UI.modal({title:'Detail audit',wide:true,body:UI.kv([['Waktu',fdt(a.at)],['Pengguna',esc(a.userName)+' ('+esc(a.roleId)+')'],['Aksi',esc(a.action)],['Data',esc(a.col)+' / '+esc(a.label)],['Alasan',esc(a.reason||'-')],['Sesi',esc(a.session||'-')]])+
   `<h3 style="margin-top:12px">Sebelum</h3><pre style="white-space:pre-wrap;overflow:auto">${esc(JSON.stringify(a.before,null,1)||'-')}</pre><h3>Sesudah</h3><pre style="white-space:pre-wrap;overflow:auto">${esc(JSON.stringify(a.after,null,1)||'-')}</pre>`})},
  cols:[{k:'at',l:'Waktu',text:r=>fdt(r.at),sortv:r=>r.at},{k:'userName',l:'Pengguna'},{k:'action',l:'Aksi'},{k:'col',l:'Data'},{k:'label',l:'Referensi'},{k:'reason',l:'Alasan'}]});
};

/* ---------------- Settings ---------------- */
PAGES.settings.render=async v=>{
 const s=S(),w=can('settings','w');
 const fCo=[F.t('name','Nama perusahaan',{req:true}),F.t('phone','Telepon',{t:'phone'}),F.t('email','Email',{t:'email'}),F.t('npwp','NPWP'),F.ta('address','Alamat')];
 const fRule=[F.pc('minMarginPct','Margin minimum tanpa approval (%)',{hint:'Quotation di bawah nilai ini butuh approval'}),F.pc('lowMarginDirectorPct','Margin di bawah (%) wajib disetujui Director'),F.pc('maxDiscPct','Diskon maksimum tanpa approval (%)'),
  F.n('quoteValidDays','Masa berlaku quotation (hari)'),F.pc('defaultTaxPct','PPN default (%)'),F.n('slaDays','Batas waktu per tahap New Order (hari)')];
 const fRent=[F.n('minMonths','Minimal rental (bulan)'),F.n('hoursPerMonth','Batas pemakaian (jam / bulan)'),F.n('depositMonths','Deposit (bulan)'),F.n('prepayMonths','Pembayaran di muka (bulan)')];
 v.innerHTML=UI.pghead('Settings')+`<div class="grid g2"><div class="card"><h3>Profil perusahaan</h3><div id="sc">${Form.render(fCo,s.company||{},!w)}</div></div>
  <div class="card"><h3>Aturan bisnis</h3><div id="sr">${Form.render(fRule,s,!w)}</div></div>
  <div class="card"><h3>Default rental (dipakai di Tahap 5)</h3><div id="sn">${Form.render(fRent,s.rental||{},!w)}</div></div>
  <div class="card"><h3>Backup & pemulihan data</h3><p class="mut">Ekspor seluruh data ERP ke satu file JSON, atau pulihkan dari file backup. Lampiran file tidak ikut diekspor.</p>
   <div class="acts"><button class="btn btn-o" data-act="backup">Unduh backup (JSON)</button>${w?'<label class="btn btn-o">Pulihkan dari file<input type="file" accept=".json" id="restore" style="display:none"></label><button class="btn btn-d" data-act="reset-demo">Reset ke data contoh</button>':''}</div>
   <p class="mut" style="margin-top:8px">Penyimpanan: <b>${Store.mode==='idb'?'IndexedDB (permanen)':Store.mode==='ls'?'localStorage':'memori (tidak permanen)'}</b></p></div></div>
  ${w?'<div class="acts"><button class="btn" data-act="settings-save">Simpan pengaturan</button></div>':''}`;
 const fr=$('#restore');if(fr)fr.addEventListener('change',()=>restoreFile(fr.files[0]));
 Settings.f={fCo,fRule,fRent};
};
const Settings={f:null};
ACT['settings-save']=()=>{
 const {fCo,fRule,fRent}=Settings.f,a=Form.collect($('#sc'),fCo),b=Form.collect($('#sr'),fRule),c=Form.collect($('#sn'),fRent);
 const err=[...a.err,...b.err,...c.err];if(err.length)return UI.toast(err[0],'err');
 const before=clone(S());Object.assign(S(),b.v);S().company=a.v;S().rental=c.v;saveSettings();
 Audit.log('Ubah pengaturan','settings','main',before,clone(S()),'');UI.toast('Pengaturan tersimpan.');
};
ACT['backup']=()=>{const o={};Object.keys(Store.mem).forEach(k=>o[k]=Store.mem[k]);Export.json(`kentford-erp-backup-${today()}.json`,{app:'KENTFORD ERP',at:nowISO(),data:o})};
async function restoreFile(f){
 if(!f)return;
 try{
  const j=JSON.parse(await f.text());if(!j.data||!j.data.roles)throw new Error('Format file backup tidak dikenali.');
  const r=await UI.confirm({title:'Pulihkan data',msg:'Semua data saat ini akan DITIMPA oleh isi file backup. Lanjutkan?',ok:'Ya, timpa data',danger:true});if(!r)return;
  await Store.clearAll();Store.mem=j.data;Store.putAll();Auth.logout();UI.toast('Data dipulihkan. Silakan login kembali.');setTimeout(()=>location.reload(),800);
 }catch(e){UI.toast('Gagal memulihkan: '+e.message,'err')}
}
ACT['reset-demo']=async()=>{
 const r=await UI.confirm({title:'Reset data',msg:'Seluruh data akan dihapus dan diganti dengan data contoh. Tindakan ini tidak dapat dibatalkan.',ok:'Ya, reset',danger:true});if(!r)return;
 await Store.clearAll();Auth.logout();location.reload();
};

/* ---------------- Approval ---------------- */
function pendingApprovalsForMe(){return DB.all('approvals').filter(a=>Approval.canDecide(a))}
function approvalVisible(a){
 if(isRole('president_director','manager'))return true;
 return a.requesterId===Auth.uid()||a.steps.some(s=>s.role===Auth.user.roleId);
}
const APPR_LINK={quotations:'quotations',orders:'orders',products:'products',salesorders:'salesorders',invoices:'invoices'};
function approvalPage(key,title,filter){
 PAGES[key].render=async v=>{
  v.innerHTML=UI.pghead(title)+'<div class="card" id="ap"></div>';
  new DT($('#ap'),{title,rows:()=>DB.all('approvals').filter(approvalVisible).filter(filter).slice().reverse(),onRow:id=>Appr.open(id),
   filters:[{k:'t',l:'Jenis',opts:()=>Object.values(APPR_TYPES),get:r=>APPR_TYPES[r.type]},{k:'s',l:'Status',opts:()=>['Menunggu','Disetujui','Ditolak'],get:r=>r.status}],
   cols:[{k:'no',l:'No.'},{k:'createdAt',l:'Diajukan',text:r=>fdate(r.createdAt),sortv:r=>r.createdAt},{k:'t',l:'Jenis',text:r=>APPR_TYPES[r.type]},{k:'title',l:'Perihal'},{k:'amount',l:'Nominal',num:true,text:r=>r.amount?rp(r.amount):'-',sortv:r=>r.amount},
    {k:'requesterName',l:'Pengaju'},{k:'st',l:'Status',text:r=>r.status,html:r=>UI.badge(r.status)+(Approval.cur(r)?`<br><small class="mut">→ ${esc(DB.get('roles',Approval.cur(r).role)?.name||'')}</small>`:'')}]});
 };
}
approvalPage('approvals_pending','Menunggu Persetujuan',a=>a.status==='Menunggu');
approvalPage('approvals_done','Disetujui',a=>a.status==='Disetujui');
approvalPage('approvals_rejected','Ditolak',a=>a.status==='Ditolak');
approvalPage('approvals_history','Riwayat Approval',()=>true);
const Appr={
 open(id){
  const a=DB.get('approvals',id),canD=Approval.canDecide(a);
  const link=a.refCol&&a.refId&&APPR_LINK[a.refCol]?`<a href="#/${APPR_LINK[a.refCol]}/${a.refId}" data-x="go">Lihat dokumen terkait</a>`:'';
  const m=UI.modal({title:`${a.no} — ${APPR_TYPES[a.type]||a.type}`,wide:true,body:
   UI.kv([['Perihal',esc(a.title)],['Pengaju',esc(a.requesterName)],['Tanggal pengajuan',fdt(a.createdAt)],['Nominal',a.amount?rp(a.amount):'-'],['Alasan',esc(a.reason||'-')],['Status',UI.badge(a.status)],['Terkait',link||'-'],['Lampiran','<div class="files" data-files="f" data-ro="1"></div>']])+
   `<h3 style="margin:14px 0 6px">Alur persetujuan</h3><div class="tblw"><table><tr><th>#</th><th>Approver (role)</th><th>Keputusan</th><th>Oleh</th><th>Tanggal</th><th>Catatan</th></tr>${a.steps.map((s,i)=>`<tr><td>${i+1}</td><td>${esc(DB.get('roles',s.role)?.name||s.role)}</td><td>${UI.badge(a.status==='Menunggu'&&i===a.idx?'Menunggu':s.status)}</td><td>${esc(s.byName||'-')}</td><td>${s.at?fdt(s.at):'-'}</td><td>${esc(s.note||'')}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">Disetujui otomatis (tanpa langkah).</td></tr>'}</table></div>`,
   foot:`<button class="btn btn-o" data-x="c">Tutup</button>${canD?'<button class="btn btn-d" data-x="no">Tolak</button><button class="btn" data-x="ok">Setujui</button>':''}`});
  const fw=$('[data-files="f"]',m.body);fw._files=a.files||[];Files.render(fw);
  m.el.addEventListener('click',async e=>{
   const b=e.target.closest('[data-x]');if(!b)return;const x=b.dataset.x;
   if(x==='c'||x==='go'){m.close();return}
   const r=await UI.ask({title:x==='ok'?'Setujui pengajuan':'Tolak pengajuan',ok:x==='ok'?'Setujui':'Tolak',danger:x==='no',fields:[F.ta('note','Catatan'+(x==='no'?' (wajib)':''),{req:x==='no'})]});
   if(!r)return;
   try{Approval.decide(id,x==='ok',r.note);m.close();UI.toast(x==='ok'?'Pengajuan disetujui.':'Pengajuan ditolak.');Router.render();App.refreshBell()}catch(er){UI.toast(er.message,'err')}
  });
 }
};

/* ---------------- Account Receivable ---------------- */
PAGES.ar.render=async v=>{
 v.innerHTML=UI.pghead('Account Receivable')+'<div class="card" id="arb"></div>';
 const rows=()=>DB.all('invoices').filter(i=>Scope.ok('invoices',i)&&Inv.outstanding(i)>0&&Inv.status(i)!=='Dibatalkan');
 new DT($('#arb'),{title:'Account Receivable',rows,onRow:id=>Router.go('invoices/'+id),size:20,
  filters:[{k:'c',l:'Customer',opts:()=>DB.all('customers').map(c=>c.name),get:r=>DB.get('customers',r.customerId)?.name}],
  cols:[{k:'no',l:'Invoice'},{k:'c',l:'Customer',text:r=>DB.get('customers',r.customerId)?.name},{k:'dueDate',l:'Jatuh tempo',text:r=>fdate(r.dueDate),sortv:r=>r.dueDate},
   {k:'total',l:'Total',num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'out',l:'Sisa tagihan',num:true,text:r=>rp(Inv.outstanding(r)),sortv:r=>Inv.outstanding(r)},
   {k:'age',l:'Umur (hari lewat)',num:true,text:r=>String(Math.max(0,daysBetween(r.dueDate,today()))),sortv:r=>daysBetween(r.dueDate,today())},
   {k:'b',l:'Aging',text:r=>Inv.aging(r)},{k:'st',l:'Status',text:r=>Inv.status(r),html:r=>UI.badge(Inv.status(r))}]});
};
