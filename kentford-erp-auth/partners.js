'use strict';
/*
 * Aftersales Partner Network API — extends the existing kentford-erp-auth Express app.
 * Adds server-side, shared storage for the 4 partner-network collections (previously only
 * in each browser's local IndexedDB, which is why the data kept disappearing whenever a
 * browser's storage was cleared). Mounted from server.js via mount(app, { authMiddleware }).
 *
 * Mirrors js/schema.js's ENT.partners / ENT.partner_prospects / ENT.partner_evaluations /
 * ENT.partner_payments field lists and js/partners.js's PartnerCode.next() numbering scheme.
 * Role read/write permission is taken directly from roles.js's ROLE_SEED perm map (same
 * source roles.js already mirrors from js/schema.js's ROLE_SEED), so it stays in lock-step
 * with the existing role table instead of re-deriving a second copy of the rule.
 */
const crypto = require('crypto');
const { roleById } = require('./roles');
const db = require('./db');

const genId = (p) => p + '_' + crypto.randomBytes(8).toString('hex');
const now = () => Date.now();
const nowISO = () => new Date().toISOString();

/* ---------- province -> island/code map, ported verbatim from js/schema.js PROVINCE_MAP ---------- */
const PROVINCE_MAP = {
  'DKI Jakarta': ['JAVA', 'JKT'], 'Jakarta': ['JAVA', 'JKT'], 'Jawa Barat': ['JAVA', 'JBR'], 'Jawa Tengah': ['JAVA', 'JTG'], 'DI Yogyakarta': ['JAVA', 'JOG'], 'Yogyakarta': ['JAVA', 'JOG'],
  'Jawa Timur': ['JAVA', 'JTM'], 'Banten': ['JAVA', 'BTN'],
  'Aceh': ['SUM', 'ACE'], 'Sumatera Utara': ['SUM', 'SU'], 'Sumatera Barat': ['SUM', 'SB'], 'Riau': ['SUM', 'RIA'], 'Kepulauan Riau': ['SUM', 'KRI'], 'Jambi': ['SUM', 'JMB'],
  'Sumatera Selatan': ['SUM', 'SS'], 'Bengkulu': ['SUM', 'BKL'], 'Lampung': ['SUM', 'LPG'], 'Bangka Belitung': ['SUM', 'BAB'],
  'Kalimantan Barat': ['KAL', 'KB'], 'Kalimantan Tengah': ['KAL', 'KTG'], 'Kalimantan Selatan': ['KAL', 'KS'], 'Kalimantan Timur': ['KAL', 'KT'], 'Kalimantan Utara': ['KAL', 'KU'],
  'Sulawesi Utara': ['SUL', 'SU'], 'Sulawesi Tengah': ['SUL', 'STG'], 'Sulawesi Selatan': ['SUL', 'SS'], 'Sulawesi Tenggara': ['SUL', 'STR'], 'Gorontalo': ['SUL', 'GTO'], 'Sulawesi Barat': ['SUL', 'SB'],
  'Bali': ['BALI', 'BLI'],
  'Nusa Tenggara Barat': ['NUSRA', 'NTB'], 'Nusa Tenggara Timur': ['NUSRA', 'NTT'],
  'Maluku': ['MALUKU', 'MLK'], 'Maluku Utara': ['MALUKU', 'MLU'],
  'Papua': ['PAPUA', 'PAP'], 'Papua Barat': ['PAPUA', 'PB'], 'Papua Tengah': ['PAPUA', 'PTG'], 'Papua Selatan': ['PAPUA', 'PSL'], 'Papua Pegunungan': ['PAPUA', 'PPG']
};
function pad(n, l) { return String(n).padStart(l, '0'); }
function lookupProvince(province) { return PROVINCE_MAP[province] || ['LAINNYA', (province || 'XX').slice(0, 3).toUpperCase()]; }

// Server-side, globally-unique next code for a province — mirrors PartnerCode.next() in
// js/partners.js exactly (format + per-province sequence), but backed by db.json's
// partnerCodeCounters instead of a per-browser Store.mem.counters.
function nextPartnerCode(data, province) {
  const [island, pcode] = lookupProvince(province);
  const key = 'PTN-' + island + '-' + pcode;
  if (!data.partnerCodeCounters) data.partnerCodeCounters = {};
  data.partnerCodeCounters[key] = (data.partnerCodeCounters[key] || 0) + 1;
  const n = data.partnerCodeCounters[key];
  return island === 'PAPUA' ? `${island}-${pad(n, 3)}` : `${island}-${pcode}-${pad(n, 3)}`;
}

/* ---------- collection registry ---------- */
// pageKey: matches ROLE_SEED perm's page key (js/schema.js / roles.js) used to check read/write.
// dataKey: the array's name inside data/db.json.
const COLLECTIONS = {
  partners: { pageKey: 'partners', dataKey: 'partners', route: '/api/partners' },
  'partner-prospects': { pageKey: 'partner_prospects', dataKey: 'partnerProspects', route: '/api/partner-prospects' },
  'partner-evaluations': { pageKey: 'partner_evaluations', dataKey: 'partnerEvaluations', route: '/api/partner-evaluations' },
  'partner-payments': { pageKey: 'partner_payments', dataKey: 'partnerPayments', route: '/api/partner-payments' }
};

function ensureArrays(data) {
  Object.values(COLLECTIONS).forEach(c => { if (!Array.isArray(data[c.dataKey])) data[c.dataKey] = []; });
  if (!data.partnerCodeCounters) data.partnerCodeCounters = {};
}

function canRead(role, pageKey) { return !!(role && role.perm && role.perm[pageKey]); }
function canWrite(role, pageKey) { return !!(role && role.perm && role.perm[pageKey] === 'w'); }

function shape(r) { return r; } // no fields hidden server-side (partner data isn't sensitive like passwords)

module.exports = function mount(app, { authMiddleware }) {
  Object.entries(COLLECTIONS).forEach(([name, cfg]) => {
    const { pageKey, dataKey, route } = cfg;

    app.get(route, authMiddleware, (req, res) => {
      const role = roleById(req.authUser.roleId);
      if (!canRead(role, pageKey)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const data = db.read();
      ensureArrays(data);
      // Returns ALL rows including soft-deleted ones (deletedAt set) — mirrors the local
      // IndexedDB DB.col()/DB.all() split: the frontend cache keeps everything and filters
      // deletedAt client-side, so the admin.js "show archived" toggle keeps working unchanged.
      res.json({ ok: true, items: data[dataKey].map(shape) });
    });

    app.post(route, authMiddleware, async (req, res) => {
      const role = roleById(req.authUser.roleId);
      if (!canWrite(role, pageKey)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const b = req.body || {};

      // Aftersales-partner-only rule (spec M, mirrored from js/admin.js Crud.open): admin_hr_sales
      // may create/edit partners, but may never set status straight to 'Active' — that requires
      // admin_aftersales/director/deputy_director. Enforced here too so it can't be bypassed by
      // calling the API directly.
      if (dataKey === 'partners' && req.authUser.roleId === 'admin_hr_sales' && b.status === 'Active') {
        return res.status(403).json({ ok: false, error: 'hr_cannot_activate', msg: 'Admin HR & Sales Support tidak berwenang mengaktifkan status partner langsung ke Active.' });
      }

      let created;
      await db.transact(data2 => {
        ensureArrays(data2);
        const r = { id: genId('p'), ...b, createdAt: nowISO(), createdBy: req.authUser.id, updatedAt: nowISO(), updatedBy: req.authUser.id, deletedAt: null };
        if (dataKey === 'partners') {
          // code is always server-assigned, never trusted from the client (mirrors admin.js's
          // `if(k==='partners'&&!rec)v.code=PartnerCode.next(v.province)`).
          if (!r.province) throw Object.assign(new Error('province_required'), { http: 400 });
          r.code = nextPartnerCode(data2, r.province);
          delete r.rating; // rating is only ever set by recalc-from-evaluations, never by client input
        }
        data2[dataKey].push(r);
        created = r;
      }).catch(e => { if (!res.headersSent) { res.status(e.http || 500).json({ ok: false, error: e.message }); } });
      if (res.headersSent) return;
      res.json({ ok: true, item: shape(created) });
    });

    app.put(`${route}/:id`, authMiddleware, async (req, res) => {
      const role = roleById(req.authUser.roleId);
      if (!canWrite(role, pageKey)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const b = req.body || {};
      const data = db.read();
      ensureArrays(data);
      const existing = data[dataKey].find(r => r.id === req.params.id && !r.deletedAt);
      if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });

      if (dataKey === 'partners' && req.authUser.roleId === 'admin_hr_sales' && b.status === 'Active' && existing.status !== 'Active') {
        return res.status(403).json({ ok: false, error: 'hr_cannot_activate', msg: 'Admin HR & Sales Support tidak berwenang mengaktifkan status partner langsung ke Active.' });
      }

      let updated;
      await db.transact(data2 => {
        const r = data2[dataKey].find(x => x.id === req.params.id);
        const patch = { ...b };
        delete patch.id; delete patch.code; delete patch.createdAt; delete patch.createdBy; delete patch.deletedAt;
        if (dataKey === 'partners') delete patch.rating; // see recalc endpoint below
        Object.assign(r, patch, { updatedAt: nowISO(), updatedBy: req.authUser.id });
        updated = r;
      });
      res.json({ ok: true, item: shape(updated) });
    });

    app.post(`${route}/:id/restore`, authMiddleware, async (req, res) => {
      const role = roleById(req.authUser.roleId);
      if (!canWrite(role, pageKey)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const data = db.read();
      ensureArrays(data);
      const existing = data[dataKey].find(r => r.id === req.params.id && r.deletedAt);
      if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
      let updated;
      await db.transact(data2 => {
        const r = data2[dataKey].find(x => x.id === req.params.id);
        r.deletedAt = null; r.deletedBy = null; r.updatedAt = nowISO(); r.updatedBy = req.authUser.id;
        updated = r;
      });
      res.json({ ok: true, item: shape(updated) });
    });

    app.delete(`${route}/:id`, authMiddleware, async (req, res) => {
      const role = roleById(req.authUser.roleId);
      if (!canWrite(role, pageKey)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const data = db.read();
      ensureArrays(data);
      const existing = data[dataKey].find(r => r.id === req.params.id && !r.deletedAt);
      if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
      await db.transact(data2 => {
        const r = data2[dataKey].find(x => x.id === req.params.id);
        r.deletedAt = nowISO();
        r.deletedBy = req.authUser.id;
        r.updatedAt = nowISO();
      });
      res.json({ ok: true });
    });
  });

  // Recalculate a partner's `rating` field from its evaluations (server-side mirror of
  // Partners.recalcRating() in js/partners.js). Called by the frontend right after it creates
  // or updates a partner_evaluations record, since rating must stay derived, not client-set.
  app.post('/api/partners/:id/recalc-rating', authMiddleware, async (req, res) => {
    const role = roleById(req.authUser.roleId);
    if (!canWrite(role, 'partner_evaluations')) return res.status(403).json({ ok: false, error: 'forbidden' });
    const SCORE_KEYS = ['scoreSpeed', 'scorePunctual', 'scoreTech', 'scoreTools', 'scoreQuality', 'scoreReport', 'scoreComm', 'scoreSatisfaction', 'scoreCost', 'scoreSop'];
    const data = db.read();
    ensureArrays(data);
    const p = data.partners.find(x => x.id === req.params.id && !x.deletedAt);
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' });
    const evs = data.partnerEvaluations.filter(e => e.partnerId === req.params.id && !e.deletedAt);
    const avg = evs.length ? evs.reduce((s, e) => s + SCORE_KEYS.reduce((s2, k) => s2 + (Number(e[k]) || 0), 0) / SCORE_KEYS.length, 0) / evs.length : 0;
    const rating = +avg.toFixed(2);
    let updated;
    await db.transact(data2 => {
      const pp = data2.partners.find(x => x.id === req.params.id);
      pp.rating = rating; pp.updatedAt = nowISO(); pp.updatedBy = req.authUser.id;
      updated = pp;
    });
    res.json({ ok: true, item: updated });
  });
};
