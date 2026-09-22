'use strict';
/*
 * Generic shared-collection store — extends kentford-erp-auth so every business collection
 * the app keeps in js/core.js's `Store.mem` (customers, orders, stock, invoices, audit, ...)
 * can be persisted on the VPS instead of only in one browser's IndexedDB. Mounted from
 * server.js via mount(app, { authMiddleware }).
 *
 * Mirrors the client's Store.put(col) semantics exactly: each named collection is one JSON
 * array, replaced wholesale on every save (same as the client already does against its own
 * IndexedDB `kv` object store) — so this file only needs to shuttle that array to/from
 * db.json, not understand what's inside it.
 *
 * Collections already migrated to their own dedicated, purpose-built tables (the Aftersales
 * Partner Network — see partners.js) are skipped client-side and never reach here; this store
 * is for everything else the app doesn't have a bespoke API for yet.
 */
const db = require('./db');

// Reject anything that isn't a plain, safe collection name — guards against prototype
// pollution (__proto__/constructor/prototype as a key) and keeps this from ever being asked
// to store outside the flat { store: { <col>: [...] } } shape.
const SAFE_COL = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
function validCol(col) {
  return typeof col === 'string' && SAFE_COL.test(col) && !FORBIDDEN.has(col);
}

module.exports = function mount(app, { authMiddleware }) {
  // Whole-store hydration: called once at app boot (see js/core.js Store.init()) so a fresh
  // browser/device gets every collection in one round trip instead of one request each.
  app.get('/api/store', authMiddleware, (req, res) => {
    const data = db.read();
    res.json({ ok: true, store: data.store || {} });
  });

  // Replace one collection's full array. Body is the raw JSON array (not wrapped), matching
  // what Store.mem[col] holds client-side.
  app.put('/api/store/:col', authMiddleware, async (req, res) => {
    const col = req.params.col;
    if (!validCol(col)) return res.status(400).json({ ok: false, error: 'invalid_collection' });
    if (!Array.isArray(req.body)) return res.status(400).json({ ok: false, error: 'expected_array_body' });
    await db.transact((data) => {
      if (!data.store) data.store = {};
      data.store[col] = req.body;
    });
    res.json({ ok: true });
  });
};
