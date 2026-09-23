'use strict';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');

let sock = null;
let ready = false;
let latestQr = null;
let onMessageCb = null;

function isReady() {
  return ready;
}

function getLatestQr() {
  return latestQr;
}

function onMessage(cb) {
  onMessageCb = cb;
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'warn' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      latestQr = qr;
      console.log('\nScan QR ini dari WhatsApp -> Perangkat Tertaut (berlaku ~20 detik, refresh otomatis):\n');
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === 'open') {
      ready = true;
      latestQr = null;
      console.log('✅ Bot WhatsApp Kentford terhubung!');
    }
    if (connection === 'close') {
      ready = false;
      const statusCode = new Boom(lastDisconnect && lastDisconnect.error).output
        ? new Boom(lastDisconnect.error).output.statusCode
        : null;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.warn(`❌ Koneksi WhatsApp terputus (${statusCode}). ${loggedOut ? 'Logged out — perlu scan ulang QR.' : 'Reconnecting...'}`);
      if (!loggedOut) start();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue;
      if (onMessageCb) onMessageCb(sock, m);
    }
  });
}

async function sendTyping(jid, ms) {
  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise((r) => setTimeout(r, ms));
    await sock.sendPresenceUpdate('paused', jid);
  } catch (e) { /* presence updates are best-effort */ }
}

async function sendText(jid, text) {
  await sock.sendMessage(jid, { text });
}

module.exports = { start, isReady, getLatestQr, onMessage, sendTyping, sendText };
