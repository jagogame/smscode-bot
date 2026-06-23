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
require('dotenv').config();

// Web server untuk tampilkan QR di Railway
const app = express();
const PORT = process.env.PORT || 3000;
let currentQR = null;

app.use(express.json());
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

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            currentQR = qr;
            console.log('\n📱 Scan QR di browser atau terminal:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            currentQR = null;
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            console.log(`❌ Koneksi terputus (${code}). ${shouldReconnect ? 'Reconnecting...' : 'Hapus folder auth_info dan scan ulang.'}`);
            if (shouldReconnect) startBot();
        }

        if (connection === 'open') {
            currentQR = null;
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
