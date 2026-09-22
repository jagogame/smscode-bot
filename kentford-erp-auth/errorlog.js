'use strict';
/* Error reporting: window.onerror/unhandledrejection di client (lihat js/main.js) dulu
   cuma nampilin toast di layar user tanpa jejak apapun di server — kalau bug kejadian di
   HP user lapangan, tim baru tahu kalau ada yang screenshot dan lapor manual. Endpoint ini
   nyimpen error itu supaya bisa dicek dari server. Sengaja TANPA authMiddleware karena
   error bisa kejadian sebelum login (mis. gagal boot Store.init()) — sebagai gantinya body
   dibatasi ketat (panjang string, jumlah entri tersimpan) supaya endpoint publik ini tidak
   bisa disalahgunakan buat membanjiri db.json. */
const MAX_ENTRIES = 500;
const MAX_LEN = 2000;

function clip(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

module.exports = function mount(app, { requireAdmin, authMiddleware } = {}) {
  const db = require('./db');

  app.post('/api/errorlog', async (req, res) => {
    const b = req.body || {};
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      at: new Date().toISOString(),
      message: clip(b.message, MAX_LEN),
      stack: clip(b.stack, MAX_LEN),
      url: clip(b.url, 500),
      userAgent: clip(req.headers['user-agent'], 300),
      userEmail: clip(b.userEmail, 200)
    };
    if (!entry.message) return res.status(400).json({ ok: false, error: 'message_required' });
    await db.transact((data) => {
      if (!Array.isArray(data.errorLogs)) data.errorLogs = [];
      data.errorLogs.push(entry);
      if (data.errorLogs.length > MAX_ENTRIES) data.errorLogs = data.errorLogs.slice(-MAX_ENTRIES);
    });
    res.json({ ok: true });
  });

  // Lihat log error, hanya admin (pakai middleware yang sama dengan /api/admin/*).
  app.get('/api/errorlog', authMiddleware, requireAdmin, (req, res) => {
    const data = db.read();
    res.json({ ok: true, logs: (data.errorLogs || []).slice().reverse() });
  });
};
