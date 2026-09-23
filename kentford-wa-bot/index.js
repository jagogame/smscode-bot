'use strict';
require('dotenv').config();
const express = require('express');
const QRCode = require('qrcode');
const wa = require('./src/wa');
const { handleMessage } = require('./src/handler');

if (!process.env.OPENROUTER_KEY) {
  console.warn('⚠️  OPENROUTER_KEY belum di-set di .env — bot tidak akan bisa membalas pesan.');
}

wa.onMessage((sock, m) => {
  handleMessage(sock, wa, m).catch((e) => console.error('handleMessage error:', e));
});

wa.start();

// Small local page to scan the WhatsApp QR code from a browser (http://<vps-ip>:QR_PORT/qr),
// since there's no physical terminal/screen on the VPS to show it on.
const app = express();
const PORT = process.env.QR_PORT || 8092;

app.get('/qr', async (req, res) => {
  if (wa.isReady()) return res.send('<h2>Bot sudah terhubung ke WhatsApp ✅</h2>');
  const qr = wa.getLatestQr();
  if (!qr) return res.send('<h2>Menunggu QR code... refresh beberapa detik lagi.</h2>');
  const dataUrl = await QRCode.toDataURL(qr);
  res.send(`<html><body style="text-align:center;font-family:sans-serif">
    <h2>Scan QR ini dari WhatsApp &rarr; Perangkat Tertaut</h2>
    <img src="${dataUrl}" style="width:300px;height:300px"/>
    <p>Halaman ini refresh otomatis tiap 5 detik.</p>
    <script>setTimeout(()=>location.reload(),5000)</script>
  </body></html>`);
});

// Bound to localhost only — the QR code is a live auth handshake, so this page never listens
// on a public interface. Access it via SSH port-forward: ssh -L 8092:localhost:8092 <vps>.
app.listen(PORT, '127.0.0.1', () => console.log(`QR juga bisa dibuka via SSH tunnel: http://localhost:${PORT}/qr`));
