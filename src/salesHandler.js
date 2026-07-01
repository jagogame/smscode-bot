const { submitForm, submitLocalOnly, getRekapHariIni, getRekapSemua, getRekapByKasir } = require('./sales');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const wa = require('./wa');
const fs = require('fs');
const path = require('path');

const salesState = {};

// Folder simpan screenshot bukti
const BUKTI_DIR = path.join(__dirname, '../data/bukti_yt');
if (!fs.existsSync(BUKTI_DIR)) fs.mkdirSync(BUKTI_DIR, { recursive: true });

// File mapping JID → nama kasir (daftar via perintah "daftar kasir <nama>")
const KASIR_JID_FILE = path.join(__dirname, '../data/kasir-jid.json');
function loadKasirJid() { try { return JSON.parse(fs.readFileSync(KASIR_JID_FILE,'utf8')); } catch { return {}; } }
function saveKasirJid(map) { fs.writeFileSync(KASIR_JID_FILE, JSON.stringify(map, null, 2)); }

const KASIR_LIST    = ['Arshil', 'Arinal', 'Dewo'];
const PRODUK_LIST   = ['Gemini Pro + 5 TB', 'Youtube Premium'];
const DURASI_LIST   = ['1 Bulan', '2 Bulan', '3 Bulan', '4 Bulan', '5 Bulan', '6 Bulan', '1 Tahun', '18 Bulan'];
const PLATFORM_LIST = ['G2G', 'ITEMKU', 'KONTAK WA'];
const STATUS_LIST   = ['BERJALAN', 'HAMPIR HABIS', 'HABIS'];

// ─────────────────────────────────────────────────────────────────────────────
// Helper: download gambar dari pesan WA lalu simpan ke disk
// ─────────────────────────────────────────────────────────────────────────────
async function saveScreenshot(msg, label) {
    const imgMsg = msg.message?.imageMessage;
    if (!imgMsg) return null;
    const stream = await downloadContentFromMessage(imgMsg, 'image');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    const ts = Date.now();
    const fname = `${label}_${ts}.jpg`;
    const fpath = path.join(BUKTI_DIR, fname);
    fs.writeFileSync(fpath, buf);
    return fpath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler pesan GAMBAR — dipanggil dari handler.js
// ─────────────────────────────────────────────────────────────────────────────
async function handleSalesImage(sock, msg) {
    const jid = msg.key.remoteJid;
    const state = salesState[jid];
    const caption = (msg.message?.imageMessage?.caption || '').trim();
    const reply = (content) => sock.sendMessage(jid, { text: content }, { quoted: msg });

    // Kirim gambar + caption langsung tanpa state → auto laporan yt
    if (!state && caption) {
        const autoKasir = detectKasir(jid);
        console.log(`[laporan-yt] img dari ${jid}, caption="${caption}", kasir=${autoKasir||'tidak dikenal'}`);
        if (!autoKasir) {
            await reply(`⚠️ Nomormu belum terdaftar sebagai kasir.\n\nKetik dulu:\n*daftar kasir Arshil*\n*daftar kasir Arinal*\n*daftar kasir Dewo*`);
            return true;
        }

        const filePath = await saveScreenshot(msg, `${autoKasir}_chat_g2g`).catch(() => null);
        if (!filePath) { await reply('⚠️ Gagal menyimpan gambar.'); return true; }

        const data = {
            namaKasir: autoKasir,
            usernamePembeli: caption.trim(),
            platform: 'G2G',
            detailAkun: 'Youtube Premium',
            chatG2G: filePath,
        };

        const settings = require('./store').getSettings();
        const adminJid = settings.whatsapp ? `${settings.whatsapp.replace(/\D/g,'')}@s.whatsapp.net` : null;
        if (adminJid) {
            const imgBuf = require('fs').readFileSync(filePath);
            sock.sendMessage(adminJid, { image: imgBuf, caption: `💬 *Bukti Chat G2G*\nKasir: ${autoKasir}\nPembeli G2G: ${data.usernamePembeli}` }).catch(() => {});
        }

        try {
            submitLocalOnly(data);
            const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
            await reply(
                `╔══════════════════════╗\n` +
                `║  ✅ LAPORAN BERHASIL  ║\n` +
                `╚══════════════════════╝\n\n` +
                formatRecordYT(data) +
                `\n📅 Waktu: ${now}\n` +
                `💬 Bukti chat → admin ✓\n` +
                `📋 Google Form → tersimpan ✓`
            );
        } catch (e) {
            await reply(
                `╔══════════════════════╗\n` +
                `║  ❌ LAPORAN GAGAL    ║\n` +
                `╚══════════════════════╝\n\n` +
                `Alasan: ${e.message}\n\n` +
                `Coba kirim ulang gambar + caption, atau ketik *laporan yt* untuk mulai ulang.`
            );
        }
        return true;
    }

    if (!state || !['pembeli_yt', 'chat_g2g'].includes(state.step)) return false;

    const stepLabel = {
        ss1: 'bukti1',
        ss2: 'bukti2',
        chat_g2g: 'chat_g2g',
    }[state.step];

    const filePath = await saveScreenshot(msg, `${state.data.namaKasir || 'kasir'}_${stepLabel}`).catch(() => null);

    if (!filePath) {
        await reply('⚠️ Gagal menyimpan gambar. Coba kirim ulang.');
        return true;
    }

    // Forward screenshot ke nomor admin dengan label
    const settings = require('./store').getSettings();
    const adminJid = settings.whatsapp ? `${settings.whatsapp.replace(/\D/g,'')}@s.whatsapp.net` : null;
    const imgBuf = fs.readFileSync(filePath);
    const captions = {
        ss1: `📸 *Bukti Screenshot 1*\nKasir: ${state.data.namaKasir}\nPembeli G2G: ${state.data.usernamePembeli || '-'}`,
        ss2: `📸 *Bukti Screenshot 2*\nKasir: ${state.data.namaKasir}\nPembeli G2G: ${state.data.usernamePembeli || '-'}`,
        chat_g2g: `💬 *Bukti Chat G2G*\nKasir: ${state.data.namaKasir}\nPembeli G2G: ${state.data.usernamePembeli || '-'}`,
    }[stepLabel];

    if (adminJid) {
        sock.sendMessage(adminJid, { image: imgBuf, caption: captions }).catch(() => {});
    }

    // Kalau masih di step pembeli_yt: ambil caption sebagai username
    if (state.step === 'pembeli_yt') {
        if (!caption.trim()) {
            await reply('⚠️ Tambahkan *username pembeli G2G* sebagai caption gambar, lalu kirim ulang.');
            return true;
        }
        state.data.usernamePembeli = caption.trim();
        state.data.platform = 'G2G';
        state.data.detailAkun = 'Youtube Premium';
    }

    state.data.chatG2G = filePath;
    state.step = 'konfirmasi_yt';
    await reply(
        `✅ Bukti chat diterima!\n\n` +
        `📋 *Konfirmasi Laporan YT G2G*\n\n` +
        formatRecordYT(state.data) +
        `\n\n💬 Bukti chat G2G ✅\n\n` +
        `Ketik *ya* untuk submit atau *batal* untuk membatalkan.`
    );
    return true;
}

// Deteksi kasir dari nomor WA pengirim
// Daftarkan nomor via env: KASIR_ARSHIL_WA=628xxx, KASIR_ARINAL_WA=628xxx, KASIR_DEWO_WA=628xxx
function detectKasir(jid) {
    // 1. Cek file registrasi JID (support @lid dan @s.whatsapp.net)
    const map = loadKasirJid();
    if (map[jid]) return map[jid];

    // 2. Fallback: cocokkan nomor HP dari env var (untuk @s.whatsapp.net lama)
    const num = jid.replace(/@.*/, '').replace(/\D/g, '');
    for (const name of KASIR_LIST) {
        const envKey = `KASIR_${name.toUpperCase()}_WA`;
        const nums = (process.env[envKey] || '').split(',').map(n => n.trim().replace(/\D/g, '')).filter(Boolean);
        if (nums.includes(num)) return name;
    }
    return null;
}

function numMenu(list) {
    return list.map((x, i) => `*${i + 1}.* ${x}`).join('\n');
}

function pickFromList(list, input) {
    const idx = parseInt(input) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < list.length) return list[idx];
    // Coba match teks langsung
    const match = list.find(x => x.toLowerCase() === input.toLowerCase());
    return match || null;
}

function formatRecordYT(r) {
    return (
        `👤 Kasir: ${r.namaKasir}\n` +
        `🛒 Username G2G: ${r.usernamePembeli}`
    );
}

function formatRecord(r) {
    return (
        `👤 Kasir: ${r.namaKasir}\n` +
        `🛒 Pembeli: ${r.namaPembeli}\n` +
        `📦 Produk: ${r.detailAkun}\n` +
        `⏳ Durasi: ${r.durasi}\n` +
        `📧 Email Admin: ${r.emailAdmin || '-'}\n` +
        `📧 Email Buyer: ${r.emailBuyer || '-'}\n` +
        `📅 Tgl Habis: ${r.tanggalHabis}\n` +
        `🛍️ Platform: ${r.platform}\n` +
        `📊 Status: ${r.keterangan}`
    );
}

async function handleSales(sock, msg, text) {
    const jid = msg.key.remoteJid;
    const lower = text.toLowerCase();
    const reply = (content) => sock.sendMessage(jid, { text: content }, { quoted: msg });

    // ── Rekap ─────────────────────────────────────────────────────────
    if (lower === 'rekap') {
        return reply(
            `📊 *Menu Rekap*\n\n` +
            `*rekap hari ini* — Semua transaksi hari ini\n` +
            `*rekap semua*    — Semua transaksi\n` +
            `*rekap kasir <nama>* — Per kasir\n\n` +
            `Contoh: \`rekap kasir Arshil\``
        );
    }

    if (lower === 'rekap yt' || lower === 'rekap yt semua') {
        const data = getRekapSemua().filter(r => r.source === 'yt_g2g' || r.platform === 'G2G');
        if (!data.length) return reply('📋 Belum ada laporan YT G2G.');
        const byKasir = {};
        data.forEach(r => { const k = r.namaKasir || 'Unknown'; if (!byKasir[k]) byKasir[k] = []; byKasir[k].push(r); });
        let txt = `📊 *Rekap Laporan YT G2G* (${data.length} total)\n${'─'.repeat(28)}\n`;
        for (const [kasir, rows] of Object.entries(byKasir)) {
            txt += `\n👤 *${kasir}* (${rows.length} transaksi)\n`;
            rows.slice(-5).forEach((r, i) => {
                const tgl = r.submittedAt?.slice(0, 10) || '-';
                txt += `  ${i + 1}. ${r.usernamePembeli || r.namaPembeli || '-'} — ${tgl}\n`;
            });
            if (rows.length > 5) txt += `  _...dan ${rows.length - 5} lainnya_\n`;
        }
        return reply(txt.trim());
    }

    if (lower.startsWith('rekap yt kasir ')) {
        const nama = text.slice(15).trim();
        const data = getRekapSemua().filter(r =>
            (r.source === 'yt_g2g' || r.platform === 'G2G') &&
            r.namaKasir?.toLowerCase() === nama.toLowerCase()
        );
        if (!data.length) return reply(`📋 Tidak ada laporan YT untuk kasir *${nama}*.`);
        const list = data.map((r, i) => {
            const tgl = r.submittedAt?.slice(0, 10) || '-';
            return `*${i + 1}.* ${r.usernamePembeli || r.namaPembeli || '-'} — ${tgl}`;
        }).join('\n');
        return reply(`📊 *Rekap YT G2G — ${nama}* (${data.length} transaksi)\n\n${list}`);
    }

    if (lower === 'rekap hari ini') {
        const data = getRekapHariIni();
        if (!data.length) return reply('📋 Belum ada transaksi hari ini.');
        const total = data.length;
        const list = data.map((r, i) => `*${i + 1}.* ${r.namaPembeli} — ${r.detailAkun} (${r.durasi}) — ${r.platform}`).join('\n');
        return reply(`📊 *Rekap Hari Ini* (${total} transaksi)\n\n${list}`);
    }

    if (lower === 'rekap semua') {
        const data = getRekapSemua();
        if (!data.length) return reply('📋 Belum ada transaksi sama sekali.');
        // Ringkasan per kasir
        const byKasir = {};
        data.forEach(r => { byKasir[r.namaKasir] = (byKasir[r.namaKasir] || 0) + 1; });
        const summary = Object.entries(byKasir).map(([k, v]) => `• ${k}: ${v} transaksi`).join('\n');
        return reply(`📊 *Rekap Semua Transaksi* (Total: ${data.length})\n\n${summary}`);
    }

    if (lower.startsWith('rekap kasir ')) {
        const nama = text.slice(12).trim();
        const data = getRekapByKasir(nama);
        if (!data.length) return reply(`📋 Tidak ada transaksi untuk kasir *${nama}*.`);
        const list = data.map((r, i) =>
            `*${i + 1}.* ${r.namaPembeli} — ${r.detailAkun} (${r.durasi}) — ${r.submittedAt?.slice(0, 10)}`
        ).join('\n');
        return reply(`📊 *Rekap Kasir ${nama}* (${data.length} transaksi)\n\n${list}`);
    }

    // ── Daftar kasir (simpan JID → nama) ─────────────────────────────────────
    if (lower.startsWith('daftar kasir ')) {
        const nama = text.slice(13).trim();
        const valid = KASIR_LIST.find(k => k.toLowerCase() === nama.toLowerCase());
        if (!valid) return reply(`❌ Nama tidak valid. Pilih: ${KASIR_LIST.join(', ')}`);
        const map = loadKasirJid();
        map[jid] = valid;
        saveKasirJid(map);
        return reply(`✅ Berhasil daftar sebagai kasir *${valid}*!\n\nSekarang kamu bisa langsung kirim foto + caption username pembeli untuk laporan YT G2G.`);
    }

    // ── Input laporan ─────────────────────────────────────────────────
    const state = salesState[jid];

    // ── Laporan YT G2G ────────────────────────────────────────────────────────
    if (lower === 'laporan yt') {
        const autoKasir = detectKasir(jid);
        if (autoKasir) {
            salesState[jid] = { step: 'pembeli_yt', data: { namaKasir: autoKasir, platform: 'G2G', detailAkun: 'Youtube Premium' }, type: 'yt_g2g' };
            return reply(
                `📝 *Form Laporan YT Premium G2G*\n\n` +
                `Kasir: *${autoKasir}* ✅\n\n` +
                `Kirim *screenshot chat G2G* dengan caption = username pembeli\n` +
                `_(atau ketik username dulu, lalu kirim gambar)_\n\nKetik *batal* untuk keluar.`
            );
        }
        salesState[jid] = { step: 'kasir_yt', data: {}, type: 'yt_g2g' };
        return reply(
            `📝 *Form Laporan YT Premium G2G*\n\n` +
            `Alur: kasir → kirim screenshot chat (caption = username G2G)\n\n` +
            `Pilih nama kasir:\n\n${numMenu(KASIR_LIST)}\n\nKetik *batal* untuk keluar.`
        );
    }

    // ── Step-step form laporan YT G2G ─────────────────────────────────────────
    if (state?.type === 'yt_g2g') {
        switch (state.step) {
            case 'kasir_yt': {
                const val = pickFromList(KASIR_LIST, text);
                if (!val) return reply(`Pilihan tidak valid:\n\n${numMenu(KASIR_LIST)}`);
                state.data.namaKasir = val;
                state.step = 'pembeli_yt';
                return reply(`✅ Kasir: *${val}*\n\nMasukkan *username pembeli di G2G*:`);
            }
            case 'pembeli_yt': {
                // Kalau teks saja → simpan username, minta screenshot terpisah
                state.data.usernamePembeli = text;
                state.data.platform = 'G2G';
                state.data.detailAkun = 'Youtube Premium';
                state.step = 'chat_g2g';
                return reply(
                    `✅ Pembeli G2G: *${text}*\n\n` +
                    `💬 Kirim *screenshot chat G2G*\n` +
                    `_(atau kirim gambar sekaligus dengan caption username pembeli dari awal)_`
                );
            }
            case 'konfirmasi_yt': {
                if (lower !== 'ya') {
                    delete salesState[jid];
                    return reply('↩️ Laporan dibatalkan. Ketik *laporan yt* untuk mengulang.');
                }
                try {
                    await reply('⏳ Menyimpan laporan...');
                    submitLocalOnly(state.data);
                    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                    delete salesState[jid];
                    return reply(
                        `╔══════════════════════╗\n` +
                        `║  ✅ LAPORAN BERHASIL  ║\n` +
                        `╚══════════════════════╝\n\n` +
                        formatRecordYT(state.data) +
                        `\n📅 Waktu: ${now}\n` +
                        `💬 Bukti chat → admin ✓\n` +
                        `📋 Google Form → tersimpan ✓`
                    );
                } catch (e) {
                    delete salesState[jid];
                    return reply(
                        `╔══════════════════════╗\n` +
                        `║  ❌ LAPORAN GAGAL    ║\n` +
                        `╚══════════════════════╝\n\n` +
                        `Alasan: ${e.message}\n\n` +
                        `Ketik *laporan yt* untuk coba ulang.`
                    );
                }
            }
        }
    }

    if (lower === 'laporan') {
        salesState[jid] = { step: 'kasir', data: {} };
        return reply(
            `📝 *Form Laporan Penjualan*\n\nPilih nama kasir:\n\n${numMenu(KASIR_LIST)}\n\nKetik *batal* untuk keluar.`
        );
    }

    if (!state) return null; // bukan perintah sales

    if (lower === 'batal') {
        delete salesState[jid];
        return reply('↩️ Laporan dibatalkan.');
    }

    switch (state.step) {
        case 'kasir': {
            const val = pickFromList(KASIR_LIST, text);
            if (!val) return reply(`Pilihan tidak valid. Ketik 1, 2, atau 3:\n\n${numMenu(KASIR_LIST)}`);
            state.data.namaKasir = val;
            state.step = 'pembeli';
            return reply(`✅ Kasir: *${val}*\n\nMasukkan *nama pembeli / username*:`);
        }

        case 'pembeli': {
            state.data.namaPembeli = text;
            state.step = 'produk';
            return reply(`✅ Pembeli: *${text}*\n\nPilih *detail akun pembelian*:\n\n${numMenu(PRODUK_LIST)}`);
        }

        case 'produk': {
            const val = pickFromList(PRODUK_LIST, text);
            if (!val) return reply(`Pilihan tidak valid:\n\n${numMenu(PRODUK_LIST)}`);
            state.data.detailAkun = val;
            state.step = 'durasi';
            return reply(`✅ Produk: *${val}*\n\nPilih *durasi premium*:\n\n${numMenu(DURASI_LIST)}`);
        }

        case 'durasi': {
            const val = pickFromList(DURASI_LIST, text);
            if (!val) return reply(`Pilihan tidak valid:\n\n${numMenu(DURASI_LIST)}`);
            state.data.durasi = val;
            state.step = 'emailAdmin';
            return reply(`✅ Durasi: *${val}*\n\nMasukkan *email admin plan penginvite*:\n_(ketik \`-\` jika tidak ada)_`);
        }

        case 'emailAdmin': {
            state.data.emailAdmin = text === '-' ? '' : text;
            state.step = 'emailBuyer';
            return reply(`✅ Email Admin: *${text}*\n\nMasukkan *email buyer* (jika lewat invite):\n_(ketik \`-\` jika tidak ada)_`);
        }

        case 'emailBuyer': {
            state.data.emailBuyer = text === '-' ? '' : text;
            state.step = 'tanggal';
            return reply(`✅ Email Buyer: *${text}*\n\nMasukkan *tanggal habis premium*:\nFormat: DD/MM/YYYY\nContoh: \`31/12/2025\``);
        }

        case 'tanggal': {
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
                return reply(`⚠️ Format salah. Gunakan DD/MM/YYYY\nContoh: \`31/12/2025\``);
            }
            state.data.tanggalHabis = text;
            state.step = 'platform';
            return reply(`✅ Tanggal Habis: *${text}*\n\nPilih *platform pembelian*:\n\n${numMenu(PLATFORM_LIST)}`);
        }

        case 'platform': {
            const val = pickFromList(PLATFORM_LIST, text);
            if (!val) return reply(`Pilihan tidak valid:\n\n${numMenu(PLATFORM_LIST)}`);
            state.data.platform = val;
            state.step = 'status';
            return reply(`✅ Platform: *${val}*\n\nPilih *keterangan status*:\n\n${numMenu(STATUS_LIST)}`);
        }

        case 'status': {
            const val = pickFromList(STATUS_LIST, text);
            if (!val) return reply(`Pilihan tidak valid:\n\n${numMenu(STATUS_LIST)}`);
            state.data.keterangan = val;
            state.step = 'konfirmasi';
            return reply(
                `📋 *Konfirmasi Laporan*\n\n${formatRecord(state.data)}\n\n` +
                `Ketik *ya* untuk submit atau *batal* untuk membatalkan.`
            );
        }

        case 'konfirmasi': {
            if (lower !== 'ya') {
                delete salesState[jid];
                return reply('↩️ Laporan dibatalkan. Ketik *laporan* untuk mengulang.');
            }
            try {
                await reply(`⏳ Menyimpan laporan...`);
                await submitForm(state.data);
                delete salesState[jid];
                return reply(
                    `✅ *Laporan Berhasil Dikirim!*\n\n${formatRecord(state.data)}\n\n` +
                    `Data sudah masuk ke Google Form.`
                );
            } catch (e) {
                delete salesState[jid];
                return reply(`❌ Gagal submit: ${e.message}`);
            }
        }
    }

    return null;
}

module.exports = { handleSales, handleSalesImage };
