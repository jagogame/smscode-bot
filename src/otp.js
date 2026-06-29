// Verifikasi OTP via WhatsApp (anti-spam order)
const wa = require('./wa');

const store = new Map(); // key: nomor ternormalisasi -> { code, exp, verified, lastSent }
const TTL = 5 * 60 * 1000;       // kode berlaku 5 menit
const RESEND_GAP = 60 * 1000;    // minimal 60 detik antar kirim
const VERIFIED_TTL = 30 * 60 * 1000; // status verified berlaku 30 menit

function norm(wa) { let n = String(wa || '').replace(/\D/g, ''); if (n.startsWith('0')) n = '62' + n.slice(1); if (!n.startsWith('62')) n = '62' + n; return n; }
function gen() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function send(waNum) {
    const key = norm(waNum);
    if (key.length < 9) throw new Error('Nomor WhatsApp tidak valid');
    const ex = store.get(key);
    if (ex && Date.now() - (ex.lastSent || 0) < RESEND_GAP) {
        throw new Error('Tunggu sebentar sebelum minta kode lagi');
    }
    const code = gen();
    store.set(key, { code, exp: Date.now() + TTL, verified: false, lastSent: Date.now() });
    const msg = `*${code}* adalah kode verifikasi Jago Game kamu.\n\nMasukkan kode ini di halaman pemesanan. Berlaku 5 menit. Jangan bagikan ke siapa pun. 🔒`;
    await wa.sendText(key, msg);
    return true;
}

function verify(waNum, code) {
    const key = norm(waNum);
    const rec = store.get(key);
    if (!rec) return { ok: false, message: 'Minta kode dulu' };
    if (Date.now() > rec.exp) return { ok: false, message: 'Kode kedaluwarsa, minta ulang' };
    if (String(code).trim() !== rec.code) return { ok: false, message: 'Kode salah' };
    rec.verified = true;
    rec.verifiedAt = Date.now();
    return { ok: true };
}

// Apakah nomor sudah terverifikasi & masih berlaku?
function isVerified(waNum) {
    const rec = store.get(norm(waNum));
    return !!(rec && rec.verified && rec.verifiedAt && Date.now() - rec.verifiedAt < VERIFIED_TTL);
}

module.exports = { send, verify, isVerified, norm };
