// ─────────────────────────────────────────────────────────────
// Juara Mingguan otomatis: tiap hari Minggu (batas UTC — sama dengan papan
// peringkat di app), umumkan juara minggu yang baru selesai lalu minggu baru
// dimulai (papan peringkat sudah auto-reset per periode).
// Notif dikirim ke semua langganan push + WA ke admin.
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { getRekapSemua } = require('./sales');
const push = require('./push');
const wa = require('./wa');
const store = require('./store');

const BONUS = 15000;
const VOL_DIR = fs.existsSync('/app/auth_info') ? '/app/auth_info' : path.join(__dirname, '../data');
const STATE_FILE = path.join(VOL_DIR, 'weekly-award.json');

function isYT(r) { return r.source === 'yt_g2g' || /youtube/i.test(r.detailAkun || ''); }
function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// Awal minggu = hari Minggu (UTC) dari sebuah Date → "yyyy-mm-dd"
// Sama dengan papan peringkat di app → reset & juara tiap hari Minggu.
function weekStartOf(date) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().slice(0, 10);
}
function addDays(ds, n) { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(s) { try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e) { console.error('[juara] gagal simpan state:', e.message); } }

// Juara periode [startMon, endMon) berdasarkan jumlah pesanan YT
function winnerOf(startMon, endMon) {
    const rows = getRekapSemua().filter(isYT).filter(r => {
        const d = (r.submittedAt || '').slice(0, 10);
        return d >= startMon && d < endMon;
    });
    if (!rows.length) return null;
    const by = {};
    rows.forEach(r => { const k = r.namaKasir || 'Unknown'; by[k] = (by[k] || 0) + 1; });
    const sorted = Object.entries(by).sort((a, b) => b[1] - a[1]);
    return { name: sorted[0][0], count: sorted[0][1], breakdown: sorted };
}

async function announce(prevMon, thisMon) {
    const w = winnerOf(prevMon, thisMon);
    if (!w) { console.log('[juara] minggu lalu tanpa penjualan → tidak diumumkan'); return; }
    const periode = `${prevMon} s/d ${addDays(thisMon, -1)}`;

    // Notif push ke semua kasir + admin
    push.send({
        title: '🏆 Juara Mingguan!',
        body: `${w.name} juara minggu lalu (${w.count} pesanan) — bonus ${rupiah(BONUS)}! Papan peringkat reset, rebut minggu ini! 🔥`,
        url: '/app',
    }).catch(() => {});

    // WA detail ke admin
    try {
        const admin = store.getSettings().whatsapp;
        if (admin && wa.isReady()) {
            let txt = `🏆 *JUARA MINGGUAN*\n📅 ${periode}\n\n🥇 *${w.name}* — ${w.count} pesanan\n💰 Bonus: ${rupiah(BONUS)}\n\n👥 *Peringkat:*\n`;
            w.breakdown.forEach(([k, n], i) => { txt += `${['🥇', '🥈', '🥉'][i] || (i + 1 + '.')} ${k}: ${n}\n`; });
            txt += `\n♻️ Papan peringkat sudah reset untuk minggu ini.`;
            await wa.sendText(admin, txt);
        }
    } catch (e) { console.error('[juara] WA admin gagal:', e.message); }

    console.log(`[juara] diumumkan: ${w.name} (${w.count}) untuk minggu ${periode}`);
}

function tick() {
    const thisWk = weekStartOf(new Date());   // Minggu (Sunday) minggu berjalan
    const prevWk = addDays(thisWk, -7);        // Minggu minggu sebelumnya
    const st = loadState();
    // Boot pertama (atau migrasi dari skema lama): tandai saja, jangan umumkan.
    if (st.lastWeek === undefined) { saveState({ lastWeek: prevWk }); return; }
    // Minggu baru terdeteksi (hari Minggu) → umumkan minggu sebelumnya (sekali).
    if (st.lastWeek !== prevWk) {
        announce(prevWk, thisWk).catch(() => {});
        saveState({ lastWeek: prevWk, lastWinner: winnerOf(prevWk, thisWk), announcedAt: new Date().toISOString() });
    }
}

function start() {
    try { tick(); } catch (e) { console.error('[juara] tick awal gagal:', e.message); }
    setInterval(() => { try { tick(); } catch (e) { console.error('[juara] tick gagal:', e.message); } }, 60 * 60 * 1000); // cek tiap jam
    console.log('🏆 Penjadwal Juara Mingguan aktif (cek tiap jam).');
}

module.exports = { start, tick, winnerOf };
