'use strict';
/* Upload file server-side asli (bukan IndexedDB lokal-per-browser seperti attachment biasa di
   kentford-erp/js/core.js Files object) - khusus buat Knowledge Base (poin b: internal project
   storage & video tutorial). Beda dengan attachment biasa, file di sini WAJIB bisa diakses semua
   user (video tutorial genset percuma kalau cuma kebaca di browser yang upload), jadi disimpan
   sungguhan di disk VPS lewat multer, bukan blob lokal. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB - lihat kesepakatan ukuran video tutorial
const UPLOAD_ROLES = new Set(['technician', 'tech_manager', 'admin_aftersales', 'deputy_director', 'director']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(16).toString('hex');
    req._uploadId = id;
    cb(null, id);
  }
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE, files: 1 } });

module.exports = function mount(app, { authMiddleware }) {
  const db = require('./db');

  app.post('/api/files', authMiddleware, (req, res) => {
    if (!UPLOAD_ROLES.has(req.authUser.roleId)) return res.status(403).json({ ok: false, error: 'forbidden' });
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: 'file_too_large', maxBytes: MAX_FILE_SIZE });
        return res.status(400).json({ ok: false, error: 'upload_failed' });
      }
      if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
      const meta = {
        id: req._uploadId,
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size,
        uploadedBy: req.authUser.id,
        uploadedByName: req.authUser.name,
        at: new Date().toISOString()
      };
      await db.transact((data) => {
        if (!Array.isArray(data.serverFiles)) data.serverFiles = [];
        data.serverFiles.push(meta);
      });
      res.json({ ok: true, file: meta });
    });
  });

  // Sengaja TANPA authMiddleware di route GET ini (beda dengan POST/DELETE yang wajib login):
  // <video src="...">/<a href="..."> di HTML tidak bisa membawa header Authorization, dan video
  // butuh native browser streaming (seek/scrub) yang cuma jalan lewat URL langsung, bukan lewat
  // fetch()+Blob (yang juga tidak mendukung range request untuk skip ke tengah video). ID file
  // adalah token acak 128-bit (crypto.randomBytes(16), lihat multer storage.filename di atas)
  // yang tidak pernah dibocorkan lewat listing publik - jadi diperlakukan sebagai unlisted/
  // unguessable link, sama seperti pola video "unlisted" di YouTube/Drive, bukan benar-benar
  // publik. Trade-off ini didokumentasikan, bukan celah yang tidak disadari.
  app.get('/api/files/:id', (req, res) => {
    const id = req.params.id;
    if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_id' });
    const data = db.read();
    const meta = (data.serverFiles || []).find(f => f.id === id);
    const filePath = path.join(UPLOAD_DIR, id);
    if (!meta || !fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'not_found' });
    res.setHeader('Content-Type', meta.type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name)}"`);
    fs.createReadStream(filePath).pipe(res);
  });

  app.delete('/api/files/:id', authMiddleware, async (req, res) => {
    const id = req.params.id;
    if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_id' });
    const data = db.read();
    const meta = (data.serverFiles || []).find(f => f.id === id);
    if (!meta) return res.status(404).json({ ok: false, error: 'not_found' });
    // Hanya yang upload, atau role admin/manajemen, yang boleh hapus filenya.
    if (meta.uploadedBy !== req.authUser.id && !UPLOAD_ROLES.has(req.authUser.roleId)) return res.status(403).json({ ok: false, error: 'forbidden' });
    await db.transact((d) => { d.serverFiles = (d.serverFiles || []).filter(f => f.id !== id); });
    fs.unlink(path.join(UPLOAD_DIR, id), () => {});
    res.json({ ok: true });
  });
};
