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
  if(!NOAUDIT.has(n))Audit.log('Buat',n,r.id,null,r,reason);
  return r;
 },
 update(n,id,patch,reason,action){
  const r=this.get(n,id);if(!r)throw new Error('Data tidak ditemukan');
  const before={};for(const k in patch)before[k]=clone(r[k]===undefined?null:r[k]);
  Object.assign(r,patch,{updatedAt:nowISO(),updatedBy:Auth.uid()});
  this.save(n);
  if(!NOAUDIT.has(n))Audit.log(action||'Ubah',n,id,before,clone(patch),reason);
  return r;
 },
 remove(n,id,reason){
  const r=this.get(n,id);if(!r)return;
  r.deletedAt=nowISO();r.deletedBy=Auth.uid();r.deleteReason=reason||'';this.save(n);
  Audit.log('Hapus (arsip)',n,id,null,null,reason);
 },
 restore(n,id){
  const r=this.get(n,id);if(!r)return;
  delete r.deletedAt;delete r.deletedBy;delete r.deleteReason;this.save(n);
  Audit.log('Pulihkan',n,id,null,null,'');
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
 async login(username,pw){
  const u=DB.all('users').find(x=>x.username.toLowerCase()===String(username).trim().toLowerCase());
  if(!u||u.active===false)return false;
  if(await this.hash(pw,u.salt)!==u.pw)return false;
  this.set(u);
  this.sid=uid()+' | '+(navigator.userAgent||'').slice(0,60);
  try{localStorage.setItem('kerp_sess',JSON.stringify({id:u.id,sid:this.sid}))}catch(e){}
  Audit.log('Login','users',u.id,null,null,'');
  return true;
 },
 set(u){this.user=u;this.role=DB.get('roles',u.roleId)||null},
 restore(){
  try{const s=JSON.parse(localStorage.getItem('kerp_sess')||'null');
   if(s){const u=DB.get('users',s.id);if(u&&!u.deletedAt&&u.active!==false){this.set(u);this.sid=s.sid;return true}}}catch(e){}
  return false;
 },
 logout(){Audit.log('Logout','users',this.user?.id,null,null,'');this.user=null;this.role=null;try{localStorage.removeItem('kerp_sess')}catch(e){}},
 async setPassword(userId,pw){const salt=uid();const pwh=await this.hash(pw,salt);DB.update('users',userId,{salt,pw:pwh},'Ubah password','Ubah Password')}
};
const can=(page,mode='r')=>{const p=Auth.role?.perm?.[page];return mode==='w'?p==='w':!!p};
const seeCost=()=>!!Auth.role?.seeCost;
const isRole=(...r)=>r.includes(Auth.user?.roleId);
const userName=id=>DB.get('users',id)?.name||'-';

/* ---------- Notifikasi ---------- */
const Notify={
 user(userId,text,link){if(userId&&userId!==Auth.uid())DB.insert('notifications',{userId,text,link:link||'',read:false})},
 role(roleId,text,link){DB.all('users').filter(u=>u.roleId===roleId&&u.active!==false).forEach(u=>this.user(u.id,text,link))},
 mine(){return DB.all('notifications').filter(n=>n.userId===Auth.uid()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))},
 unread(){return this.mine().filter(n=>!n.read).length}
};

/* ---------- Approval engine ---------- */
const APPR_TYPES={
 quotation:'Quotation (diskon / margin)',purchase_request:'Purchase Request',purchase_order:'Purchase Order',payment_request:'Payment Request',
 petty_cash:'Pengeluaran Petty Cash',ship_no_payment:'Pengiriman Tanpa Pembayaran',refund:'Refund Customer',deposit_return:'Pengembalian Deposit Rental',
 stock_adjust:'Penggunaan / Penyesuaian Stok',warranty_free:'Service Gratis / Warranty',cancellation:'Pembatalan Transaksi'
};
const Approval={hooks:{},
 steps(type,amount,meta){
  const L=DB.all('approvalLimits').filter(x=>x.type===type).sort((a,b)=>num(a.step)-num(b.step));
  const roles=L.filter(x=>!num(x.min)||num(amount)>=num(x.min)).map(x=>x.role);
  if(meta&&meta.forceDirector&&!roles.includes('president_director'))roles.push('president_director');
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
 canDecide(a,u=Auth.user){const s=this.cur(a);return !!s&&a.requesterId!==u.id&&(u.roleId===s.role||u.roleId==='president_director')},
 notifyCurrent(a){const s=this.cur(a);if(s)Notify.role(s.role,`Approval baru: ${a.title} (${a.no})`,'#/approvals_pending')},
 decide(id,ok,note){
  const a=DB.get('approvals',id);
  if(!a||!this.canDecide(a))throw new Error('Anda tidak berwenang menyetujui pengajuan ini.');
  if(!ok&&!note)throw new Error('Alasan penolakan wajib diisi.');
  const steps=clone(a.steps),s=steps[a.idx];
  s.status=ok?'Disetujui':'Ditolak';s.by=Auth.uid();s.byName=Auth.user.name;s.at=nowISO();s.note=note||'';
  let status='Menunggu',idx=a.idx;
  if(!ok)status='Ditolak';else{idx++;if(idx>=steps.length)status='Disetujui'}
  DB.update('approvals',id,{steps,idx:Math.min(idx,steps.length-1),status,decidedAt:status==='Menunggu'?null:nowISO()},note,ok?'Approval: Setuju':'Approval: Tolak');
  const b=DB.get('approvals',id);
  let failMsg='';
  if(status==='Menunggu')this.notifyCurrent(b);else failMsg=this.finish(b,status==='Disetujui');
  if(failMsg)throw new Error(`Disetujui, tetapi gagal diterapkan ke dokumen: ${failMsg}. Perubahan status TIDAK dibatalkan — hubungi Admin / IT.`);
  return b;
 },
 finish(a,ok){
  const h=this.hooks[a.type];
  let failMsg='';
  try{if(h)(ok?h.approved:h.rejected)?.(a)}catch(e){console.error(e);failMsg=e.message||String(e)}
  if(failMsg){
   Audit.log('Gagal menerapkan approval: '+failMsg,a.refCol,a.refId,null,null,a.no);
   Notify.user(a.requesterId,`Pengajuan ${a.no} (${a.title}) disetujui TAPI GAGAL diterapkan: ${failMsg}. Hubungi Admin.`,'#/approvals_history');
   Notify.role('president_director',`Approval ${a.no} disetujui tapi gagal diterapkan: ${failMsg}`,'#/approvals_history');
  }else Notify.user(a.requesterId,`Pengajuan ${a.no} (${a.title}) ${ok?'DISETUJUI':'DITOLAK'}`,'#/approvals_history');
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
  if((s?s.qty:0)+delta<0)throw new Error(`Stok ${p?.name||''} di ${DB.get('warehouses',wh)?.name||'lokasi'} tidak cukup (tersedia ${s?s.qty:0}, butuh ${-delta}).`);
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
