'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { ROLE_SEED, ADMIN_ROLE_IDS, roleById } = require('./roles');
const db = require('./db');

const PORT = process.env.PORT || 8091;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // ~12h
const RESET_TTL_MS = 60 * 60 * 1000; // ~1h
const PENDING_RESETS_LOG = path.join(__dirname, 'pending-resets.log');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://69.161.221.210:8090';

const app = express();
app.use(helmet());
app.use(express.json({ limit: '256kb' }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

/* ---------- helpers ---------- */
const genToken = () => crypto.randomBytes(32).toString('hex');
const now = () => Date.now();
const nowISO = () => new Date().toISOString();
const genId = (p) => p + '_' + crypto.randomBytes(8).toString('hex');
const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, resetToken, resetTokenExpiresAt, ...rest } = u;
  return rest;
}

function shapeRole(roleId) {
  const r = roleById(roleId);
  if (!r) return null;
  return { id: r.id, name: r.name, seeCost: r.seeCost, scopeOwn: r.scopeOwn, perm: r.perm };
}

function findUserByEmail(data, email) {
  const q = String(email || '').trim().toLowerCase();
  return data.users.find(u => (u.email || '').toLowerCase() === q);
}

function sessionUser(data, token) {
  if (!token) return null;
  const s = data.sessions.find(s => s.token === token);
  if (!s) return null;
  if (s.expiresAt < now()) return null;
  const u = data.users.find(u => u.id === s.userId);
  if (!u || u.deletedAt) return null;
  return { session: s, user: u };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'no_token' });
  const data = db.read();
  const found = sessionUser(data, token);
  if (!found) return res.status(401).json({ ok: false, error: 'invalid_session' });
  req.token = token;
  req.authUser = found.user;
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_ROLE_IDS.includes(req.authUser.roleId)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  next();
}

/* ---------- mailer (optional — see .env.example) ---------- */
const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
let transporter = null;
if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
} else {
  console.warn('[kentford-erp-auth] SMTP not configured — reset link logged instead of emailed (see pending-resets.log). Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM in .env to enable real email.');
}

/* CATATAN: sempat dicoba fallback "kirim langsung" (MX lookup + koneksi langsung ke mail server
   tujuan tanpa SMTP terkonfigurasi) supaya tidak perlu menunggu kredensial. Dibatalkan — itu
   mengharuskan menonaktifkan verifikasi sertifikat TLS ke server tujuan yang tidak dikenal, yang
   melemahkan keamanan koneksi tanpa jaminan hasil (kemungkinan besar tetap masuk spam/ditolak
   provider besar). Sampai SMTP_HOST/dst diisi di .env, jalur aman adalah mencatat ke pending-resets.log
   untuk dikirim manual oleh admin. */
async function sendResetEmail(email, link) {
  const line = `${nowISO()}\t${email}\t${link}\n`;
  if (!transporter) {
    fs.appendFileSync(PENDING_RESETS_LOG, line);
    console.warn('[kentford-erp-auth] SMTP not configured — reset link logged instead of emailed:', link);
    return { sent: false, logged: true };
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Kentford ERP - Reset Password',
      text: `Klik link berikut untuk mengatur ulang password Anda (berlaku 1 jam):\n${link}`,
      html: `<p>Klik link berikut untuk mengatur ulang password Anda (berlaku 1 jam):</p><p><a href="${link}">${link}</a></p>`
    });
    return { sent: true, logged: false };
  } catch (e) {
    console.error('[kentford-erp-auth] SMTP send failed, falling back to log file:', e.message);
    fs.appendFileSync(PENDING_RESETS_LOG, line);
    return { sent: false, logged: true, error: e.message };
  }
}

/* ---------- auth endpoints ---------- */
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || !password) return res.status(400).json({ ok: false, error: 'invalid_input', msg: 'Email/password tidak valid.' });
  const data = db.read();
  const u = findUserByEmail(data, email);
  if (!u) return res.status(401).json({ ok: false, error: 'login_failed', msg: 'Email atau password salah.' });
  const status = u.status || 'active';
  if (status !== 'active') {
    return res.status(403).json({ ok: false, error: 'account_' + status, msg: status === 'suspended' ? 'Akun Anda ditangguhkan. Hubungi administrator.' : 'Akun Anda nonaktif. Hubungi administrator.' });
  }
  const okPw = await bcrypt.compare(password, u.passwordHash || '');
  if (!okPw) return res.status(401).json({ ok: false, error: 'login_failed', msg: 'Email atau password salah.' });

  const token = genToken();
  const session = { token, userId: u.id, createdAt: nowISO(), expiresAt: now() + SESSION_TTL_MS };
  await db.transact(data2 => { data2.sessions.push(session); });

  const role = shapeRole(u.roleId);
  return res.json({ ok: true, token, user: publicUser(u), role });
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  await db.transact(data => {
    data.sessions = data.sessions.filter(s => s.token !== req.token);
  });
  res.json({ ok: true });
});

app.get('/api/auth/session', authMiddleware, (req, res) => {
  const role = shapeRole(req.authUser.roleId);
  res.json({ ok: true, user: publicUser(req.authUser), role });
});

app.post('/api/auth/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = req.body || {};
  // Always the same generic response, regardless of whether the account exists,
  // so this endpoint never leaks which emails are registered.
  const generic = { ok: true, msg: 'Jika email terdaftar, link reset password telah dikirim.' };
  if (!isEmail(email)) return res.json(generic);
  const data = db.read();
  const u = findUserByEmail(data, email);
  if (u) {
    const token = genToken();
    const expiresAt = now() + RESET_TTL_MS;
    await db.transact(data2 => {
      const uu = data2.users.find(x => x.id === u.id);
      if (uu) { uu.resetToken = token; uu.resetTokenExpiresAt = expiresAt; }
    });
    const link = `${PUBLIC_BASE_URL}/#/reset-password?token=${token}`;
    await sendResetEmail(u.email, link);
  }
  res.json(generic);
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ ok: false, error: 'invalid_input', msg: 'Password baru minimal 8 karakter.' });
  }
  const data = db.read();
  const u = data.users.find(x => x.resetToken === token);
  if (!u || !u.resetTokenExpiresAt || u.resetTokenExpiresAt < now()) {
    return res.status(400).json({ ok: false, error: 'invalid_token', msg: 'Link reset tidak valid atau sudah kedaluwarsa.' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await db.transact(data2 => {
    const uu = data2.users.find(x => x.id === u.id);
    uu.passwordHash = hash;
    uu.resetToken = null;
    uu.resetTokenExpiresAt = null;
    uu.updatedAt = nowISO();
    // invalidate all existing sessions for this user
    data2.sessions = data2.sessions.filter(s => s.userId !== uu.id);
  });
  res.json({ ok: true, msg: 'Password berhasil diubah. Silakan login dengan password baru.' });
});

// Self-service change-own-password (requires knowing the current password), used by the
// frontend's existing "change password" menu item (js/ui.js ACT['chpw']).
app.put('/api/auth/password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ ok: false, error: 'invalid_input', msg: 'Password baru minimal 8 karakter.' });
  }
  const okPw = await bcrypt.compare(oldPassword, req.authUser.passwordHash || '');
  if (!okPw) return res.status(401).json({ ok: false, error: 'wrong_password', msg: 'Password lama salah.' });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.transact(data2 => {
    const uu = data2.users.find(x => x.id === req.authUser.id);
    uu.passwordHash = passwordHash;
    uu.updatedAt = nowISO();
  });
  res.json({ ok: true, msg: 'Password berhasil diubah.' });
});

/* ---------- admin: user management (director / deputy_director only) ---------- */
app.get('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  const data = db.read();
  res.json({ ok: true, users: data.users.filter(u => !u.deletedAt).map(publicUser) });
});

app.post('/api/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !isEmail(b.email) || !b.roleId || !b.password) {
    return res.status(400).json({ ok: false, error: 'invalid_input', msg: 'Nama, email, role, dan password wajib diisi.' });
  }
  if (!roleById(b.roleId)) return res.status(400).json({ ok: false, error: 'invalid_role' });
  if (String(b.password).length < 8) return res.status(400).json({ ok: false, error: 'weak_password', msg: 'Password minimal 8 karakter.' });
  const data = db.read();
  if (findUserByEmail(data, b.email)) return res.status(409).json({ ok: false, error: 'email_taken', msg: 'Email sudah terdaftar.' });
  const passwordHash = await bcrypt.hash(b.password, 10);
  const u = {
    id: genId('u'),
    name: b.name,
    email: String(b.email).trim().toLowerCase(),
    roleId: b.roleId,
    position: b.position || b.jabatan || '',
    jabatan: b.jabatan || b.position || '',
    phone: b.phone || '',
    deptId: b.deptId || '',
    location: b.location || '',
    approverId: b.approverId || '',
    approvalLimit: Number(b.approvalLimit) || 0,
    delegateTo: b.delegateTo || '',
    status: b.status || 'active',
    savedSignature: b.savedSignature || '',
    passwordHash,
    resetToken: null,
    resetTokenExpiresAt: null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    deletedAt: null
  };
  await db.transact(data2 => { data2.users.push(u); });
  res.json({ ok: true, user: publicUser(u) });
});

app.put('/api/admin/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const data = db.read();
  const u = data.users.find(x => x.id === req.params.id && !x.deletedAt);
  if (!u) return res.status(404).json({ ok: false, error: 'not_found' });
  if (b.email && isEmail(b.email)) {
    const other = findUserByEmail(data, b.email);
    if (other && other.id !== u.id) return res.status(409).json({ ok: false, error: 'email_taken' });
  }
  if (b.roleId && !roleById(b.roleId)) return res.status(400).json({ ok: false, error: 'invalid_role' });
  const editable = ['name', 'email', 'roleId', 'position', 'jabatan', 'phone', 'deptId', 'location', 'approverId', 'approvalLimit', 'delegateTo', 'status', 'savedSignature'];
  await db.transact(data2 => {
    const uu = data2.users.find(x => x.id === u.id);
    editable.forEach(k => { if (b[k] !== undefined) uu[k] = k === 'email' ? String(b[k]).trim().toLowerCase() : b[k]; });
    uu.updatedAt = nowISO();
  });
  const fresh = db.read().users.find(x => x.id === u.id);
  res.json({ ok: true, user: publicUser(fresh) });
});

app.put('/api/admin/users/:id/password', authMiddleware, requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ ok: false, error: 'weak_password', msg: 'Password minimal 8 karakter.' });
  const data = db.read();
  const u = data.users.find(x => x.id === req.params.id && !x.deletedAt);
  if (!u) return res.status(404).json({ ok: false, error: 'not_found' });
  const passwordHash = await bcrypt.hash(password, 10);
  await db.transact(data2 => {
    const uu = data2.users.find(x => x.id === u.id);
    uu.passwordHash = passwordHash;
    uu.resetToken = null;
    uu.resetTokenExpiresAt = null;
    uu.updatedAt = nowISO();
    data2.sessions = data2.sessions.filter(s => s.userId !== uu.id); // force re-login
  });
  res.json({ ok: true });
});

// Soft-delete only, matching the app's existing DB.remove philosophy — never hard-delete a row.
app.delete('/api/admin/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  const data = db.read();
  const u = data.users.find(x => x.id === req.params.id && !x.deletedAt);
  if (!u) return res.status(404).json({ ok: false, error: 'not_found' });
  await db.transact(data2 => {
    const uu = data2.users.find(x => x.id === u.id);
    uu.status = 'inactive';
    uu.deletedAt = nowISO();
    uu.updatedAt = nowISO();
    data2.sessions = data2.sessions.filter(s => s.userId !== uu.id);
  });
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'kentford-erp-auth', smtpConfigured }));

app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[kentford-erp-auth] unhandled error:', err);
  res.status(500).json({ ok: false, error: 'server_error' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[kentford-erp-auth] listening on 127.0.0.1:${PORT} (smtpConfigured=${smtpConfigured})`);
});
