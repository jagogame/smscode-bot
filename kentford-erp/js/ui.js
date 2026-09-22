'use strict';
/* =========================================================
   KENTFORD ERP - UI: modal, form builder, tabel, upload,
   tanda tangan, router, shell aplikasi
   ========================================================= */
const ACT={};          // aksi klik: data-act="nama"
const CALC={};         // kalkulasi baris: data-calc="nama"
const CHANGE={};       // handler perubahan khusus

const UI={
 toast(msg,type){
  const d=document.createElement('div');d.className='toast'+(type==='err'?' err':'');d.textContent=msg;
  $('#toasts').appendChild(d);setTimeout(()=>d.remove(),type==='err'?6000:3500);
 },
 modal(o){
  const el=document.createElement('div');el.className='ov';
  el.innerHTML=`<div class="dlg ${o.wide?'wide':''}"><div class="dlg-h"><b>${esc(o.title||'')}</b><button class="btn-x" data-act="modal-close" title="Tutup">×</button></div><div class="dlg-b">${o.body||''}</div>${o.foot?`<div class="dlg-f">${o.foot}</div>`:''}</div>`;
  $('#modals').appendChild(el);
  const m={el,body:$('.dlg-b',el),foot:$('.dlg-f',el),close(){el.remove();o.onClose&&o.onClose()}};
  el._m=m;return m;
 },
 /* dialog isian: kembalikan objek nilai atau null bila dibatalkan */
 ask({title,fields=[],vals={},ok='Simpan',wide,pre='',post='',danger}){
  return new Promise(res=>{
   const m=this.modal({title,wide,body:pre+Form.render(fields,vals)+post,
    foot:`<button class="btn btn-o" data-x="c">Batal</button><button class="btn ${danger?'btn-d':''}" data-x="ok">${esc(ok)}</button>`});
   Form.hydrate(m.body,fields,vals);
   m.el.addEventListener('click',e=>{
    const b=e.target.closest('[data-x]');if(!b)return;
    if(b.dataset.x==='c'){m.close();res(null);return}
    const {v,err}=Form.collect(m.body,fields);
    if(err.length){UI.toast(err[0],'err');return}
    m.close();res(v);
   });
  });
 },
 confirm({title='Konfirmasi',msg,reason=false,ok='Ya, lanjutkan',danger=false}){
  return this.ask({title,ok,danger,pre:`<p>${msg}</p>`,fields:reason?[{k:'reason',l:'Alasan',t:'textarea',req:true}]:[]});
 },
 empty(msg){return `<div class="card empty">${esc(msg)}</div>`},
 pghead(title,acts=''){return `<div class="pghead"><h2>${esc(title)}</h2><div class="acts">${acts}</div></div>`},
 badge(t){
  const s=String(t??'-');
  const rules=[[/ditolak|terlambat|dibatalkan|kalah|kedaluwarsa|tidak tersedia|tidak lulus|rusak|refund|tidak ok|gagal/i,'red'],
   [/sebagian|menunggu|dalam|proses|terjadwal|jatuh tempo|revisi|perlu|dijadwalkan|dp diterima/i,'yellow'],
   [/disetujui|selesai|lunas|diterima|menang|aktif|\bsiap\b|tersedia|ditutup|lulus|^ok$|aman/i,'green'],
   [/dikirim|survey|persiapan|keputusan|pemeriksaan|final check|instalasi|perencanaan|pembuatan|after delivery/i,'yellow'],
   [/draft|baru|informasi|kualifikasi|dihubungi|quotation|belum/i,'blue']];
  const c=(rules.find(r=>r[0].test(s))||[0,'gray'])[1];
  return `<span class="badge b-${c}">${esc(s)}</span>`;
 },
 kv(pairs){return `<dl class="kv">${pairs.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v??'-'}</dd>`).join('')}</dl>`},
 timeline(col,id){
  const ev=[...DB.col('audit').filter(a=>a.col===col&&a.ref===id).map(a=>({at:a.at,by:a.userName,t:`<b>${esc(a.action)}</b>${a.reason?': '+esc(a.reason):''}`})),
   ...DB.all('comments').filter(c=>c.refCol===col&&c.refId===id).map(c=>({at:c.createdAt,by:c.byName,t:'Komentar: '+esc(c.text)}))]
   .sort((a,b)=>b.at.localeCompare(a.at));
  return ev.length?`<div class="tl">${ev.map(e=>`<div class="ev">${e.t}<br><small>${esc(e.by)} • ${fdt(e.at)}</small></div>`).join('')}</div>`:'<div class="empty">Belum ada aktivitas.</div>';
 },
 activity(col,id){
  return `<div class="activity" data-col="${col}" data-id="${id}"><textarea rows="2" placeholder="Tulis komentar… gunakan @username untuk mention pengguna"></textarea>
   <div class="right" style="margin:6px 0 12px"><button class="btn btn-sm" data-act="comment-add">Kirim komentar</button></div><div class="tl-box">${this.timeline(col,id)}</div></div>`;
 }
};
ACT['modal-close']=el=>el.closest('.ov')._m.close();
ACT['comment-add']=el=>{
 const w=el.closest('.activity'),t=$('textarea',w),text=t.value.trim();
 if(!text)return UI.toast('Komentar masih kosong.','err');
 const {col,id}=w.dataset;
 DB.insert('comments',{refCol:col,refId:id,text,byName:Auth.user.name});
 (text.match(/@([\w.]+)/g)||[]).forEach(m=>{const u=DB.all('users').find(x=>x.username.toLowerCase()===m.slice(1).toLowerCase());if(u)Notify.user(u.id,`${Auth.user.name} menyebut Anda: ${text.slice(0,80)}`,location.hash)});
 t.value='';$('.tl-box',w).innerHTML=UI.timeline(col,id);App.refreshBell();
};

/* ---------------- Form builder ---------------- */
const Form={
 opts(f){
  if(f.t==='ref'){
   const e=ENT[f.ref];let rows=DB.all(f.ref).filter(r=>Scope.ok(f.ref,r));if(f.filter)rows=rows.filter(f.filter);
   return rows.map(r=>({v:r.id,l:e?e.label(r):(r.name||r.id)}));
  }
  const o=typeof f.opts==='function'?f.opts():(f.opts||[]);
  return o.map(x=>typeof x==='object'?x:{v:x,l:x});
 },
 select(name,f,val,dis,extra=''){
  const o=this.opts(f);
  return `<select ${name} ${dis} ${extra}><option value="">— pilih —</option>${o.map(x=>`<option value="${esc(x.v)}" ${String(x.v)===String(val??'')?'selected':''}>${esc(x.l)}</option>`).join('')}</select>`;
 },
 field(f,val,ro){
  const name=`name="${f.k}"`,dis=(ro||f.ro)?'disabled':'',t=f.t||'text';
  let inp='';
  if(t==='textarea')inp=`<textarea ${name} rows="${f.rows||3}" ${dis}>${esc(val??'')}</textarea>`;
  else if(t==='select'||t==='ref')inp=this.select(name,f,val,dis);
  else if(t==='check')inp=`<label class="chk"><input type="checkbox" ${name} ${val?'checked':''} ${dis}> ${esc(f.cl||'Ya')}</label>`;
  else if(t==='files')inp=`<div class="files" data-files="${f.k}" data-ro="${(ro||f.ro)?1:0}"></div>`;
  else if(t==='lines')inp=Lines.render(f,val||[],ro||f.ro);
  else if(t==='checklist')inp=this.checklist(f,val||[],ro||f.ro);
  else if(t==='sig')inp=Sig.html(f,val,ro||f.ro);
  else if(t==='info')inp=`<div class="info">${f.html?f.html(val):esc(val??'')}</div>`;
  else{
   const it={money:'number',percent:'number',number:'number',date:'date',time:'time',email:'email',phone:'tel',text:'text',password:'password'}[t]||'text';
   inp=`<input type="${it}" ${name} value="${esc(val??'')}" ${it==='number'?'step="any"':''} ${f.ph?`placeholder="${esc(f.ph)}"`:''} ${dis} ${f.auto?'autocomplete="off"':''}>`;
  }
  const full=f.w==='full'||['textarea','files','lines','checklist','sig','info'].includes(t);
  return `<div class="fld ${full?'full':''}"><label>${esc(f.l)}${f.req?' <b class="req">*</b>':''}</label>${inp}${f.hint?`<small>${esc(f.hint)}</small>`:''}</div>`;
 },
 render(fields,vals={},ro=false){
  return `<div class="fg">${fields.filter(f=>!(f.hide&&f.hide())).map(f=>this.field(f,vals[f.k]??(f.def!==undefined?(typeof f.def==='function'?f.def():f.def):undefined),ro)).join('')}</div>`;
 },
 checklist(f,val,ro){
  const st=['Belum diperiksa','OK','Tidak OK','N/A'];
  return `<div class="tblw"><table data-checklist="${f.k}"><thead><tr><th>Item pemeriksaan</th><th>Hasil</th><th>Catatan</th></tr></thead><tbody>${f.items.map((it,i)=>{
   const r=val.find(x=>x.i===it)||{};
   return `<tr><td>${esc(it)}</td><td><select data-ci="${i}" data-cs ${ro?'disabled':''}>${st.map(s=>`<option ${s===(r.s||st[0])?'selected':''}>${s}</option>`).join('')}</select></td><td><input data-cn value="${esc(r.n||'')}" ${ro?'disabled':''}></td></tr>`;
  }).join('')}</tbody></table></div>`;
 },
 hydrate(root,fields,vals={}){
  fields.forEach(f=>{
   if(f.t==='files'){const el=$(`[data-files="${f.k}"]`,root);if(el){el._files=[...(vals[f.k]||[])];Files.render(el)}}
   if(f.t==='sig'){const cv=$(`[data-sig="${f.k}"] canvas`,root);if(cv)Sig.mount(cv,vals[f.k])}
  });
 },
 collect(root,fields){
  const v={},err=[];
  for(const f of fields){
   if((f.hide&&f.hide())||f.t==='info'||f.ro)continue;
   const el=$(`[name="${f.k}"]`,root);let x;
   switch(f.t){
    case 'check':x=!!(el&&el.checked);break;
    case 'files':x=$(`[data-files="${f.k}"]`,root)?._files||[];break;
    case 'lines':x=Lines.collect($(`[data-lines="${f.k}"]`,root));break;
    case 'checklist':x=$$(`[data-checklist="${f.k}"] tbody tr`,root).map(tr=>({i:f.items[+$('[data-cs]',tr).dataset.ci],s:$('[data-cs]',tr).value,n:$('[data-cn]',tr).value.trim()}));break;
    case 'sig':x=Sig.value(root,f);break;
    case 'number':case 'money':case 'percent':x=el&&el.value!==''?parseFloat(el.value):null;break;
    default:x=el?el.value.trim():'';
   }
   v[f.k]=x;
   if(f.req&&f.t!=='check'&&(x===''||x==null||(Array.isArray(x)&&!x.length)))err.push(`${f.l} wajib diisi.`);
  }
  return {v,err};
 }
};

/* ---------------- Baris item (quotation, pengiriman, dll) ---------------- */
const Lines={
 vis(cols){return cols.filter(c=>!c.cost||seeCost())},
 render(f,rows,ro){
  const cols=f.cols;
  return `<div class="lines" data-lines="${f.k}" data-cols="${esc(JSON.stringify(cols))}" ${f.calc?`data-calc="${f.calc}"`:''}>
   <div class="lines-w"><table><thead><tr>${this.vis(cols).map(c=>`<th>${esc(c.l)}</th>`).join('')}<th></th></tr></thead>
   <tbody>${(rows.length?rows:(f.min?[{}]:[])).map(r=>this.row(cols,r,ro)).join('')}</tbody></table></div>
   ${ro?'':'<button type="button" class="btn btn-o btn-sm" data-act="line-add">+ Tambah baris</button>'}</div>`;
 },
 row(cols,r,ro){
  return `<tr data-row="${esc(JSON.stringify(r))}">${this.vis(cols).map(c=>`<td style="${c.w?'min-width:'+c.w:''}">${this.cell(c,r[c.k],ro)}</td>`).join('')}<td>${ro?'':'<button type="button" class="btn-x" data-act="line-del" title="Hapus baris">×</button>'}</td></tr>`;
 },
 cell(c,val,ro){
  const dis=ro?'disabled':'',nm=`data-c="${c.k}"`;
  if(c.t==='ref'||c.t==='select')return Form.select(nm,c,val,dis,c.ref?`data-ref="${c.ref}"`:'');
  const t=c.t==='text'?'text':'number';
  return `<input type="${t}" ${t==='number'?'step="any"':''} ${nm} value="${esc(val??'')}" ${dis}>`;
 },
 collect(el){
  if(!el)return [];
  const cols=JSON.parse(el.dataset.cols);
  return $$('tbody tr',el).map(tr=>{
   let r={};try{r=JSON.parse(tr.dataset.row||'{}')}catch(e){}
   $$('[data-c]',tr).forEach(i=>{r[i.dataset.c]=i.type==='number'?(i.value===''?null:parseFloat(i.value)):i.value});
   return r;
  }).filter(r=>cols.some(c=>{const x=r[c.k];return x!==''&&x!=null&&!(c.t==='number'&&x===0)}));
 }
};
ACT['line-add']=el=>{
 const w=el.closest('.lines'),cols=JSON.parse(w.dataset.cols);
 $('tbody',w).insertAdjacentHTML('beforeend',Lines.row(cols,{},false));
};
ACT['line-del']=el=>{const w=el.closest('.lines');el.closest('tr').remove();if(w.dataset.calc)CALC[w.dataset.calc]?.(w)};

/* ---------------- Upload file ---------------- */
Files.render=function(el){
 const ro=el.dataset.ro==='1';
 el.innerHTML=`<div>${(el._files||[]).map((f,i)=>`<span class="fchip"><a href="#" data-act="file-view" data-id="${f.id}">${esc(f.name)}</a> <small>${Math.max(1,Math.round(f.size/1024))} KB</small>${ro?'':`<button type="button" class="btn-x" data-act="file-del" data-i="${i}" title="Hapus">×</button>`}</span>`).join('')||'<span class="mut">Belum ada file.</span>'}</div>${ro?'':'<input type="file" multiple data-fileinput accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.mp4">'}`;
};
ACT['file-del']=el=>{const w=el.closest('[data-files]');w._files.splice(+el.dataset.i,1);Files.render(w)};
ACT['file-view']=async el=>{
 const w=el.closest('[data-files]'),meta=(w._files||[]).find(f=>f.id===el.dataset.id);
 const u=await Files.url(el.dataset.id);
 if(!u)return UI.toast('File tidak ditemukan (penyimpanan tidak permanen atau data dihapus).','err');
 const t=meta?.type||'';
 const body=t.startsWith('image/')?`<img src="${u}" style="max-width:100%">`:t==='application/pdf'?`<iframe src="${u}" style="width:100%;height:70vh;border:0"></iframe>`:t.startsWith('video/')?`<video src="${u}" controls style="max-width:100%"></video>`:`<p>Pratinjau tidak tersedia untuk tipe file ini.</p>`;
 UI.modal({title:meta?.name||'File',wide:true,body:body+`<p><a class="btn btn-o btn-sm" href="${u}" download="${esc(meta?.name||'file')}" target="_blank">Unduh / buka</a></p>`});
};
CHANGE.fileinput=async input=>{
 const w=input.closest('[data-files]');
 for(const f of input.files){
  if(f.size>10*1024*1024){UI.toast(`${f.name}: ukuran melebihi 10 MB.`,'err');continue}
  try{w._files.push(await Files.put(f))}catch(e){UI.toast('Gagal menyimpan file: '+e.message,'err')}
 }
 Files.render(w);
 if(Store.mode!=='idb')UI.toast('Peringatan: penyimpanan permanen tidak tersedia, file hilang saat halaman ditutup.','err');
};

/* ---------------- Tanda tangan digital ---------------- */
const Sig={
 html(f,val,ro){
  if(ro)return val?`<img src="${val}" alt="tanda tangan">`:'<span class="mut">Belum ditandatangani.</span>';
  return `<div class="sig" data-sig="${f.k}"><canvas width="640" height="200"></canvas><button type="button" class="btn btn-o btn-sm" data-act="sig-clear">Hapus tanda tangan</button></div>`;
 },
 mount(cv,init){
  cv._init=init||'';cv._dirty=false;
  const ctx=cv.getContext('2d');ctx.lineWidth=2.5;ctx.lineCap='round';ctx.strokeStyle='#111';
  if(init){const im=new Image();im.onload=()=>ctx.drawImage(im,0,0,cv.width,cv.height);im.src=init}
  let on=false;
  const pos=e=>{const r=cv.getBoundingClientRect();return [(e.clientX-r.left)*cv.width/r.width,(e.clientY-r.top)*cv.height/r.height]};
  cv.addEventListener('pointerdown',e=>{on=true;cv.setPointerCapture(e.pointerId);const [x,y]=pos(e);ctx.beginPath();ctx.moveTo(x,y);e.preventDefault()});
  cv.addEventListener('pointermove',e=>{if(!on)return;const [x,y]=pos(e);ctx.lineTo(x,y);ctx.stroke();cv._dirty=true});
  const end=()=>{on=false};cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
 },
 value(root,f){const cv=$(`[data-sig="${f.k}"] canvas`,root);if(!cv)return '';return cv._dirty?cv.toDataURL('image/png'):(cv._init||'')}
};
ACT['sig-clear']=el=>{const cv=$('canvas',el.closest('.sig'));cv.getContext('2d').clearRect(0,0,cv.width,cv.height);cv._dirty=false;cv._init=''};

/* ---------------- Tabel data (cari, filter, urut, halaman, ekspor) ---------------- */
class DT{
 constructor(el,cfg){this.el=el;this.cfg=cfg;this.id='dt'+uid();DT.inst[this.id]=this;this.q='';this.f={};this.sort=cfg.sort||null;this.page=1;this.size=cfg.size||15;this.arch=false;this.init()}
 init(){
  const c=this.cfg;
  this.el.innerHTML=`<div class="tb" data-dt="${this.id}"><input type="search" placeholder="Cari…" data-dtq>
   ${(c.filters||[]).map(f=>`<select data-dtf="${f.k}"><option value="">${esc(f.l)}: semua</option>${[...new Set(f.opts())].map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`).join('')}
   <span style="flex:1"></span>${c.toolbar||''}
   ${c.export===false?'':`<button class="btn btn-o btn-sm" data-act="dt-xls" data-dt="${this.id}">Excel</button><button class="btn btn-o btn-sm" data-act="dt-print" data-dt="${this.id}">Cetak / PDF</button>`}</div>
   <div class="dt-body"></div>`;
  this.draw();
 }
 cols(){return this.cfg.cols.filter(x=>!x.hide||!x.hide())}
 val(c,r){return c.text?c.text(r):r[c.k]}
 rows(){
  const c=this.cfg;let r=c.rows();
  if(this.q){const q=this.q.toLowerCase();r=r.filter(x=>this.cols().some(cc=>String(this.val(cc,x)??'').toLowerCase().includes(q)))}
  for(const f of c.filters||[]){const v=this.f[f.k];if(v)r=r.filter(x=>String(f.get(x))===v)}
  if(this.sort){const cc=c.cols.find(x=>x.k===this.sort.k);if(cc){const g=x=>cc.sortv?cc.sortv(x):this.val(cc,x);r=[...r].sort((a,b)=>{const A=g(a)??'',B=g(b)??'';return (A>B?1:A<B?-1:0)*this.sort.d})}}
  return r;
 }
 draw(){
  const rows=this.rows(),c=this.cfg,cols=this.cols(),pages=Math.max(1,Math.ceil(rows.length/this.size));
  if(this.page>pages)this.page=pages;
  const sl=rows.slice((this.page-1)*this.size,this.page*this.size);
  $('.dt-body',this.el).innerHTML=`<div class="tblw"><table><thead><tr>${cols.map(x=>`<th class="${x.num?'num':''} ${x.sort===false?'':'sortable'}" ${x.sort===false?'':`data-act="dt-sort" data-k="${esc(x.k)}" data-dt="${this.id}"`}>${esc(x.l)}${this.sort&&this.sort.k===x.k?(this.sort.d>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead>
   <tbody>${sl.map(r=>`<tr class="${c.onRow?'clk':''}" ${c.onRow?`data-act="dt-row" data-dt="${this.id}" data-id="${r.id}"`:''}>${cols.map(x=>`<td class="${x.num?'num':''}">${x.html?x.html(r):esc(this.val(x,r)??'')}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${cols.length}" class="empty">${esc(c.empty||'Belum ada data.')}</td></tr>`}</tbody></table></div>
   <div class="pager"><span class="mut">${rows.length} data</span><span><button class="btn btn-o btn-sm" data-act="dt-page" data-d="-1" data-dt="${this.id}" ${this.page<=1?'disabled':''}>‹ Sebelumnya</button> Hal ${this.page}/${pages} <button class="btn btn-o btn-sm" data-act="dt-page" data-d="1" data-dt="${this.id}" ${this.page>=pages?'disabled':''}>Berikutnya ›</button></span></div>`;
 }
 export(){const cols=this.cols(),rows=this.rows();return {head:cols.map(c=>c.l),rows:rows.map(r=>cols.map(c=>this.val(c,r)??''))}}
}
DT.inst={};
ACT['dt-sort']=el=>{const t=DT.inst[el.dataset.dt];t.sort=t.sort&&t.sort.k===el.dataset.k?{k:el.dataset.k,d:-t.sort.d}:{k:el.dataset.k,d:1};t.draw()};
ACT['dt-page']=el=>{const t=DT.inst[el.dataset.dt];t.page+=+el.dataset.d;t.draw()};
ACT['dt-row']=el=>DT.inst[el.dataset.dt].cfg.onRow(el.dataset.id);
ACT['dt-xls']=el=>{const t=DT.inst[el.dataset.dt],x=t.export();Export.xls(t.cfg.title||'data',x.head,x.rows)};
ACT['dt-print']=el=>{const t=DT.inst[el.dataset.dt],x=t.export();
 Print.html(Print.header(t.cfg.title||'Daftar Data',fdate(today()))+`<table><tr>${x.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>${x.rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`)};

/* ---------------- Event delegasi global ---------------- */
document.addEventListener('click',e=>{
 const el=e.target.closest('[data-act]');
 if(!e.target.closest('.pop'))$$('.popm').forEach(p=>p.classList.add('hide'));
 if(!e.target.closest('.search'))$('#sres')&&$('#sres').classList.add('hide');
 if(!el)return;
 if(el.tagName==='A')e.preventDefault();
 const fn=ACT[el.dataset.act];if(!fn)return;
 if(el.disabled)return;
 Promise.resolve().then(()=>fn(el,e)).catch(err=>{console.error(err);UI.toast(err.message||String(err),'err')});
});
document.addEventListener('input',e=>{
 const t=e.target;
 if(t.matches('[data-dtq]')){const d=DT.inst[t.closest('[data-dt]').dataset.dt];d.q=t.value;d.page=1;d.draw();return}
 const l=t.closest&&t.closest('[data-lines]');
 if(l&&l.dataset.calc)CALC[l.dataset.calc]?.(l);
 if(t.id==='gsearch')App.search(t.value);
});
document.addEventListener('change',e=>{
 const t=e.target;
 if(t.matches('[data-dtf]')){const d=DT.inst[t.closest('[data-dt]').dataset.dt];d.f[t.dataset.dtf]=t.value;d.page=1;d.draw();return}
 if(t.matches('[data-fileinput]')){CHANGE.fileinput(t);return}
 if(t.matches('select[data-ref="products"]')){
  const tr=t.closest('tr'),p=DB.get('products',t.value);
  if(tr&&p){
   let r={};try{r=JSON.parse(tr.dataset.row||'{}')}catch(x){}
   r.cost=p.lastCost||0;tr.dataset.row=JSON.stringify(r);
   const set=(k,v)=>{const i=$(`[data-c="${k}"]`,tr);if(i&&(i.value===''||k==='price'||k==='cost'))i.value=v};
   set('desc',p.name);set('price',p.price||0);set('cost',p.lastCost||0);
  }
 }
 const l=t.closest&&t.closest('[data-lines]');
 if(l&&l.dataset.calc)CALC[l.dataset.calc]?.(l);
 for(const k in CHANGE){if(k!=='fileinput'&&CHANGE[k].match&&CHANGE[k].match(t))CHANGE[k].run(t)}
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){const o=$$('#modals .ov').pop();if(o)o._m.close()}
 if(e.key==='Enter'&&e.target.closest&&e.target.closest('#loginbox')){e.preventDefault();ACT.login()}
});

/* ---------------- Router ---------------- */
const Router={
 parse(){const p=(location.hash||'#/dashboard').slice(2).split('/');return {page:p[0]||'dashboard',param:decodeURIComponent(p.slice(1).join('/'))}},
 go(h){location.hash='#/'+h},
 async render(){
  if(!Auth.user)return;
  const {page,param}=this.parse(),v=$('#view'),def=PAGES[page];
  if(!def||!def.render||!can(page)){v.innerHTML=UI.empty(def&&!def.render?'Modul ini tersedia pada tahap pengembangan berikutnya.':'Halaman tidak tersedia atau Anda tidak memiliki hak akses.');$('#pgtitle').textContent=def?.label||'';App.markNav(page);return}
  $('#pgtitle').textContent=def.label;
  v.innerHTML='<div class="loading">Memuat…</div>';
  try{await def.render(v,param,page)}
  catch(e){console.error(e);v.innerHTML=`<div class="errbox"><b>Terjadi kesalahan pada halaman ini.</b><br>${esc(e.message)}</div>`}
  App.markNav(page);$('#side').classList.remove('open');window.scrollTo(0,0);
 }
};
window.addEventListener('hashchange',()=>Router.render());

/* ---------------- Shell aplikasi ---------------- */
const App={closed:new Set(),
 mount(){
  $('#root').innerHTML=`<div class="app"><aside id="side"></aside><div class="main">
   <div class="top"><button class="btn btn-o btn-sm burger" data-act="toggle-side" aria-label="Menu">☰</button><span class="ttl" id="pgtitle"></span>
    <div class="search"><input id="gsearch" type="search" placeholder="Cari customer, quotation, order, produk…" autocomplete="off"><div id="sres" class="sres hide"></div></div><span style="flex:1"></span>
    <div class="pop"><button class="btn btn-o btn-sm bell" data-act="pop" data-p="pn">Notifikasi <span class="n hide" id="bcount"></span></button><div class="popm hide" id="pn"></div></div>
    <div class="pop"><button class="btn btn-o btn-sm" data-act="pop" data-p="pp">${esc(Auth.user.name)}</button><div class="popm hide" id="pp"></div></div>
   </div><div id="view"></div></div></div>`;
  this.nav();this.refreshBell();this.profile();
  if(Store.mode!=='idb')$('#view').insertAdjacentHTML('beforebegin',`<div class="warnbox" style="margin:12px 20px 0">Penyimpanan permanen browser (IndexedDB) tidak tersedia di sini. Data ${Store.mode==='ls'?'disimpan di localStorage (terbatas)':'HANYA di memori dan hilang saat halaman ditutup'}. Buka lewat http://localhost (lihat README) agar data permanen.</div>`);
  Router.render();
 },
 nav(){
  let h=`<div class="brand"><b>KENTFORD ERP</b><small>PT Kentford Group Indonesia</small></div>`;
  for(const g of PAGE_GROUPS){
   const items=g.pages.filter(k=>PAGES[k]&&can(k));
   if(!items.length)continue;
   const closed=g.g&&this.closed.has(g.g);
   h+=`<div class="grp">${g.g?`<div class="gh" data-act="toggle-grp" data-g="${esc(g.g)}"><span>${esc(g.g)}</span><span>${closed?'+':'−'}</span></div>`:''}${closed?'':items.map(k=>{
    const p=PAGES[k];
    return p.render?`<a class="nv" data-p="${k}" href="#/${k}">${esc(p.label)}<span class="tag hide" data-badge="${k}"></span></a>`
     :`<div class="nv soon" title="Tersedia di Tahap ${p.stage}">${esc(p.label)}<span class="tag">Tahap ${p.stage}</span></div>`;
   }).join('')}</div>`;
  }
  $('#side').innerHTML=h;
  this.badges();
 },
 badges(){
  const set=(k,n)=>{const e=$(`[data-badge="${k}"]`);if(e){e.textContent=n;e.classList.toggle('hide',!n)}};
  if(typeof pendingApprovalsForMe==='function')set('approvals_pending',pendingApprovalsForMe().length);
 },
 markNav(page){$$('#side a.nv').forEach(a=>a.classList.toggle('on',a.dataset.p===page||(page==='master'&&false)))},
 refreshBell(){
  const n=Notify.unread(),b=$('#bcount');if(b){b.textContent=n;b.classList.toggle('hide',!n)}
  const p=$('#pn');if(p)p.innerHTML=`<div class="it"><b>Notifikasi</b> <a href="#" data-act="notif-read" style="float:right">Tandai semua dibaca</a></div>`+
   (Notify.mine().slice(0,15).map(x=>`<a class="it ${x.read?'':'un'}" href="#" data-act="notif-open" data-id="${x.id}">${esc(x.text)}<br><small class="mut">${fdt(x.createdAt)}</small></a>`).join('')||'<div class="it mut">Tidak ada notifikasi.</div>');
  this.badges();
 },
 profile(){
  $('#pp').innerHTML=`<div class="it"><b>${esc(Auth.user.name)}</b><br><small class="mut">${esc(Auth.role?.name||'')} • ${esc(Auth.user.username)}</small></div>
   <a class="it" href="#" data-act="chpw">Ubah password</a><a class="it" href="#" data-act="logout">Keluar</a>`;
 },
 search(q){
  const box=$('#sres');q=q.trim().toLowerCase();
  if(q.length<2){box.classList.add('hide');return}
  const out=[];
  for(const s of SEARCH){
   if(!can(s.page))continue;
   DB.all(s.col).filter(r=>Scope.ok(s.ent,r)).filter(r=>JSON.stringify([r.no,r.name,r.company,r.sku,r.title,r.pic,r.model,r.code,r.phone,r.email]).toLowerCase().includes(q)).slice(0,4)
    .forEach(r=>out.push(`<a href="#/${s.page}/${r.id}"><b>${esc(s.title(r))}</b><small>${esc(s.label)} — ${esc(s.sub(r)||'')}</small></a>`));
  }
  box.innerHTML=out.join('')||'<div class="empty">Tidak ada hasil.</div>';box.classList.remove('hide');
 }
};
ACT['toggle-side']=()=>$('#side').classList.toggle('open');
ACT['toggle-grp']=el=>{const g=el.dataset.g;App.closed.has(g)?App.closed.delete(g):App.closed.add(g);App.nav();App.markNav(Router.parse().page)};
ACT['pop']=el=>{const p=$('#'+el.dataset.p),was=p.classList.contains('hide');$$('.popm').forEach(x=>x.classList.add('hide'));if(was)p.classList.remove('hide')};
ACT['notif-open']=el=>{const n=DB.get('notifications',el.dataset.id);if(n){n.read=true;DB.save('notifications');App.refreshBell();$('#pn').classList.add('hide');if(n.link)location.hash=n.link}};
ACT['notif-read']=()=>{Notify.mine().forEach(n=>n.read=true);DB.save('notifications');App.refreshBell()};
ACT['logout']=()=>{Auth.logout();location.hash='';Login.show()};
ACT['chpw']=async()=>{
 const v=await UI.ask({title:'Ubah password',fields:[{k:'old',l:'Password lama',t:'password',req:true},{k:'n1',l:'Password baru (min. 6 karakter)',t:'password',req:true},{k:'n2',l:'Ulangi password baru',t:'password',req:true}]});
 if(!v)return;
 if(await Auth.hash(v.old,Auth.user.salt)!==Auth.user.pw)return UI.toast('Password lama salah.','err');
 if(v.n1.length<6||v.n1!==v.n2)return UI.toast('Password baru minimal 6 karakter dan harus sama.','err');
 await Auth.setPassword(Auth.user.id,v.n1);Auth.set(DB.get('users',Auth.user.id));UI.toast('Password berhasil diubah.');
};

/* ---------------- Login ---------------- */
const LOGO_MARK=`<svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="46" height="46" rx="12" fill="currentColor"/><path d="M14 12h5.4v9.3L28 12h6.6l-9.8 10.6L35 36h-6.8l-6.9-9.7-2 2.2V36H14V12z" fill="#fff"/></svg>`;
const Login={
 show(){
  const demo=DB.all('users').filter(u=>u.active!==false).map(u=>`<button class="btn btn-o" data-act="demo" data-u="${esc(u.username)}">${esc(DB.get('roles',u.roleId)?.name||u.username)}</button>`).join('');
  $('#root').innerHTML=`<div class="login">
   <div class="login-visual">
    <div class="login-visual-imgs">
     <div style="background-image:url('https://picsum.photos/seed/kentford-genset-unit/900/700')"></div>
     <div style="background-image:url('https://picsum.photos/seed/kentford-genset-service/900/700')"></div>
    </div>
    <div class="login-visual-overlay">
     <div class="login-logo">${LOGO_MARK}<b>KENTFORD</b></div>
     <p class="login-tag">Genset Industrial &middot; Sales, Rental &amp; Service</p>
     <ul class="login-points">
      <li>Approval &amp; workflow New Order terkontrol</li>
      <li>Rental &amp; service genset dalam satu sistem</li>
      <li>Stok, keuangan, dan laporan real-time</li>
     </ul>
    </div>
   </div>
   <div class="login-panel"><div class="box" id="loginbox">
    <div class="login-logo login-logo-sm">${LOGO_MARK}<b>KENTFORD ERP</b></div>
    <p class="mut">PT KENTFORD GROUP INDONESIA. Silakan masuk.</p>
    <div class="fld"><label>Username</label><input id="lu" autocomplete="username"></div><div class="fld" style="margin-top:8px"><label>Password</label><input id="lp" type="password" autocomplete="current-password"></div>
    <button class="btn" style="width:100%;margin-top:14px" data-act="login">Masuk</button>
    <p class="mut" style="margin-top:14px;font-size:12px"><b>Akun demo</b> (password semua akun: <code>kentford123</code>). Klik untuk mengisi username:</p><div class="demo">${demo}</div>
   </div></div>
  </div>`;
  setTimeout(()=>$('#lu')?.focus(),50);
 }
};
ACT['demo']=el=>{$('#lu').value=el.dataset.u;$('#lp').value='kentford123'};
ACT['login']=async()=>{
 const ok=await Auth.login($('#lu').value,$('#lp').value);
 if(!ok){UI.toast('Username atau password salah, atau akun nonaktif.','err');return}
 if(!location.hash||location.hash==='#/')location.hash='#/dashboard';
 App.mount();
};
