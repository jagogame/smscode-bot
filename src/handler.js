const sms = require('./smscode');
const { handleSales } = require('./salesHandler');

// catalog_product_id tetap untuk Google/YouTube/Gmail - Brazil
const GOOGLE_BR_PRODUCT_ID = 6220;

// Polling aktif per order
const activePolls = {};

const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS  = 20 * 60_000;

function startPolling(sock, jid, orderId) {
    if (activePolls[orderId]) return;

    const seenOtp = new Set();
    const startTime = Date.now();

    sock.sendMessage(jid, {
        text: `🔄 Menunggu OTP untuk order \`${orderId}\`...\nBot akan notif otomatis kalau OTP masuk (maks 10 menit).\nKetik *stop ${orderId}* untuk berhenti.`
    });

    const interval = setInterval(async () => {
        try {
            if (Date.now() - startTime > POLL_TIMEOUT_MS) {
                stopPolling(orderId);
                return;
            }

            const order = await sms.getOrder(orderId);

            // OTP masuk saat order sudah expired — notif khusus
            if (['EXPIRED', 'CANCELLED'].includes(order.status)) {
                if (order.otp_code && !seenOtp.has(order.otp_code)) {
                    seenOtp.add(order.otp_code);
                    sock.sendMessage(jid, {
                        text:
                            `⚠️ *OTP Masuk Tapi Waktu Habis!*\n\n` +
                            `🆔 Order: \`${orderId}\`\n` +
                            `📞 Nomor: \`+${order.phone_number}\`\n` +
                            `🔑 *OTP: \`${order.otp_code}\`*\n\n` +
                            `❌ Order sudah *${order.status}* — OTP ini tidak bisa dipakai.`
                    });
                }
                stopPolling(orderId);
                return;
            }

            if (order.status === 'COMPLETED') {
                stopPolling(orderId);
                return;
            }

            if (order.otp_code && !seenOtp.has(order.otp_code)) {
                seenOtp.add(order.otp_code);
                const count = seenOtp.size;
                sock.sendMessage(jid, {
                    text:
                        `📨 *OTP${count > 1 ? ` Terbaru (#${count})` : ''} Masuk!*\n\n` +
                        `🆔 Order: \`${orderId}\`\n` +
                        `📞 Nomor: \`+${order.phone_number}\`\n` +
                        `🔑 *OTP: \`${order.otp_code}\`*\n\n` +
                        `Ketik *selesai ${orderId}* setelah pakai.`
                });
            }
        } catch (e) {}
    }, POLL_INTERVAL_MS);

    activePolls[orderId] = { jid, interval };
}

function stopPolling(orderId) {
    if (!activePolls[orderId]) return false;
    clearInterval(activePolls[orderId].interval);
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
║ *laporan* - Input data   ║
║ *rekap*   - Lihat rekap  ║
╚══════════════════════════╝`;

async function handleMessage(sock, msg) {
    const jid = msg.key.remoteJid;
    const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
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

    // Coba handler laporan penjualan
    const salesResult = await handleSales(sock, msg, text);
    if (salesResult !== null) return salesResult;

    return reply(`Perintah tidak dikenal. Ketik *menu* untuk melihat perintah yang tersedia.`);
}

module.exports = { handleMessage };
