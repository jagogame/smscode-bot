'use strict';
const fs = require('fs');
const path = require('path');
const claude = require('./claude');

const MAX_HISTORY = 20; // messages kept per chat (user+assistant combined)
const histories = new Map(); // jid -> [{role, content}]
const LOG_PATH = path.join(__dirname, '..', 'conversations.log');

// Setiap pesan masuk/keluar dicatat ke conversations.log untuk audit - penting karena balasan
// dikirim OTOMATIS tanpa direview staff dulu, jadi harus bisa ditelusuri kalau ada yang salah jawab.
function logLine(obj) {
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n');
  } catch (e) {
    console.error('gagal tulis log:', e.message);
  }
}

function extractText(m) {
  const msg = m.message;
  if (!msg) return null;
  return (
    msg.conversation ||
    (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
    (msg.imageMessage && msg.imageMessage.caption) ||
    (msg.videoMessage && msg.videoMessage.caption) ||
    null
  );
}

function pushHistory(jid, role, content) {
  const h = histories.get(jid) || [];
  h.push({ role, content });
  while (h.length > MAX_HISTORY) h.shift();
  histories.set(jid, h);
  return h;
}

async function handleMessage(sock, wa, m) {
  const jid = m.key.remoteJid;
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return; // ignore groups/status

  const text = extractText(m);
  if (!text) return;

  const waNumber = jid.split('@')[0];
  logLine({ event: 'inbound', from: waNumber, text });

  const history = pushHistory(jid, 'user', text);

  const delay = Number(process.env.REPLY_DELAY_MS || 1500);
  await wa.sendTyping(jid, delay);

  let reply;
  try {
    reply = await claude.reply(history, waNumber);
  } catch (e) {
    console.error('AI reply error:', e.message);
    logLine({ event: 'ai_error', from: waNumber, error: e.message });
    reply = 'Maaf, sistem sedang ada gangguan teknis. Tim kami akan segera menghubungi Anda.';
  }

  pushHistory(jid, 'assistant', reply);
  await wa.sendText(jid, reply);
  logLine({ event: 'outbound', to: waNumber, text: reply });
}

module.exports = { handleMessage };
