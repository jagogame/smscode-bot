const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Password admin dari ENV (lebih aman). Jika tidak diset, pakai default lama.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const USERS = {
    admin: { password: ADMIN_PASSWORD, role: 'admin', name: 'Admin' },
    arshil: { password: process.env.KASIR_ARSHIL_PASSWORD || 'arshil123', role: 'kasir', name: 'Arshil' },
    arinal: { password: process.env.KASIR_ARINAL_PASSWORD || 'arinal123', role: 'kasir', name: 'Arinal' },
    dewo: { password: process.env.KASIR_DEWO_PASSWORD || 'dewo123', role: 'kasir', name: 'Dewo' },
};

// Sesi persisten di volume agar tidak hilang saat restart
const VOL_DIR = fs.existsSync('/app/auth_info') ? '/app/auth_info' : path.join(__dirname, '../data');
const SESSION_FILE = path.join(VOL_DIR, 'sessions.json');
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 hari

let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { sessions = {}; }
function persist() { try { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions)); } catch {} }

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Bandingkan password tahan timing-attack
function safeEqual(a, b) {
    const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

function login(username, password) {
    const user = USERS[String(username || '').toLowerCase()];
    if (!user || !safeEqual(user.password, password)) return null;
    const token = generateToken();
    sessions[token] = { username: username.toLowerCase(), role: user.role, name: user.name, exp: Date.now() + SESSION_TTL };
    persist();
    return token;
}

function getSession(token) {
    const s = sessions[token];
    if (!s) return null;
    if (s.exp && Date.now() > s.exp) { delete sessions[token]; persist(); return null; }
    return s;
}

function logout(token) {
    delete sessions[token];
    persist();
}

module.exports = { login, getSession, logout };
