// ─────────────────────────────────────────────────────────────
// API tambahan untuk Aplikasi Kasir (PWA): rekap YT + laporan.
// Semua endpoint additive (prefix /api/app), tidak mengubah bot.
// ─────────────────────────────────────────────────────────────
const express = require('express');
const path = require('path');
const router = express.Router();
const auth = require('./auth');
const { getRekapSemua, submitLocalOnly } = require('./sales');
const push = require('./push');

const RATE = 5000;            // komisi Rp per bulan YouTube
const WEEK_GOAL = 50;         // (tidak dipakai lagi di UI) sisa dari target lama
const WEEK_BONUS = 15000;     // bonus juara #1 mingguan
const KASIR = ['Arshil', 'Arinal', 'Dewo'];

function isYT(r) { return r.source === 'yt_g2g' || /youtube/i.test(r.detailAkun || ''); }
function monthsOf(r) {
    if (typeof r.durasiBulan === 'number' && r.durasiBulan > 0) return r.durasiBulan;
    const d = String(r.durasi || '').toLowerCase();
    const th = d.match(/(\d+)\s*tahun/); if (th) return parseInt(th[1], 10) * 12;
    const bl = d.match(/(\d+)\s*bulan/); if (bl) return parseInt(bl[1], 10);
    return 1; // data lama tanpa durasi → anggap 1 bulan
}
function komisi(r) { return monthsOf(r) * RATE; }
function buyer(r) { return r.usernamePembeli || r.namaPembeli || '-'; }
function sameKasir(r, name) { return String(r.namaKasir || '').toLowerCase() === String(name).toLowerCase(); }

// Auth via token (header x-token / query), reuse sesi bot
function requireAuth(req, res, next) {
    const token = req.headers['x-token'] || req.query.token;
    const s = auth.getSession(token);
    if (!s) return res.status(401).json({ error: 'Unauthorized' });
    req.session = s;
    next();
}

// Batas periode pakai UTC-slice (konsisten dgn report YT bot yang sudah ada)
function todayStr() { return new Date().toISOString().slice(0, 10); }
function mondayStr() {
    const d = new Date(); const back = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
    d.setUTCDate(d.getUTCDate() - back); return d.toISOString().slice(0, 10);
}
function inPeriod(r, period) {
    const day = (r.submittedAt || '').slice(0, 10);
    if (!day) return false;
    if (period === 'hari') return day === todayStr();
    if (period === 'minggu') return day >= mondayStr() && day <= todayStr();
    return (r.submittedAt || '').slice(0, 7) === new Date().toISOString().slice(0, 7); // bulan
}
function parseTgl(s) { // "dd/mm/yyyy" → ms akhir hari itu
    if (!s) return null;
    const m = String(s).split('/'); if (m.length !== 3) return null;
    const d = +m[0], mo = +m[1], y = +m[2]; if (!d || !mo || !y) return null;
    return new Date(y, mo - 1, d, 23, 59, 59).getTime();
}

// ── Ringkasan untuk dashboard ──────────────────────────────
router.get('/api/app/summary', requireAuth, (req, res) => {
    try {
        const period = ['hari', 'minggu', 'bulan'].includes(req.query.period) ? req.query.period : 'hari';
        const role = req.session.role, meName = req.session.name;
        const all = getRekapSemua().filter(isYT);
        const inP = all.filter(r => inPeriod(r, period));

        // Papan peringkat (semua kasir) untuk periode terpilih
        const leaderboard = KASIR.map(k => {
            const rows = inP.filter(r => sameKasir(r, k));
            const months = rows.reduce((s, r) => s + monthsOf(r), 0);
            return { name: k, count: rows.length, months, komisi: months * RATE };
        }).sort((a, b) => b.count - a.count || b.months - a.months);

        // Data ter-scope: kasir hanya miliknya, admin semua
        const scoped = role === 'kasir' ? all.filter(r => sameKasir(r, meName)) : all;
        const scopedP = role === 'kasir' ? inP.filter(r => sameKasir(r, meName)) : inP;

        const myMonths = scopedP.reduce((s, r) => s + monthsOf(r), 0);
        const me = { count: scopedP.length, months: myMonths, komisi: myMonths * RATE };

        // Tren 7 hari (scoped)
        const trend = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
            const ds = d.toISOString().slice(0, 10);
            trend.push(scoped.filter(r => (r.submittedAt || '').slice(0, 10) === ds).length);
        }

        // Penjualan terbaru (scoped)
        const recent = scoped.slice()
            .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
            .slice(0, 8)
            .map(r => ({ u: buyer(r), k: r.namaKasir || '-', months: monthsOf(r), komisi: komisi(r), at: r.submittedAt }));

        // Mau habis < 24 jam (butuh tanggalHabis)
        const now = Date.now();
        const expiring = scoped.map(r => {
            const exp = parseTgl(r.tanggalHabis); if (!exp) return null;
            const hoursLeft = Math.round((exp - now) / 3600000);
            if (hoursLeft < 0 || hoursLeft > 24) return null;
            return { u: buyer(r), k: r.namaKasir || '-', hoursLeft };
        }).filter(Boolean).sort((a, b) => a.hoursLeft - b.hoursLeft);

        const totMonths = inP.reduce((s, r) => s + monthsOf(r), 0);
        res.json({
            role, name: meName, period, me, leaderboard, trend, recent, expiring,
            totals: { count: inP.length, months: totMonths, komisi: totMonths * RATE },
            config: { rate: RATE, weekGoal: WEEK_GOAL, weekBonus: WEEK_BONUS },
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Kirim laporan (mencatat durasi + tanggal habis) ─────────
router.post('/api/app/laporan', requireAuth, (req, res) => {
    try {
        const role = req.session.role, meName = req.session.name;
        const b = req.body || {};
        const kasir = role === 'kasir' ? meName : (b.namaKasir || meName);
        const bulan = Math.max(1, parseInt(b.durasiBulan, 10) || 1);
        const username = String(b.usernamePembeli || '').trim();
        if (!username) return res.status(400).json({ error: 'Username pembeli wajib diisi' });

        const record = {
            namaKasir: kasir,
            usernamePembeli: username,
            detailAkun: b.produk || 'Youtube Premium',
            durasi: bulan === 12 ? '1 Tahun' : (bulan + ' Bulan'),
            durasiBulan: bulan,
            tanggalHabis: b.tanggalHabis || '',
            platform: 'G2G',
            keterangan: 'BERJALAN',
            source: 'yt_g2g',
        };
        submitLocalOnly(record);
        // Notif HP admin: info laporan baru
        push.send(
            { title: '📝 Laporan baru', body: `${kasir} — ${username} (${bulan} bln YT)`, url: '/app' },
            u => u.role === 'admin'
        ).catch(() => {});
        // Notif HP kasir LAIN: pancing kompetisi (yang closing tidak dinotif)
        push.send(
            { title: `🔥 ${kasir} baru closing!`, body: `${username} · ${bulan} bln YT — kejar posisinya di papan peringkat! 🏆`, url: '/app' },
            u => u.role === 'kasir' && String(u.name).toLowerCase() !== String(kasir).toLowerCase()
        ).catch(() => {});
        res.json({ ok: true, komisi: bulan * RATE, record });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Web Push: kunci publik VAPID + daftar langganan HP ──────
router.get('/api/app/push/vapid', (req, res) => {
    const key = push.getPublicKey();
    if (!key) return res.status(503).json({ error: 'Push belum aktif di server' });
    res.json({ key });
});
router.post('/api/app/push/subscribe', requireAuth, (req, res) => {
    try {
        const ok = push.addSubscription(req.body && req.body.subscription, { name: req.session.name, role: req.session.role });
        if (!ok) return res.status(400).json({ error: 'Langganan tidak valid' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Halaman app (juga bisa diakses via /app.html karena express.static)
router.get('/app', (req, res) => res.sendFile(path.join(__dirname, '../public/app.html')));

module.exports = router;
