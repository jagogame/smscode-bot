'use strict';
/*
 * KNOWN-RISK DUPLICATION: this table is a manually-maintained MIRROR of ROLE_SEED in the
 * frontend's kentford-erp/js/schema.js. The backend is a plain Node service and cannot
 * `require()` a browser-only frontend file, so the permission shape (perm/seeCost/scopeOwn)
 * for each of the 10 roles is copied here by hand. If ROLE_SEED in js/schema.js changes
 * (new page key, new role, changed seeCost/scopeOwn/perm), this file MUST be updated to
 * match or the backend-issued `role` object handed to the frontend on login/session-restore
 * will be stale/wrong. There is currently no automated sync between the two copies.
 */

const ALLK = [
  'dashboard','leads','customers','followups','quotations','salesorders','orders',
  'pr','sq','pc','po','suppliers','incoming',
  'products','stock_genset','stock_parts','gr','gi','transfer','opname','barcode',
  'invoices','ar','si','ap','payreq','bank','petty','tax','recon','coa','journal',
  'company_docs','leave',
  'rent_units','rent_contracts','rent_schedule','hourmeter','overtime','deposit','rent_return',
  'svc_req','survey','wo','tech_sched','install','pm','warranty','svc_report',
  'approvals_pending','approvals_done','approvals_rejected','approvals_history',
  'partners','partners_map','partner_prospects','partner_evaluations','partner_payments',
  'master','users','settings','reports'
];
const G_CRM = ['leads','customers','followups','quotations','salesorders','orders'];
const G_PUR = ['pr','sq','pc','po','suppliers','incoming'];
const G_INV = ['products','stock_genset','stock_parts','gr','gi','transfer','opname','barcode'];
const G_FIN = ['invoices','ar','si','ap','payreq','bank','petty','tax','recon','coa','journal'];
const G_ADM = ['company_docs','leave'];
const G_RENT = ['rent_units','rent_contracts','rent_schedule','hourmeter','overtime','deposit','rent_return'];
const G_SVC = ['svc_req','survey','wo','tech_sched','install','pm','warranty','svc_report'];
const G_APR = ['approvals_pending','approvals_done','approvals_rejected','approvals_history'];
const G_PTN = ['partners','partners_map','partner_prospects','partner_evaluations','partner_payments'];
const permOf = (r, w = []) => { const o = {}; r.forEach(k => o[k] = 'r'); w.forEach(k => o[k] = 'w'); return o; };

const ROLE_SEED = [
  { id: 'director', name: 'Direktur', seeCost: true, scopeOwn: false, perm: permOf(ALLK, [...G_APR, 'orders', 'quotations', 'master', 'settings', 'leads', 'customers', 'followups', 'suppliers', 'invoices', 'salesorders', 'users', 'coa', 'journal', ...G_ADM, ...G_PTN]) },
  { id: 'deputy_director', name: 'Asisten Direktur', seeCost: true, scopeOwn: false, perm: permOf(ALLK.filter(k => !['settings'].includes(k)), [...G_APR, 'orders', 'quotations', 'master', 'leads', 'customers', 'followups', 'suppliers', 'invoices', 'salesorders', 'users', ...G_PTN]) },
  { id: 'finance', name: 'Finance, Accounting & Tax', seeCost: true, scopeOwn: false, perm: permOf(['dashboard', 'customers', 'quotations', 'salesorders', 'orders', 'followups', 'suppliers', 'po', 'products', 'stock_genset', 'stock_parts', 'reports', 'master', ...G_FIN, ...G_APR, 'rent_contracts', 'deposit', 'overtime', ...G_PTN], [...G_FIN, 'invoices', 'partner_payments']) },
  { id: 'admin_hr_sales', name: 'General Admin, HR & Sales Support', seeCost: false, scopeOwn: false, perm: permOf(['dashboard', ...G_CRM, ...G_PUR, 'products', 'stock_genset', 'stock_parts', 'invoices', 'ar', 'reports', 'master', 'users', ...G_APR, ...G_RENT, ...G_SVC, ...G_ADM, ...G_PTN], ['customers', 'followups', 'quotations', 'salesorders', 'orders', 'invoices', 'leads', ...G_SVC, ...G_PUR, 'master', ...G_ADM, 'partners', 'partner_prospects']) },
  { id: 'admin_aftersales', name: 'Admin Aftersales', seeCost: false, scopeOwn: false, perm: permOf(['dashboard', 'customers', 'products', 'stock_genset', 'stock_parts', 'reports', ...G_SVC, ...G_APR, ...G_PTN], ['svc_req', 'survey', 'install', 'pm', 'svc_report', 'partners', 'partners_map', 'partner_prospects', 'partner_evaluations', 'partner_payments']) },
  { id: 'warehouse', name: 'Admin Gudang', seeCost: false, scopeOwn: false, perm: permOf(['dashboard', 'orders', 'products', 'stock_genset', 'stock_parts', 'reports', 'master', 'svc_req', 'wo', ...G_INV, ...G_APR, 'partners', 'partners_map'], [...G_INV.filter(k => k !== 'products')]) },
  { id: 'tech_manager', name: 'Manager Teknisi', seeCost: false, scopeOwn: false, perm: permOf(['dashboard', 'products', 'stock_genset', 'stock_parts', 'reports', ...G_SVC, ...G_APR, ...G_PTN], [...G_SVC, 'partner_evaluations']) },
  { id: 'technician', name: 'Staff Teknisi', seeCost: false, scopeOwn: true, perm: permOf(['dashboard', 'orders', 'products', 'stock_genset', 'stock_parts', ...G_SVC, ...G_APR], [...G_SVC]) },
  { id: 'sales_manager', name: 'Manager Sales', seeCost: true, scopeOwn: false, perm: permOf(['dashboard', ...G_CRM, 'products', 'stock_genset', 'stock_parts', 'invoices', 'reports', 'master', ...G_APR, 'partners', 'partners_map'], [...G_CRM]) },
  { id: 'sales', name: 'Staff Sales', seeCost: false, scopeOwn: true, perm: permOf(['dashboard', 'leads', 'customers', 'followups', 'quotations', 'salesorders', 'orders', 'products', 'stock_genset', 'stock_parts', 'invoices', 'reports', ...G_APR, 'partners', 'partners_map'], ['leads', 'customers', 'followups', 'quotations', 'orders']) }
];

// Only these roles may read/write the admin user-management endpoints (matches
// ROLE_SEED's 'users':'w' entries in js/schema.js — director & deputy_director).
const ADMIN_ROLE_IDS = ['director', 'deputy_director'];

function roleById(id) {
  return ROLE_SEED.find(r => r.id === id) || null;
}

// Per-user override (u.fullAccess === true): grants write access to every page regardless
// of the user's actual roleId/role label. Used sparingly for individuals who need to act
// across all departments without reassigning their formal role.
function fullAccessRole(baseRoleId) {
  const base = roleById(baseRoleId);
  return { id: base ? base.id : baseRoleId, name: base ? base.name : baseRoleId, seeCost: true, scopeOwn: false, perm: permOf(ALLK, ALLK) };
}

module.exports = { ROLE_SEED, ADMIN_ROLE_IDS, roleById, fullAccessRole };
