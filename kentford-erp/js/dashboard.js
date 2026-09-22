'use strict';
/* =========================================================
   KENTFORD ERP - Dashboard sesuai role
   ========================================================= */
const bars=(items,fmt=rp)=>{
 const max=Math.max(1,...items.map(i=>i.v));
 return items.length?`<div class="bars">${items.map(i=>`<div class="br"><span title="${esc(i.l)}">${esc(i.l.length>22?i.l.slice(0,21)+'…':i.l)}</span><div class="bt"><i style="width:${Math.max(2,i.v/max*100)}%"></i></div><b>${fmt(i.v)}</b></div>`).join('')}</div>`:`<div class="empty">${t('common.no_data_yet')}</div>`;
};
const kpi=(l,v,sub='',cls='')=>`<div class="kpi ${cls}"><span>${esc(l)}</span><b>${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;
const groupSum=(rows,keyf,valf)=>{const m={};rows.forEach(r=>{const k=keyf(r);m[k]=(m[k]||0)+num(valf(r))});return Object.entries(m).map(([l,v])=>({l,v})).sort((a,b)=>b.v-a.v)};

PAGES.dashboard.render=async v=>{
 Quote.expire();
 const exec=isRole('director','deputy_director','sales_manager','tech_manager'),fin=isRole('finance');
 const ym=today().slice(0,7);
 const sos=Scope.rows('salesorders').filter(s=>s.status!=='Dibatalkan'),soMonth=sos.filter(s=>(s.date||'').startsWith(ym));
 const invs=Scope.rows('invoices').filter(i=>!i.cancelled),ar=sum(invs,i=>Inv.outstanding(i)),arOver=sum(invs.filter(i=>Inv.outstanding(i)>0&&i.dueDate<today()),i=>Inv.outstanding(i));
 const lowStock=DB.all('products').filter(p=>num(p.minStock)>0&&Stock.qty(p.id)<=num(p.minStock));
 const orders=Scope.rows('orders').filter(o=>!o.cancelled&&o.stage!=='done'),lateOrders=orders.filter(o=>Order.late(o));
 const qActive=Scope.rows('quotations').filter(q=>['Draft','Menunggu Approval','Disetujui','Dikirim'].includes(q.status));
 const pend=pendingApprovalsForMe();
 let h=UI.pghead(t('dashboard.greeting',{name:Auth.user.name}),`<span class="mut">${esc(Auth.role?.name||'')} • ${fdate(today())}</span>`);

 /* ----- KPI manajemen / finance ----- */
 if(exec||fin){
  const k=[];
  if(exec){
   k.push(kpi(t('dashboard.sales_mtd'),rp(sum(soMonth,s=>s.dpp)),t('dashboard.so_count_dpp',{n:soMonth.length})));
   if(seeCost())k.push(kpi(t('common.gross_profit'),rp(sum(soMonth,s=>s.gp)),t('common.margin')+' '+pct(sum(soMonth,s=>s.dpp)?sum(soMonth,s=>s.gp)/sum(soMonth,s=>s.dpp)*100:0)));
   k.push(kpi(t('dashboard.active_quotations'),qActive.length,t('dashboard.value_prefix')+rp(sum(qActive,q=>q.total))));
   k.push(kpi(t('dashboard.so_in_progress'),sos.filter(s=>['Baru','Diproses','Dikirim'].includes(s.status)).length));
   k.push(kpi(t('dashboard.orders_in_progress'),orders.length,lateOrders.length?t('dashboard.n_late',{n:lateOrders.length}):t('dashboard.none_late'),lateOrders.length?'warn':''));
  }
  k.push(kpi(t('dashboard.total_ar'),rp(ar),t('dashboard.n_unpaid_invoices',{n:invs.filter(i=>Inv.outstanding(i)>0).length})));
  k.push(kpi(t('dashboard.overdue_ar'),rp(arOver),arOver?t('dashboard.needs_collection'):t('dashboard.safe'),arOver?'bad':''));
  if(seeCost())k.push(kpi(t('dashboard.stock_value'),rp(sum(DB.all('stock'),s=>s.qty*num(DB.get('products',s.productId)?.lastCost))),t('dashboard.stock_rows',{n:DB.all('stock').length})));
  k.push(kpi(t('dashboard.low_stock'),lowStock.length,lowStock.length?lowStock.slice(0,2).map(p=>esc(p.name)).join(', '):t('dashboard.all_safe'),lowStock.length?'warn':''));
  k.push(kpi(t('dashboard.approvals_pending'),pend.length,'',pend.length?'warn':''));
  h+=`<div class="grid g4" style="margin-bottom:16px">${k.join('')}</div>`;
 }
 /* ----- Tugas saya ----- */
 const tasks=Order.myTasks();
 const fu=Scope.rows('followups').filter(f=>f.status==='Terjadwal'&&f.date<=today());
 const drafts=[...Scope.rows('quotations').filter(q=>q.status==='Draft'&&q.createdBy===Auth.uid()).map(q=>({t:t('dashboard.quotation_draft'),no:q.no,href:'quotations/'+q.id})),
  ...Scope.rows('orders').filter(o=>o.stage==='sales_input'&&!o.cancelled&&(o.createdBy===Auth.uid()||o.salesId===Auth.uid())).map(o=>({t:t('dashboard.order_needs_revision'),no:o.no,href:'orders/'+o.id}))];
 const sched=[...DB.all('orders').filter(o=>o.data?.shipping?.schedule===today()&&!o.cancelled).map(o=>t('dashboard.shipment_of',{no:o.no,cust:custName(o.customerId)})),
  ...fu.filter(f=>f.date===today()).map(f=>t('dashboard.followup_of',{type:f.type,cust:custName(f.customerId)}))];
 h+=`<div class="grid g2" style="align-items:start"><div>
  <div class="card"><h3>${t('dashboard.my_tasks')} ${UI.badge(t('dashboard.n_tasks',{n:tasks.length}))}</h3>${tasks.length?`<div class="tblw"><table>${tasks.slice(0,8).map(o=>`<tr class="clk" data-act="go" data-h="orders/${o.id}"><td><b>${esc(o.no)}</b><br><small class="mut">${esc(custName(o.customerId))}</small></td><td>${UI.badge(o.statusText)}${Order.late(o)?' '+UI.badge(t('common.late')):''}</td></tr>`).join('')}</table></div>`:`<div class="empty">${t('dashboard.no_order_tasks')}</div>`}</div>
  <div class="card"><h3>${t('dashboard.my_approvals')} ${UI.badge(t('dashboard.n_pending',{n:pend.length}))}</h3>${pend.length?`<div class="tblw"><table>${pend.slice(0,6).map(a=>`<tr class="clk" data-act="appr-open" data-id="${a.id}"><td><b>${esc(a.no)}</b><br><small class="mut">${esc(a.title)}</small></td><td class="num">${a.amount?rp(a.amount):''}</td></tr>`).join('')}</table></div>`:`<div class="empty">${t('dashboard.no_pending_approvals')}</div>`}</div>
  <div class="card"><h3>${t('dashboard.overdue_work')}</h3>${(lateOrders.length||fu.some(f=>f.date<today()))?`<div class="tblw"><table>${lateOrders.slice(0,6).map(o=>`<tr class="clk" data-act="go" data-h="orders/${o.id}"><td>${esc(o.no)} — ${esc(custName(o.customerId))}</td><td>${UI.badge(o.statusText)}</td></tr>`).join('')}${fu.filter(f=>f.date<today()).slice(0,4).map(f=>`<tr class="clk" data-act="go" data-h="followups/${f.id}"><td>${t('dashboard.followup_prefix')} ${esc(custName(f.customerId))}</td><td>${UI.badge(t('common.late'))} <small>${fdate(f.date)}</small></td></tr>`).join('')}</table></div>`:`<div class="empty">${t('dashboard.no_overdue_work')}</div>`}</div>
  </div><div>
  <div class="card"><h3>${t('dashboard.today_schedule')}</h3>${sched.length?sched.map(s=>`<div style="padding:4px 0">• ${esc(s)}</div>`).join(''):`<div class="empty">${t('dashboard.no_schedule_today')}</div>`}</div>
  <div class="card"><h3>${t('dashboard.incomplete_docs')}</h3>${drafts.length?drafts.map(d=>`<div style="padding:4px 0"><a href="#/${d.href}">${esc(d.no)}</a> <span class="mut">— ${esc(d.t)}</span></div>`).join(''):`<div class="empty">${t('dashboard.all_docs_complete')}</div>`}</div>
  <div class="card"><h3>${t('dashboard.recent_notifications')}</h3>${Notify.mine().slice(0,5).map(n=>`<div style="padding:5px 0;border-bottom:1px solid var(--bd)">${n.read?'':'● '}${esc(n.text)}<br><small class="mut">${fdt(n.createdAt)}</small></div>`).join('')||`<div class="empty">${t('dashboard.no_notifications_yet')}</div>`}</div></div></div>`;
 /* ----- Analitik manajemen ----- */
 if(exec||fin){
  const byStage=STAGES.filter(s=>s.key!=='done').map(s=>({l:s.short,v:orders.filter(o=>o.stage===s.key).length})).filter(x=>x.v>0);
  h+=`<div class="grid g2" style="align-items:start">
   <div class="card"><h3>${t('dashboard.top_customers')}</h3>${bars(groupSum(sos,s=>custName(s.customerId),s=>s.dpp).slice(0,5))}</div>
   <div class="card"><h3>${t('dashboard.top_products')}</h3>${bars(groupSum(sos.flatMap(s=>s.lines.map(l=>({n:l.desc||DB.get('products',l.productId)?.name||'-',v:num(l.qty)*num(l.price)*(1-num(l.discPct)/100)}))),r=>r.n,r=>r.v).slice(0,5))}</div>
   <div class="card"><h3>${t('dashboard.sales_performance')}</h3>${bars(groupSum(sos,s=>userName(s.salesId),s=>s.dpp))}</div>
   <div class="card"><h3>${t('dashboard.orders_by_stage')}</h3>${bars(byStage,n=>t('dashboard.n_orders',{n}))}</div></div>`;
 }
 /* ----- K. Aftersales Partner Network (hanya role dengan akses modul partner) ----- */
 if(isRole('director','deputy_director','admin_aftersales','tech_manager')&&typeof PartnerDash!=='undefined'){
  const ps=PartnerDash.summary();
  h+=`<div class="card"><h3>${t('nav.partners_map')}</h3><div class="grid g4">
   ${kpi(t('partner.col_active'),ps.active)}${kpi(t('partner.col_prospect'),ps.prospect)}${kpi(t('partner.col_inactive'),ps.inactive)}
   ${kpi(t('partner.coverage_by_province'),ps.provincesCovered+'/'+ps.provincesTotal)}
   ${kpi(t('partner.rating'),ps.topRated?esc(ps.topRated.name)+' ('+(num(ps.topRated.rating)||'-')+')':'-')}
   ${kpi(t('common.notes'),ps.expiring.length,ps.expiring.length?ps.expiring.slice(0,2).map(p=>esc(p.name)).join(', '):'','warn')}
   ${kpi(t('partner.evaluate_btn'),ps.notEvaluated.length,'',ps.notEvaluated.length?'warn':'')}
   ${kpi(t('partner.region_priority'),ps.priorityRegions.length,ps.priorityRegions.slice(0,2).map(r=>esc(r.province)).join(', '),ps.priorityRegions.length?'bad':'')}
   </div><p class="mut" style="margin-top:6px"><a href="#/partners_map">${t('partner.view_map')} ›</a></p></div>`;
 }
 v.innerHTML=h;
};
ACT['go']=el=>{location.hash='#/'+el.dataset.h};
