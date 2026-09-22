'use strict';
/* =========================================================
   KENTFORD ERP - Dashboard sesuai role
   ========================================================= */
const bars=(items,fmt=rp)=>{
 const max=Math.max(1,...items.map(i=>i.v));
 return items.length?`<div class="bars">${items.map(i=>`<div class="br"><span title="${esc(i.l)}">${esc(i.l.length>22?i.l.slice(0,21)+'…':i.l)}</span><div class="bt"><i style="width:${Math.max(2,i.v/max*100)}%"></i></div><b>${fmt(i.v)}</b></div>`).join('')}</div>`:'<div class="empty">Belum ada data.</div>';
};
const kpi=(l,v,sub='',cls='')=>`<div class="kpi ${cls}"><span>${esc(l)}</span><b>${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;
const groupSum=(rows,keyf,valf)=>{const m={};rows.forEach(r=>{const k=keyf(r);m[k]=(m[k]||0)+num(valf(r))});return Object.entries(m).map(([l,v])=>({l,v})).sort((a,b)=>b.v-a.v)};

PAGES.dashboard.render=async v=>{
 Quote.expire();
 const exec=isRole('president_director','manager'),fin=isRole('finance');
 const ym=today().slice(0,7);
 const sos=Scope.rows('salesorders').filter(s=>s.status!=='Dibatalkan'),soMonth=sos.filter(s=>(s.date||'').startsWith(ym));
 const invs=Scope.rows('invoices').filter(i=>!i.cancelled),ar=sum(invs,i=>Inv.outstanding(i)),arOver=sum(invs.filter(i=>Inv.outstanding(i)>0&&i.dueDate<today()),i=>Inv.outstanding(i));
 const lowStock=DB.all('products').filter(p=>num(p.minStock)>0&&Stock.qty(p.id)<=num(p.minStock));
 const orders=Scope.rows('orders').filter(o=>!o.cancelled&&o.stage!=='done'),lateOrders=orders.filter(o=>Order.late(o));
 const qActive=Scope.rows('quotations').filter(q=>['Draft','Menunggu Approval','Disetujui','Dikirim'].includes(q.status));
 const pend=pendingApprovalsForMe();
 let h=UI.pghead(`Halo, ${Auth.user.name}`,`<span class="mut">${esc(Auth.role?.name||'')} • ${fdate(today())}</span>`);

 /* ----- KPI manajemen / finance ----- */
 if(exec||fin){
  const k=[];
  if(exec){
   k.push(kpi('Penjualan bulan berjalan',rp(sum(soMonth,s=>s.dpp)),`${soMonth.length} Sales Order (DPP)`));
   if(seeCost())k.push(kpi('Gross profit',rp(sum(soMonth,s=>s.gp)),'Margin '+pct(sum(soMonth,s=>s.dpp)?sum(soMonth,s=>s.gp)/sum(soMonth,s=>s.dpp)*100:0)));
   k.push(kpi('Quotation aktif',qActive.length,`Nilai ${rp(sum(qActive,q=>q.total))}`));
   k.push(kpi('Sales Order berjalan',sos.filter(s=>['Baru','Diproses','Dikirim'].includes(s.status)).length));
   k.push(kpi('New Order berjalan',orders.length,lateOrders.length?`${lateOrders.length} terlambat`:'Tidak ada yang terlambat',lateOrders.length?'warn':''));
  }
  k.push(kpi('Total piutang (AR)',rp(ar),`${invs.filter(i=>Inv.outstanding(i)>0).length} invoice belum lunas`));
  k.push(kpi('Piutang jatuh tempo',rp(arOver),arOver?'Perlu penagihan':'Aman',arOver?'bad':''));
  if(seeCost())k.push(kpi('Nilai stok (harga beli)',rp(sum(DB.all('stock'),s=>s.qty*num(DB.get('products',s.productId)?.lastCost))),`${DB.all('stock').length} baris stok`));
  k.push(kpi('Stok menipis',lowStock.length,lowStock.length?lowStock.slice(0,2).map(p=>esc(p.name)).join(', '):'Semua aman',lowStock.length?'warn':''));
  k.push(kpi('Approval menunggu Anda',pend.length,'',pend.length?'warn':''));
  h+=`<div class="grid g4" style="margin-bottom:16px">${k.join('')}</div>`;
 }
 /* ----- Tugas saya ----- */
 const tasks=Order.myTasks();
 const fu=Scope.rows('followups').filter(f=>f.status==='Terjadwal'&&f.date<=today());
 const drafts=[...Scope.rows('quotations').filter(q=>q.status==='Draft'&&q.createdBy===Auth.uid()).map(q=>({t:'Quotation draft',no:q.no,href:'quotations/'+q.id})),
  ...Scope.rows('orders').filter(o=>o.stage==='sales_input'&&!o.cancelled&&(o.createdBy===Auth.uid()||o.salesId===Auth.uid())).map(o=>({t:'New Order belum dikirim / perlu revisi',no:o.no,href:'orders/'+o.id}))];
 const sched=[...DB.all('orders').filter(o=>o.data?.shipping?.schedule===today()&&!o.cancelled).map(o=>`Pengiriman ${o.no} — ${custName(o.customerId)}`),
  ...fu.filter(f=>f.date===today()).map(f=>`Follow-up ${f.type}: ${custName(f.customerId)}`)];
 h+=`<div class="grid g2" style="align-items:start"><div>
  <div class="card"><h3>Tugas saya ${UI.badge(tasks.length+' tugas')}</h3>${tasks.length?`<div class="tblw"><table>${tasks.slice(0,8).map(o=>`<tr class="clk" data-act="go" data-h="orders/${o.id}"><td><b>${esc(o.no)}</b><br><small class="mut">${esc(custName(o.customerId))}</small></td><td>${UI.badge(o.statusText)}${Order.late(o)?' '+UI.badge('Terlambat'):''}</td></tr>`).join('')}</table></div>`:'<div class="empty">Tidak ada tugas New Order untuk Anda.</div>'}</div>
  <div class="card"><h3>Approval saya ${UI.badge(pend.length+' menunggu')}</h3>${pend.length?`<div class="tblw"><table>${pend.slice(0,6).map(a=>`<tr class="clk" data-act="appr-open" data-id="${a.id}"><td><b>${esc(a.no)}</b><br><small class="mut">${esc(a.title)}</small></td><td class="num">${a.amount?rp(a.amount):''}</td></tr>`).join('')}</table></div>`:'<div class="empty">Tidak ada approval yang menunggu.</div>'}</div>
  <div class="card"><h3>Pekerjaan terlambat</h3>${(lateOrders.length||fu.some(f=>f.date<today()))?`<div class="tblw"><table>${lateOrders.slice(0,6).map(o=>`<tr class="clk" data-act="go" data-h="orders/${o.id}"><td>${esc(o.no)} — ${esc(custName(o.customerId))}</td><td>${UI.badge(o.statusText)}</td></tr>`).join('')}${fu.filter(f=>f.date<today()).slice(0,4).map(f=>`<tr class="clk" data-act="go" data-h="followups/${f.id}"><td>Follow-up ${esc(custName(f.customerId))}</td><td>${UI.badge('Terlambat')} <small>${fdate(f.date)}</small></td></tr>`).join('')}</table></div>`:'<div class="empty">Tidak ada pekerjaan terlambat.</div>'}</div>
  </div><div>
  <div class="card"><h3>Jadwal hari ini</h3>${sched.length?sched.map(s=>`<div style="padding:4px 0">• ${esc(s)}</div>`).join(''):'<div class="empty">Tidak ada jadwal hari ini.</div>'}</div>
  <div class="card"><h3>Dokumen belum lengkap</h3>${drafts.length?drafts.map(d=>`<div style="padding:4px 0"><a href="#/${d.href}">${esc(d.no)}</a> <span class="mut">— ${esc(d.t)}</span></div>`).join(''):'<div class="empty">Semua dokumen Anda sudah lengkap.</div>'}</div>
  <div class="card"><h3>Notifikasi terbaru</h3>${Notify.mine().slice(0,5).map(n=>`<div style="padding:5px 0;border-bottom:1px solid var(--bd)">${n.read?'':'● '}${esc(n.text)}<br><small class="mut">${fdt(n.createdAt)}</small></div>`).join('')||'<div class="empty">Belum ada notifikasi.</div>'}</div></div></div>`;
 /* ----- Analitik manajemen ----- */
 if(exec||fin){
  const byStage=STAGES.filter(s=>s.key!=='done').map(s=>({l:s.short,v:orders.filter(o=>o.stage===s.key).length})).filter(x=>x.v>0);
  h+=`<div class="grid g2" style="align-items:start">
   <div class="card"><h3>Top customer (nilai SO)</h3>${bars(groupSum(sos,s=>custName(s.customerId),s=>s.dpp).slice(0,5))}</div>
   <div class="card"><h3>Top produk (nilai penjualan)</h3>${bars(groupSum(sos.flatMap(s=>s.lines.map(l=>({n:l.desc||DB.get('products',l.productId)?.name||'-',v:num(l.qty)*num(l.price)*(1-num(l.discPct)/100)}))),r=>r.n,r=>r.v).slice(0,5))}</div>
   <div class="card"><h3>Performa sales (nilai SO)</h3>${bars(groupSum(sos,s=>userName(s.salesId),s=>s.dpp))}</div>
   <div class="card"><h3>New Order per tahap</h3>${bars(byStage,n=>n+' order')}</div></div>`;
 }
 v.innerHTML=h;
};
ACT['go']=el=>{location.hash='#/'+el.dataset.h};
