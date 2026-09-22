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
  if(e.status||e.followup)cols.push({k:'_d',l:'',sort:false,html:r=>r.deletedAt?UI.badge(t('admin.show_archived')):''});
  const cfg={title:e.title,cols,size:15,
   rows:()=>(opts.rows?opts.rows():DB.col(e.col).filter(r=>Scope.ok(k,r)&&((dt&&dt.arch)||!r.deletedAt))).slice().reverse(),
   onRow:id=>this.open(k,id),
   toolbar:(w?`<button class="btn btn-sm" data-act="crud-new" data-e="${k}">${esc(t('admin.new_btn',{name:e.title}))}</button>`:'')+(w?`<label class="chk mut" style="font-size:12px"><input type="checkbox" data-act="crud-arch" data-dt="__ID__"> ${t('admin.show_archived')}</label>`:''),
   filters:e.status?[{k:'status',l:t('common.status'),opts:()=>Form.opts(e.fields.find(f=>f.k===e.status)).map(o=>o.v),get:r=>r[e.status]}]:[]};
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
  const foot=`<button class="btn btn-o" data-x="c">${t('admin.close')}</button>`+
   (rec?`<button class="btn btn-o" data-x="h">${t('admin.history')}</button>`:'')+
   (rec&&rec.deletedAt&&canEnt(e)?`<button class="btn btn-o" data-x="r">${t('admin.restore')}</button>`:'')+
   (rec&&canW?`<button class="btn btn-d" data-x="d">${t('admin.delete')}</button>`:'')+
   (canW?`<button class="btn" data-x="s">${t('admin.save')}</button>`:'');
  const m=UI.modal({title:rec?t('admin.detail',{name:e.title}):t('admin.add_new',{name:e.title}),wide:true,body:Form.render(fields,vals,!canW)+(k==='leads'&&rec?`<p style="margin-top:12px"><button class="btn btn-o btn-sm" data-x="conv">${t('admin.convert_to_customer')}</button></p>`:'')+(rec&&rec.deletedAt?`<div class="warnbox" style="margin-top:10px">${t('admin.archived_notice')}</div>`:''),foot});
  Form.hydrate(m.body,fields,vals);
  m.el.addEventListener('click',async ev=>{
   const b=ev.target.closest('[data-x]');if(!b)return;const x=b.dataset.x;
   if(x==='c'){m.close();return}
   if(x==='h'){UI.modal({title:t('admin.history_title'),wide:true,body:Crud.history(e.col,id)});return}
   if(x==='r'){DB.restore(e.col,id);m.close();UI.toast(t('admin.data_restored'));Crud.refresh();return}
   if(x==='conv'){m.close();Crud.convertLead(rec);return}
   if(x==='d'){
    const r=await UI.confirm({title:t('admin.delete_title'),msg:t('admin.delete_confirm_msg',{name:esc(e.label(rec))}),reason:true,ok:t('admin.yes_delete'),danger:true});
    if(!r)return;DB.remove(e.col,id,r.reason);m.close();UI.toast(t('admin.data_archived'));Crud.refresh();return;
   }
   if(x==='s'){
    const {v,err}=Form.collect(m.body,fields);
    if(err.length)return UI.toast(err[0],'err');
    try{
     if(e.autoCode&&!rec)v[e.autoCode.k]=Num.next(e.autoCode.type);
     if(e.autoCode&&rec)delete v[e.autoCode.k];
     // Kode partner: format {PULAU}-{PROVINSI}-{URUT} (lihat js/partners.js PartnerCode), bukan lewat Num
     // biasa karena penomorannya per pulau+provinsi, bukan per bulan/tahun.
     if(k==='partners'&&!rec){if(!v.province)throw new Error(t('partner.err_province_required'));v.code=PartnerCode.next(v.province)}
     if(k==='partners'&&rec)delete v.code;
     if(k==='partners')delete v.rating; // rating hanya diubah otomatis dari evaluasi (lihat Partners.recalcRating)
     if(k==='partner_evaluations'){const ks=['scoreSpeed','scorePunctual','scoreTech','scoreTools','scoreQuality','scoreReport','scoreComm','scoreSatisfaction','scoreCost','scoreSop'];v.avgScore=+(sum(ks.map(x=>num(v[x])),x=>x)/ks.length).toFixed(2)}
     if(k==='partner_payments')v.total=num(v.serviceFee)+num(v.transportCost)+num(v.accomCost)+num(v.partsCost)-num(v.taxDeduction);
     if(k==='products'&&!v.barcode)v.barcode=v.sku;
     if(k==='products'&&DB.all('products').some(p=>p.sku===v.sku&&p.id!==id))throw new Error(t('admin.sku_used'));
     if(k==='approvalLimits'&&num(v.step)<1)throw new Error(t('admin.step_min1'));
     // Aftersales partner: General Admin/HR/Sales Support boleh input data awal & follow-up, tapi
     // TIDAK boleh "menyetujui" partner (mengubah status jadi Active) — itu wewenang Admin Aftersales/
     // Direksi (spec section M). Berlaku hanya saat status BERUBAH menjadi Active oleh role ini.
     if(k==='partners'&&isRole('admin_hr_sales')&&v.status==='Active'&&(!rec||rec.status!=='Active'))throw new Error(t('partner.err_hr_cannot_activate'));
     if(rec){DB.update(e.col,id,v,'')}else{DB.insert(e.col,v)}
     m.close();UI.toast(t('admin.data_saved'));Crud.refresh();
    }catch(er){UI.toast(er.message,'err')}
   }
  });
 },
 refresh(){const t=Object.values(DT.inst).filter(d=>document.body.contains(d.el)).pop();if(t)t.draw();App.refreshBell()},
 history(col,id){
  const a=DB.col('audit').filter(x=>x.col===col&&x.ref===id).reverse();
  if(!a.length)return `<div class="empty">${t('admin.no_history')}</div>`;
  return `<div class="tblw"><table><tr><th>${t('admin.time')}</th><th>${t('admin.user')}</th><th>${t('admin.action')}</th><th>${t('admin.before')} → ${t('admin.after')}</th></tr>${a.map(x=>`<tr><td class="nowrap">${fdt(x.at)}</td><td>${esc(x.userName)}</td><td>${esc(x.action)}${x.reason?'<br><small class="mut">'+esc(x.reason)+'</small>':''}</td><td>${Crud.diff(x)}</td></tr>`).join('')}</table></div>`;
 },
 diff(x){
  if(!x.after&&!x.before)return '-';
  if(x.action==='Buat')return `<small class="mut">${t('admin.new_data_created')}</small>`;
  const keys=Object.keys(x.after||{});
  return keys.slice(0,8).map(k=>`<div><small><b>${esc(k)}</b>: ${esc(JSON.stringify(x.before?.[k])?.slice(0,60)??'')} → ${esc(JSON.stringify(x.after[k])?.slice(0,60)??'')}</small></div>`).join('')||'-';
 },
 async convertLead(l){
  const ok=await UI.confirm({title:t('admin.convert_lead_title'),msg:t('admin.convert_lead_msg',{name:esc(l.company||l.name)})});
  if(!ok)return;
  const c=DB.insert('customers',{code:Num.next('CUS'),name:l.company||l.name,pic:l.name,phone:l.phone,email:l.email,salesId:l.salesId,active:true,notes:t('admin.from_lead_prefix')+(l.notes||'')});
  DB.update('leads',l.id,{status:'Menang',customerId:c.id},t('admin.convert_lead_to_customer'),t('admin.convert_action'));
  UI.toast(t('admin.customer_created',{name:c.name}));Router.go('customers/'+c.id);
 }
};
ACT['crud-new']=el=>{const k=el.dataset.e;Crud.open(k,null,el.dataset.pre?JSON.parse(el.dataset.pre):null)};
ACT['crud-arch']=el=>{const d=DT.inst[el.dataset.dt];d.arch=el.checked;d.draw()};

/* halaman entitas generik */
function crudPage(key,title,entKey){
 const ek=entKey||key;
 PAGES[key].render=async(v,param)=>{
  v.innerHTML=UI.pghead(title||PAGES[key].label)+'<div class="card" id="crudbox"></div>';
  Crud.list($('#crudbox'),ek);
  if(param)Crud.open(ek,param);
 };
}
crudPage('leads');crudPage('customers');crudPage('followups');crudPage('suppliers');
// Chart of Accounts, Dokumen Perusahaan (General Admin), Cuti & Izin (HR) — modul minimal (lihat js/schema.js ENT)
crudPage('coa',null,'chart_of_accounts');
crudPage('company_docs',null,'company_documents');
crudPage('leave',null,'leave_requests');

/* follow-up: status terlambat diturunkan dari tanggal */
ENT.followups.fields.find(f=>f.k==='status').badge=true;

/* ---------------- Produk & stok ---------------- */
PAGES.products.render=async(v,param)=>{
 v.innerHTML=UI.pghead(t('admin.product_list'))+'<div class="card" id="crudbox"></div>';
 const e=ENT.products,dt=Crud.list($('#crudbox'),'products');
 dt.cfg.cols.splice(3,0,{k:'_stock',l:t('admin.total_stock'),num:true,text:r=>String(Stock.qty(r.id)),sortv:r=>Stock.qty(r.id)});
 dt.cfg.filters=[{k:'kind',l:t('common.type'),opts:()=>Form.opts(e.fields.find(f=>f.k==='kind')).map(o=>o.v),get:r=>r.kind}];
 dt.init();const cb=$('[data-act="crud-arch"]',dt.el);if(cb)cb.dataset.dt=dt.id;const nb=$('[data-act="crud-new"]',dt.el);if(nb)nb.dataset.dt=dt.id;
 if(param)Crud.open('products',param);
};
function stockPage(key,title,kinds){
 PAGES[key].render=async v=>{
  const canAdj=can('gi','w')||isRole('warehouse','deputy_director','director');
  v.innerHTML=UI.pghead(title,(canAdj?`<button class="btn" data-act="stock-adjust">${t('admin.stock_adjustment')}</button>`:'')+(can('pr','w')?`<button class="btn btn-o" data-act="pr-from-lowstock">${t('admin.pr_from_lowstock')}</button>`:''))+`<div class="card" id="stk"></div><div class="card"><h3>${t('admin.stock_move_history')}</h3><div id="mv"></div></div>`;
  const whs=DB.all('warehouses');
  new DT($('#stk'),{title,size:20,
   rows:()=>DB.all('products').filter(p=>kinds.includes(p.kind)),
   filters:[{k:'kind',l:t('common.type'),opts:()=>kinds,get:r=>r.kind}],
   cols:[{k:'sku',l:t('reports.col_sku')},{k:'name',l:t('common.product')},{k:'kind',l:t('common.type')},{k:'model',l:'Model'},
    ...whs.filter(w=>DB.all('stock').some(s=>s.whId===w.id)||['w_ho','w_ckr','w_plt'].includes(w.id)).map(w=>({k:'w'+w.id,l:w.code,num:true,text:r=>String(Stock.qty(r.id,w.id)),sortv:r=>Stock.qty(r.id,w.id)})),
    {k:'total',l:t('common.total'),num:true,text:r=>String(Stock.qty(r.id)),sortv:r=>Stock.qty(r.id)},{k:'min',l:t('reports.col_minimum'),num:true,text:r=>String(num(r.minStock))},
    {k:'st',l:t('common.status'),text:r=>Stock.qty(r.id)<=0?t('admin.out_of_stock'):Stock.qty(r.id)<=num(r.minStock)&&num(r.minStock)>0?t('admin.low_stock_short'):t('admin.safe'),html:r=>{const q=Stock.qty(r.id),m=num(r.minStock);return q<=0?UI.badge(t('admin.badge_out_of_stock')):(m>0&&q<=m)?UI.badge(t('admin.badge_needs_order')):UI.badge(t('admin.badge_available'))}},
    {k:'val',l:t('admin.stock_value_cost'),num:true,hide:()=>!seeCost(),text:r=>rp(Stock.qty(r.id)*num(r.lastCost)),sortv:r=>Stock.qty(r.id)*num(r.lastCost)}],
   onRow:id=>Router.go('products/'+id)});
  const mvRows=()=>DB.all('stock_moves').slice().reverse().filter(m=>{const p=DB.get('products',m.productId);return p&&kinds.includes(p.kind)});
  new DT($('#mv'),{title:t('admin.stock_moves'),size:10,rows:mvRows,cols:[{k:'at',l:t('reports.col_time'),text:r=>fdt(r.at),sortv:r=>r.at},{k:'p',l:t('common.product'),text:r=>DB.get('products',r.productId)?.name},{k:'w',l:t('common.location_'),text:r=>DB.get('warehouses',r.whId)?.name},
   {k:'type',l:t('common.type')},{k:'delta',l:t('reports.col_change'),num:true,text:r=>(r.delta>0?'+':'')+r.delta},{k:'ref',l:t('common.reference')},{k:'note',l:t('common.notes')},{k:'byName',l:t('reports.col_by')}]});
 };
}
stockPage('stock_genset',t('admin.stock_genset'),['Genset','Engine','Alternator','Aset rental']);
stockPage('stock_parts',t('admin.stock_parts'),['Spare part','Controller','Panel','Kabel & material instalasi','Consumable']);
ACT['stock-adjust']=async()=>{
 const v=await UI.ask({title:t('admin.stock_adjust_title'),ok:t('admin.submit_approval'),fields:[
  F.r('productId',t('common.product'),'products',{req:true}),F.r('whId',t('common.warehouse'),'warehouses',{req:true,filter:w=>['Gudang','Kantor'].includes(w.type)}),F.n('newQty',t('admin.new_correct_qty'),{req:true}),
  F.ta('reason',t('admin.adjust_reason'),{req:true}),F.fl('files',t('admin.attachment_optional'))]});
 if(!v)return;
 if(v.newQty<0)return UI.toast(t('admin.qty_not_negative'),'err');
 const p=DB.get('products',v.productId),cur=Stock.qty(v.productId,v.whId);
 const a=Approval.request({type:'stock_adjust',refCol:'products',refId:v.productId,title:t('admin.stock_adjust_title2',{name:p.name,from:cur,to:v.newQty}),amount:Math.abs(v.newQty-cur)*num(p.lastCost),reason:v.reason,files:v.files,meta:{whId:v.whId,newQty:v.newQty}});
 UI.toast(t('admin.submission_sent',{no:a.no}));
};
Approval.hooks.stock_adjust={
 approved(a){const cur=Stock.qty(a.refId,a.meta.whId);const d=num(a.meta.newQty)-cur;if(d)Stock.change(a.refId,a.meta.whId,d,'Penyesuaian',a.no,a.reason)},
 rejected(){}
};

/* ---------------- Master Data ---------------- */
PAGES.master.render=async(v,param)=>{
 const key=MASTER.includes(param.split('/')[0])?param.split('/')[0]:'customers';
 v.innerHTML=UI.pghead(t('admin.master_data'))+`<div class="tabs">${MASTER.map(k=>`<a href="#/master/${k}" class="${k===key?'on':''}">${esc(ENT[k].title)}</a>`).join('')}</div><div class="card" id="crudbox"></div>`;
 const dt=Crud.list($('#crudbox'),key);
 if(key==='products'){dt.cfg.filters=[];dt.init();}
};

/* ---------------- User & Access ---------------- */
PAGES.users.render=async(v,param)=>{
 const tab=param==='akses'?'akses':'user';
 v.innerHTML=UI.pghead(t('admin.user_access'))+`<div class="tabs"><a href="#/users" class="${tab==='user'?'on':''}">${t('admin.users_tab')}</a><a href="#/users/akses" class="${tab==='akses'?'on':''}">${t('admin.role_access_tab')}</a></div><div id="ub"></div>`;
 tab==='user'?Users.render($('#ub')):Users.roles($('#ub'));
};
/* Users: identitas login kini dikelola oleh backend terpisah kentford-erp-auth/ (lihat
   Auth.apiFetch di js/core.js) — bukan lagi koleksi `users` lokal di IndexedDB. UI/field/tabel
   yang sudah ada dipertahankan persis sama; hanya lapisan penyimpanan di bawahnya yang diganti
   ke panggilan /api/admin/users/*. Field `username` dihapus (backend login pakai email saja). */
const Users={
 _cache:[],
 async load(){
  const r=await Auth.apiFetch('/api/admin/users');
  this._cache=r.ok&&r.users?r.users:[];
  return this._cache;
 },
 byId(id){return this._cache.find(u=>u.id===id)||null},
 fields(rec){
  return [F.t('name',t('admin.full_name'),{req:true}),F.t('email','Email',{req:true,t:'email'}),
   F.s('roleId',t('admin.role'),()=>DB.all('roles').map(r=>({v:r.id,l:r.name})),{req:true}),F.r('deptId',t('admin.department'),'departments'),F.t('phone',t('admin.phone'),{t:'phone'}),
   F.t('jabatan',t('admin.position')),F.t('location',t('admin.work_location')),
   F.s('approverId',t('admin.approver'),()=>this._cache.filter(u=>!rec||u.id!==rec.id).map(u=>({v:u.id,l:u.name}))),
   F.n('approvalLimit',t('admin.approval_limit'),{hint:t('admin.approval_limit_hint')}),
   F.s('delegateTo',t('admin.delegate_to'),()=>this._cache.filter(u=>!rec||u.id!==rec.id).map(u=>({v:u.id,l:u.name})),{hint:t('admin.delegate_to_hint')}),
   F.s('status',t('admin.account_status'),[{v:'active',l:t('admin.status_active')},{v:'inactive',l:t('admin.status_inactive')},{v:'suspended',l:t('admin.status_suspended')}],{req:true,def:'active'}),
   {k:'password',l:rec?t('admin.password_new_hint'):t('admin.password_min_hint'),t:'password',req:!rec,auto:true},
   // Tanda tangan tersimpan milik user (dipakai sbg default cepat saat serah terima New Order — lihat neworder.js ord-handover)
   {k:'savedSignature',l:t('admin.saved_signature'),t:'sig',hint:t('admin.saved_signature_hint')}];
 },
 async render(el){
  const w=can('users','w');
  el.innerHTML='<div class="card" id="ul">'+t('common.loading')+'</div>';
  await this.load();
  new DT($('#ul'),{title:t('admin.users_tab'),rows:()=>this._cache,onRow:id=>w&&Users.edit(id),
   toolbar:w?`<button class="btn btn-sm" data-act="user-new">${t('admin.new_user')}</button>`:'',
   filters:[{k:'role',l:t('admin.role'),opts:()=>DB.all('roles').map(r=>r.name),get:r=>DB.get('roles',r.roleId)?.name}],
   cols:[{k:'name',l:t('admin.full_name')},{k:'role',l:t('admin.role'),text:r=>DB.get('roles',r.roleId)?.name},{k:'email',l:'Email'},
    {k:'status',l:t('common.status'),text:r=>t('admin.status_'+Auth.userStatus(r)),html:r=>UI.badge(t('admin.status_'+Auth.userStatus(r)))},
    {k:'hist',l:t('admin.login_history'),html:r=>`<button class="btn btn-sm btn-o" data-act="user-history" data-id="${r.id}" onclick="event.stopPropagation()">${esc(t('admin.login_history'))}</button>`}]});
 },
 async edit(id){
  const rec=id?this.byId(id):null,fields=this.fields(rec);
  const v=await UI.ask({title:rec?t('admin.edit_user'):t('admin.new_user_title'),fields,vals:rec||{status:'active'},wide:true});
  if(!v)return;
  if(v.password&&v.password.length<8)return UI.toast(t('admin.password_min'),'err');
  if(rec&&id===Auth.user.id&&(v.status!=='active'||v.roleId!==rec.roleId))return UI.toast(t('admin.cannot_change_self'),'err');
  const pw=v.password;delete v.password;
  let r;
  if(rec)r=await Auth.apiFetch('/api/admin/users/'+id,{method:'PUT',body:JSON.stringify(v)});
  else r=await Auth.apiFetch('/api/admin/users',{method:'POST',body:JSON.stringify({...v,password:pw})});
  if(!r.ok)return UI.toast(r.msg||t('admin.user_saved'),'err');
  id=r.user?.id||id;
  if(rec&&pw){const pr=await Auth.apiFetch('/api/admin/users/'+id+'/password',{method:'PUT',body:JSON.stringify({password:pw})});if(!pr.ok)return UI.toast(pr.msg||t('admin.password_min'),'err')}
  UI.toast(t('admin.user_saved'));await this.load();Router.render();
 },
 /* Riwayat login & aktivitas seorang user, diambil dari Audit log lokal (audit log tetap
    tersimpan di IndexedDB, per browser tempat aktivitas terjadi — bukan lagi indikasi lengkap
    lintas-device sejak login pindah ke backend, lihat catatan di laporan deploy). */
 history(id){
  const u=this.byId(id);if(!u)return;
  const rows=DB.col('audit').filter(a=>a.userId===id).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,300);
  UI.modal({title:t('admin.login_history_title',{name:u.name}),wide:true,body:`<div class="tblw"><table><thead><tr><th>${t('admin.time')}</th><th>${t('admin.action')}</th><th>${t('admin.data')}</th></tr></thead><tbody>
   ${rows.map(r=>`<tr><td>${fdt(r.at)}</td><td>${esc(r.action)}</td><td>${esc(r.col||'')} ${esc(r.label||'')}</td></tr>`).join('')||`<tr><td colspan="3" class="mut">${t('admin.no_history')}</td></tr>`}
   </tbody></table></div>`});
 },
 roles(el){
  const w=can('users','w'),roles=DB.all('roles'),pages=Object.keys(PAGES).filter(k=>PAGES[k].render||true);
  const sel=(r,k)=>`<select data-rp="${r.id}|${k}" ${w?'':'disabled'} style="min-width:64px"><option value="" ${!r.perm[k]?'selected':''}>${t('admin.none_perm')}</option><option value="r" ${r.perm[k]==='r'?'selected':''}>${t('admin.view_perm')}</option><option value="w" ${r.perm[k]==='w'?'selected':''}>${t('admin.edit_perm')}</option></select>`;
  el.innerHTML=`<div class="card"><div class="ch">${t('admin.role_access_title')} <span>${w?`<button class="btn btn-sm" data-act="roles-save">${t('admin.save_changes_btn')}</button>`:''}</span></div>
   <p class="mut">${t('admin.role_access_hint')}</p>
   <div class="tblw"><table><thead><tr><th>${t('admin.menu')}</th>${roles.map(r=>`<th>${esc(r.name)}</th>`).join('')}</tr></thead><tbody>
   <tr><td><b>${t('admin.see_cost_margin')}</b></td>${roles.map(r=>`<td><input type="checkbox" data-rf="${r.id}|seeCost" ${r.seeCost?'checked':''} ${w?'':'disabled'}></td>`).join('')}</tr>
   <tr><td><b>${t('admin.own_data_only')}</b></td>${roles.map(r=>`<td><input type="checkbox" data-rf="${r.id}|scopeOwn" ${r.scopeOwn?'checked':''} ${w?'':'disabled'}></td>`).join('')}</tr>
   ${pages.map(k=>`<tr><td>${esc(PAGES[k].label)}${PAGES[k].render?'':' <small class="mut">'+t('admin.stage_suffix',{n:PAGES[k].stage})+'</small>'}</td>${roles.map(r=>`<td>${sel(r,k)}</td>`).join('')}</tr>`).join('')}
   </tbody></table></div></div>`;
 }
};
ACT['user-new']=()=>Users.edit(null);
ACT['user-history']=el=>Users.history(el.dataset.id);
ACT['roles-save']=()=>{
 const roles=DB.all('roles');
 roles.forEach(r=>{
  const perm={};let changed=false;
  $$(`[data-rp^="${r.id}|"]`).forEach(s=>{const k=s.dataset.rp.split('|')[1];if(s.value)perm[k]=s.value});
  const sc=$(`[data-rf="${r.id}|scopeOwn"]`).checked,sk=$(`[data-rf="${r.id}|seeCost"]`).checked;
  if(JSON.stringify(perm)!==JSON.stringify(r.perm)||sc!==!!r.scopeOwn||sk!==!!r.seeCost)DB.update('roles',r.id,{perm,scopeOwn:sc,seeCost:sk},t('admin.role_access_changed'),t('admin.role_access_action'));
 });
 Auth.set(DB.get('users',Auth.user.id));App.nav();UI.toast(t('admin.role_access_saved'));
};

/* ---------------- Audit log ---------------- */
PAGES.audit.render=async v=>{
 v.innerHTML=UI.pghead(t('admin.audit_log'))+'<div class="card" id="al"></div>';
 new DT($('#al'),{title:t('admin.audit_log'),size:20,rows:()=>DB.col('audit').slice().reverse(),
  filters:[{k:'u',l:t('admin.user'),opts:()=>DB.all('users').map(u=>u.name),get:r=>r.userName},{k:'a',l:t('admin.action'),opts:()=>[...new Set(DB.col('audit').map(a=>a.action.split(':')[0]))],get:r=>r.action.split(':')[0]},{k:'c',l:t('admin.data'),opts:()=>[...new Set(DB.col('audit').map(a=>a.col))],get:r=>r.col}],
  onRow:id=>{const a=DB.get('audit',id);UI.modal({title:t('admin.audit_detail'),wide:true,body:UI.kv([[t('admin.time'),fdt(a.at)],[t('admin.user'),esc(a.userName)+' ('+esc(a.roleId)+')'],[t('admin.action'),esc(a.action)],[t('admin.data'),esc(a.col)+' / '+esc(a.label)],[t('common.reason'),esc(a.reason||'-')],[t('admin.session'),esc(a.session||'-')]])+
   `<h3 style="margin-top:12px">${t('admin.before')}</h3><pre style="white-space:pre-wrap;overflow:auto">${esc(JSON.stringify(a.before,null,1)||'-')}</pre><h3>${t('admin.after')}</h3><pre style="white-space:pre-wrap;overflow:auto">${esc(JSON.stringify(a.after,null,1)||'-')}</pre>`})},
  cols:[{k:'at',l:t('admin.time'),text:r=>fdt(r.at),sortv:r=>r.at},{k:'userName',l:t('admin.user')},{k:'action',l:t('admin.action')},{k:'col',l:t('admin.data')},{k:'label',l:t('common.reference')},{k:'reason',l:t('common.reason')}]});
};

/* ---------------- Settings ---------------- */
PAGES.settings.render=async v=>{
 const s=S(),w=can('settings','w');
 const fCo=[F.t('name',t('admin.company_name'),{req:true}),F.t('phone',t('admin.phone'),{t:'phone'}),F.t('email','Email',{t:'email'}),F.t('npwp',t('admin.npwp')),F.ta('address',t('admin.address'))];
 const fRule=[F.pc('minMarginPct',t('admin.min_margin_pct'),{hint:t('admin.min_margin_hint')}),F.pc('lowMarginDirectorPct',t('admin.low_margin_director_pct')),F.pc('maxDiscPct',t('admin.max_disc_pct')),
  F.n('quoteValidDays',t('admin.quote_valid_days')),F.pc('defaultTaxPct',t('admin.default_tax_pct')),F.n('slaDays',t('admin.sla_days'))];
 const fRent=[F.n('minMonths',t('admin.min_months')),F.n('hoursPerMonth',t('admin.hours_per_month')),F.n('depositMonths',t('admin.deposit_months')),F.n('prepayMonths',t('admin.prepay_months'))];
 v.innerHTML=UI.pghead(t('admin.settings'))+`<div class="grid g2"><div class="card"><h3>${t('admin.company_profile')}</h3><div id="sc">${Form.render(fCo,s.company||{},!w)}</div></div>
  <div class="card"><h3>${t('admin.business_rules')}</h3><div id="sr">${Form.render(fRule,s,!w)}</div></div>
  <div class="card"><h3>${t('admin.rental_default')}</h3><div id="sn">${Form.render(fRent,s.rental||{},!w)}</div></div>
  ${isRole('director')?`<div class="card"><h3>${t('admin.period_lock')}</h3><p class="mut">${t('admin.period_lock_hint')}</p>
   <div class="fld"><label>${t('admin.period_lock_date')}</label><input type="date" id="plockdate" value="${esc(PeriodLock.date())}"></div>
   <div class="acts" style="margin-top:8px"><button class="btn btn-o" data-act="period-lock-save">${t('common.save')}</button></div></div>`:''}
  <div class="card"><h3>${t('admin.backup_restore')}</h3><p class="mut">${t('admin.backup_hint')}</p>
   <div class="acts"><button class="btn btn-o" data-act="backup">${t('admin.download_backup')}</button>${w?`<label class="btn btn-o">${t('admin.restore_from_file')}<input type="file" accept=".json" id="restore" style="display:none"></label><button class="btn btn-d" data-act="reset-demo">${t('admin.reset_demo')}</button>`:''}</div>
   <p class="mut" style="margin-top:8px">${t('admin.storage_label')}: <b>${Store.mode==='idb'?t('admin.storage_idb'):Store.mode==='ls'?'localStorage':t('admin.storage_mem')}</b></p></div></div>
  ${w?`<div class="acts"><button class="btn" data-act="settings-save">${t('admin.save_settings')}</button></div>`:''}`;
 const fr=$('#restore');if(fr)fr.addEventListener('change',()=>restoreFile(fr.files[0]));
 Settings.f={fCo,fRule,fRent};
};
const Settings={f:null};
ACT['settings-save']=()=>{
 const {fCo,fRule,fRent}=Settings.f,a=Form.collect($('#sc'),fCo),b=Form.collect($('#sr'),fRule),c=Form.collect($('#sn'),fRent);
 const err=[...a.err,...b.err,...c.err];if(err.length)return UI.toast(err[0],'err');
 const before=clone(S());Object.assign(S(),b.v);S().company=a.v;S().rental=c.v;saveSettings();
 Audit.log(t('admin.settings_changed'),'settings','main',before,clone(S()),'');UI.toast(t('admin.settings_saved'));
};
ACT['period-lock-save']=()=>{PeriodLock.set($('#plockdate').value);UI.toast(t('admin.period_lock_saved'))};
ACT['backup']=()=>{const o={};Object.keys(Store.mem).forEach(k=>o[k]=Store.mem[k]);Export.json(`kentford-erp-backup-${today()}.json`,{app:'KENTFORD ERP',at:nowISO(),data:o})};
async function restoreFile(f){
 if(!f)return;
 try{
  const j=JSON.parse(await f.text());if(!j.data||!j.data.roles)throw new Error(t('admin.backup_format_unknown'));
  const r=await UI.confirm({title:t('admin.restore_title'),msg:t('admin.restore_msg'),ok:t('admin.yes_overwrite'),danger:true});if(!r)return;
  await Store.clearAll();Store.mem=j.data;Store.putAll();Auth.logout();UI.toast(t('admin.data_restored_relogin'));setTimeout(()=>location.reload(),800);
 }catch(e){UI.toast(t('admin.restore_failed',{msg:e.message}),'err')}
}
ACT['reset-demo']=async()=>{
 const r=await UI.confirm({title:t('admin.reset_title'),msg:t('admin.reset_msg'),ok:t('admin.yes_reset'),danger:true});if(!r)return;
 await Store.clearAll();Auth.logout();location.reload();
};

/* ---------------- Approval ---------------- */
function pendingApprovalsForMe(){return DB.all('approvals').filter(a=>Approval.canDecide(a))}
function approvalVisible(a){
 if(isRole('director','deputy_director'))return true;
 return a.requesterId===Auth.uid()||a.steps.some(s=>s.role===Auth.user.roleId);
}
const APPR_LINK={quotations:'quotations',orders:'orders',products:'products',salesorders:'salesorders',invoices:'invoices'};
function approvalPage(key,title,filter){
 PAGES[key].render=async v=>{
  v.innerHTML=UI.pghead(title)+'<div class="card" id="ap"></div>';
  new DT($('#ap'),{title,rows:()=>DB.all('approvals').filter(approvalVisible).filter(filter).slice().reverse(),onRow:id=>Appr.open(id),
   filters:[{k:'t',l:t('admin.type_col'),opts:()=>Object.values(APPR_TYPES),get:r=>APPR_TYPES[r.type]},{k:'s',l:t('admin.status_col'),opts:()=>['Menunggu','Disetujui','Ditolak'],get:r=>r.status}],
   cols:[{k:'no',l:t('common.no_dot')},{k:'createdAt',l:t('admin.submitted_col'),text:r=>fdate(r.createdAt),sortv:r=>r.createdAt},{k:'t',l:t('admin.type_col'),text:r=>APPR_TYPES[r.type]},{k:'title',l:t('admin.subject_col')},{k:'amount',l:t('admin.nominal_col'),num:true,text:r=>r.amount?rp(r.amount):'-',sortv:r=>r.amount},
    {k:'requesterName',l:t('admin.requester_col')},{k:'st',l:t('admin.status_col'),text:r=>r.status,html:r=>UI.badge(r.status)+(Approval.cur(r)?`<br><small class="mut">→ ${esc(DB.get('roles',Approval.cur(r).role)?.name||'')}</small>`:'')}]});
 };
}
approvalPage('approvals_pending',t('admin.approvals_pending'),a=>a.status==='Menunggu');
approvalPage('approvals_done',t('admin.approvals_done'),a=>a.status==='Disetujui');
approvalPage('approvals_rejected',t('admin.approvals_rejected'),a=>a.status==='Ditolak');
approvalPage('approvals_history',t('admin.approvals_history'),()=>true);
const Appr={
 open(id){
  const a=DB.get('approvals',id),canD=Approval.canDecide(a);
  const link=a.refCol&&a.refId&&APPR_LINK[a.refCol]?`<a href="#/${APPR_LINK[a.refCol]}/${a.refId}" data-x="go">${t('admin.related_doc')}</a>`:'';
  const m=UI.modal({title:`${a.no} — ${APPR_TYPES[a.type]||a.type}`,wide:true,body:
   UI.kv([[t('admin.subject_col'),esc(a.title)],[t('admin.requester_col'),esc(a.requesterName)],[t('admin.submitted_col'),fdt(a.createdAt)],[t('admin.nominal_col'),a.amount?rp(a.amount):'-'],[t('common.reason'),esc(a.reason||'-')],[t('admin.status_col'),UI.badge(a.status)],['—',link||'-'],[t('common.attachment'),'<div class="files" data-files="f" data-ro="1"></div>']])+
   `<h3 style="margin:14px 0 6px">${t('admin.approval_flow')}</h3><div class="tblw"><table><tr><th>#</th><th>${t('admin.approver_role')}</th><th>${t('admin.decision')}</th><th>${t('admin.by_col')}</th><th>${t('admin.date_col')}</th><th>${t('admin.note_col')}</th></tr>${a.steps.map((s,i)=>`<tr><td>${i+1}</td><td>${esc(DB.get('roles',s.role)?.name||s.role)}</td><td>${UI.badge(a.status==='Menunggu'&&i===a.idx?t('admin.waiting'):s.status)}</td><td>${esc(s.byName||'-')}</td><td>${s.at?fdt(s.at):'-'}</td><td>${esc(s.note||'')}</td></tr>`).join('')||`<tr><td colspan="6" class="empty">${t('admin.auto_approved_no_step')}</td></tr>`}</table></div>`,
   foot:`<button class="btn btn-o" data-x="c">${t('admin.close')}</button>${canD?`<button class="btn btn-d" data-x="no">${t('admin.reject_btn')}</button><button class="btn" data-x="ok">${t('admin.approve_btn')}</button>`:''}`});
  const fw=$('[data-files="f"]',m.body);fw._files=a.files||[];Files.render(fw);
  m.el.addEventListener('click',async e=>{
   const b=e.target.closest('[data-x]');if(!b)return;const x=b.dataset.x;
   if(x==='c'||x==='go'){m.close();return}
   const r=await UI.ask({title:x==='ok'?t('admin.approve_submission'):t('admin.reject_submission'),ok:x==='ok'?t('admin.approve_btn'):t('admin.reject_btn'),danger:x==='no',fields:[F.ta('note',t('admin.note_label')+(x==='no'?t('admin.note_required_suffix'):''),{req:x==='no'})]});
   if(!r)return;
   try{Approval.decide(id,x==='ok',r.note);m.close();UI.toast(x==='ok'?t('admin.submission_approved'):t('admin.submission_rejected'));Router.render();App.refreshBell()}catch(er){UI.toast(er.message,'err')}
  });
 }
};

/* ---------------- Account Receivable ---------------- */
PAGES.ar.render=async v=>{
 v.innerHTML=UI.pghead(t('admin.ar_title'))+'<div class="card" id="arb"></div>';
 const rows=()=>DB.all('invoices').filter(i=>Scope.ok('invoices',i)&&Inv.outstanding(i)>0&&Inv.status(i)!=='Dibatalkan');
 new DT($('#arb'),{title:t('admin.ar_title'),rows,onRow:id=>Router.go('invoices/'+id),size:20,
  filters:[{k:'c',l:t('common.customer'),opts:()=>DB.all('customers').map(c=>c.name),get:r=>DB.get('customers',r.customerId)?.name}],
  cols:[{k:'no',l:t('inv.no_invoice')},{k:'c',l:t('common.customer'),text:r=>DB.get('customers',r.customerId)?.name},{k:'dueDate',l:t('inv.due_date'),text:r=>fdate(r.dueDate),sortv:r=>r.dueDate},
   {k:'total',l:t('common.total'),num:true,text:r=>rp(r.total),sortv:r=>r.total},{k:'out',l:t('inv.outstanding'),num:true,text:r=>rp(Inv.outstanding(r)),sortv:r=>Inv.outstanding(r)},
   {k:'age',l:t('admin.ar_age'),num:true,text:r=>String(Math.max(0,daysBetween(r.dueDate,today()))),sortv:r=>daysBetween(r.dueDate,today())},
   {k:'b',l:t('inv.aging'),text:r=>Inv.aging(r)},{k:'st',l:t('common.status'),text:r=>Inv.status(r),html:r=>UI.badge(Inv.status(r))}]});
};
