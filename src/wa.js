// Penyimpan referensi socket WhatsApp (Baileys) agar modul lain bisa kirim pesan.
let sock = null;

function setSock(s) { sock = s; }
function isReady() { return !!sock; }

// Ubah nomor (08xx / 628xx / +628xx) jadi JID WhatsApp
function toJid(phone) {
    let n = String(phone || '').replace(/\D/g, '');
    if (n.startsWith('0')) n = '62' + n.slice(1);
    if (!n.startsWith('62')) n = '62' + n;
    return n + '@s.whatsapp.net';
}

async function sendText(phone, text) {
    if (!sock) throw new Error('WhatsApp belum terhubung');
    const jid = toJid(phone);
    await sock.sendMessage(jid, { text });
    return true;
}

module.exports = { setSock, isReady, sendText, toJid };
