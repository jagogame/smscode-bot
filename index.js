const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');
const { handleMessage } = require('./src/handler');
const apiRouter = require('./src/api');
const wa = require('./src/wa');
const backup = require('./src/backup');
const store = require('./src/store');
require('dotenv').config();

// ── Peringatan konfigurasi keamanan ──────────────────────────────────────────
// Cek env var penting yang kalau kosong bikin sistem jatuh ke default lemah
// atau nyimpen data sensitif tanpa enkripsi.
(function checkSecurityConfig() {
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const warnings = [];

    if (!process.env.ADMIN_PASSWORD) warnings.push('ADMIN_PASSWORD belum di-set → login admin pakai password default (admin123)');
    if (!process.env.KASIR_ARSHIL_PASSWORD) warnings.push('KASIR_ARSHIL_PASSWORD belum di-set → password default (arshil123)');
    if (!process.env.KASIR_ARINAL_PASSWORD) warnings.push('KASIR_ARINAL_PASSWORD belum di-set → password default (arinal123)');
    if (!process.env.KASIR_DEWO_PASSWORD) warnings.push('KASIR_DEWO_PASSWORD belum di-set → password default (dewo123)');
    if (!process.env.ENCRYPTION_KEY) warnings.push('ENCRYPTION_KEY belum di-set → kredensial akun customer DISIMPAN TANPA ENKRIPSI di data/store-orders.json');
    if (String(process.env.ADMIN_2FA || 'false') !== 'true') warnings.push('ADMIN_2FA belum aktif → login admin tanpa verifikasi OTP WhatsApp kedua');

    if (warnings.length) {
        console.warn('\n⚠️  PERINGATAN KEAMANAN' + (isProd ? ' (PRODUCTION)' : '') + ':');
        warnings.forEach(w => console.warn('   - ' + w));
        console.warn(isProd
            ? '   → Set env var di atas di Railway secepatnya, ini production!\n'
            : '   → Set env var di atas sebelum deploy ke production.\n');
    }
})();

backup.startSchedule();
require('./src/weeklyAward').start(); // Juara Mingguan otomatis (umumkan + reset tiap awal minggu)

// Follow-up otomatis: ingatkan pesanan PENDING yang belum dibayar (>15 menit, sekali saja)
setInterval(() => {
    if (!wa.isReady()) return;
    const now = Date.now();
    for (const o of store.getOrders()) {
        if (o.status !== 'PENDING' || o.reminded || !o.createdAt) continue;
        const age = now - new Date(o.createdAt).getTime();
        if (age > 15 * 60 * 1000 && age < 24 * 60 * 60 * 1000) {
            wa.sendText(o.customerWA, `Halo ${o.customerName} 👋\n\nPesanan *${o.productName}* (${o.id}) masih menunggu pembayaran. Yuk selesaikan biar akunnya langsung dikirim otomatis 🚀\n\nAda kendala? Balas chat ini ya. 🙏`).catch(() => {});
            try { store.patchOrder(o.id, { reminded: true }); } catch {}
        }
    }
}, 5 * 60 * 1000);


// Web server untuk tampilkan QR di Railway
const app = express();
const PORT = process.env.PORT || 3000;
let currentQR = null;

app.use(express.json());
app.use('/', require('./src/appApi')); // API Aplikasi Kasir (PWA) — additive
app.use('/', apiRouter);

app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send(`
            <html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#e2e8f0">
            <h2>✅ Bot WhatsApp sudah terhubung!</h2>
            <p style="color:#94a3b8">Kembali ke <a href="/" style="color:#6366f1">Dashboard</a></p>
            </body></html>
        `);
    }
    const qrImage = await QRCode.toDataURL(currentQR);
    res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#e2e8f0">
        <h2>📱 Scan QR Code dengan WhatsApp</h2>
        <p style="color:#94a3b8">Buka WhatsApp → Linked Devices → Link a Device</p>
        <img src="${qrImage}" style="width:300px;height:300px;border-radius:12px;margin:20px"/>
        <p><small style="color:#64748b">Refresh halaman jika QR expired</small></p>
        </body></html>
    `);
});

app.listen(PORT, () => console.log(`🌐 QR Server jalan di port ${PORT}`));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);
    wa.setSock(sock);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            currentQR = qr;
            console.log('\n📱 Scan QR di browser atau terminal:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            currentQR = null;
            wa.setConnected(false);
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            console.log(`❌ Koneksi terputus (${code}). ${shouldReconnect ? 'Reconnecting...' : 'Hapus folder auth_info dan scan ulang.'}`);
            if (shouldReconnect) startBot();
        }

        if (connection === 'open') {
            currentQR = null;
            wa.setConnected(true);
            console.log('✅ Bot WhatsApp terhubung!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (msg.key.fromMe) continue;
            if (!msg.message) continue;
            try {
                await handleMessage(sock, msg);
            } catch (err) {
                console.error('Error handle message:', err.message);
            }
        }
    });
}

startBot();
