const crypto = require('crypto');

// Kunci enkripsi dari env. Jika tidak diset, data disimpan apa adanya (tanpa enkripsi).
const RAW_KEY = process.env.ENCRYPTION_KEY || '';
const KEY = RAW_KEY ? crypto.createHash('sha256').update(RAW_KEY).digest() : null;
const PREFIX = 'enc::';

function enabled() { return !!KEY; }

function encrypt(text) {
    if (!KEY || text == null) return text;
    if (typeof text === 'string' && text.startsWith(PREFIX)) return text; // sudah terenkripsi
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(text) {
    if (typeof text !== 'string' || !text.startsWith(PREFIX)) return text; // plaintext lama / tak terenkripsi
    if (!KEY) return text; // tak bisa dekripsi tanpa kunci
    try {
        const raw = Buffer.from(text.slice(PREFIX.length), 'base64');
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const data = raw.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
        return text;
    }
}

module.exports = { encrypt, decrypt, enabled };
