const sms = require('./smscode');
const { handleSales } = require('./salesHandler');
const { checkSkin } = require('./cekskin-bot/index.js');
const fs = require('fs');

// catalog_product_id tetap untuk Google/YouTube/Gmail - Brazil
const GOOGLE_BR_PRODUCT_ID = 6220;

// Polling aktif per order
const activePolls = {};

const POLL_INTERVAL_MS = 100;

function startPolling(sock, jid, orderId) {
    if (activePolls[orderId]) return;

    const seenOtp = new Set();
    let stopped = false;

    sock.sendMessage(jid, {
        text: `🔄 Menunggu OTP untuk order \`${orderId}\`...\nKetik *stop ${orderId}* untuk berhenti.`
    });

    async function poll() {
        if (stopped) return;
        try {
            const order = await sms.getOrder(orderId);
            if (order.otp_code && !seenOtp.has(order.otp_code)) {
                seenOtp.add(order.otp_code);
                sock.sendMessage(jid, { text: order.otp_code });
            }
            if (order.status === 'COMPLETED') {
                stopped = true;
                delete activePolls[orderId];
                return;
            }
        } catch (e) {}
        if (!stopped) setTimeout(poll, POLL_INTERVAL_MS);
    }

    activePolls[orderId] = { jid, stop: () => { stopped = true; } };
    poll();
}

function stopPolling(orderId) {
    if (!activePolls[orderId]) return false;
    activePolls[orderId].stop();
    delete activePolls[orderId];
    return true;
}

const MENU = `╔══════════════════════════╗
║  🤖 *Premium Bot*        ║
╠══════════════════════════╣
║ 📱 *SMS / OTP*           ║
║ *beli*    - Beli nomor   ║
║ *saldo*   - Cek saldo    ║
║ *aktif*   - Order aktif  ║
║ *cek <id>*    - Cek OTP  ║
║ *pantau <id>* - Auto notif║
║ *batal <id>*  - Cancel   ║
║ *selesai <id>*- Finish   ║
╠══════════════════════════╣
║ 📝 *Laporan Penjualan*   ║
║ *laporan*    - Form umum ║
║ *laporan yt* - YT G2G    ║
║ *daftar kasir <nama>*    ║
║ *rekap yt*   - Rekap YT   ║
║ *rekap*      - Rekap umum ║
╠══════════════════════════╣
║ 📊 *Report YouTube*      ║
║ *report harian*  - Hari  ║
║ *report mingguan*- Minggu║
║ *report bulanan* - Bulan ║
╠══════════════════════════╣
║ 🕒 *Absensi Kasir*       ║
║ *on*  - Mulai kerja      ║
║ *off* - Selesai kerja    ║
╚══════════════════════════╝`;

async function handleMessage(sock, msg) {
    const jid = msg.key.remoteJid;

    // Ekstrak image message dari berbagai wrapper Baileys
    const imgMsg = msg.message?.imageMessage
        || msg.message?.ephemeralMessage?.message?.imageMessage
        || msg.message?.viewOnceMessage?.message?.imageMessage
        || msg.message?.viewOnceMessageV2?.message?.imageMessage;

    const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

    // Screenshot + "?" → AI bantu balas chat G2G
    // Support: (1) gambar dengan caption "?" atau (2) reply "?" ke gambar
    const caption = (imgMsg?.caption || '').trim();
    const quotedImg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    const isG2GRequest = (imgMsg && caption === '?') || (text === '?' && quotedImg);

    if (isG2GRequest) {
        const reply = (content) => sock.sendMessage(jid, { text: content }, { quoted: msg });
        const targetMsg = (imgMsg && caption === '?') ? msg : { message: { imageMessage: quotedImg } };
        try {
            await reply('🤖 Analyzing screenshot...');
            const { generateG2GReply } = require('./g2gReply');
            const aiReply = await generateG2GReply(targetMsg);
            if (aiReply) {
                await reply(aiReply);
            } else {
                await reply('⚠️ Tidak bisa menganalisis screenshot. Pastikan API key sudah di-set.');
            }
        } catch (e) {
            await reply(`❌ Gagal analisis: ${e.message}`);
        }
        return;
    }

    // Teruskan pesan gambar ke salesHandler (Hanya di Personal Chat)
    if (imgMsg) {
        if (!jid.endsWith('@g.us')) {
            // Normalisasi: pastikan msg.message.imageMessage selalu ada untuk handler
            if (!msg.message.imageMessage) msg.message.imageMessage = imgMsg;
            const { handleSalesImage } = require('./salesHandler');
            const handled = await handleSalesImage(sock, msg);
            if (handled) return;
        }
        if (!text) return;
    }

    if (!text) return;

    const lower = text.toLowerCase();
    const reply = (content) => sock.sendMessage(jid, { text: content }, { quoted: msg });

    // Menu
    if (['menu', 'start', 'halo', 'hi', 'help'].includes(lower)) {
        return reply(MENU);
    }

    // Saldo
    if (lower === 'saldo') {
        try {
            const bal = await sms.getBalance();
            return reply(`💰 *Saldo:* Rp ${Number(bal.balance).toLocaleString('id-ID')}`);
        } catch (e) {
            return reply(`❌ Gagal cek saldo: ${e.message}`);
        }
    }

    // Beli nomor Google Brazil
    if (lower === 'beli') {
        try {
            const bal = await sms.getBalance();
            if (bal.balance < 574) {
                return reply(`❌ Saldo tidak cukup. Saldo kamu: Rp ${Number(bal.balance).toLocaleString('id-ID')}\nHarga mulai dari Rp 574.`);
            }
            await reply(`⏳ Membeli nomor Google/YouTube/Gmail 🇧🇷 Brazil...`);
            const order = await sms.createOrder(GOOGLE_BR_PRODUCT_ID);
            await reply(
                `✅ *Order Berhasil!*\n\n` +
                `🆔 ID: \`${order.id}\`\n` +
                `📞 Nomor: \`+${order.phone_number}\`\n` +
                `💰 Harga: Rp ${Number(order.amount).toLocaleString('id-ID')}\n` +
                `⏳ Expired: ${new Date(order.expires_at).toLocaleString('id-ID')}`
            );
            startPolling(sock, jid, order.id);
        } catch (e) {
            return reply(`❌ Gagal beli nomor: ${e.message}`);
        }
        return;
    }

    // Order aktif
    if (lower === 'aktif') {
        try {
            const orders = await sms.getActiveOrders();
            if (!orders || orders.length === 0) return reply('📋 Tidak ada order aktif.');
            const list = orders.map(o =>
                `• ID: \`${o.id}\` | \`+${o.phone_number}\` | ${o.status}`
            ).join('\n');
            return reply(`📋 *Order Aktif:*\n\n${list}`);
        } catch (e) {
            return reply(`❌ Gagal: ${e.message}`);
        }
    }

    // Pantau order dari luar bot
    if (lower.startsWith('pantau ')) {
        const id = text.split(' ')[1]?.trim();
        if (!id) return reply('Format: *pantau <order_id>*');
        try {
            const order = await sms.getOrder(id);
            if (order.otp_code) {
                return reply(
                    `📨 *OTP Sudah Masuk!*\n\n` +
                    `🆔 Order: \`${order.id}\`\n` +
                    `📞 Nomor: \`+${order.phone_number}\`\n` +
                    `🔑 *OTP: \`${order.otp_code}\`*`
                );
            }
            if (['EXPIRED', 'CANCELLED', 'COMPLETED'].includes(order.status)) {
                return reply(`⚠️ Order \`${id}\` sudah berstatus *${order.status}*, tidak bisa dipantau.`);
            }
            startPolling(sock, jid, id);
        } catch (e) {
            return reply(`❌ Gagal pantau order: ${e.message}`);
        }
        return;
    }

    // Stop polling
    if (lower.startsWith('stop ')) {
        const id = text.split(' ')[1];
        const stopped = stopPolling(id);
        return reply(stopped ? `✅ Polling order \`${id}\` dihentikan.` : `⚠️ Tidak ada polling aktif untuk \`${id}\`.`);
    }

    // Cek order
    if (lower.startsWith('cek ')) {
        const id = text.split(' ')[1];
        try {
            const order = await sms.getOrder(id);
            const otp = order.otp_code ? `🔑 *OTP: \`${order.otp_code}\`*` : '_(OTP belum masuk)_';
            return reply(
                `🔎 *Detail Order*\n\n` +
                `🆔 ID: \`${order.id}\`\n` +
                `📞 Nomor: \`+${order.phone_number}\`\n` +
                `📊 Status: ${order.status}\n` +
                `⏳ Expired: ${new Date(order.expires_at).toLocaleString('id-ID')}\n\n` +
                otp
            );
        } catch (e) {
            return reply(`❌ Gagal: ${e.message}`);
        }
    }

    // Cancel order
    if (lower.startsWith('batal ')) {
        const id = text.split(' ')[1];
        try {
            stopPolling(id);
            await sms.cancelOrder(id);
            return reply(`✅ Order \`${id}\` dibatalkan. Saldo akan dikembalikan.`);
        } catch (e) {
            return reply(`❌ Gagal cancel: ${e.message}`);
        }
    }

    // Finish order
    if (lower.startsWith('selesai ')) {
        const id = text.split(' ')[1];
        try {
            await sms.finishOrder(id);
            return reply(`✅ Order \`${id}\` diselesaikan.`);
        } catch (e) {
            return reply(`❌ Gagal: ${e.message}`);
        }
    }

    // CekSkin MLBB
    if (lower.startsWith('/cekskin ') || lower.startsWith('cekskin ')) {
        const gameId = text.split(' ')[1]?.trim();
        if (!gameId) return reply('❌ Format salah! Gunakan: /cekskin <ID>\nContoh: /cekskin 12345678');
        
        await reply('⏳ Sedang mengecek skin untuk ID ' + gameId + '...\nProses memakan waktu sekitar 15-30 detik.');
        try {
            const hasil = await checkSkin(gameId);
            await sock.sendMessage(jid, {
                image: { url: hasil.posterPath },
                caption: hasil.descriptionText
            }, { quoted: msg });
            
            // Hapus file gambar setelah dikirim untuk menghemat storage
            if (fs.existsSync(hasil.posterPath)) {
                fs.unlinkSync(hasil.posterPath);
            }
            return;
        } catch (e) {
            console.error('Error CekSkin:', e);
            return reply(`❌ Gagal mengecek skin: ${e.message}`);
        }
    }

    // Coba handler laporan penjualan
    const salesResult = await handleSales(sock, msg, text);
    if (salesResult !== null) return salesResult;

    if (jid.endsWith('@g.us')) return; // di grup: diam kalau perintah tak dikenal (biar tidak spam)
    return reply(`Perintah tidak dikenal. Ketik *menu* untuk melihat perintah yang tersedia.`);
}

module.exports = { handleMessage };
