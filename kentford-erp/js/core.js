'use strict';
/* =========================================================
   KENTFORD ERP - core: util, penyimpanan (IndexedDB), audit,
   penomoran, autentikasi/RBAC, notifikasi, approval, stok
   ========================================================= */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=(n,l=2)=>String(n).padStart(l,'0');
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=()=>ymd(new Date());
const pd=s=>!s?null:(/^\d{4}-\d\d-\d\d$/.test(s)?new Date(s+'T00:00:00'):new Date(s));
const addDays=(s,n)=>{const d=pd(s||today());d.setDate(d.getDate()+n);return ymd(d)};
const nowISO=()=>new Date().toISOString();
const num=n=>{const v=Number(n);return isFinite(v)?v:0};
const rp=n=>'Rp '+num(n).toLocaleString('id-ID',{maximumFractionDigits:0});
const nf=n=>num(n).toLocaleString('id-ID',{maximumFractionDigits:2});
const pct=n=>nf(n)+'%';
const fdate=s=>{const d=pd(s);return d&&!isNaN(d)?d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):'-'};
const fdt=s=>{const d=pd(s);return d&&!isNaN(d)?d.toLocaleString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'-'};
const sum=(a,f)=>a.reduce((s,x)=>s+num(f(x)),0);
const daysBetween=(a,b)=>Math.round((pd(b)-pd(a))/864e5);
const clone=o=>JSON.parse(JSON.stringify(o));

/* ---------- Internasionalisasi (i18n): id / en / zh ---------- */
const I18N_LANGS={id:'Bahasa Indonesia',en:'English',zh:'中文'};
const I18N={id:{},en:{},zh:{}};
const Lang={
 /* Preferensi bahasa disimpan di localStorage (tersedia sebelum Store/IndexedDB siap, dan tidak ikut
    terhapus oleh Store.clearAll() / reset data contoh) — lalu disinkronkan ke Store.mem.settings.lang. */
 cur(){
  try{const l=localStorage.getItem('kerp_lang');if(l&&I18N_LANGS[l])return l}catch(e){}
  return (typeof Store!=='undefined'&&Store.mem&&Store.mem.settings&&Store.mem.settings.lang)||'id';
 },
 set(l){
  if(!I18N_LANGS[l])return;
  try{localStorage.setItem('kerp_lang',l)}catch(e){}
  if(typeof Store!=='undefined'&&Store.mem&&Store.mem.settings){S().lang=l;saveSettings()}
  location.reload();
 },
 t(key,vars){
  let s=(I18N[this.cur()]&&I18N[this.cur()][key])??I18N.id[key]??key;
  if(vars)for(const k in vars)s=s.replaceAll('{'+k+'}',vars[k]);
  return s;
 }
};
const t=(k,v)=>Lang.t(k,v);

/* ---------- Penyimpanan permanen: IndexedDB (fallback localStorage/memori) ---------- */
const Store={mode:'idb',mem:{},db:null,
 init(){return new Promise(res=>{
  let done=false;const fin=()=>{if(!done){done=true;res()}};
  setTimeout(()=>{if(!done){this.fallback();fin()}},4000);
  try{
   const rq=indexedDB.open('kentford_erp',1);
   rq.onupgradeneeded=()=>{rq.result.createObjectStore('kv');rq.result.createObjectStore('files')};
   rq.onerror=()=>{this.fallback();fin()};
   rq.onsuccess=()=>{
    this.db=rq.result;
    try{
     const cr=this.db.transaction('kv').objectStore('kv').openCursor();
     cr.onsuccess=e=>{const c=e.target.result;if(c){this.mem[c.key]=c.value;c.continue()}else fin()};
     cr.onerror=()=>{this.fallback();fin()};
    }catch(e){this.fallback();fin()}
   };
  }catch(e){this.fallback();fin()}
 })},
 fallback(){this.mode='mem';this.db=null;try{const s=localStorage.getItem('kerp_mem');if(s)this.mem=JSON.parse(s);this.mode='ls'}catch(e){}},
 put(col){
  const v=this.mem[col];
  if(this.mode==='idb'){try{this.db.transaction('kv','readwrite').objectStore('kv').put(v,col)}catch(e){console.error(e)}}
  else if(this.mode==='ls'){try{localStorage.setItem('kerp_mem',JSON.stringify(this.mem))}catch(e){}}
 },
 putAll(){Object.keys(this.mem).forEach(k=>this.put(k))},
 clearAll(){return new Promise(res=>{this.mem={};if(this.mode==='idb'){try{const tx=this.db.transaction(['kv','files'],'readwrite');tx.objectStore('kv').clear();tx.objectStore('files').clear();tx.oncomplete=res;tx.onerror=res}catch(e){res()}}else{try{localStorage.removeItem('kerp_mem')}catch(e){}res()}})}
};

const Files={mem:{},
 async put(file){
  const meta={id:uid(),name:file.name,type:file.type,size:file.size,at:nowISO()};
  if(Store.mode==='idb'){await new Promise((ok,no)=>{const r=Store.db.transaction('files','readwrite').objectStore('files').put(file,meta.id);r.onsuccess=ok;r.onerror=()=>no(r.error)})}
  else this.mem[meta.id]=file;
  return meta;
 },
 get(id){
  if(this.mem[id])return Promise.resolve(this.mem[id]);
  if(Store.mode!=='idb')return Promise.resolve(null);
  return new Promise(ok=>{const r=Store.db.transaction('files').objectStore('files').get(id);r.onsuccess=()=>ok(r.result||null);r.onerror=()=>ok(null)});
 },
 async url(id){const b=await this.get(id);return b?URL.createObjectURL(b):null}
};

/* ---------- Koleksi data (dengan audit otomatis & soft delete) ---------- */
const NOAUDIT=new Set(['audit','notifications','comments','stock','stock_moves']);
const DB={
 col(n){return Array.isArray(Store.mem[n])?Store.mem[n]:(Store.mem[n]=[])},
 all(n){return this.col(n).filter(r=>!r.deletedAt)},
 get(n,id){return this.col(n).find(r=>r.id===id)},
 save(n){Store.put(n)},
 insert(n,o,reason){
  const r={id:uid(),...o,createdAt:nowISO(),createdBy:Auth.uid()};
  this.col(n).push(r);this.save(n);
  if(!NOAUDIT.has(n))Audit.log(t('audit.create'),n,r.id,null,r,reason);
  return r;
 },
 update(n,id,patch,reason,action){
  const r=this.get(n,id);if(!r)throw new Error(t('err.notfound'));
  const before={};for(const k in patch)before[k]=clone(r[k]===undefined?null:r[k]);
  Object.assign(r,patch,{updatedAt:nowISO(),updatedBy:Auth.uid()});
  this.save(n);
  if(!NOAUDIT.has(n))Audit.log(action||t('audit.update'),n,id,before,clone(patch),reason);
  return r;
 },
 remove(n,id,reason){
  const r=this.get(n,id);if(!r)return;
  r.deletedAt=nowISO();r.deletedBy=Auth.uid();r.deleteReason=reason||'';this.save(n);
  Audit.log(t('audit.archive'),n,id,null,null,reason);
 },
 restore(n,id){
  const r=this.get(n,id);if(!r)return;
  delete r.deletedAt;delete r.deletedBy;delete r.deleteReason;this.save(n);
  Audit.log(t('audit.restore'),n,id,null,null,'');
 }
};
const S=()=>Store.mem.settings||(Store.mem.settings={});
const saveSettings=()=>Store.put('settings');

/* ---------- Audit log ---------- */
const Audit={
 log(action,col,ref,before,after,reason){
  const u=Auth.user;
  const e={id:uid(),at:nowISO(),userId:u?.id||'system',userName:u?.name||'Sistem',roleId:u?.roleId||'',action,col,ref,
   label:this.label(col,ref,after),before:before||null,after:after||null,reason:reason||'',session:Auth.sid||''};
  const a=DB.col('audit');a.push(e);if(a.length>6000)a.splice(0,a.length-6000);
  Store.put('audit');return e;
 },
 label(col,ref,after){const r=(ref&&DB.get(col,ref))||after||{};return r.no||r.name||r.title||r.sku||r.username||String(ref||'')}
};

/* ---------- Penomoran dokumen otomatis ---------- */
const Num={
 next(type){
  const cfg=DB.all('numbering').find(x=>x.type===type)||{prefix:type,format:'{P}/{YYYY}/{MM}/{N4}',reset:'bulanan'};
  const d=new Date(),ym=`${d.getFullYear()}${pad(d.getMonth()+1)}`;
  const ctr=Store.mem.counters||(Store.mem.counters={});
  const key=type+'-'+(cfg.reset==='tahunan'?String(d.getFullYear()):cfg.reset==='tidak'?'all':ym);
  ctr[key]=(ctr[key]||0)+1;Store.put('counters');
  const n=ctr[key];
  return String(cfg.format||'{P}/{YYYY}/{MM}/{N4}').replace('{P}',cfg.prefix||type).replace('{YYYY}',d.getFullYear()).replace('{MM}',pad(d.getMonth()+1))
   .replace(/\{N(\d)\}/,(m,l)=>pad(n,+l)).replace('{N}',n);
 }
};

/* ---------- Autentikasi & RBAC (sisi klien) ---------- */
const Auth={user:null,role:null,sid:'',
 uid(){return this.user?.id||'system'},
 async hash(pw,salt){
  try{const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+':'+pw));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  catch(e){let h1=0xdeadbeef,h2=0x41c6ce57;for(const ch of salt+':'+pw){h1=Math.imul(h1^ch.charCodeAt(0),2654435761);h2=Math.imul(h2^ch.charCodeAt(0),1597334677)}return 'x'+(h1>>>0).toString(16)+(h2>>>0).toString(16)}
 },
 /* status akun 3-state: 'active'|'inactive'|'suspended'. Data lama tanpa field `status` dianggap
    'active' selama active!==false (kompatibilitas mundur), 'inactive' bila active===false. */
 userStatus(u){return u?.status||(u?.active===false?'inactive':'active')},
 isActive(u){return this.userStatus(u)==='active'},
 async login(username,pw){
  const u=DB.all('users').find(x=>x.username.toLowerCase()===String(username).trim().toLowerCase());
  if(!u)return {ok:false,msg:t('login.failed')};
  if(!this.isActive(u))return {ok:false,msg:t('login.account_'+this.userStatus(u))};
  if(await this.hash(pw,u.salt)!==u.pw)return {ok:false,msg:t('login.failed')};
  this.set(u);
  this.sid=uid()+' | '+(navigator.userAgent||'').slice(0,60);
  try{localStorage.setItem('kerp_sess',JSON.stringify({id:u.id,sid:this.sid}))}catch(e){}
  Audit.log(t('audit.login'),'users',u.id,null,null,'');
  return {ok:true};
 },
 set(u){this.user=u;this.role=DB.get('roles',u.roleId)||null},
 restore(){
  try{const s=JSON.parse(localStorage.getItem('kerp_sess')||'null');
   if(s){const u=DB.get('users',s.id);if(u&&!u.deletedAt&&this.isActive(u)){this.set(u);this.sid=s.sid;return true}}}catch(e){}
  return false;
 },
 logout(){Audit.log(t('audit.logout'),'users',this.user?.id,null,null,'');this.user=null;this.role=null;try{localStorage.removeItem('kerp_sess')}catch(e){}},
 async setPassword(userId,pw){const salt=uid();const pwh=await this.hash(pw,salt);DB.update('users',userId,{salt,pw:pwh},t('common.change_password'),t('audit.change_password'))},
 /* Batas approval efektif seorang user: override per-user (users.approvalLimit) bila diisi (>0),
    kalau tidak pakai batas role (approvalLimits) sebagaimana biasa. Dipakai untuk menandai bahwa
    seorang user bisa mendapat hak approve lebih tinggi/lebih rendah dari role-nya secara individual. */
 effectiveLimit(u){return num(u?.approvalLimit)||null},
 /* Delegasi approval: bila seorang approver mengaktifkan delegateTo (mis. sedang cuti), user
    tujuan delegasi juga dianggap berhak memutuskan/menerima notifikasi step tsb. */
 delegatesFor(userId){return DB.all('users').filter(u=>u.delegateTo===userId&&this.isActive(u)).map(u=>u.id)},
 /* Idle timeout: logout otomatis setelah tidak ada interaksi (mousemove/keydown/click) selama
    durasi tertentu (menit, default 30 — dapat diubah lewat Store.mem.settings.idleTimeoutMin). */
 idleTimer:null,
 armIdleTimer(){
  clearTimeout(this.idleTimer);
  const mins=num(S().idleTimeoutMin)||30;
  this.idleTimer=setTimeout(()=>{if(this.user){this.logout();location.hash='';if(typeof Login!=='undefined')Login.show()}},mins*60000);
 },
 watchIdle(){
  ['mousemove','keydown','click','touchstart'].forEach(ev=>document.addEventListener(ev,()=>this.armIdleTimer(),{passive:true}));
  this.armIdleTimer();
 }
};
const can=(page,mode='r')=>{const p=Auth.role?.perm?.[page];return mode==='w'?p==='w':!!p};
const seeCost=()=>!!Auth.role?.seeCost;
const isRole=(...r)=>r.includes(Auth.user?.roleId);
const userName=id=>DB.get('users',id)?.name||'-';
/* ---------- Lock periode finansial ---------- */
const PeriodLock={
 date(){return S().periodLockDate||''},
 isLocked(docDate){const l=this.date();return !!l&&!!docDate&&docDate<=l},
 set(dateStr){S().periodLockDate=dateStr||'';saveSettings();Audit.log(t('audit.period_lock'),'settings','periodLockDate',null,{periodLockDate:dateStr||''},'')}
};

/* ---------- Notifikasi ---------- */
const Notify={
 user(userId,text,link){if(userId&&userId!==Auth.uid())DB.insert('notifications',{userId,text,link:link||'',read:false})},
 role(roleId,text,link){DB.all('users').filter(u=>u.roleId===roleId&&u.active!==false).forEach(u=>this.user(u.id,text,link))},
 mine(){return DB.all('notifications').filter(n=>n.userId===Auth.uid()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))},
 unread(){return this.mine().filter(n=>!n.read).length}
};

/* ---------- Approval engine ---------- */
const APPR_TYPE_KEYS=['quotation','purchase_request','purchase_order','payment_request','petty_cash','ship_no_payment','refund','deposit_return','stock_adjust','warranty_free','cancellation'];
const APPR_TYPES={};
APPR_TYPE_KEYS.forEach(k=>Object.defineProperty(APPR_TYPES,k,{enumerable:true,get:()=>t('apprtype.'+k)}));
const Approval={hooks:{},
 steps(type,amount,meta){
  const L=DB.all('approvalLimits').filter(x=>x.type===type).sort((a,b)=>num(a.step)-num(b.step));
  const roles=L.filter(x=>!num(x.min)||num(amount)>=num(x.min)).map(x=>x.role);
  if(meta&&meta.forceDirector&&!roles.includes('director'))roles.push('director');
  return roles.map(role=>({role,status:'Menunggu',by:null,byName:'',at:null,note:''}));
 },
 request({type,refCol,refId,title,amount,reason,files,meta}){
  const steps=this.steps(type,amount,meta);
  const a=DB.insert('approvals',{no:Num.next('APR'),type,refCol,refId,title,amount:num(amount),reason:reason||'',files:files||[],meta:meta||{},
   requesterId:Auth.uid(),requesterName:Auth.user.name,steps,idx:0,status:steps.length?'Menunggu':'Disetujui',decidedAt:steps.length?null:nowISO()});
  if(!steps.length)this.finish(a,true);else this.notifyCurrent(a);
  return a;
 },
 cur(a){return a.status==='Menunggu'?a.steps[a.idx]:null},
 /* seorang user boleh memutuskan step ini bila: perannya cocok dengan role step, ATAU dia adalah
    Direktur (final authority), ATAU dia adalah delegasi aktif (delegateTo) dari salah satu approver
    dengan role step tsb — dipakai saat approver utama berhalangan/cuti. Maker-checker tetap dijaga:
    requesterId!==u.id selalu diperiksa lebih dulu, delegasi TIDAK melewati aturan ini. */
 canDecide(a,u=Auth.user){
  const s=this.cur(a);if(!s||a.requesterId===u.id)return false;
  if(u.roleId===s.role||u.roleId==='director')return true;
  const delegators=DB.all('users').filter(x=>x.delegateTo===u.id&&x.roleId===s.role);
  return delegators.length>0;
 },
 notifyCurrent(a){
  const s=this.cur(a);if(!s)return;
  Notify.role(s.role,t('notify.new_approval',{title:a.title,no:a.no}),'#/approvals_pending');
  // notifikasi juga ke delegasi aktif approver role ini
  DB.all('users').filter(u=>u.roleId===s.role&&u.delegateTo).forEach(u=>Notify.user(u.delegateTo,t('notify.new_approval',{title:a.title,no:a.no}),'#/approvals_pending'));
 },
 decide(id,ok,note){
  const a=DB.get('approvals',id);
  if(!a||!this.canDecide(a))throw new Error(t('err.not_authorized_approve'));
  if(!ok&&!note)throw new Error(t('err.reject_reason_required'));
  const steps=clone(a.steps),s=steps[a.idx];
  s.status=ok?'Disetujui':'Ditolak';s.by=Auth.uid();s.byName=Auth.user.name;s.byRole=Auth.role?.name||Auth.user.roleId;s.at=nowISO();s.note=note||'';
  let status='Menunggu',idx=a.idx;
  if(!ok)status='Ditolak';else{idx++;if(idx>=steps.length)status='Disetujui'}
  DB.update('approvals',id,{steps,idx:Math.min(idx,steps.length-1),status,decidedAt:status==='Menunggu'?null:nowISO()},note,ok?'Approval: Setuju':'Approval: Tolak');
  const b=DB.get('approvals',id);
  let failMsg='';
  if(status==='Menunggu')this.notifyCurrent(b);else failMsg=this.finish(b,status==='Disetujui');
  if(failMsg)throw new Error(t('err.approve_apply_failed',{msg:failMsg}));
  return b;
 },
 finish(a,ok){
  const h=this.hooks[a.type];
  let failMsg='';
  try{if(h)(ok?h.approved:h.rejected)?.(a)}catch(e){console.error(e);failMsg=e.message||String(e)}
  if(failMsg){
   Audit.log(t('audit.apply_approval_failed',{msg:failMsg}),a.refCol,a.refId,null,null,a.no);
   Notify.user(a.requesterId,t('notify.approved_but_failed',{no:a.no,title:a.title,msg:failMsg}),'#/approvals_history');
   Notify.role('director',t('notify.approved_but_failed_role',{no:a.no,msg:failMsg}),'#/approvals_history');
  }else Notify.user(a.requesterId,t('notify.approval_decided',{no:a.no,title:a.title,decision:ok?t('common.approved_upper'):t('common.rejected_upper')}),'#/approvals_history');
  return failMsg;
 },
 forRef(col,id){return DB.all('approvals').filter(a=>a.refCol===col&&a.refId===id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
};

/* ---------- Stok ---------- */
const Stock={
 qty(pid,wh){return sum(DB.all('stock').filter(s=>s.productId===pid&&(!wh||s.whId===wh)),s=>s.qty)},
 change(pid,wh,delta,type,ref,note){
  let s=DB.all('stock').find(x=>x.productId===pid&&x.whId===wh);
  const p=DB.get('products',pid);
  if((s?s.qty:0)+delta<0)throw new Error(t('err.stock_insufficient',{name:p?.name||'',wh:DB.get('warehouses',wh)?.name||t('common.location'),have:s?s.qty:0,need:-delta}));
  if(!s)s=DB.insert('stock',{productId:pid,whId:wh,qty:0});
  s.qty+=delta;DB.save('stock');
  DB.insert('stock_moves',{productId:pid,whId:wh,delta,type,ref:ref||'',note:note||'',at:nowISO(),by:Auth.uid(),byName:Auth.user?.name||''});
  Audit.log('Mutasi stok: '+type,'products',pid,null,{gudang:wh,perubahan:delta,ref},note);
 }
};

/* ---------- Ekspor & cetak ---------- */
const Export={
 dl(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),3000)},
 xls(name,head,rows){
  const t='<html><head><meta charset="utf-8"></head><body><table border="1"><tr>'+head.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>'+
   rows.map(r=>'<tr>'+r.map(c=>`<td>${esc(c)}</td>`).join('')+'</tr>').join('')+'</table></body></html>';
  this.dl(new Blob([t],{type:'application/vnd.ms-excel'}),name+'.xls');
 },
 json(name,obj){this.dl(new Blob([JSON.stringify(obj,null,1)],{type:'application/json'}),name)}
};
const Print={
 html(html){
  let p=$('#print');p.innerHTML=`<div class="pdoc">${html}</div>`;
  const done=()=>{p.innerHTML='';window.removeEventListener('afterprint',done)};
  window.addEventListener('afterprint',done);
  setTimeout(()=>window.print(),50);
 },
 header(title,no){
  const c=S().company||{};
  return `<div class="hd"><div><h1>${esc(c.name||'PT KENTFORD GROUP INDONESIA')}</h1><div>${esc(c.address||'')}<br>${esc(c.phone||'')} ${esc(c.email||'')}</div></div><div class="right"><h1>${esc(title)}</h1><b>${esc(no||'')}</b></div></div>`;
 }
};

/* ---------- Kamus terjemahan (id / en / zh) ---------- */
Object.assign(I18N.id,{
 'audit.create':'Buat','audit.update':'Ubah','audit.archive':'Hapus (arsip)','audit.restore':'Pulihkan','audit.login':'Login','audit.logout':'Logout','audit.period_lock':'Ubah tanggal lock periode',
 'audit.change_password':'Ubah Password','audit.apply_approval_failed':'Gagal menerapkan approval: {msg}',
 'err.notfound':'Data tidak ditemukan','err.not_authorized_approve':'Anda tidak berwenang menyetujui pengajuan ini.','err.reject_reason_required':'Alasan penolakan wajib diisi.',
 'err.approve_apply_failed':'Disetujui, tetapi gagal diterapkan ke dokumen: {msg}. Perubahan status TIDAK dibatalkan — hubungi Admin / IT.',
 'err.stock_insufficient':'Stok {name} di {wh} tidak cukup (tersedia {have}, butuh {need}).',
 'notify.new_approval':'Approval baru: {title} ({no})','notify.approved_but_failed':'Pengajuan {no} ({title}) disetujui TAPI GAGAL diterapkan: {msg}. Hubungi Admin.',
 'notify.approved_but_failed_role':'Approval {no} disetujui tapi gagal diterapkan: {msg}','notify.approval_decided':'Pengajuan {no} ({title}) {decision}',
 'common.change_password':'Ubah password','common.approved_upper':'DISETUJUI','common.rejected_upper':'DITOLAK','common.location':'lokasi',
 'common.save':'Simpan','common.cancel':'Batal','common.close':'Tutup','common.back':'Kembali','common.search':'Cari…','common.add':'Tambah','common.delete':'Hapus','common.edit':'Ubah',
 'common.new':'Baru','common.confirm':'Konfirmasi','common.yes_continue':'Ya, lanjutkan',
 'apprtype.quotation':'Quotation (diskon / margin)','apprtype.purchase_request':'Purchase Request','apprtype.purchase_order':'Purchase Order','apprtype.payment_request':'Payment Request',
 'apprtype.petty_cash':'Pengeluaran Petty Cash','apprtype.ship_no_payment':'Pengiriman Tanpa Pembayaran','apprtype.refund':'Refund Customer','apprtype.deposit_return':'Pengembalian Deposit Rental',
 'apprtype.stock_adjust':'Penggunaan / Penyesuaian Stok','apprtype.warranty_free':'Service Gratis / Warranty','apprtype.cancellation':'Pembatalan Transaksi',
 'nav.dashboard':'Dashboard','nav.leads':'Leads','nav.customers':'Customers','nav.followups':'Follow-up','nav.quotations':'Quotation','nav.salesorders':'Sales Order','nav.orders':'New Order Tracking',
 'nav.pr':'Purchase Request','nav.sq':'Supplier Quotation','nav.pc':'Price Comparison','nav.po':'Purchase Order','nav.suppliers':'Supplier','nav.incoming':'Incoming Shipment',
 'nav.products':'Daftar Produk','nav.stock_genset':'Stok Genset','nav.stock_parts':'Stok Spare Part','nav.gr':'Barang Masuk','nav.gi':'Barang Keluar','nav.transfer':'Transfer Lokasi','nav.opname':'Stock Opname','nav.barcode':'Barcode',
 'nav.invoices':'Customer Invoice','nav.ar':'Account Receivable','nav.si':'Supplier Invoice','nav.ap':'Account Payable','nav.payreq':'Payment Request','nav.bank':'Bank & Cash','nav.petty':'Petty Cash','nav.tax':'Tax','nav.recon':'Bank Reconciliation',
 'nav.rent_units':'Unit Rental','nav.rent_contracts':'Kontrak Rental','nav.rent_schedule':'Jadwal Rental','nav.hourmeter':'Hour Meter','nav.overtime':'Overtime','nav.deposit':'Deposit','nav.rent_return':'Pengembalian Unit',
 'nav.svc_req':'Service Request','nav.survey':'Survey','nav.wo':'Work Order','nav.tech_sched':'Jadwal Teknisi','nav.install':'Installation','nav.pm':'Preventive Maintenance','nav.warranty':'Warranty Claim','nav.svc_report':'Service Report',
 'nav.approvals_pending':'Menunggu Persetujuan','nav.approvals_done':'Disetujui','nav.approvals_rejected':'Ditolak','nav.approvals_history':'Riwayat Approval',
 'nav.reports':'Reports','nav.master':'Master Data','nav.users':'User & Access','nav.audit':'Audit Log','nav.settings':'Settings',
 'grp.crm_sales':'CRM & Sales','grp.purchasing':'Purchasing','grp.inventory':'Inventory','grp.finance':'Finance','grp.rental':'Rental','grp.service':'Service & Aftersales','grp.approval':'Approval','grp.other':'Lainnya',
 'ent.users':'Pengguna','ent.roles':'Role','ent.leads':'Lead','ent.customers':'Customer','ent.suppliers':'Supplier','ent.products':'Produk','ent.categories':'Kategori Produk','ent.brands':'Brand','ent.warehouses':'Warehouse / Lokasi',
 'ent.banks':'Rekening Bank','ent.taxes':'Pajak','ent.payterms':'Payment Terms','ent.deliveryterms':'Delivery Terms','ent.employees':'Karyawan','ent.departments':'Departemen','ent.approvalLimits':'Batas Approval','ent.numbering':'Penomoran Dokumen',
 'ent.uoms':'Satuan (UoM)','ent.vehicles':'Kendaraan','ent.technicians':'Teknisi','ent.failcats':'Kategori Kerusakan','ent.servicetypes':'Jenis Service','ent.followups':'Follow-up',
 'ent.si':'Supplier Invoice','ent.rent_contracts':'Kontrak Rental','ent.payreq':'Payment Request','ent.quotations':'Quotation','ent.salesorders':'Sales Order','ent.invoices':'Customer Invoice','ent.orders':'New Order',
 'ent.rent_units':'Unit Rental','ent.pm_schedules':'Jadwal PM',
 'stage.sales_input.short':'Input Sales','stage.sales_input.status':'Input Sales','stage.review.short':'Verifikasi Admin','stage.review.status':'Dalam Review Sales Support',
 'stage.warehouse.short':'Cek Stok','stage.warehouse.status':'Pemeriksaan Gudang','stage.finance.short':'Cek Finance','stage.finance.status':'Pemeriksaan Finance',
 'stage.director.short':'Approval Direktur','stage.director.status':'Menunggu Approval Direktur','stage.prepare.short':'Persiapan Barang','stage.prepare.status':'Persiapan Barang',
 'stage.shipping.short':'Pengiriman','stage.shipping.status':'Dalam Pengiriman','stage.delivered.short':'Diterima Customer','stage.delivered.status':'Diterima Customer',
 'stage.install.short':'Instalasi','stage.install.status':'Instalasi & Commissioning','stage.handover.short':'Serah Terima','stage.handover.status':'Serah Terima & TTD',
 'stage.invoice_final.short':'Invoice Final','stage.invoice_final.status':'Penagihan Final','stage.done.short':'Selesai','stage.done.status':'Selesai',
 'svcstatus.0':'Request masuk','svcstatus.1':'Dijadwalkan','svcstatus.2':'Teknisi menuju lokasi','svcstatus.3':'Sedang dikerjakan','svcstatus.4':'Menunggu spare part','svcstatus.5':'Menunggu persetujuan customer','svcstatus.6':'Selesai','svcstatus.7':'Ditutup',
 'rentstage.0':'Draft','rentstage.1':'Aktif','rentstage.2':'Proses Pengembalian','rentstage.3':'Selesai','rentstage.4':'Dibatalkan',
 'login.tagline':'Genset Industrial · Sales, Rental & Service','login.point1':'Approval & workflow New Order terkontrol','login.point2':'Rental & service genset dalam satu sistem','login.point3':'Stok, keuangan, dan laporan real-time',
 'login.please_login':'PT KENTFORD GROUP INDONESIA. Silakan masuk.','login.username':'Username','login.password':'Password','login.button':'Masuk','login.demo_title':'Akun demo','login.demo_hint':'(password semua akun: {pw}). Klik untuk mengisi username:',
 'login.failed':'Username atau password salah, atau akun nonaktif.','login.account_inactive':'Akun tidak aktif. Hubungi Direktur/Admin.','login.account_suspended':'Akun ditangguhkan (suspend). Hubungi Direktur/Admin.','lang.label':'Bahasa',
 'common.reason':'Alasan','common.select':'pilih','common.all':'semua','common.excel':'Excel','common.print_pdf':'Cetak / PDF','common.no_data':'Belum ada data.',
 'common.data_count_suffix':'data','common.prev':'Sebelumnya','common.page':'Hal','common.next':'Berikutnya','common.data_list':'Daftar Data',
 'common.comment':'Komentar','common.no_activity':'Belum ada aktivitas.','common.comment_placeholder':'Tulis komentar… gunakan @username untuk mention pengguna',
 'common.send_comment':'Kirim komentar','common.comment_empty':'Komentar masih kosong.','common.mention_notify':'{name} menyebut Anda: {text}',
 'common.global_search':'Cari customer, quotation, order, produk…','common.notifications':'Notifikasi',
 'common.storage_warning':'Penyimpanan permanen browser (IndexedDB) tidak tersedia di sini. Data {mode}. Buka lewat http://localhost (lihat README) agar data permanen.',
 'common.storage_ls':'disimpan di localStorage (terbatas)','common.storage_mem':'HANYA di memori dan hilang saat halaman ditutup',
 'common.mark_all_read':'Tandai semua dibaca','common.no_notifications':'Tidak ada notifikasi.','common.no_results':'Tidak ada hasil.','common.logout':'Keluar',
 'common.old_password':'Password lama','common.new_password_hint':'Password baru (min. 6 karakter)','common.repeat_new_password':'Ulangi password baru',
 'common.old_password_wrong':'Password lama salah.','common.new_password_invalid':'Password baru minimal 6 karakter dan harus sama.','common.password_changed':'Password berhasil diubah.',
 'common.product':'Produk','common.qty':'Qty','common.customer':'Customer','common.supplier':'Supplier','common.payment_terms':'Payment terms','common.delivery_terms':'Delivery terms','common.warranty':'Warranty',
 'common.notes':'Catatan','common.subtotal':'Subtotal','common.discount':'Diskon','common.dpp':'DPP','common.ppn':'PPN','common.total':'Total','common.gross_profit':'Gross profit','common.margin':'Margin',
 'common.no_dot':'No.','common.sales':'Sales','common.date':'Tanggal','common.status':'Status','common.type':'Jenis','common.amount':'Jumlah','common.price':'Harga','common.description':'Keterangan','common.value':'Nilai',
 'common.method':'Metode','common.reference':'Referensi','common.recorded_by':'Dicatat oleh','common.attachment':'Lampiran','common.activity_comments':'Aktivitas & komentar','common.approval':'Approval',
 'common.save_draft':'Simpan draft','common.save_submit':'Simpan & ajukan','common.draft_saved':'Draft tersimpan.','common.action_submitted_reason':'Diajukan untuk approval','common.action_request_approval':'Ajukan approval',
 'common.auto_approved_action':'Disetujui otomatis','common.request_cancellation':'Ajukan pembatalan','common.cancellation_reason':'Alasan pembatalan','common.cancellation_already_pending':'Sudah ada pengajuan pembatalan yang menunggu.',
 'common.cancellation_title':'Pembatalan {label} {no}','common.cancellation_submitted':'Pengajuan pembatalan dikirim.','common.save_payment':'Simpan pembayaran',
 'common.warehouse':'Gudang','common.file':'File','common.balance':'Saldo','common.account':'Rekening','common.category':'Kategori','common.location_':'Lokasi',
 'common.no_data_yet':'Belum ada data.','common.confirm_action':'Konfirmasi','common.save_changes':'Simpan perubahan','common.print':'Cetak','common.upload':'Unggah',
 'quot.reason_expired':'Masa berlaku habis','quot.action_auto_expired':'Kedaluwarsa otomatis','quot.desc_spec':'Deskripsi / spesifikasi','quot.buy_price_rp':'Harga beli (Rp)','quot.sell_price_rp':'Harga jual (Rp)','quot.disc_pct':'Diskon %',
 'quot.pic_customer':'PIC customer','quot.sales_pic':'Sales PIC','quot.valid_until':'Berlaku sampai','quot.tax_pct':'PPN (%)','quot.lead_time':'Lead time','quot.lead_time_ph':'mis. 4 minggu','quot.warranty_ph':'mis. 12 bulan / 2.000 jam',
 'quot.products_prices':'Produk & harga','quot.buy_price':'Harga beli','quot.badge_below_threshold':'Di bawah batas → perlu approval','quot.warn_disc_exceeds':'Diskon {disc} melebihi batas {max} — quotation akan memerlukan approval.',
 'quot.warn_margin_below':'Harga/margin berada di bawah batas — quotation akan memerlukan approval.','quot.err_min_one_product':'Tambahkan minimal satu produk.','quot.err_qty_positive':'Qty setiap baris harus lebih dari 0.',
 'quot.err_price_disc_invalid':'Harga / diskon tidak valid.','quot.err_valid_after_date':'Tanggal berlaku harus setelah tanggal quotation.','quot.action_update':'Ubah quotation',
 'quot.approval_reason':'Margin {margin} (batas {marginLimit}), diskon maks {disc} (batas {discLimit})','quot.submitted_for_approval':'Quotation diajukan untuk approval.','quot.reason_auto_approve':'Memenuhi batas margin & diskon',
 'quot.auto_approved':'Quotation disetujui otomatis (memenuhi batas margin & diskon).','quot.new':'Quotation baru','quot.not_found':'Quotation tidak ditemukan.','quot.no_right_create':'Anda tidak berhak membuat quotation.',
 'quot.make_revision':'Buat revisi','quot.mark_sent':'Tandai dikirim ke customer','quot.rejected_by_customer':'Ditolak customer','quot.accepted_by_customer':'Diterima customer','quot.make_so':'Buat Sales Order',
 'quot.data_title':'Data quotation','quot.rejected_prefix':'Ditolak','quot.value_summary':'Ringkasan nilai','quot.revisions':'Versi revisi','quot.reason_sent':'Dikirim ke customer','quot.action_sent':'Dikirim ke customer',
 'quot.status_sent_toast':'Status: Dikirim.','quot.reason_won':'Diterima customer','quot.action_won':'Diterima customer','quot.toast_won':'Quotation diterima customer.','quot.lost_confirm_msg':'Catat alasan penolakan dari customer.',
 'quot.customer_prefix':'Customer: ','quot.action_lost':'Ditolak customer','quot.revise_confirm_msg':'Buat revisi baru dari <b>{no}</b>? Versi lama akan berstatus <i>Direvisi</i> dan tidak dapat diubah.','quot.action_revised':'Direvisi',
 'quot.revision_created':'Revisi dibuat.','quot.so_created':'Sales Order dibuat: {no}','quot.reason_approval_approved':'Approval disetujui','quot.action_approved':'Disetujui','quot.notify_approved':'Quotation {no} disetujui.',
 'quot.action_rejected':'Ditolak','quot.notify_rejected':'Quotation {no} ditolak: {note}',
 'so.err_quote_status':'Quotation harus berstatus Disetujui / Dikirim / Diterima.','so.err_already_exists':'Sales Order untuk quotation ini sudah ada.','so.reason_created':'Sales Order {no} dibuat','so.action_accepted':'Diterima (SO dibuat)',
 'so.action_link':'Tautkan Sales Order','so.action_cancelled':'Dibatalkan','so.no_so':'No. SO','so.not_found':'Sales Order tidak ditemukan.','so.order_info':'Informasi order','so.items':'Item','so.make_invoice':'Buat invoice',
 'so.billed':'Ditagihkan','so.reason_invoice_created':'Invoice dibuat','so.action_processed':'Diproses',
 'inv.due_date':'Jatuh tempo','inv.paid':'Dibayar','inv.none_yet':'Belum ada invoice.','inv.err_full_only_if_none':'Invoice penuh hanya bisa dibuat bila belum ada invoice lain untuk SO ini.',
 'inv.err_exceeds_remaining':'Nilai invoice melebihi sisa tagihan Sales Order ({amt} sebelum PPN).','inv.type_settlement':'Pelunasan','inv.type_full':'Pembayaran penuh','inv.type':'Jenis invoice','inv.dp_pct':'Persentase DP (%) — khusus jenis DP',
 'inv.invoice_date':'Tanggal invoice','inv.due_days':'Jatuh tempo (hari)','inv.note_optional':'Keterangan (opsional)','inv.pre_so_summary':'Total SO (DPP): <b>{total}</b> • sudah ditagihkan: <b>{used}</b> • sisa: <b>{remaining}</b>',
 'inv.err_dp_pct_invalid':'Persentase DP tidak valid.','inv.created':'Invoice dibuat: {no}','inv.no_invoice':'No. Invoice','inv.not_found':'Invoice tidak ditemukan.','inv.info_title':'Informasi invoice','inv.aging':'Aging',
 'inv.incoming_payments':'Pembayaran masuk','inv.proof':'Bukti','inv.no_payments_yet':'Belum ada pembayaran.','inv.outstanding':'Sisa tagihan','inv.record_payment':'Catat pembayaran','inv.date_received':'Tanggal terima',
 'inv.amount_received_rp':'Jumlah diterima (Rp)','inv.destination_account':'Rekening tujuan','inv.ref_no':'No. referensi / bukti transfer','inv.transfer_proof':'Bukti transfer (upload)','inv.pre_outstanding':'Sisa tagihan: <b>{amt}</b>',
 'inv.err_amount_positive':'Jumlah harus lebih dari 0.','inv.err_amount_exceeds':'Jumlah melebihi sisa tagihan ({amt}).','inv.reason_payment':'Pembayaran {amt}','inv.action_record_payment':'Catat pembayaran',
 'inv.payment_recorded':'Pembayaran dicatat. Status: {status}','inv.notify_payment_received':'Pembayaran {amt} diterima untuk {no} ({status}).',
 'pr.source':'Sumber','pr.needed_by':'Dibutuhkan tanggal','pr.items_requested':'Barang yang diminta','pr.notes_reason':'Catatan / alasan','pr.reason_no_rule':'Tidak ada aturan approval','pr.auto_approved':'PR disetujui otomatis (tanpa aturan approval).',
 'pr.submitted':'PR diajukan untuk approval.','pr.notify_approved':'PR {no} disetujui.','pr.no_right_create':'Anda tidak berhak membuat Purchase Request.','pr.new':'PR baru','pr.no_pr':'No. PR','pr.requester':'Pemohon',
 'pr.item_count':'Jumlah item','pr.est_value':'Estimasi nilai','pr.not_found':'PR tidak ditemukan.','pr.compare_make_po':'Bandingkan & buat PO','pr.request_detail':'Detail permintaan','pr.no_supplier_quote':'Belum ada penawaran supplier.',
 'pr.no_po':'Belum ada PO.','pr.draft_saved':'Draft PR tersimpan.','pr.err_line_incomplete':'Setiap baris harus memiliki produk dan qty > 0.','pr.no_lowstock':'Tidak ada stok yang menipis saat ini.',
 'pr.restock_desc':'Restock (stok {stock} / min {min})','pr.auto_lowstock_notes':'Dibuat otomatis dari daftar stok menipis.','pr.draft_from_lowstock':'Draft PR dibuat dari stok menipis: {no}',
 'sq.unit_price':'Harga satuan','sq.lead_time_ph':'mis. 6 minggu','sq.warranty_label':'Garansi','sq.warranty_ph':'mis. 12 bulan','sq.items_prices':'Item & harga','sq.offer_doc':'Dokumen penawaran',
 'sq.err_incomplete_line':'Lengkapi produk, qty, dan harga pada setiap baris.','sq.saved':'Supplier quotation tersimpan.',
 'pc.select_pr':'Pilih PR','pc.no_pr_ready':'Tidak ada PR yang siap dibandingkan','pc.no_sq_for_pr':'Belum ada Supplier Quotation untuk PR ini.','pc.total_price':'Total harga','pc.choose_make_po':'Pilih & buat PO',
 'pc.po_created_reason':'PO dibuat: {no}','pc.po_created_action':'PO dibuat','pc.po_created_toast':'PO dibuat: {no}',
 'po.reason_no_rule':'Tanpa aturan approval','po.auto_approved':'PO disetujui otomatis.','po.submitted':'PO diajukan untuk approval.','po.notify_approved':'PO {no} disetujui.','po.no_po':'No. PO','po.currency':'Mata uang',
 'po.total_idr':'Total (Rp)','po.not_found':'PO tidak ditemukan.','po.mark_sent':'Tandai dikirim ke supplier','po.make_si':'Buat Supplier Invoice','po.info_title':'Informasi PO','po.related_pr':'PR terkait','po.rate':'kurs',
 'po.incoterm':'Incoterm','po.received':'Diterima','po.in_rupiah':'Dalam Rupiah','po.shipment_tracking':'Tracking pengiriman','po.no_notes':'Belum ada catatan.','po.update_eta':'+ Update ETA / catatan','po.gr_title':'Barang masuk (GR)',
 'po.no_receipts':'Belum ada penerimaan.','po.reason_sent':'Dikirim ke supplier','po.status_sent_toast':'Status: Dikirim Supplier.','po.update_tracking':'Update tracking PO','po.eta_estimate':'Estimasi kedatangan',
 'po.tracking_note_ph':'Catatan (mis. status produksi/pengiriman)','po.tracking_updated':'Tracking diperbarui.','po.eta_none':'Belum ada','po.last_note':'Catatan terakhir',
 'gr.no_gr':'No. GR','gr.no_right':'Anda tidak berhak mencatat barang masuk.','gr.qty_received':'Qty diterima','gr.serial_no':'No. seri','gr.receive_at':'Terima di gudang','gr.receive_date':'Tanggal terima',
 'gr.items_received':'Barang diterima','gr.docs_hint':'Foto / dokumen (packing list, invoice)','gr.remaining_info':'Sisa belum diterima','gr.save_receipt':'Simpan penerimaan','gr.not_found':'GR tidak ditemukan.',
 'gr.err_min_one':'Isi minimal satu barang diterima.','gr.err_exceeds_remaining':'Qty {name} melebihi sisa PO (maks {max}).','gr.stock_move_type':'Barang masuk','gr.reason_price_update':'Update harga beli dari PO {no}',
 'gr.action_price_update':'Update harga beli','gr.reason_received':'Barang masuk {no}','gr.recorded':'Barang masuk dicatat: {no}',
 'gi.time':'Waktu','gi.purpose':'Keperluan','gi.from_warehouse':'Dari gudang','gi.purpose_ref':'Keperluan / referensi','gi.recorded':'Barang keluar dicatat.','gi.new_title':'Barang Keluar (manual)',
 'transfer.from':'Dari','transfer.to':'Ke','transfer.process':'Proses transfer','transfer.goods':'Barang','transfer.err_same_wh':'Gudang asal dan tujuan tidak boleh sama.','transfer.err_min_one':'Isi minimal satu barang.',
 'transfer.err_stock_insufficient':'Stok {name} di {wh} tidak cukup.','transfer.type_out':'Transfer keluar','transfer.type_in':'Transfer masuk','transfer.done':'Transfer selesai: {no}',
 'opname.no_right':'Anda tidak berhak membuat stock opname.','opname.new':'Opname baru','opname.start_count':'Mulai hitung','opname.diff_items':'Selisih item','opname.not_found':'Opname tidak ditemukan.',
 'opname.system_qty':'Sistem','opname.counted_qty':'Hasil hitung','opname.diff':'Selisih','opname.finish':'Selesaikan opname','opname.no_stock':'Tidak ada produk dengan stok di gudang ini.','opname.err_negative':'Hasil hitung tidak boleh negatif.',
 'opname.reason_no_diff':'Tidak ada selisih','opname.done_action':'Selesai','opname.no_diff_toast':'Opname selesai, tidak ada selisih.','opname.diff_confirm_msg':'Ditemukan {n} item selisih (nilai {val}). Penyesuaian stok memerlukan approval Manager. Lanjutkan?',
 'opname.approval_title':'Stock Opname {no} — {wh} ({n} item selisih)','opname.approval_reason':'Hasil stock opname','opname.submitted':'Opname diajukan untuk approval: {no}','opname.adjustment_type':'Penyesuaian (opname)','opname.adjustment_ref':'Stock opname {no}',
 'barcode.scan_hint':'Pindai / ketik barcode atau SKU','barcode.scan_ph':'Klik di sini lalu pindai dengan barcode scanner…','barcode.print_labels':'Cetak label barcode','barcode.print_selected':'Cetak label terpilih',
 'barcode.not_found':'Barcode/SKU "{code}" tidak ditemukan.','barcode.total_stock':'Stok total','barcode.no_stock':'Tidak ada stok',
 'si.err_exceeds_remaining':'Nilai invoice melebihi sisa PO ({amt} sebelum PPN).','si.not_found':'Supplier Invoice tidak ditemukan.','si.request_payreq':'Ajukan Payment Request','si.outgoing_payments':'Pembayaran keluar',
 'si.manual_invoice':'Invoice manual','si.amount_dpp_rp':'Nominal (DPP, Rp)','si.invoice_attachment':'Lampiran invoice','si.err_amount_positive':'Nominal harus lebih dari 0.','si.created':'Supplier invoice dibuat: {no}',
 'si.pre_po_summary':'Total PO (DPP): <b>{total}</b> • sudah ditagihkan: <b>{used}</b> • sisa: <b>{remaining}</b>',
 'payreq.submitted':'Payment Request diajukan.','payreq.reason_paid_via':'Dibayar via {no}','payreq.action_outgoing_payment':'Pembayaran keluar','payreq.action_paid':'Dibayar','payreq.notify_approved':'Payment Request {no} disetujui, siap dibayar.',
 'payreq.no_right':'Anda tidak berhak membuat Payment Request.','payreq.new':'Payment Request baru','payreq.purpose':'Keperluan','payreq.nominal':'Nominal','payreq.not_found':'Payment Request tidak ditemukan.','payreq.detail':'Detail',
 'payreq.requested_account':'Rekening diminta','payreq.paid_via':'Dibayar via','payreq.si_ref_label':'Supplier Invoice (bila kategori Bayar Supplier Invoice)','payreq.purpose_desc':'Keperluan / deskripsi','payreq.nominal_rp':'Nominal (Rp)',
 'payreq.source_account':'Rekening sumber dana','payreq.needed_before':'Dibutuhkan sebelum','payreq.attachment_hint':'Lampiran (invoice, kuitansi, dsb.)','payreq.purpose_pay':'Pembayaran {no} — {sup}','payreq.err_pick_si':'Pilih Supplier Invoice yang akan dibayar.',
 'payreq.mark_paid':'Tandai sudah dibayar','payreq.confirm_payment':'Konfirmasi pembayaran','payreq.paid_from_account':'Dibayar dari rekening','payreq.pay_date':'Tanggal bayar','payreq.balance_insufficient':'Saldo tidak cukup',
 'payreq.balance_insufficient_msg':'Saldo rekening saat ini {bal}, kurang dari nominal {amt}. Tetap lanjutkan?','payreq.payment_recorded':'Pembayaran dicatat.',
 'petty.topup_desc':'Isi ulang dari bank — {no}','petty.topup_via_payreq':'Isi ulang (via Payment Request)','petty.record_expense':'Catat pengeluaran','petty.balance':'Saldo Petty Cash','petty.pending_approval':'Pengeluaran menunggu approval',
 'petty.total_tx':'Total transaksi','petty.record_expense_title':'Catat pengeluaran Petty Cash (memerlukan approval)','petty.amount_rp':'Jumlah (Rp)','petty.receipt_hint':'Kuitansi / bukti','petty.pre_balance':'Saldo saat ini: <b>{bal}</b>',
 'petty.err_exceeds_balance':'Jumlah melebihi saldo petty cash.','petty.expense_title':'Pengeluaran Petty Cash: {desc}',
 'bank.mutation':'Mutasi','bank.manual_tx':'Transaksi manual','bank.recon':'Rekonsiliasi','bank.reconciled':'Sudah rekon','bank.not_reconciled':'Belum rekon','bank.tx_saved':'Transaksi tersimpan.','bank.desc_payment':'Pembayaran {no}',
 'tax.record_doc':'Catat dokumen pajak','tax.output_vat':'PPN Keluaran (bulan ini)','tax.input_vat':'PPN Masukan (bulan ini)','tax.balance':'PPN kurang/lebih bayar','tax.rates':'Tarif pajak','tax.inactive':'Nonaktif',
 'tax.change_rate_hint':'Ubah tarif di','tax.docs':'Dokumen Pajak','tax.doc_no':'No. Dokumen','tax.doc_type':'Jenis dokumen','tax.doc_no_field':'Nomor dokumen','tax.value_rp':'Nilai (Rp)','tax.upload_doc':'Unggah dokumen','tax.doc_saved':'Dokumen pajak tersimpan.',
 'recon.new':'Rekonsiliasi baru','recon.period':'Periode','recon.stmt_hint':'Baris mutasi rekening koran (tempel dari statement bank: tanggal | keterangan | jumlah, satu baris per transaksi; nominal keluar tulis negatif)','recon.start_match':'Mulai cocokkan',
 'recon.matched':'Cocok','recon.not_found':'Rekonsiliasi tidak ditemukan.','recon.statement':'Rekening koran','recon.match':'Cocok','recon.select_system_tx':'pilih transaksi sistem','recon.unmatched':'Belum cocok','recon.system_unmatched':'Sistem (belum cocok)',
 'recon.all_matched':'Semua cocok','recon.save_matching':'Simpan pencocokan','recon.finish':'Selesaikan rekonsiliasi','recon.err_min_line':'Isi minimal satu baris mutasi rekening koran.','recon.auto_matched':'Pencocokan awal dibuat otomatis untuk nominal yang sama persis.',
 'recon.matching_saved':'Pencocokan disimpan.','recon.finish_confirm_msg':'Masih ada {n} baris rekening koran yang belum cocok dengan sistem. Tetap selesaikan?','recon.reason_reconciled':'Direkonsiliasi','recon.finished':'Rekonsiliasi selesai.',
 'common.late':'Terlambat',
 'dashboard.greeting':'Halo, {name}','dashboard.sales_mtd':'Penjualan bulan berjalan','dashboard.so_count_dpp':'{n} Sales Order (DPP)','dashboard.active_quotations':'Quotation aktif','dashboard.value_prefix':'Nilai ',
 'dashboard.so_in_progress':'Sales Order berjalan','dashboard.orders_in_progress':'New Order berjalan','dashboard.n_late':'{n} terlambat','dashboard.none_late':'Tidak ada yang terlambat','dashboard.total_ar':'Total piutang (AR)',
 'dashboard.n_unpaid_invoices':'{n} invoice belum lunas','dashboard.overdue_ar':'Piutang jatuh tempo','dashboard.needs_collection':'Perlu penagihan','dashboard.safe':'Aman','dashboard.stock_value':'Nilai stok (harga beli)',
 'dashboard.stock_rows':'{n} baris stok','dashboard.low_stock':'Stok menipis','dashboard.all_safe':'Semua aman','dashboard.approvals_pending':'Approval menunggu Anda','dashboard.quotation_draft':'Quotation draft',
 'dashboard.order_needs_revision':'New Order belum dikirim / perlu revisi','dashboard.shipment_of':'Pengiriman {no} — {cust}','dashboard.followup_of':'Follow-up {type}: {cust}','dashboard.my_tasks':'Tugas saya','dashboard.n_tasks':'{n} tugas',
 'dashboard.no_order_tasks':'Tidak ada tugas New Order untuk Anda.','dashboard.my_approvals':'Approval saya','dashboard.n_pending':'{n} menunggu','dashboard.no_pending_approvals':'Tidak ada approval yang menunggu.',
 'dashboard.overdue_work':'Pekerjaan terlambat','dashboard.followup_prefix':'Follow-up','dashboard.no_overdue_work':'Tidak ada pekerjaan terlambat.','dashboard.today_schedule':'Jadwal hari ini','dashboard.no_schedule_today':'Tidak ada jadwal hari ini.',
 'dashboard.incomplete_docs':'Dokumen belum lengkap','dashboard.all_docs_complete':'Semua dokumen Anda sudah lengkap.','dashboard.recent_notifications':'Notifikasi terbaru','dashboard.no_notifications_yet':'Belum ada notifikasi.',
 'dashboard.top_customers':'Top customer (nilai SO)','dashboard.top_products':'Top produk (nilai penjualan)','dashboard.sales_performance':'Performa sales (nilai SO)','dashboard.orders_by_stage':'New Order per tahap','dashboard.n_orders':'{n} order',
 'reports.sales':'Laporan Penjualan','reports.quoteconv':'Konversi Quotation','reports.margin':'Gross Profit & Margin','reports.salesperf':'Performa Sales','reports.followup':'Follow-up Customer',
 'reports.orderprog':'Progress New Order','reports.delivery':'Laporan Pengiriman & Instalasi','reports.stockval':'Valuasi Stok','reports.lowstock':'Stok Menipis','reports.invmove':'Mutasi Stok',
 'reports.apaging':'Aging Hutang (AP)','reports.cashflow':'Arus Kas','reports.pettyreport':'Petty Cash','reports.taxsummary':'Ringkasan Pajak','reports.aging':'Aging Piutang (AR)',
 'reports.col_quote_count':'Jumlah quotation','reports.col_approved':'Disetujui','reports.col_won':'Diterima customer','reports.col_lost':'Ditolak','reports.col_quote_value':'Nilai quotation',
 'reports.col_won_value':'Nilai diterima','reports.col_conversion':'Konversi','reports.col_sales_dpp':'Penjualan (DPP)','reports.col_sales_value':'Nilai penjualan','reports.col_followups_done':'Follow-up selesai',
 'reports.col_next':'Berikutnya','reports.col_order_no':'No. Order','reports.col_need':'Kebutuhan','reports.col_target_delivery':'Target delivery','reports.col_days_in_stage':'Hari di tahap','reports.col_lateness':'Keterlambatan',
 'reports.col_delivery_report':'Delivery report','reports.col_date_received':'Tanggal diterima','reports.col_receiver':'Penerima','reports.col_sj_do':'SJ / DO','reports.col_installation':'Instalasi',
 'reports.val_none':'Tidak ada','reports.val_planned':'Terencana','reports.val_not_planned':'Belum direncanakan',
 'reports.col_sku':'SKU','reports.col_stock':'Stok','reports.col_minimum':'Minimum','reports.col_shortage':'Kekurangan','reports.col_time':'Waktu','reports.col_change':'Perubahan','reports.col_by':'Oleh','reports.col_source':'Sumber',
 'reports.sum_so':'Jumlah SO: <b>{n}</b> • Total DPP: <b>{dpp}</b> • Total: <b>{total}</b>','reports.sum_margin':'Penjualan: <b>{dpp}</b> • Gross profit: <b>{gp}</b> • Margin: <b>{m}</b>',
 'reports.sum_stockval':'Total nilai persediaan: <b>{v}</b>','reports.sum_cashflow':'Masuk: <b>{in}</b> • Keluar: <b>{out}</b> • Bersih: <b>{net}</b>','reports.sum_petty':'Saldo akhir periode: <b>{bal}</b>',
 'reports.data_count':'Jumlah data: <b>{n}</b>','reports.make_pr_from_list':'Buat PR dari daftar ini','reports.f_from_date':'Dari tanggal','reports.f_to_date':'Sampai tanggal','reports.f_pic_sales':'PIC (sales)','reports.f_branch_wh':'Cabang / gudang',
 'reports.apply_filter':'Terapkan filter',
 'admin.close':'Tutup','admin.history':'Riwayat','admin.restore':'Pulihkan','admin.delete':'Hapus','admin.save':'Simpan','admin.add_new':'{name} baru','admin.detail':'Detail {name}',
 'admin.convert_to_customer':'Konversi ke Customer','admin.archived_notice':'Data ini diarsipkan (soft delete).','admin.history_title':'Riwayat perubahan','admin.data_restored':'Data dipulihkan.','admin.delete_title':'Hapus data',
 'admin.delete_confirm_msg':'Arsipkan <b>{name}</b>? Data tidak dihapus permanen dan dapat dipulihkan.','admin.yes_delete':'Ya, hapus','admin.data_archived':'Data diarsipkan.','admin.data_saved':'Data tersimpan.',
 'admin.sku_used':'SKU sudah dipakai produk lain.','admin.step_min1':'Urutan langkah minimal 1.','admin.no_history':'Belum ada riwayat.','admin.new_data_created':'Data baru dibuat',
 'admin.convert_lead_title':'Konversi lead','admin.convert_lead_msg':'Buat customer baru dari lead <b>{name}</b>?','admin.from_lead_prefix':'Dari lead. ','admin.convert_lead_to_customer':'Konversi ke customer','admin.convert_action':'Konversi',
 'admin.customer_created':'Customer dibuat: {name}','admin.new_btn':'+ {name} baru','admin.show_archived':'Tampilkan arsip',
 'admin.product_list':'Daftar Produk','admin.total_stock':'Stok total','admin.stock_adjustment':'Penyesuaian stok','admin.pr_from_lowstock':'Buat PR dari stok menipis','admin.stock_move_history':'Riwayat pergerakan stok',
 'admin.out_of_stock':'Habis','admin.low_stock_short':'Stok menipis','admin.safe':'Aman','admin.badge_out_of_stock':'Stok habis','admin.badge_needs_order':'Perlu order (menipis)','admin.badge_available':'Tersedia',
 'admin.stock_value_cost':'Nilai (harga beli)','admin.stock_moves':'Pergerakan stok',
 'admin.stock_genset':'Stok Genset','admin.stock_parts':'Stok Spare Part & Material',
 'admin.stock_adjust_title':'Penyesuaian stok (memerlukan approval)','admin.submit_approval':'Ajukan approval','admin.new_correct_qty':'Jumlah stok yang benar','admin.adjust_reason':'Alasan penyesuaian',
 'admin.attachment_optional':'Lampiran (opsional)','admin.qty_not_negative':'Jumlah stok tidak boleh negatif.','admin.stock_adjust_title2':'Penyesuaian stok {name}: {from} → {to}','admin.submission_sent':'Pengajuan dikirim: {no}',
 'admin.master_data':'Master Data','admin.user_access':'User & Access','admin.users_tab':'Pengguna','admin.role_access_tab':'Hak Akses Role','admin.full_name':'Nama lengkap','admin.username':'Username',
 'admin.username_hint':'Huruf kecil tanpa spasi','admin.role':'Role','admin.department':'Departemen','admin.phone':'Telepon','admin.password_new_hint':'Password baru (kosongkan bila tidak diubah)','admin.password_min_hint':'Password (min. 6 karakter)',
 'admin.position':'Jabatan','admin.work_location':'Lokasi kerja','admin.approver':'Atasan / Approver','admin.approval_limit':'Batas nominal approval (Rp)','admin.approval_limit_hint':'0 = pakai batas default role','admin.delegate_to':'Delegasi approval ke','admin.delegate_to_hint':'Isi bila sedang cuti/berhalangan',
 'admin.account_status':'Status akun','admin.status_active':'Aktif','admin.status_inactive':'Nonaktif','admin.status_suspended':'Suspend','admin.login_history':'Riwayat Login','admin.login_history_title':'Riwayat login & aktivitas — {name}','admin.no_history':'Belum ada riwayat.',
 'admin.account_active':'Akun aktif','admin.new_user':'+ Pengguna baru','admin.inactive':'Nonaktif','admin.active':'Aktif','admin.edit_user':'Ubah pengguna','admin.new_user_title':'Pengguna baru',
 'admin.period_lock':'Lock Periode Keuangan','admin.period_lock_hint':'Transaksi dengan tanggal ≤ tanggal ini dianggap terkunci untuk modul finance/reporting.','admin.period_lock_date':'Terkunci sampai tanggal','admin.period_lock_saved':'Tanggal lock periode disimpan.',
 'admin.username_min':'Username minimal 3 karakter (huruf kecil, angka, titik, strip).','admin.username_taken':'Username sudah dipakai.','admin.password_min':'Password minimal 6 karakter.',
 'admin.cannot_change_self':'Anda tidak dapat menonaktifkan / mengganti role akun sendiri.','admin.user_saved':'Pengguna tersimpan.','admin.role_access_title':'Hak akses per role','admin.save_changes_btn':'Simpan perubahan',
 'admin.role_access_hint':'Atur akses tiap menu: <b>—</b> tidak tampil, <b>Lihat</b> hanya baca, <b>Ubah</b> boleh membuat/mengubah. Hak Ubah pada master data juga dibatasi per dataset. Perubahan berlaku pada login berikutnya.',
 'admin.menu':'Menu','admin.see_cost_margin':'Lihat harga beli & margin','admin.own_data_only':'Hanya data milik sendiri','admin.stage_suffix':'(Tahap {n})','admin.none_perm':'—','admin.view_perm':'Lihat','admin.edit_perm':'Ubah',
 'admin.role_access_saved':'Hak akses tersimpan.','admin.role_access_changed':'Perubahan hak akses','admin.role_access_action':'Ubah hak akses',
 'admin.audit_log':'Audit Log','admin.audit_detail':'Detail audit','admin.session':'Sesi','admin.before':'Sebelum','admin.after':'Sesudah','admin.time':'Waktu','admin.user':'Pengguna','admin.action':'Aksi','admin.data':'Data',
 'admin.settings':'Settings','admin.company_profile':'Profil perusahaan','admin.company_name':'Nama perusahaan','admin.npwp':'NPWP','admin.address':'Alamat','admin.business_rules':'Aturan bisnis',
 'admin.min_margin_pct':'Margin minimum tanpa approval (%)','admin.min_margin_hint':'Quotation di bawah nilai ini butuh approval','admin.low_margin_director_pct':'Margin di bawah (%) wajib disetujui Director',
 'admin.max_disc_pct':'Diskon maksimum tanpa approval (%)','admin.quote_valid_days':'Masa berlaku quotation (hari)','admin.default_tax_pct':'PPN default (%)','admin.sla_days':'Batas waktu per tahap New Order (hari)',
 'admin.rental_default':'Default rental (dipakai di Tahap 5)','admin.min_months':'Minimal rental (bulan)','admin.hours_per_month':'Batas pemakaian (jam / bulan)','admin.deposit_months':'Deposit (bulan)','admin.prepay_months':'Pembayaran di muka (bulan)',
 'admin.backup_restore':'Backup & pemulihan data','admin.backup_hint':'Ekspor seluruh data ERP ke satu file JSON, atau pulihkan dari file backup. Lampiran file tidak ikut diekspor.','admin.download_backup':'Unduh backup (JSON)',
 'admin.restore_from_file':'Pulihkan dari file','admin.reset_demo':'Reset ke data contoh','admin.storage_label':'Penyimpanan','admin.storage_idb':'IndexedDB (permanen)','admin.storage_mem':'memori (tidak permanen)',
 'admin.save_settings':'Simpan pengaturan','admin.settings_changed':'Ubah pengaturan','admin.settings_saved':'Pengaturan tersimpan.','admin.backup_format_unknown':'Format file backup tidak dikenali.',
 'admin.restore_title':'Pulihkan data','admin.restore_msg':'Semua data saat ini akan DITIMPA oleh isi file backup. Lanjutkan?','admin.yes_overwrite':'Ya, timpa data','admin.data_restored_relogin':'Data dipulihkan. Silakan login kembali.',
 'admin.restore_failed':'Gagal memulihkan: {msg}','admin.reset_title':'Reset data','admin.reset_msg':'Seluruh data akan dihapus dan diganti dengan data contoh. Tindakan ini tidak dapat dibatalkan.','admin.yes_reset':'Ya, reset',
 'admin.type_col':'Jenis','admin.status_col':'Status','admin.subject_col':'Perihal','admin.nominal_col':'Nominal','admin.requester_col':'Pengaju','admin.submitted_col':'Diajukan','admin.related_doc':'Lihat dokumen terkait',
 'admin.approval_flow':'Alur persetujuan','admin.approver_role':'Approver (role)','admin.decision':'Keputusan','admin.by_col':'Oleh','admin.date_col':'Tanggal','admin.note_col':'Catatan','admin.waiting':'Menunggu',
 'admin.auto_approved_no_step':'Disetujui otomatis (tanpa langkah).','admin.approve_submission':'Setujui pengajuan','admin.reject_submission':'Tolak pengajuan','admin.approve_btn':'Setujui','admin.reject_btn':'Tolak',
 'admin.note_label':'Catatan','admin.note_required_suffix':' (wajib)','admin.submission_approved':'Pengajuan disetujui.','admin.submission_rejected':'Pengajuan ditolak.',
 'admin.approvals_pending':'Menunggu Persetujuan','admin.approvals_done':'Disetujui','admin.approvals_rejected':'Ditolak','admin.approvals_history':'Riwayat Approval','admin.ar_title':'Account Receivable',
 'admin.ar_age':'Umur (hari lewat)'
});
Object.assign(I18N.en,{
 'audit.create':'Create','audit.update':'Update','audit.archive':'Delete (archive)','audit.restore':'Restore','audit.login':'Login','audit.logout':'Logout','audit.period_lock':'Change period lock date',
 'audit.change_password':'Change Password','audit.apply_approval_failed':'Failed to apply approval: {msg}',
 'err.notfound':'Data not found','err.not_authorized_approve':'You are not authorized to approve this request.','err.reject_reason_required':'Rejection reason is required.',
 'err.approve_apply_failed':'Approved, but failed to apply to the document: {msg}. The status change was NOT rolled back — contact Admin / IT.',
 'err.stock_insufficient':'Stock of {name} at {wh} is insufficient (available {have}, needed {need}).',
 'notify.new_approval':'New approval: {title} ({no})','notify.approved_but_failed':'Request {no} ({title}) was approved BUT FAILED to apply: {msg}. Contact Admin.',
 'notify.approved_but_failed_role':'Approval {no} was approved but failed to apply: {msg}','notify.approval_decided':'Request {no} ({title}) {decision}',
 'common.change_password':'Change password','common.approved_upper':'APPROVED','common.rejected_upper':'REJECTED','common.location':'location',
 'common.save':'Save','common.cancel':'Cancel','common.close':'Close','common.back':'Back','common.search':'Search…','common.add':'Add','common.delete':'Delete','common.edit':'Edit',
 'common.new':'New','common.confirm':'Confirm','common.yes_continue':'Yes, continue',
 'apprtype.quotation':'Quotation (discount / margin)','apprtype.purchase_request':'Purchase Request','apprtype.purchase_order':'Purchase Order','apprtype.payment_request':'Payment Request',
 'apprtype.petty_cash':'Petty Cash Expense','apprtype.ship_no_payment':'Shipment Without Payment','apprtype.refund':'Customer Refund','apprtype.deposit_return':'Rental Deposit Return',
 'apprtype.stock_adjust':'Stock Usage / Adjustment','apprtype.warranty_free':'Free Service / Warranty','apprtype.cancellation':'Transaction Cancellation',
 'nav.dashboard':'Dashboard','nav.leads':'Leads','nav.customers':'Customers','nav.followups':'Follow-up','nav.quotations':'Quotation','nav.salesorders':'Sales Order','nav.orders':'New Order Tracking',
 'nav.pr':'Purchase Request','nav.sq':'Supplier Quotation','nav.pc':'Price Comparison','nav.po':'Purchase Order','nav.suppliers':'Supplier','nav.incoming':'Incoming Shipment',
 'nav.products':'Product List','nav.stock_genset':'Genset Stock','nav.stock_parts':'Spare Part Stock','nav.gr':'Goods Receipt','nav.gi':'Goods Issue','nav.transfer':'Location Transfer','nav.opname':'Stock Opname','nav.barcode':'Barcode',
 'nav.invoices':'Customer Invoice','nav.ar':'Account Receivable','nav.si':'Supplier Invoice','nav.ap':'Account Payable','nav.payreq':'Payment Request','nav.bank':'Bank & Cash','nav.petty':'Petty Cash','nav.tax':'Tax','nav.recon':'Bank Reconciliation',
 'nav.rent_units':'Rental Unit','nav.rent_contracts':'Rental Contract','nav.rent_schedule':'Rental Schedule','nav.hourmeter':'Hour Meter','nav.overtime':'Overtime','nav.deposit':'Deposit','nav.rent_return':'Unit Return',
 'nav.svc_req':'Service Request','nav.survey':'Survey','nav.wo':'Work Order','nav.tech_sched':'Technician Schedule','nav.install':'Installation','nav.pm':'Preventive Maintenance','nav.warranty':'Warranty Claim','nav.svc_report':'Service Report',
 'nav.approvals_pending':'Pending Approval','nav.approvals_done':'Approved','nav.approvals_rejected':'Rejected','nav.approvals_history':'Approval History',
 'nav.reports':'Reports','nav.master':'Master Data','nav.users':'User & Access','nav.audit':'Audit Log','nav.settings':'Settings',
 'grp.crm_sales':'CRM & Sales','grp.purchasing':'Purchasing','grp.inventory':'Inventory','grp.finance':'Finance','grp.rental':'Rental','grp.service':'Service & Aftersales','grp.approval':'Approval','grp.other':'Other',
 'ent.users':'User','ent.roles':'Role','ent.leads':'Lead','ent.customers':'Customer','ent.suppliers':'Supplier','ent.products':'Product','ent.categories':'Product Category','ent.brands':'Brand','ent.warehouses':'Warehouse / Location',
 'ent.banks':'Bank Account','ent.taxes':'Tax','ent.payterms':'Payment Terms','ent.deliveryterms':'Delivery Terms','ent.employees':'Employee','ent.departments':'Department','ent.approvalLimits':'Approval Limit','ent.numbering':'Document Numbering',
 'ent.uoms':'Unit of Measure','ent.vehicles':'Vehicle','ent.technicians':'Technician','ent.failcats':'Failure Category','ent.servicetypes':'Service Type','ent.followups':'Follow-up',
 'ent.si':'Supplier Invoice','ent.rent_contracts':'Rental Contract','ent.payreq':'Payment Request','ent.quotations':'Quotation','ent.salesorders':'Sales Order','ent.invoices':'Customer Invoice','ent.orders':'New Order',
 'ent.rent_units':'Rental Unit','ent.pm_schedules':'PM Schedule',
 'stage.sales_input.short':'Sales Input','stage.sales_input.status':'Sales Input','stage.review.short':'Admin Review','stage.review.status':'Under Sales Support Review',
 'stage.warehouse.short':'Stock Check','stage.warehouse.status':'Warehouse Check','stage.finance.short':'Finance Check','stage.finance.status':'Finance Check',
 'stage.director.short':'Director Approval','stage.director.status':'Awaiting Director Approval','stage.prepare.short':'Goods Preparation','stage.prepare.status':'Goods Preparation',
 'stage.shipping.short':'Shipping','stage.shipping.status':'In Shipping','stage.delivered.short':'Received by Customer','stage.delivered.status':'Received by Customer',
 'stage.install.short':'Installation','stage.install.status':'Installation & Commissioning','stage.handover.short':'Handover','stage.handover.status':'Handover & Signature',
 'stage.invoice_final.short':'Final Invoice','stage.invoice_final.status':'Final Billing','stage.done.short':'Done','stage.done.status':'Done',
 'svcstatus.0':'Request received','svcstatus.1':'Scheduled','svcstatus.2':'Technician en route','svcstatus.3':'In progress','svcstatus.4':'Waiting for spare part','svcstatus.5':'Waiting for customer approval','svcstatus.6':'Completed','svcstatus.7':'Closed',
 'rentstage.0':'Draft','rentstage.1':'Active','rentstage.2':'Return in Progress','rentstage.3':'Completed','rentstage.4':'Cancelled',
 'login.tagline':'Industrial Genset · Sales, Rental & Service','login.point1':'Controlled New Order approval & workflow','login.point2':'Genset rental & service in one system','login.point3':'Real-time stock, finance, and reports',
 'login.please_login':'PT KENTFORD GROUP INDONESIA. Please sign in.','login.username':'Username','login.password':'Password','login.button':'Sign in','login.demo_title':'Demo accounts','login.demo_hint':'(password for all accounts: {pw}). Click to fill in the username:',
 'login.failed':'Wrong username or password, or the account is inactive.','login.account_inactive':'Account is inactive. Contact Director/Admin.','login.account_suspended':'Account is suspended. Contact Director/Admin.','lang.label':'Language',
 'common.reason':'Reason','common.select':'select','common.all':'All','common.excel':'Excel','common.print_pdf':'Print / PDF','common.no_data':'No data yet.',
 'common.data_count_suffix':'records','common.prev':'Previous','common.page':'Page','common.next':'Next','common.data_list':'Data List',
 'common.comment':'Comment','common.no_activity':'No activity yet.','common.comment_placeholder':'Write a comment… use @username to mention a user',
 'common.send_comment':'Send comment','common.comment_empty':'Comment is still empty.','common.mention_notify':'{name} mentioned you: {text}',
 'common.global_search':'Search customers, quotations, orders, products…','common.notifications':'Notifications',
 'common.storage_warning':'Permanent browser storage (IndexedDB) is not available here. Data is {mode}. Open via http://localhost (see README) for permanent storage.',
 'common.storage_ls':'stored in localStorage (limited)','common.storage_mem':'ONLY in memory and will be lost when the page is closed',
 'common.mark_all_read':'Mark all as read','common.no_notifications':'No notifications.','common.no_results':'No results.','common.logout':'Log out',
 'common.old_password':'Old password','common.new_password_hint':'New password (min. 6 characters)','common.repeat_new_password':'Repeat new password',
 'common.old_password_wrong':'Old password is incorrect.','common.new_password_invalid':'New password must be at least 6 characters and match.','common.password_changed':'Password changed successfully.',
 'common.product':'Product','common.qty':'Qty','common.customer':'Customer','common.supplier':'Supplier','common.payment_terms':'Payment terms','common.delivery_terms':'Delivery terms','common.warranty':'Warranty',
 'common.notes':'Notes','common.subtotal':'Subtotal','common.discount':'Discount','common.dpp':'Taxable base (DPP)','common.ppn':'VAT','common.total':'Total','common.gross_profit':'Gross profit','common.margin':'Margin',
 'common.no_dot':'No.','common.sales':'Sales','common.date':'Date','common.status':'Status','common.type':'Type','common.amount':'Amount','common.price':'Price','common.description':'Description','common.value':'Value',
 'common.method':'Method','common.reference':'Reference','common.recorded_by':'Recorded by','common.attachment':'Attachment','common.activity_comments':'Activity & comments','common.approval':'Approval',
 'common.save_draft':'Save draft','common.save_submit':'Save & submit','common.draft_saved':'Draft saved.','common.action_submitted_reason':'Submitted for approval','common.action_request_approval':'Request approval',
 'common.auto_approved_action':'Auto-approved','common.request_cancellation':'Request cancellation','common.cancellation_reason':'Cancellation reason','common.cancellation_already_pending':'A cancellation request is already pending.',
 'common.cancellation_title':'Cancellation of {label} {no}','common.cancellation_submitted':'Cancellation request sent.','common.save_payment':'Save payment',
 'common.warehouse':'Warehouse','common.file':'File','common.balance':'Balance','common.account':'Account','common.category':'Category','common.location_':'Location',
 'common.no_data_yet':'No data yet.','common.confirm_action':'Confirm','common.save_changes':'Save changes','common.print':'Print','common.upload':'Upload',
 'quot.reason_expired':'Validity period ended','quot.action_auto_expired':'Auto-expired','quot.desc_spec':'Description / specification','quot.buy_price_rp':'Buy price (Rp)','quot.sell_price_rp':'Sell price (Rp)','quot.disc_pct':'Discount %',
 'quot.pic_customer':'Customer PIC','quot.sales_pic':'Sales PIC','quot.valid_until':'Valid until','quot.tax_pct':'VAT (%)','quot.lead_time':'Lead time','quot.lead_time_ph':'e.g. 4 weeks','quot.warranty_ph':'e.g. 12 months / 2,000 hours',
 'quot.products_prices':'Products & prices','quot.buy_price':'Buy price','quot.badge_below_threshold':'Below threshold → needs approval','quot.warn_disc_exceeds':'Discount {disc} exceeds the limit of {max} — the quotation will require approval.',
 'quot.warn_margin_below':'Price/margin is below the threshold — the quotation will require approval.','quot.err_min_one_product':'Add at least one product.','quot.err_qty_positive':'Qty on every line must be greater than 0.',
 'quot.err_price_disc_invalid':'Invalid price / discount.','quot.err_valid_after_date':'The valid-until date must be after the quotation date.','quot.action_update':'Edit quotation',
 'quot.approval_reason':'Margin {margin} (limit {marginLimit}), max discount {disc} (limit {discLimit})','quot.submitted_for_approval':'Quotation submitted for approval.','quot.reason_auto_approve':'Meets margin & discount thresholds',
 'quot.auto_approved':'Quotation auto-approved (meets margin & discount thresholds).','quot.new':'New quotation','quot.not_found':'Quotation not found.','quot.no_right_create':'You are not authorized to create a quotation.',
 'quot.make_revision':'Create revision','quot.mark_sent':'Mark as sent to customer','quot.rejected_by_customer':'Rejected by customer','quot.accepted_by_customer':'Accepted by customer','quot.make_so':'Create Sales Order',
 'quot.data_title':'Quotation data','quot.rejected_prefix':'Rejected','quot.value_summary':'Value summary','quot.revisions':'Revision versions','quot.reason_sent':'Sent to customer','quot.action_sent':'Sent to customer',
 'quot.status_sent_toast':'Status: Sent.','quot.reason_won':'Accepted by customer','quot.action_won':'Accepted by customer','quot.toast_won':'Quotation accepted by customer.','quot.lost_confirm_msg':'Record the customer\'s reason for rejecting.',
 'quot.customer_prefix':'Customer: ','quot.action_lost':'Rejected by customer','quot.revise_confirm_msg':'Create a new revision from <b>{no}</b>? The old version will be status <i>Revised</i> and cannot be edited.','quot.action_revised':'Revised',
 'quot.revision_created':'Revision created.','quot.so_created':'Sales Order created: {no}','quot.reason_approval_approved':'Approval approved','quot.action_approved':'Approved','quot.notify_approved':'Quotation {no} approved.',
 'quot.action_rejected':'Rejected','quot.notify_rejected':'Quotation {no} rejected: {note}',
 'so.err_quote_status':'The quotation must be Approved / Sent / Accepted.','so.err_already_exists':'A Sales Order for this quotation already exists.','so.reason_created':'Sales Order {no} created','so.action_accepted':'Accepted (SO created)',
 'so.action_link':'Link Sales Order','so.action_cancelled':'Cancelled','so.no_so':'SO No.','so.not_found':'Sales Order not found.','so.order_info':'Order information','so.items':'Items','so.make_invoice':'Create invoice',
 'so.billed':'Billed','so.reason_invoice_created':'Invoice created','so.action_processed':'Processing',
 'inv.due_date':'Due date','inv.paid':'Paid','inv.none_yet':'No invoices yet.','inv.err_full_only_if_none':'A full invoice can only be created if no other invoice exists for this SO.',
 'inv.err_exceeds_remaining':'The invoice amount exceeds the remaining Sales Order balance ({amt} before VAT).','inv.type_settlement':'Settlement','inv.type_full':'Full payment','inv.type':'Invoice type','inv.dp_pct':'Down payment percentage (%) — DP type only',
 'inv.invoice_date':'Invoice date','inv.due_days':'Due (days)','inv.note_optional':'Description (optional)','inv.pre_so_summary':'SO total (DPP): <b>{total}</b> • already billed: <b>{used}</b> • remaining: <b>{remaining}</b>',
 'inv.err_dp_pct_invalid':'Invalid down payment percentage.','inv.created':'Invoice created: {no}','inv.no_invoice':'Invoice No.','inv.not_found':'Invoice not found.','inv.info_title':'Invoice information','inv.aging':'Aging',
 'inv.incoming_payments':'Incoming payments','inv.proof':'Proof','inv.no_payments_yet':'No payments yet.','inv.outstanding':'Outstanding','inv.record_payment':'Record payment','inv.date_received':'Date received',
 'inv.amount_received_rp':'Amount received (Rp)','inv.destination_account':'Destination account','inv.ref_no':'Reference No. / transfer proof','inv.transfer_proof':'Transfer proof (upload)','inv.pre_outstanding':'Outstanding balance: <b>{amt}</b>',
 'inv.err_amount_positive':'Amount must be greater than 0.','inv.err_amount_exceeds':'Amount exceeds the outstanding balance ({amt}).','inv.reason_payment':'Payment {amt}','inv.action_record_payment':'Record payment',
 'inv.payment_recorded':'Payment recorded. Status: {status}','inv.notify_payment_received':'Payment {amt} received for {no} ({status}).',
 'pr.source':'Source','pr.needed_by':'Needed by','pr.items_requested':'Items requested','pr.notes_reason':'Notes / reason','pr.reason_no_rule':'No approval rule','pr.auto_approved':'PR auto-approved (no approval rule).',
 'pr.submitted':'PR submitted for approval.','pr.notify_approved':'PR {no} approved.','pr.no_right_create':'You are not authorized to create a Purchase Request.','pr.new':'New PR','pr.no_pr':'PR No.','pr.requester':'Requester',
 'pr.item_count':'Item count','pr.est_value':'Estimated value','pr.not_found':'PR not found.','pr.compare_make_po':'Compare & create PO','pr.request_detail':'Request detail','pr.no_supplier_quote':'No supplier quotation yet.',
 'pr.no_po':'No PO yet.','pr.draft_saved':'PR draft saved.','pr.err_line_incomplete':'Every line must have a product and qty > 0.','pr.no_lowstock':'No products are low on stock right now.',
 'pr.restock_desc':'Restock (stock {stock} / min {min})','pr.auto_lowstock_notes':'Auto-generated from the low-stock list.','pr.draft_from_lowstock':'PR draft created from low stock: {no}',
 'sq.unit_price':'Unit price','sq.lead_time_ph':'e.g. 6 weeks','sq.warranty_label':'Warranty','sq.warranty_ph':'e.g. 12 months','sq.items_prices':'Items & prices','sq.offer_doc':'Offer document',
 'sq.err_incomplete_line':'Complete the product, qty, and price on every line.','sq.saved':'Supplier quotation saved.',
 'pc.select_pr':'Select PR','pc.no_pr_ready':'No PR ready for comparison','pc.no_sq_for_pr':'No Supplier Quotation for this PR yet.','pc.total_price':'Total price','pc.choose_make_po':'Choose & create PO',
 'pc.po_created_reason':'PO created: {no}','pc.po_created_action':'PO created','pc.po_created_toast':'PO created: {no}',
 'po.reason_no_rule':'No approval rule','po.auto_approved':'PO auto-approved.','po.submitted':'PO submitted for approval.','po.notify_approved':'PO {no} approved.','po.no_po':'PO No.','po.currency':'Currency',
 'po.total_idr':'Total (Rp)','po.not_found':'PO not found.','po.mark_sent':'Mark as sent to supplier','po.make_si':'Create Supplier Invoice','po.info_title':'PO information','po.related_pr':'Related PR','po.rate':'rate',
 'po.incoterm':'Incoterm','po.received':'Received','po.in_rupiah':'In Rupiah','po.shipment_tracking':'Shipment tracking','po.no_notes':'No notes yet.','po.update_eta':'+ Update ETA / note','po.gr_title':'Goods receipts (GR)',
 'po.no_receipts':'No receipts yet.','po.reason_sent':'Sent to supplier','po.status_sent_toast':'Status: Sent to Supplier.','po.update_tracking':'Update PO tracking','po.eta_estimate':'Estimated arrival',
 'po.tracking_note_ph':'Note (e.g. production/shipping status)','po.tracking_updated':'Tracking updated.','po.eta_none':'Not set yet','po.last_note':'Latest note',
 'gr.no_gr':'GR No.','gr.no_right':'You are not authorized to record goods receipts.','gr.qty_received':'Qty received','gr.serial_no':'Serial No.','gr.receive_at':'Receive at warehouse','gr.receive_date':'Receipt date',
 'gr.items_received':'Items received','gr.docs_hint':'Photo / document (packing list, invoice)','gr.remaining_info':'Not yet received','gr.save_receipt':'Save receipt','gr.not_found':'GR not found.',
 'gr.err_min_one':'Enter at least one item received.','gr.err_exceeds_remaining':'Qty of {name} exceeds the PO remainder (max {max}).','gr.stock_move_type':'Goods receipt','gr.reason_price_update':'Buy price updated from PO {no}',
 'gr.action_price_update':'Buy price update','gr.reason_received':'Goods received {no}','gr.recorded':'Goods receipt recorded: {no}',
 'gi.time':'Time','gi.purpose':'Purpose','gi.from_warehouse':'From warehouse','gi.purpose_ref':'Purpose / reference','gi.recorded':'Goods issue recorded.','gi.new_title':'Goods Issue (manual)',
 'transfer.from':'From','transfer.to':'To','transfer.process':'Process transfer','transfer.goods':'Goods','transfer.err_same_wh':'Source and destination warehouse cannot be the same.','transfer.err_min_one':'Enter at least one item.',
 'transfer.err_stock_insufficient':'Stock of {name} at {wh} is insufficient.','transfer.type_out':'Transfer out','transfer.type_in':'Transfer in','transfer.done':'Transfer complete: {no}',
 'opname.no_right':'You are not authorized to create a stock opname.','opname.new':'New opname','opname.start_count':'Start counting','opname.diff_items':'Discrepant items','opname.not_found':'Opname not found.',
 'opname.system_qty':'System','opname.counted_qty':'Counted','opname.diff':'Difference','opname.finish':'Finish opname','opname.no_stock':'No products with stock at this warehouse.','opname.err_negative':'Counted quantity cannot be negative.',
 'opname.reason_no_diff':'No discrepancy','opname.done_action':'Completed','opname.no_diff_toast':'Opname completed, no discrepancy.','opname.diff_confirm_msg':'Found {n} discrepant item(s) (value {val}). Stock adjustment requires Manager approval. Continue?',
 'opname.approval_title':'Stock Opname {no} — {wh} ({n} discrepant item(s))','opname.approval_reason':'Stock opname result','opname.submitted':'Opname submitted for approval: {no}','opname.adjustment_type':'Adjustment (opname)','opname.adjustment_ref':'Stock opname {no}',
 'barcode.scan_hint':'Scan / type a barcode or SKU','barcode.scan_ph':'Click here then scan with a barcode scanner…','barcode.print_labels':'Print barcode labels','barcode.print_selected':'Print selected labels',
 'barcode.not_found':'Barcode/SKU "{code}" not found.','barcode.total_stock':'Total stock','barcode.no_stock':'No stock',
 'si.err_exceeds_remaining':'The invoice amount exceeds the remaining PO balance ({amt} before VAT).','si.not_found':'Supplier Invoice not found.','si.request_payreq':'Request Payment Request','si.outgoing_payments':'Outgoing payments',
 'si.manual_invoice':'Manual invoice','si.amount_dpp_rp':'Amount (DPP, Rp)','si.invoice_attachment':'Invoice attachment','si.err_amount_positive':'Amount must be greater than 0.','si.created':'Supplier invoice created: {no}',
 'si.pre_po_summary':'PO total (DPP): <b>{total}</b> • already billed: <b>{used}</b> • remaining: <b>{remaining}</b>',
 'payreq.submitted':'Payment Request submitted.','payreq.reason_paid_via':'Paid via {no}','payreq.action_outgoing_payment':'Outgoing payment','payreq.action_paid':'Paid','payreq.notify_approved':'Payment Request {no} approved, ready to pay.',
 'payreq.no_right':'You are not authorized to create a Payment Request.','payreq.new':'New Payment Request','payreq.purpose':'Purpose','payreq.nominal':'Amount','payreq.not_found':'Payment Request not found.','payreq.detail':'Detail',
 'payreq.requested_account':'Requested account','payreq.paid_via':'Paid via','payreq.si_ref_label':'Supplier Invoice (for the Pay Supplier Invoice category)','payreq.purpose_desc':'Purpose / description','payreq.nominal_rp':'Amount (Rp)',
 'payreq.source_account':'Source funding account','payreq.needed_before':'Needed before','payreq.attachment_hint':'Attachment (invoice, receipt, etc.)','payreq.purpose_pay':'Payment for {no} — {sup}','payreq.err_pick_si':'Select the Supplier Invoice to pay.',
 'payreq.mark_paid':'Mark as paid','payreq.confirm_payment':'Confirm payment','payreq.paid_from_account':'Paid from account','payreq.pay_date':'Payment date','payreq.balance_insufficient':'Insufficient balance',
 'payreq.balance_insufficient_msg':'The account balance is currently {bal}, less than the amount {amt}. Proceed anyway?','payreq.payment_recorded':'Payment recorded.',
 'petty.topup_desc':'Top-up from bank — {no}','petty.topup_via_payreq':'Top up (via Payment Request)','petty.record_expense':'Record expense','petty.balance':'Petty Cash balance','petty.pending_approval':'Expenses pending approval',
 'petty.total_tx':'Total transactions','petty.record_expense_title':'Record Petty Cash expense (requires approval)','petty.amount_rp':'Amount (Rp)','petty.receipt_hint':'Receipt / proof','petty.pre_balance':'Current balance: <b>{bal}</b>',
 'petty.err_exceeds_balance':'Amount exceeds the petty cash balance.','petty.expense_title':'Petty Cash expense: {desc}',
 'bank.mutation':'Transactions','bank.manual_tx':'Manual transaction','bank.recon':'Reconciliation','bank.reconciled':'Reconciled','bank.not_reconciled':'Not reconciled','bank.tx_saved':'Transaction saved.','bank.desc_payment':'Payment {no}',
 'tax.record_doc':'Record tax document','tax.output_vat':'Output VAT (this month)','tax.input_vat':'Input VAT (this month)','tax.balance':'VAT payable/receivable','tax.rates':'Tax rates','tax.inactive':'Inactive',
 'tax.change_rate_hint':'Change the rate under','tax.docs':'Tax Documents','tax.doc_no':'Document No.','tax.doc_type':'Document type','tax.doc_no_field':'Document number','tax.value_rp':'Value (Rp)','tax.upload_doc':'Upload document','tax.doc_saved':'Tax document saved.',
 'recon.new':'New reconciliation','recon.period':'Period','recon.stmt_hint':'Bank statement lines (paste from your bank statement: date | description | amount, one line per transaction; outgoing amounts should be negative)','recon.start_match':'Start matching',
 'recon.matched':'Matched','recon.not_found':'Reconciliation not found.','recon.statement':'Bank statement','recon.match':'Matched','recon.select_system_tx':'select a system transaction','recon.unmatched':'Not matched','recon.system_unmatched':'System (unmatched)',
 'recon.all_matched':'All matched','recon.save_matching':'Save matching','recon.finish':'Finish reconciliation','recon.err_min_line':'Enter at least one bank statement line.','recon.auto_matched':'Initial matching was created automatically for exact-amount matches.',
 'recon.matching_saved':'Matching saved.','recon.finish_confirm_msg':'There are still {n} bank statement line(s) not matched to the system. Finish anyway?','recon.reason_reconciled':'Reconciled','recon.finished':'Reconciliation completed.',
 'common.late':'Late',
 'dashboard.greeting':'Hello, {name}','dashboard.sales_mtd':'Sales this month','dashboard.so_count_dpp':'{n} Sales Order(s) (DPP)','dashboard.active_quotations':'Active quotations','dashboard.value_prefix':'Value ',
 'dashboard.so_in_progress':'Sales Orders in progress','dashboard.orders_in_progress':'New Orders in progress','dashboard.n_late':'{n} late','dashboard.none_late':'None late','dashboard.total_ar':'Total receivables (AR)',
 'dashboard.n_unpaid_invoices':'{n} unpaid invoice(s)','dashboard.overdue_ar':'Overdue receivables','dashboard.needs_collection':'Needs collection','dashboard.safe':'Safe','dashboard.stock_value':'Stock value (buy price)',
 'dashboard.stock_rows':'{n} stock row(s)','dashboard.low_stock':'Low stock','dashboard.all_safe':'All safe','dashboard.approvals_pending':'Approvals waiting on you','dashboard.quotation_draft':'Quotation draft',
 'dashboard.order_needs_revision':'New Order not yet sent / needs revision','dashboard.shipment_of':'Shipment {no} — {cust}','dashboard.followup_of':'Follow-up {type}: {cust}','dashboard.my_tasks':'My tasks','dashboard.n_tasks':'{n} tasks',
 'dashboard.no_order_tasks':'No New Order tasks for you.','dashboard.my_approvals':'My approvals','dashboard.n_pending':'{n} pending','dashboard.no_pending_approvals':'No approvals pending.',
 'dashboard.overdue_work':'Overdue work','dashboard.followup_prefix':'Follow-up','dashboard.no_overdue_work':'No overdue work.','dashboard.today_schedule':"Today's schedule",'dashboard.no_schedule_today':'No schedule today.',
 'dashboard.incomplete_docs':'Incomplete documents','dashboard.all_docs_complete':'All your documents are complete.','dashboard.recent_notifications':'Recent notifications','dashboard.no_notifications_yet':'No notifications yet.',
 'dashboard.top_customers':'Top customers (SO value)','dashboard.top_products':'Top products (sales value)','dashboard.sales_performance':'Sales performance (SO value)','dashboard.orders_by_stage':'New Orders by stage','dashboard.n_orders':'{n} order(s)',
 'reports.sales':'Sales Report','reports.quoteconv':'Quotation Conversion','reports.margin':'Gross Profit & Margin','reports.salesperf':'Sales Performance','reports.followup':'Customer Follow-up',
 'reports.orderprog':'New Order Progress','reports.delivery':'Delivery & Installation Report','reports.stockval':'Stock Valuation','reports.lowstock':'Low Stock','reports.invmove':'Inventory Movement',
 'reports.apaging':'AP Aging','reports.cashflow':'Cash Flow','reports.pettyreport':'Petty Cash','reports.taxsummary':'Tax Summary','reports.aging':'AR Aging',
 'reports.col_quote_count':'Quotation count','reports.col_approved':'Approved','reports.col_won':'Won by customer','reports.col_lost':'Lost','reports.col_quote_value':'Quotation value',
 'reports.col_won_value':'Won value','reports.col_conversion':'Conversion','reports.col_sales_dpp':'Sales (base amount)','reports.col_sales_value':'Sales value','reports.col_followups_done':'Follow-ups completed',
 'reports.col_next':'Next','reports.col_order_no':'Order No.','reports.col_need':'Need','reports.col_target_delivery':'Target delivery','reports.col_days_in_stage':'Days in stage','reports.col_lateness':'Lateness',
 'reports.col_delivery_report':'Delivery report','reports.col_date_received':'Date received','reports.col_receiver':'Receiver','reports.col_sj_do':'Delivery/order note','reports.col_installation':'Installation',
 'reports.val_none':'None','reports.val_planned':'Planned','reports.val_not_planned':'Not yet planned',
 'reports.col_sku':'SKU','reports.col_stock':'Stock','reports.col_minimum':'Minimum','reports.col_shortage':'Shortage','reports.col_time':'Time','reports.col_change':'Change','reports.col_by':'By','reports.col_source':'Source',
 'reports.sum_so':'SO count: <b>{n}</b> • Total base amount: <b>{dpp}</b> • Total: <b>{total}</b>','reports.sum_margin':'Sales: <b>{dpp}</b> • Gross profit: <b>{gp}</b> • Margin: <b>{m}</b>',
 'reports.sum_stockval':'Total inventory value: <b>{v}</b>','reports.sum_cashflow':'In: <b>{in}</b> • Out: <b>{out}</b> • Net: <b>{net}</b>','reports.sum_petty':'Ending period balance: <b>{bal}</b>',
 'reports.data_count':'Records: <b>{n}</b>','reports.make_pr_from_list':'Create PR from this list','reports.f_from_date':'From date','reports.f_to_date':'To date','reports.f_pic_sales':'PIC (sales)','reports.f_branch_wh':'Branch / warehouse',
 'reports.apply_filter':'Apply filter',
 'admin.close':'Close','admin.history':'History','admin.restore':'Restore','admin.delete':'Delete','admin.save':'Save','admin.add_new':'New {name}','admin.detail':'{name} details',
 'admin.convert_to_customer':'Convert to Customer','admin.archived_notice':'This record is archived (soft deleted).','admin.history_title':'Change history','admin.data_restored':'Record restored.','admin.delete_title':'Delete record',
 'admin.delete_confirm_msg':'Archive <b>{name}</b>? The record is not permanently deleted and can be restored.','admin.yes_delete':'Yes, delete','admin.data_archived':'Record archived.','admin.data_saved':'Record saved.',
 'admin.sku_used':'SKU is already used by another product.','admin.step_min1':'Step order must be at least 1.','admin.no_history':'No history yet.','admin.new_data_created':'New record created',
 'admin.convert_lead_title':'Convert lead','admin.convert_lead_msg':'Create a new customer from lead <b>{name}</b>?','admin.from_lead_prefix':'From lead. ','admin.convert_lead_to_customer':'Converted to customer','admin.convert_action':'Convert',
 'admin.customer_created':'Customer created: {name}','admin.new_btn':'+ New {name}','admin.show_archived':'Show archived',
 'admin.product_list':'Product List','admin.total_stock':'Total stock','admin.stock_adjustment':'Stock adjustment','admin.pr_from_lowstock':'Create PR from low stock','admin.stock_move_history':'Stock movement history',
 'admin.out_of_stock':'Out of stock','admin.low_stock_short':'Low stock','admin.safe':'Safe','admin.badge_out_of_stock':'Out of stock','admin.badge_needs_order':'Needs order (low)','admin.badge_available':'Available',
 'admin.stock_value_cost':'Value (buy price)','admin.stock_moves':'Stock movements',
 'admin.stock_genset':'Genset Stock','admin.stock_parts':'Spare Part & Material Stock',
 'admin.stock_adjust_title':'Stock adjustment (requires approval)','admin.submit_approval':'Submit for approval','admin.new_correct_qty':'Correct stock quantity','admin.adjust_reason':'Adjustment reason',
 'admin.attachment_optional':'Attachment (optional)','admin.qty_not_negative':'Stock quantity may not be negative.','admin.stock_adjust_title2':'Stock adjustment for {name}: {from} → {to}','admin.submission_sent':'Submitted: {no}',
 'admin.master_data':'Master Data','admin.user_access':'User & Access','admin.users_tab':'Users','admin.role_access_tab':'Role Access','admin.full_name':'Full name','admin.username':'Username',
 'admin.username_hint':'Lowercase, no spaces','admin.role':'Role','admin.department':'Department','admin.phone':'Phone','admin.password_new_hint':'New password (leave blank to keep current)','admin.password_min_hint':'Password (min. 6 characters)',
 'admin.position':'Position','admin.work_location':'Work location','admin.approver':'Approver / Supervisor','admin.approval_limit':'Approval amount limit (Rp)','admin.approval_limit_hint':'0 = use role default limit','admin.delegate_to':'Delegate approval to','admin.delegate_to_hint':'Set when on leave/unavailable',
 'admin.account_status':'Account status','admin.status_active':'Active','admin.status_inactive':'Inactive','admin.status_suspended':'Suspended','admin.login_history':'Login History','admin.login_history_title':'Login & activity history — {name}','admin.no_history':'No history yet.',
 'admin.account_active':'Account active','admin.new_user':'+ New user','admin.inactive':'Inactive','admin.active':'Active','admin.edit_user':'Edit user','admin.new_user_title':'New user',
 'admin.period_lock':'Financial Period Lock','admin.period_lock_hint':'Transactions dated on or before this date are locked for finance/reporting modules.','admin.period_lock_date':'Locked through date','admin.period_lock_saved':'Period lock date saved.',
 'admin.username_min':'Username must be at least 3 characters (lowercase letters, digits, dot, hyphen).','admin.username_taken':'Username is already taken.','admin.password_min':'Password must be at least 6 characters.',
 'admin.cannot_change_self':'You cannot deactivate or change the role of your own account.','admin.user_saved':'User saved.','admin.role_access_title':'Access rights per role','admin.save_changes_btn':'Save changes',
 'admin.role_access_hint':'Set access for each menu: <b>—</b> hidden, <b>View</b> read-only, <b>Edit</b> can create/modify. Edit rights on master data are also restricted per dataset. Changes take effect on next login.',
 'admin.menu':'Menu','admin.see_cost_margin':'View buy price & margin','admin.own_data_only':'Own data only','admin.stage_suffix':'(Stage {n})','admin.none_perm':'—','admin.view_perm':'View','admin.edit_perm':'Edit',
 'admin.role_access_saved':'Access rights saved.','admin.role_access_changed':'Access rights change','admin.role_access_action':'Change access rights',
 'admin.audit_log':'Audit Log','admin.audit_detail':'Audit detail','admin.session':'Session','admin.before':'Before','admin.after':'After','admin.time':'Time','admin.user':'User','admin.action':'Action','admin.data':'Data',
 'admin.settings':'Settings','admin.company_profile':'Company profile','admin.company_name':'Company name','admin.npwp':'Tax ID (NPWP)','admin.address':'Address','admin.business_rules':'Business rules',
 'admin.min_margin_pct':'Minimum margin without approval (%)','admin.min_margin_hint':'Quotations below this value require approval','admin.low_margin_director_pct':'Margin below (%) requires Director approval',
 'admin.max_disc_pct':'Maximum discount without approval (%)','admin.quote_valid_days':'Quotation validity (days)','admin.default_tax_pct':'Default VAT (%)','admin.sla_days':'Time limit per New Order stage (days)',
 'admin.rental_default':'Rental defaults (used in Stage 5)','admin.min_months':'Minimum rental (months)','admin.hours_per_month':'Usage limit (hours / month)','admin.deposit_months':'Deposit (months)','admin.prepay_months':'Prepayment (months)',
 'admin.backup_restore':'Backup & data recovery','admin.backup_hint':'Export all ERP data to a single JSON file, or restore from a backup file. File attachments are not included in the export.','admin.download_backup':'Download backup (JSON)',
 'admin.restore_from_file':'Restore from file','admin.reset_demo':'Reset to sample data','admin.storage_label':'Storage','admin.storage_idb':'IndexedDB (permanent)','admin.storage_mem':'memory (not permanent)',
 'admin.save_settings':'Save settings','admin.settings_changed':'Settings change','admin.settings_saved':'Settings saved.','admin.backup_format_unknown':'Unrecognized backup file format.',
 'admin.restore_title':'Restore data','admin.restore_msg':'All current data will be OVERWRITTEN by the backup file contents. Continue?','admin.yes_overwrite':'Yes, overwrite','admin.data_restored_relogin':'Data restored. Please log in again.',
 'admin.restore_failed':'Restore failed: {msg}','admin.reset_title':'Reset data','admin.reset_msg':'All data will be deleted and replaced with sample data. This action cannot be undone.','admin.yes_reset':'Yes, reset',
 'admin.type_col':'Type','admin.status_col':'Status','admin.subject_col':'Subject','admin.nominal_col':'Amount','admin.requester_col':'Requester','admin.submitted_col':'Submitted','admin.related_doc':'View related document',
 'admin.approval_flow':'Approval flow','admin.approver_role':'Approver (role)','admin.decision':'Decision','admin.by_col':'By','admin.date_col':'Date','admin.note_col':'Note','admin.waiting':'Pending',
 'admin.auto_approved_no_step':'Auto-approved (no steps).','admin.approve_submission':'Approve request','admin.reject_submission':'Reject request','admin.approve_btn':'Approve','admin.reject_btn':'Reject',
 'admin.note_label':'Note','admin.note_required_suffix':' (required)','admin.submission_approved':'Request approved.','admin.submission_rejected':'Request rejected.',
 'admin.approvals_pending':'Pending Approval','admin.approvals_done':'Approved','admin.approvals_rejected':'Rejected','admin.approvals_history':'Approval History','admin.ar_title':'Account Receivable',
 'admin.ar_age':'Age (days overdue)'
});
Object.assign(I18N.zh,{
 'audit.create':'新建','audit.update':'修改','audit.archive':'删除（归档）','audit.restore':'恢复','audit.login':'登录','audit.logout':'登出','audit.period_lock':'修改锁定期间日期',
 'audit.change_password':'修改密码','audit.apply_approval_failed':'审批应用失败：{msg}',
 'err.notfound':'未找到数据','err.not_authorized_approve':'您无权审批此申请。','err.reject_reason_required':'必须填写拒绝原因。',
 'err.approve_apply_failed':'已批准，但应用到单据时失败：{msg}。状态未被回滚 — 请联系管理员/IT。',
 'err.stock_insufficient':'{name} 在 {wh} 的库存不足（现有 {have}，需要 {need}）。',
 'notify.new_approval':'新审批：{title}（{no}）','notify.approved_but_failed':'申请 {no}（{title}）已批准，但应用失败：{msg}。请联系管理员。',
 'notify.approved_but_failed_role':'审批 {no} 已批准但应用失败：{msg}','notify.approval_decided':'申请 {no}（{title}）{decision}',
 'common.change_password':'修改密码','common.approved_upper':'已批准','common.rejected_upper':'已拒绝','common.location':'位置',
 'common.save':'保存','common.cancel':'取消','common.close':'关闭','common.back':'返回','common.search':'搜索…','common.add':'新增','common.delete':'删除','common.edit':'编辑',
 'common.new':'新建','common.confirm':'确认','common.yes_continue':'是，继续',
 'apprtype.quotation':'报价（折扣/毛利）','apprtype.purchase_request':'采购申请','apprtype.purchase_order':'采购订单','apprtype.payment_request':'付款申请',
 'apprtype.petty_cash':'备用金支出','apprtype.ship_no_payment':'未付款发货','apprtype.refund':'客户退款','apprtype.deposit_return':'租赁押金退还',
 'apprtype.stock_adjust':'库存使用/调整','apprtype.warranty_free':'免费服务/保修','apprtype.cancellation':'交易取消',
 'nav.dashboard':'仪表盘','nav.leads':'销售线索','nav.customers':'客户','nav.followups':'跟进','nav.quotations':'报价单','nav.salesorders':'销售订单','nav.orders':'新订单跟踪',
 'nav.pr':'采购申请','nav.sq':'供应商报价','nav.pc':'比价','nav.po':'采购订单','nav.suppliers':'供应商','nav.incoming':'到货跟踪',
 'nav.products':'产品清单','nav.stock_genset':'发电机库存','nav.stock_parts':'备件库存','nav.gr':'入库','nav.gi':'出库','nav.transfer':'库位调拨','nav.opname':'盘点','nav.barcode':'条码',
 'nav.invoices':'客户发票','nav.ar':'应收账款','nav.si':'供应商发票','nav.ap':'应付账款','nav.payreq':'付款申请','nav.bank':'银行与现金','nav.petty':'备用金','nav.tax':'税务','nav.recon':'银行对账',
 'nav.rent_units':'租赁设备','nav.rent_contracts':'租赁合同','nav.rent_schedule':'租赁排期','nav.hourmeter':'工时表','nav.overtime':'超时使用','nav.deposit':'押金','nav.rent_return':'设备归还',
 'nav.svc_req':'服务请求','nav.survey':'现场勘查','nav.wo':'工单','nav.tech_sched':'技术员排班','nav.install':'安装','nav.pm':'预防性维护','nav.warranty':'保修索赔','nav.svc_report':'服务报告',
 'nav.approvals_pending':'待审批','nav.approvals_done':'已批准','nav.approvals_rejected':'已拒绝','nav.approvals_history':'审批历史',
 'nav.reports':'报表','nav.master':'主数据','nav.users':'用户与权限','nav.audit':'审计日志','nav.settings':'系统设置',
 'grp.crm_sales':'客户关系与销售','grp.purchasing':'采购','grp.inventory':'库存','grp.finance':'财务','grp.rental':'租赁','grp.service':'服务与售后','grp.approval':'审批','grp.other':'其他',
 'ent.users':'用户','ent.roles':'角色','ent.leads':'销售线索','ent.customers':'客户','ent.suppliers':'供应商','ent.products':'产品','ent.categories':'产品分类','ent.brands':'品牌','ent.warehouses':'仓库/库位',
 'ent.banks':'银行账户','ent.taxes':'税种','ent.payterms':'付款条款','ent.deliveryterms':'交货条款','ent.employees':'员工','ent.departments':'部门','ent.approvalLimits':'审批额度','ent.numbering':'单据编号规则',
 'ent.uoms':'计量单位','ent.vehicles':'车辆','ent.technicians':'技术员','ent.failcats':'故障类别','ent.servicetypes':'服务类型','ent.followups':'跟进',
 'ent.si':'供应商发票','ent.rent_contracts':'租赁合同','ent.payreq':'付款申请','ent.quotations':'报价单','ent.salesorders':'销售订单','ent.invoices':'客户发票','ent.orders':'新订单',
 'ent.rent_units':'租赁设备','ent.pm_schedules':'保养计划',
 'stage.sales_input.short':'销售录入','stage.sales_input.status':'销售录入','stage.review.short':'管理审核','stage.review.status':'销售支持审核中',
 'stage.warehouse.short':'库存核查','stage.warehouse.status':'仓库核查','stage.finance.short':'财务核查','stage.finance.status':'财务核查',
 'stage.director.short':'总监审批','stage.director.status':'等待总监审批','stage.prepare.short':'备货','stage.prepare.status':'备货中',
 'stage.shipping.short':'发货','stage.shipping.status':'发货中','stage.delivered.short':'客户已签收','stage.delivered.status':'客户已签收',
 'stage.install.short':'安装','stage.install.status':'安装与调试','stage.handover.short':'交接','stage.handover.status':'交接与签字',
 'stage.invoice_final.short':'最终发票','stage.invoice_final.status':'最终开票','stage.done.short':'完成','stage.done.status':'完成',
 'svcstatus.0':'请求已收到','svcstatus.1':'已排期','svcstatus.2':'技术员前往中','svcstatus.3':'处理中','svcstatus.4':'等待备件','svcstatus.5':'等待客户确认','svcstatus.6':'已完成','svcstatus.7':'已关闭',
 'rentstage.0':'草稿','rentstage.1':'使用中','rentstage.2':'归还处理中','rentstage.3':'已完成','rentstage.4':'已取消',
 'login.tagline':'工业发电机 · 销售、租赁与服务','login.point1':'受控的新订单审批与流程','login.point2':'发电机租赁与服务一体化管理','login.point3':'库存、财务与报表实时掌握',
 'login.please_login':'肯特福德集团印尼有限公司。请登录。','login.username':'用户名','login.password':'密码','login.button':'登录','login.demo_title':'演示账号','login.demo_hint':'（所有账号密码均为 {pw}）。点击以填入用户名：',
 'login.failed':'用户名或密码错误，或账号已停用。','login.account_inactive':'账号未启用，请联系管理员。','login.account_suspended':'账号已被暂停，请联系管理员。','lang.label':'语言',
 'common.reason':'原因','common.select':'请选择','common.all':'全部','common.excel':'Excel','common.print_pdf':'打印/PDF','common.no_data':'暂无数据。',
 'common.data_count_suffix':'条记录','common.prev':'上一页','common.page':'第','common.next':'下一页','common.data_list':'数据列表',
 'common.comment':'评论','common.no_activity':'暂无动态。','common.comment_placeholder':'写评论…使用 @用户名 提及用户',
 'common.send_comment':'发送评论','common.comment_empty':'评论内容不能为空。','common.mention_notify':'{name} 提及了您：{text}',
 'common.global_search':'搜索客户、报价单、订单、产品…','common.notifications':'通知',
 'common.storage_warning':'此环境不支持浏览器永久存储（IndexedDB）。数据{mode}。请通过 http://localhost 打开（参见 README）以获得永久存储。',
 'common.storage_ls':'保存在 localStorage 中（容量有限）','common.storage_mem':'仅保存在内存中，关闭页面后将丢失',
 'common.mark_all_read':'全部标记为已读','common.no_notifications':'暂无通知。','common.no_results':'没有结果。','common.logout':'退出登录',
 'common.old_password':'旧密码','common.new_password_hint':'新密码（至少6位）','common.repeat_new_password':'重复新密码',
 'common.old_password_wrong':'旧密码错误。','common.new_password_invalid':'新密码至少6位且两次输入需一致。','common.password_changed':'密码修改成功。',
 'common.product':'产品','common.qty':'数量','common.customer':'客户','common.supplier':'供应商','common.payment_terms':'付款条款','common.delivery_terms':'交货条款','common.warranty':'保修',
 'common.notes':'备注','common.subtotal':'小计','common.discount':'折扣','common.dpp':'计税基数(DPP)','common.ppn':'增值税','common.total':'总计','common.gross_profit':'毛利','common.margin':'毛利率',
 'common.no_dot':'编号','common.sales':'销售','common.date':'日期','common.status':'状态','common.type':'类型','common.amount':'金额','common.price':'价格','common.description':'说明','common.value':'数值',
 'common.method':'方式','common.reference':'参考号','common.recorded_by':'记录人','common.attachment':'附件','common.activity_comments':'动态与评论','common.approval':'审批',
 'common.save_draft':'保存草稿','common.save_submit':'保存并提交','common.draft_saved':'草稿已保存。','common.action_submitted_reason':'已提交审批','common.action_request_approval':'发起审批',
 'common.auto_approved_action':'自动批准','common.request_cancellation':'申请取消','common.cancellation_reason':'取消原因','common.cancellation_already_pending':'已有待处理的取消申请。',
 'common.cancellation_title':'取消 {label} {no}','common.cancellation_submitted':'取消申请已提交。','common.save_payment':'保存付款',
 'common.warehouse':'仓库','common.file':'文件','common.balance':'余额','common.account':'账户','common.category':'分类','common.location_':'位置',
 'common.no_data_yet':'暂无数据。','common.confirm_action':'确认','common.save_changes':'保存更改','common.print':'打印','common.upload':'上传',
 'quot.reason_expired':'有效期已过','quot.action_auto_expired':'自动过期','quot.desc_spec':'描述/规格','quot.buy_price_rp':'采购价（Rp）','quot.sell_price_rp':'销售价（Rp）','quot.disc_pct':'折扣 %',
 'quot.pic_customer':'客户联系人','quot.sales_pic':'销售负责人','quot.valid_until':'有效期至','quot.tax_pct':'增值税 (%)','quot.lead_time':'交货周期','quot.lead_time_ph':'例如 4 周','quot.warranty_ph':'例如 12 个月 / 2,000 小时',
 'quot.products_prices':'产品与价格','quot.buy_price':'采购价','quot.badge_below_threshold':'低于阈值 → 需要审批','quot.warn_disc_exceeds':'折扣 {disc} 超过限额 {max} — 该报价单将需要审批。',
 'quot.warn_margin_below':'价格/毛利率低于阈值 — 该报价单将需要审批。','quot.err_min_one_product':'请至少添加一个产品。','quot.err_qty_positive':'每行数量必须大于 0。',
 'quot.err_price_disc_invalid':'价格/折扣无效。','quot.err_valid_after_date':'有效期至必须晚于报价单日期。','quot.action_update':'修改报价单',
 'quot.approval_reason':'毛利率 {margin}（限额 {marginLimit}），最大折扣 {disc}（限额 {discLimit}）','quot.submitted_for_approval':'报价单已提交审批。','quot.reason_auto_approve':'符合毛利率与折扣限额',
 'quot.auto_approved':'报价单已自动批准（符合毛利率与折扣限额）。','quot.new':'新建报价单','quot.not_found':'未找到报价单。','quot.no_right_create':'您无权创建报价单。',
 'quot.make_revision':'创建修订版','quot.mark_sent':'标记为已发送给客户','quot.rejected_by_customer':'客户已拒绝','quot.accepted_by_customer':'客户已接受','quot.make_so':'创建销售订单',
 'quot.data_title':'报价单数据','quot.rejected_prefix':'已拒绝','quot.value_summary':'金额汇总','quot.revisions':'修订版本','quot.reason_sent':'已发送给客户','quot.action_sent':'已发送给客户',
 'quot.status_sent_toast':'状态：已发送。','quot.reason_won':'客户已接受','quot.action_won':'客户已接受','quot.toast_won':'报价单已被客户接受。','quot.lost_confirm_msg':'请记录客户拒绝的原因。',
 'quot.customer_prefix':'客户：','quot.action_lost':'客户已拒绝','quot.revise_confirm_msg':'要基于 <b>{no}</b> 创建新修订版吗？旧版本状态将变为<i>已修订</i>且不可再编辑。','quot.action_revised':'已修订',
 'quot.revision_created':'修订版已创建。','quot.so_created':'销售订单已创建：{no}','quot.reason_approval_approved':'审批已批准','quot.action_approved':'已批准','quot.notify_approved':'报价单 {no} 已批准。',
 'quot.action_rejected':'已拒绝','quot.notify_rejected':'报价单 {no} 已被拒绝：{note}',
 'so.err_quote_status':'报价单状态必须为已批准/已发送/已接受。','so.err_already_exists':'该报价单已存在对应的销售订单。','so.reason_created':'销售订单 {no} 已创建','so.action_accepted':'已接受（销售订单已创建）',
 'so.action_link':'关联销售订单','so.action_cancelled':'已取消','so.no_so':'销售订单号','so.not_found':'未找到销售订单。','so.order_info':'订单信息','so.items':'项目','so.make_invoice':'创建发票',
 'so.billed':'已开票','so.reason_invoice_created':'发票已创建','so.action_processed':'处理中',
 'inv.due_date':'到期日','inv.paid':'已付款','inv.none_yet':'暂无发票。','inv.err_full_only_if_none':'仅当该销售订单尚无其他发票时，才能创建全额发票。',
 'inv.err_exceeds_remaining':'发票金额超过销售订单剩余金额（税前 {amt}）。','inv.type_settlement':'结清','inv.type_full':'全额付款','inv.type':'发票类型','inv.dp_pct':'预付款百分比 (%) — 仅限 DP 类型',
 'inv.invoice_date':'发票日期','inv.due_days':'到期天数','inv.note_optional':'说明（可选）','inv.pre_so_summary':'销售订单总额（DPP）：<b>{total}</b> • 已开票：<b>{used}</b> • 剩余：<b>{remaining}</b>',
 'inv.err_dp_pct_invalid':'预付款百分比无效。','inv.created':'发票已创建：{no}','inv.no_invoice':'发票号','inv.not_found':'未找到发票。','inv.info_title':'发票信息','inv.aging':'账龄',
 'inv.incoming_payments':'收款记录','inv.proof':'凭证','inv.no_payments_yet':'暂无付款记录。','inv.outstanding':'未收余额','inv.record_payment':'登记付款','inv.date_received':'收款日期',
 'inv.amount_received_rp':'收款金额（Rp）','inv.destination_account':'收款账户','inv.ref_no':'参考号/转账凭证','inv.transfer_proof':'转账凭证（上传）','inv.pre_outstanding':'未收余额：<b>{amt}</b>',
 'inv.err_amount_positive':'金额必须大于 0。','inv.err_amount_exceeds':'金额超过未收余额（{amt}）。','inv.reason_payment':'付款 {amt}','inv.action_record_payment':'登记付款',
 'inv.payment_recorded':'付款已登记。状态：{status}','inv.notify_payment_received':'已收到 {no} 的付款 {amt}（{status}）。',
 'pr.source':'来源','pr.needed_by':'需求日期','pr.items_requested':'申请物品','pr.notes_reason':'备注/原因','pr.reason_no_rule':'无审批规则','pr.auto_approved':'采购申请已自动批准（无审批规则）。',
 'pr.submitted':'采购申请已提交审批。','pr.notify_approved':'采购申请 {no} 已批准。','pr.no_right_create':'您无权创建采购申请。','pr.new':'新建采购申请','pr.no_pr':'采购申请号','pr.requester':'申请人',
 'pr.item_count':'项目数','pr.est_value':'预估金额','pr.not_found':'未找到采购申请。','pr.compare_make_po':'比价并创建采购订单','pr.request_detail':'申请详情','pr.no_supplier_quote':'暂无供应商报价。',
 'pr.no_po':'暂无采购订单。','pr.draft_saved':'采购申请草稿已保存。','pr.err_line_incomplete':'每行必须包含产品且数量大于 0。','pr.no_lowstock':'目前没有库存不足的产品。',
 'pr.restock_desc':'补货（现有库存 {stock} / 最低 {min}）','pr.auto_lowstock_notes':'根据低库存清单自动生成。','pr.draft_from_lowstock':'已从低库存生成采购申请草稿：{no}',
 'sq.unit_price':'单价','sq.lead_time_ph':'例如 6 周','sq.warranty_label':'保修','sq.warranty_ph':'例如 12 个月','sq.items_prices':'项目与价格','sq.offer_doc':'报价文件',
 'sq.err_incomplete_line':'请填写每行的产品、数量和价格。','sq.saved':'供应商报价已保存。',
 'pc.select_pr':'选择采购申请','pc.no_pr_ready':'没有可比价的采购申请','pc.no_sq_for_pr':'该采购申请尚无供应商报价。','pc.total_price':'总价','pc.choose_make_po':'选择并创建采购订单',
 'pc.po_created_reason':'采购订单已创建：{no}','pc.po_created_action':'采购订单已创建','pc.po_created_toast':'采购订单已创建：{no}',
 'po.reason_no_rule':'无审批规则','po.auto_approved':'采购订单已自动批准。','po.submitted':'采购订单已提交审批。','po.notify_approved':'采购订单 {no} 已批准。','po.no_po':'采购订单号','po.currency':'币种',
 'po.total_idr':'总额（Rp）','po.not_found':'未找到采购订单。','po.mark_sent':'标记为已发送给供应商','po.make_si':'创建供应商发票','po.info_title':'采购订单信息','po.related_pr':'相关采购申请','po.rate':'汇率',
 'po.incoterm':'贸易条款','po.received':'已收货','po.in_rupiah':'折合印尼盾','po.shipment_tracking':'物流跟踪','po.no_notes':'暂无记录。','po.update_eta':'+ 更新预计到货/备注','po.gr_title':'入库记录（GR）',
 'po.no_receipts':'尚未收货。','po.reason_sent':'已发送给供应商','po.status_sent_toast':'状态：已发送给供应商。','po.update_tracking':'更新采购订单跟踪','po.eta_estimate':'预计到货日期',
 'po.tracking_note_ph':'备注（例如生产/发货状态）','po.tracking_updated':'跟踪信息已更新。','po.eta_none':'尚未设置','po.last_note':'最新备注',
 'gr.no_gr':'入库单号','gr.no_right':'您无权记录入库。','gr.qty_received':'收货数量','gr.serial_no':'序列号','gr.receive_at':'收货仓库','gr.receive_date':'收货日期',
 'gr.items_received':'收货明细','gr.docs_hint':'照片/文件（装箱单、发票）','gr.remaining_info':'尚未收货','gr.save_receipt':'保存收货','gr.not_found':'未找到入库单。',
 'gr.err_min_one':'请至少填写一项收货。','gr.err_exceeds_remaining':'{name} 的数量超过采购订单剩余数量（最多 {max}）。','gr.stock_move_type':'入库','gr.reason_price_update':'从采购订单 {no} 更新采购价',
 'gr.action_price_update':'更新采购价','gr.reason_received':'已入库 {no}','gr.recorded':'入库已记录：{no}',
 'gi.time':'时间','gi.purpose':'用途','gi.from_warehouse':'来源仓库','gi.purpose_ref':'用途/参考','gi.recorded':'出库已记录。','gi.new_title':'出库（手动）',
 'transfer.from':'从','transfer.to':'到','transfer.process':'处理调拨','transfer.goods':'货物','transfer.err_same_wh':'来源仓库和目标仓库不能相同。','transfer.err_min_one':'请至少填写一项货物。',
 'transfer.err_stock_insufficient':'{name} 在 {wh} 的库存不足。','transfer.type_out':'调出','transfer.type_in':'调入','transfer.done':'调拨已完成：{no}',
 'opname.no_right':'您无权创建盘点。','opname.new':'新建盘点','opname.start_count':'开始盘点','opname.diff_items':'差异项','opname.not_found':'未找到盘点单。',
 'opname.system_qty':'系统数量','opname.counted_qty':'盘点数量','opname.diff':'差异','opname.finish':'完成盘点','opname.no_stock':'该仓库没有任何有库存的产品。','opname.err_negative':'盘点数量不能为负。',
 'opname.reason_no_diff':'无差异','opname.done_action':'已完成','opname.no_diff_toast':'盘点完成，无差异。','opname.diff_confirm_msg':'发现 {n} 项差异（价值 {val}）。库存调整需要经理审批。是否继续？',
 'opname.approval_title':'盘点 {no} — {wh}（{n} 项差异）','opname.approval_reason':'盘点结果','opname.submitted':'盘点已提交审批：{no}','opname.adjustment_type':'调整（盘点）','opname.adjustment_ref':'盘点 {no}',
 'barcode.scan_hint':'扫描或输入条码/SKU','barcode.scan_ph':'点击此处，然后用条码扫描器扫描…','barcode.print_labels':'打印条码标签','barcode.print_selected':'打印所选标签',
 'barcode.not_found':'未找到条码/SKU "{code}"。','barcode.total_stock':'总库存','barcode.no_stock':'无库存',
 'si.err_exceeds_remaining':'发票金额超过采购订单剩余金额（税前 {amt}）。','si.not_found':'未找到供应商发票。','si.request_payreq':'申请付款申请','si.outgoing_payments':'付款记录',
 'si.manual_invoice':'手动发票','si.amount_dpp_rp':'金额（DPP，Rp）','si.invoice_attachment':'发票附件','si.err_amount_positive':'金额必须大于 0。','si.created':'供应商发票已创建：{no}',
 'si.pre_po_summary':'采购订单总额（DPP）：<b>{total}</b> • 已开票：<b>{used}</b> • 剩余：<b>{remaining}</b>',
 'payreq.submitted':'付款申请已提交。','payreq.reason_paid_via':'通过 {no} 付款','payreq.action_outgoing_payment':'付款支出','payreq.action_paid':'已付款','payreq.notify_approved':'付款申请 {no} 已批准，可以付款。',
 'payreq.no_right':'您无权创建付款申请。','payreq.new':'新建付款申请','payreq.purpose':'用途','payreq.nominal':'金额','payreq.not_found':'未找到付款申请。','payreq.detail':'详情',
 'payreq.requested_account':'申请账户','payreq.paid_via':'付款账户','payreq.si_ref_label':'供应商发票（当分类为“支付供应商发票”时）','payreq.purpose_desc':'用途/说明','payreq.nominal_rp':'金额（Rp）',
 'payreq.source_account':'资金来源账户','payreq.needed_before':'需求截止日期','payreq.attachment_hint':'附件（发票、收据等）','payreq.purpose_pay':'支付 {no} — {sup}','payreq.err_pick_si':'请选择要支付的供应商发票。',
 'payreq.mark_paid':'标记为已付款','payreq.confirm_payment':'确认付款','payreq.paid_from_account':'付款账户','payreq.pay_date':'付款日期','payreq.balance_insufficient':'余额不足',
 'payreq.balance_insufficient_msg':'该账户当前余额为 {bal}，少于金额 {amt}。是否仍要继续？','payreq.payment_recorded':'付款已登记。',
 'petty.topup_desc':'银行充值 — {no}','petty.topup_via_payreq':'充值（通过付款申请）','petty.record_expense':'登记支出','petty.balance':'备用金余额','petty.pending_approval':'待审批支出',
 'petty.total_tx':'交易总数','petty.record_expense_title':'登记备用金支出（需要审批）','petty.amount_rp':'金额（Rp）','petty.receipt_hint':'收据/凭证','petty.pre_balance':'当前余额：<b>{bal}</b>',
 'petty.err_exceeds_balance':'金额超过备用金余额。','petty.expense_title':'备用金支出：{desc}',
 'bank.mutation':'流水','bank.manual_tx':'手动交易','bank.recon':'对账','bank.reconciled':'已对账','bank.not_reconciled':'未对账','bank.tx_saved':'交易已保存。','bank.desc_payment':'付款 {no}',
 'tax.record_doc':'登记税务单据','tax.output_vat':'销项税（本月）','tax.input_vat':'进项税（本月）','tax.balance':'应补/应退税额','tax.rates':'税率','tax.inactive':'已停用',
 'tax.change_rate_hint':'在此处修改税率：','tax.docs':'税务单据','tax.doc_no':'单据号','tax.doc_type':'单据类型','tax.doc_no_field':'单据编号','tax.value_rp':'金额（Rp）','tax.upload_doc':'上传单据','tax.doc_saved':'税务单据已保存。',
 'recon.new':'新建对账','recon.period':'账期','recon.stmt_hint':'银行对账单行（从银行对账单粘贴：日期 | 说明 | 金额，每行一笔交易；支出金额请填负数）','recon.start_match':'开始匹配',
 'recon.matched':'已匹配','recon.not_found':'未找到对账单。','recon.statement':'银行对账单','recon.match':'匹配','recon.select_system_tx':'选择系统交易','recon.unmatched':'未匹配','recon.system_unmatched':'系统记录（未匹配）',
 'recon.all_matched':'全部匹配','recon.save_matching':'保存匹配','recon.finish':'完成对账','recon.err_min_line':'请至少填写一行对账单记录。','recon.auto_matched':'已自动为金额完全一致的记录完成初步匹配。',
 'recon.matching_saved':'匹配已保存。','recon.finish_confirm_msg':'仍有 {n} 行对账单记录未与系统匹配。是否仍要完成？','recon.reason_reconciled':'已对账','recon.finished':'对账已完成。',
 'common.late':'逾期',
 'dashboard.greeting':'你好，{name}','dashboard.sales_mtd':'本月销售额','dashboard.so_count_dpp':'{n} 个销售订单（DPP）','dashboard.active_quotations':'有效报价','dashboard.value_prefix':'金额 ',
 'dashboard.so_in_progress':'进行中的销售订单','dashboard.orders_in_progress':'进行中的新订单','dashboard.n_late':'{n} 个逾期','dashboard.none_late':'没有逾期','dashboard.total_ar':'应收账款总额（AR）',
 'dashboard.n_unpaid_invoices':'{n} 张未结清发票','dashboard.overdue_ar':'逾期应收账款','dashboard.needs_collection':'需要催收','dashboard.safe':'正常','dashboard.stock_value':'库存价值（采购价）',
 'dashboard.stock_rows':'{n} 行库存','dashboard.low_stock':'库存不足','dashboard.all_safe':'全部正常','dashboard.approvals_pending':'待您审批','dashboard.quotation_draft':'报价草稿',
 'dashboard.order_needs_revision':'新订单尚未发送/需要修改','dashboard.shipment_of':'发货 {no} — {cust}','dashboard.followup_of':'跟进 {type}：{cust}','dashboard.my_tasks':'我的任务','dashboard.n_tasks':'{n} 项任务',
 'dashboard.no_order_tasks':'您没有新订单任务。','dashboard.my_approvals':'我的审批','dashboard.n_pending':'{n} 项待处理','dashboard.no_pending_approvals':'没有待处理的审批。',
 'dashboard.overdue_work':'逾期工作','dashboard.followup_prefix':'跟进','dashboard.no_overdue_work':'没有逾期工作。','dashboard.today_schedule':'今日日程','dashboard.no_schedule_today':'今天没有日程。',
 'dashboard.incomplete_docs':'未完成的文件','dashboard.all_docs_complete':'您的所有文件均已完成。','dashboard.recent_notifications':'最新通知','dashboard.no_notifications_yet':'暂无通知。',
 'dashboard.top_customers':'顶级客户（销售订单金额）','dashboard.top_products':'热销产品（销售金额）','dashboard.sales_performance':'销售业绩（销售订单金额）','dashboard.orders_by_stage':'各阶段新订单','dashboard.n_orders':'{n} 个订单',
 'reports.sales':'销售报表','reports.quoteconv':'报价转化率','reports.margin':'毛利与利润率','reports.salesperf':'销售业绩','reports.followup':'客户跟进',
 'reports.orderprog':'新订单进度','reports.delivery':'交付与安装报表','reports.stockval':'库存估值','reports.lowstock':'低库存','reports.invmove':'库存变动',
 'reports.apaging':'应付账龄','reports.cashflow':'现金流','reports.pettyreport':'备用金','reports.taxsummary':'税务汇总','reports.aging':'应收账龄',
 'reports.col_quote_count':'报价数量','reports.col_approved':'已批准','reports.col_won':'客户接受','reports.col_lost':'已拒绝','reports.col_quote_value':'报价金额',
 'reports.col_won_value':'成交金额','reports.col_conversion':'转化率','reports.col_sales_dpp':'销售额（DPP）','reports.col_sales_value':'销售金额','reports.col_followups_done':'已完成跟进',
 'reports.col_next':'下一次','reports.col_order_no':'订单号','reports.col_need':'需求','reports.col_target_delivery':'目标交货日','reports.col_days_in_stage':'停留天数','reports.col_lateness':'延误',
 'reports.col_delivery_report':'交付报告','reports.col_date_received':'签收日期','reports.col_receiver':'签收人','reports.col_sj_do':'送货单/出货单','reports.col_installation':'安装',
 'reports.val_none':'无','reports.val_planned':'已计划','reports.val_not_planned':'尚未计划',
 'reports.col_sku':'SKU','reports.col_stock':'库存','reports.col_minimum':'最低库存','reports.col_shortage':'缺口','reports.col_time':'时间','reports.col_change':'变动','reports.col_by':'操作人','reports.col_source':'来源',
 'reports.sum_so':'销售订单数：<b>{n}</b> • 总计DPP：<b>{dpp}</b> • 总计：<b>{total}</b>','reports.sum_margin':'销售额：<b>{dpp}</b> • 毛利：<b>{gp}</b> • 利润率：<b>{m}</b>',
 'reports.sum_stockval':'库存总价值：<b>{v}</b>','reports.sum_cashflow':'流入：<b>{in}</b> • 流出：<b>{out}</b> • 净额：<b>{net}</b>','reports.sum_petty':'期末余额：<b>{bal}</b>',
 'reports.data_count':'记录数：<b>{n}</b>','reports.make_pr_from_list':'根据此列表创建采购申请','reports.f_from_date':'起始日期','reports.f_to_date':'截止日期','reports.f_pic_sales':'负责人（销售）','reports.f_branch_wh':'分支/仓库',
 'reports.apply_filter':'应用筛选',
 'admin.close':'关闭','admin.history':'历史记录','admin.restore':'恢复','admin.delete':'删除','admin.save':'保存','admin.add_new':'新建{name}','admin.detail':'{name}详情',
 'admin.convert_to_customer':'转为客户','admin.archived_notice':'此记录已归档（软删除）。','admin.history_title':'变更历史','admin.data_restored':'记录已恢复。','admin.delete_title':'删除记录',
 'admin.delete_confirm_msg':'归档 <b>{name}</b>？数据不会被永久删除，可以恢复。','admin.yes_delete':'是，删除','admin.data_archived':'记录已归档。','admin.data_saved':'记录已保存。',
 'admin.sku_used':'该SKU已被其他产品使用。','admin.step_min1':'步骤顺序最小为1。','admin.no_history':'暂无历史记录。','admin.new_data_created':'新记录已创建',
 'admin.convert_lead_title':'转化线索','admin.convert_lead_msg':'从线索 <b>{name}</b> 创建新客户？','admin.from_lead_prefix':'来自线索。','admin.convert_lead_to_customer':'已转为客户','admin.convert_action':'转化',
 'admin.customer_created':'客户已创建：{name}','admin.new_btn':'+ 新建{name}','admin.show_archived':'显示已归档',
 'admin.product_list':'产品列表','admin.total_stock':'总库存','admin.stock_adjustment':'库存调整','admin.pr_from_lowstock':'根据低库存创建采购申请','admin.stock_move_history':'库存变动历史',
 'admin.out_of_stock':'缺货','admin.low_stock_short':'库存不足','admin.safe':'安全','admin.badge_out_of_stock':'已缺货','admin.badge_needs_order':'需要订购（不足）','admin.badge_available':'有货',
 'admin.stock_value_cost':'价值（采购价）','admin.stock_moves':'库存变动',
 'admin.stock_genset':'发电机库存','admin.stock_parts':'备件与材料库存',
 'admin.stock_adjust_title':'库存调整（需要审批）','admin.submit_approval':'提交审批','admin.new_correct_qty':'正确库存数量','admin.adjust_reason':'调整原因',
 'admin.attachment_optional':'附件（可选）','admin.qty_not_negative':'库存数量不能为负数。','admin.stock_adjust_title2':'{name}库存调整：{from} → {to}','admin.submission_sent':'已提交：{no}',
 'admin.master_data':'主数据','admin.user_access':'用户与权限','admin.users_tab':'用户','admin.role_access_tab':'角色权限','admin.full_name':'姓名','admin.username':'用户名',
 'admin.username_hint':'小写字母，不含空格','admin.role':'角色','admin.department':'部门','admin.phone':'电话','admin.password_new_hint':'新密码（留空则不修改）','admin.password_min_hint':'密码（最少6位）',
 'admin.position':'职位','admin.work_location':'工作地点','admin.approver':'上级 / 审批人','admin.approval_limit':'审批额度上限（Rp）','admin.approval_limit_hint':'0 = 使用角色默认额度','admin.delegate_to':'审批委托给','admin.delegate_to_hint':'休假或无法处理时设置',
 'admin.account_status':'账户状态','admin.status_active':'启用中','admin.status_inactive':'已停用','admin.status_suspended':'已暂停','admin.login_history':'登录历史','admin.login_history_title':'登录与操作历史 — {name}','admin.no_history':'暂无历史记录。',
 'admin.account_active':'账户启用','admin.new_user':'+ 新用户','admin.inactive':'已停用','admin.active':'启用中','admin.edit_user':'编辑用户','admin.new_user_title':'新用户',
 'admin.period_lock':'财务期间锁定','admin.period_lock_hint':'日期早于或等于此日期的交易将在财务/报表模块中被锁定。','admin.period_lock_date':'锁定截止日期','admin.period_lock_saved':'期间锁定日期已保存。',
 'admin.username_min':'用户名至少3个字符（小写字母、数字、点、连字符）。','admin.username_taken':'用户名已被使用。','admin.password_min':'密码至少6个字符。',
 'admin.cannot_change_self':'您不能停用或更改自己账户的角色。','admin.user_saved':'用户已保存。','admin.role_access_title':'各角色权限','admin.save_changes_btn':'保存更改',
 'admin.role_access_hint':'设置每个菜单的权限：<b>—</b> 不显示，<b>查看</b> 仅只读，<b>编辑</b> 可创建/修改。主数据的编辑权限还按数据集单独限制。更改将在下次登录时生效。',
 'admin.menu':'菜单','admin.see_cost_margin':'查看采购价与利润率','admin.own_data_only':'仅本人数据','admin.stage_suffix':'（阶段{n}）','admin.none_perm':'—','admin.view_perm':'查看','admin.edit_perm':'编辑',
 'admin.role_access_saved':'权限已保存。','admin.role_access_changed':'权限变更','admin.role_access_action':'修改权限',
 'admin.audit_log':'审计日志','admin.audit_detail':'审计详情','admin.session':'会话','admin.before':'之前','admin.after':'之后','admin.time':'时间','admin.user':'用户','admin.action':'操作','admin.data':'数据',
 'admin.settings':'设置','admin.company_profile':'公司资料','admin.company_name':'公司名称','admin.npwp':'税号（NPWP）','admin.address':'地址','admin.business_rules':'业务规则',
 'admin.min_margin_pct':'免审批最低利润率（%）','admin.min_margin_hint':'低于此值的报价需要审批','admin.low_margin_director_pct':'利润率低于（%）需总监审批',
 'admin.max_disc_pct':'免审批最高折扣（%）','admin.quote_valid_days':'报价有效期（天）','admin.default_tax_pct':'默认增值税率（%）','admin.sla_days':'新订单各阶段时限（天）',
 'admin.rental_default':'租赁默认值（用于第5阶段）','admin.min_months':'最短租期（月）','admin.hours_per_month':'使用限额（小时/月）','admin.deposit_months':'押金（月）','admin.prepay_months':'预付款（月）',
 'admin.backup_restore':'备份与数据恢复','admin.backup_hint':'将所有ERP数据导出为单个JSON文件，或从备份文件恢复。文件附件不包含在导出内容中。','admin.download_backup':'下载备份（JSON）',
 'admin.restore_from_file':'从文件恢复','admin.reset_demo':'重置为示例数据','admin.storage_label':'存储方式','admin.storage_idb':'IndexedDB（永久）','admin.storage_mem':'内存（非永久）',
 'admin.save_settings':'保存设置','admin.settings_changed':'设置变更','admin.settings_saved':'设置已保存。','admin.backup_format_unknown':'无法识别的备份文件格式。',
 'admin.restore_title':'恢复数据','admin.restore_msg':'当前所有数据将被备份文件内容覆盖。是否继续？','admin.yes_overwrite':'是，覆盖','admin.data_restored_relogin':'数据已恢复，请重新登录。',
 'admin.restore_failed':'恢复失败：{msg}','admin.reset_title':'重置数据','admin.reset_msg':'所有数据将被删除并替换为示例数据。此操作无法撤销。','admin.yes_reset':'是，重置',
 'admin.type_col':'类型','admin.status_col':'状态','admin.subject_col':'主题','admin.nominal_col':'金额','admin.requester_col':'申请人','admin.submitted_col':'提交时间','admin.related_doc':'查看相关单据',
 'admin.approval_flow':'审批流程','admin.approver_role':'审批角色','admin.decision':'审批结果','admin.by_col':'操作人','admin.date_col':'日期','admin.note_col':'备注','admin.waiting':'待处理',
 'admin.auto_approved_no_step':'已自动批准（无需步骤）。','admin.approve_submission':'批准申请','admin.reject_submission':'拒绝申请','admin.approve_btn':'批准','admin.reject_btn':'拒绝',
 'admin.note_label':'备注','admin.note_required_suffix':'（必填）','admin.submission_approved':'申请已批准。','admin.submission_rejected':'申请已拒绝。',
 'admin.approvals_pending':'待审批','admin.approvals_done':'已批准','admin.approvals_rejected':'已拒绝','admin.approvals_history':'审批历史','admin.ar_title':'应收账款',
 'admin.ar_age':'账龄（逾期天数）'
});
