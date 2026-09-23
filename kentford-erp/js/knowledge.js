'use strict';
/* =========================================================
   KENTFORD ERP - Knowledge Base internal: dokumen project & video
   tutorial (mis. cara benerin genset masuk angin). Upload file
   sungguhan ke server (ServerFiles, lihat js/core.js) - beda dari
   attachment biasa (F.fl) yang cuma tersimpan lokal per-browser.
   ========================================================= */
const KNOW_CATS=['Video Tutorial','Dokumen Project','SOP','Lainnya'];
const KNOW_UPLOAD_ROLES=['technician','tech_manager','admin_aftersales','deputy_director','director'];
const canUploadKnowledge=()=>KNOW_UPLOAD_ROLES.includes(Auth.user?.roleId);

PAGES.knowledge.render=async(v,param)=>{
 if(param){KnowDoc.openDetail(param);}
 v.innerHTML=UI.pghead('Knowledge Base',canUploadKnowledge()?'<button class="btn" data-act="know-new">+ Tambah Dokumen</button>':'')+
  `<div class="card"><div class="fld" style="max-width:320px"><input id="knowq" type="search" placeholder="Cari judul, kategori, tag..."></div></div>
   <div class="grid g3" id="knowlist"></div>`;
 $('#knowq').addEventListener('input',()=>KnowDoc.renderList());
 KnowDoc.renderList();
};
const KnowDoc={
 renderList(q){
  q=(q??$('#knowq')?.value??'').toLowerCase();
  const rows=DB.all('knowledge_docs').filter(r=>!q||[r.title,r.category,r.unit,r.tags].join(' ').toLowerCase().includes(q)).slice().reverse();
  const el=$('#knowlist');if(!el)return;
  el.innerHTML=rows.length?rows.map(r=>`
   <div class="card" style="cursor:pointer" data-act="know-open" data-id="${r.id}">
    <div class="badge b-blue">${esc(r.category)}</div>
    <h3 style="margin-top:8px">${esc(r.title)}</h3>
    ${r.unit?`<p class="mut" style="margin:2px 0">${esc(r.unit)}</p>`:''}
    <p class="mut" style="font-size:12px">${r.fileMeta?.type?.startsWith('video/')?'▶ Video':'📄 Dokumen'} · ${nf((r.fileMeta?.size||0)/1024/1024)} MB · ${fdate(r.createdAt||r.at)}</p>
   </div>`).join(''):'<div class="empty">Belum ada dokumen/video. '+(canUploadKnowledge()?'Klik "+ Tambah Dokumen" untuk mulai.':'')+'</div>';
 },
 async openNew(){
  if(!canUploadKnowledge())return UI.toast(t('know.no_upload_right'),'err');
  const m=UI.modal({title:'Tambah Dokumen / Video Tutorial',wide:true,body:`
   <div class="fg">
    <div class="fld"><label>Judul</label><input id="kTitle" required></div>
    <div class="fld"><label>Kategori</label><select id="kCat">${KNOW_CATS.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>
    <div class="fld"><label>Unit / masalah terkait</label><input id="kUnit" placeholder="mis. Genset masuk angin"></div>
    <div class="fld full"><label>Tag (pisah koma)</label><input id="kTags" placeholder="mis. genset, troubleshooting, mesin"></div>
    <div class="fld full"><label>Deskripsi</label><textarea id="kDesc" rows="3"></textarea></div>
    <div class="fld full"><label>File (video/dokumen, maks 200MB)</label><input id="kFile" type="file" required></div>
    <div class="fld full" id="kProg" class="hide"></div>
   </div>`,foot:`<button class="btn btn-o" data-x="c">${t('admin.close')}</button><button class="btn" data-x="s">Upload & Simpan</button>`});
  m.el.addEventListener('click',async ev=>{
   const b=ev.target.closest('[data-x]');if(!b)return;
   if(b.dataset.x==='c'){m.close();return}
   if(b.dataset.x==='s'){
    const title=$('#kTitle',m.body).value.trim(),file=$('#kFile',m.body).files[0];
    if(!title)return UI.toast(t('know.title_required'),'err');
    if(!file)return UI.toast(t('know.file_required'),'err');
    if(file.size>200*1024*1024)return UI.toast(t('know.file_too_large'),'err');
    b.disabled=true;b.textContent='Mengupload...';
    try{
     const fileMeta=await ServerFiles.put(file);
     DB.insert('knowledge_docs',{title,category:$('#kCat',m.body).value,unit:$('#kUnit',m.body).value.trim(),
      tags:$('#kTags',m.body).value.trim(),description:$('#kDesc',m.body).value.trim(),fileMeta,uploadedByName:Auth.user.name});
     UI.toast(t('know.saved'));m.close();KnowDoc.renderList();
    }catch(e){UI.toast(e.message||'Upload gagal.','err');b.disabled=false;b.textContent='Upload & Simpan'}
   }
  });
 },
 openDetail(id){
  const r=DB.get('knowledge_docs',id);if(!r)return;
  const isVideo=r.fileMeta?.type?.startsWith('video/');
  const url=r.fileMeta?ServerFiles.url(r.fileMeta.id):'';
  const m=UI.modal({title:r.title,wide:true,
   body:`<div class="badge b-blue">${esc(r.category)}</div>${r.unit?` <b>${esc(r.unit)}</b>`:''}
    <p class="mut" style="margin:8px 0">${esc(r.description||'')}</p>
    ${isVideo?`<video src="${url}" controls style="width:100%;max-height:60vh;border-radius:8px;background:#000"></video>`
     :`<p><a class="btn btn-o" href="${url}" target="_blank" rel="noopener">Buka / Unduh File</a></p>`}
    <p class="mut" style="margin-top:10px;font-size:12px">Diupload oleh ${esc(r.uploadedByName||'-')} · ${fdt(r.createdAt||r.at)}${r.tags?' · Tag: '+esc(r.tags):''}</p>`,
   foot:`<button class="btn btn-o" data-x="c">${t('admin.close')}</button>`+(canUploadKnowledge()?`<button class="btn btn-d" data-x="del">${t('admin.delete')}</button>`:'')});
  m.el.addEventListener('click',async ev=>{
   const b=ev.target.closest('[data-x]');if(!b)return;
   if(b.dataset.x==='c'){m.close();history.replaceState(null,'','#/knowledge');return}
   if(b.dataset.x==='del'){
    if(!confirm('Hapus dokumen ini?'))return;
    if(r.fileMeta?.id)await ServerFiles.remove(r.fileMeta.id);
    DB.remove('knowledge_docs',r.id,'Dihapus dari Knowledge Base');
    UI.toast(t('know.deleted'));m.close();history.replaceState(null,'','#/knowledge');KnowDoc.renderList();
   }
  });
 }
};
ACT['know-new']=()=>KnowDoc.openNew();
ACT['know-open']=el=>{history.replaceState(null,'','#/knowledge/'+el.dataset.id);KnowDoc.openDetail(el.dataset.id)};
