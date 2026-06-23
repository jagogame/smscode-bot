const { submitForm, getRekapHariIni, getRekapSemua, getRekapByKasir } = require('./sales');

const salesState = {};

const KASIR_LIST   = ['Arshil', 'Arinal', 'Dewo'];
const PRODUK_LIST  = ['Gemini Pro + 5 TB', 'Youtube Premium'];
const DURASI_LIST  = ['1 Bulan', '2 Bulan', '3 Bulan', '4 Bulan', '5 Bulan', '6 Bulan', '1 Tahun', '18 Bulan'];
const PLATFORM_LIST = ['G2G', 'ITEMKU', 'KONTAK WA'];
const STATUS_LIST  = ['BERJALAN', 'HAMPIR HABIS', 'HABIS'];

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

    // ── Input laporan ─────────────────────────────────────────────────
    const state = salesState[jid];

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

module.exports = { handleSales };
