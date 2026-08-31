// ─────────────────────────────────────────────────────────────
// Web Push untuk Aplikasi Kasir (PWA).
// - VAPID keys: dari ENV, kalau tidak ada → generate & simpan di volume
//   persisten (/app/auth_info di Railway, else ./data) supaya awet lintas deploy.
// - Langganan (subscription) HP kasir disimpan di file yang sama.
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
let webpush = null;
try { webpush = require('web-push'); } catch (_) { /* dep belum ada → push dimatikan */ }

const VOL_DIR = fs.existsSync('/app/auth_info') ? '/app/auth_info' : path.join(__dirname, '../data');
const VAPID_FILE = path.join(VOL_DIR, 'vapid.json');
const SUBS_FILE = path.join(VOL_DIR, 'push-subs.json');
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@jagogame.store';

let keys = null;     // { publicKey, privateKey }
let enabled = false;

function loadJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function saveJson(file, data) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { console.error('[push] gagal simpan', file, e.message); } }

function init() {
    if (!webpush) { console.warn('[push] modul web-push tidak tersedia → notifikasi HP nonaktif'); return; }
    // 1) ENV
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    } else {
        // 2) file volume
        keys = loadJson(VAPID_FILE, null);
        // 3) generate
        if (!keys || !keys.publicKey || !keys.privateKey) {
            keys = webpush.generateVAPIDKeys();
            saveJson(VAPID_FILE, keys);
            console.log('[push] VAPID keys baru dibuat & disimpan di', VAPID_FILE);
        }
    }
    try {
        webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
        enabled = true;
    } catch (e) { console.error('[push] setVapidDetails gagal:', e.message); }
}
init();

function getPublicKey() { return enabled ? keys.publicKey : null; }

function loadSubs() { return loadJson(SUBS_FILE, []); }
function saveSubs(list) { saveJson(SUBS_FILE, list); }

// Simpan langganan (dedupe per endpoint). user = { name, role }
function addSubscription(sub, user) {
    if (!sub || !sub.endpoint) return false;
    const list = loadSubs();
    const i = list.findIndex(x => x.sub && x.sub.endpoint === sub.endpoint);
    const entry = { sub, name: user && user.name, role: user && user.role, at: new Date().toISOString() };
    if (i >= 0) list[i] = entry; else list.push(entry);
    saveSubs(list);
    return true;
}

// Kirim notifikasi ke langganan yang lolos filter(user). Auto-hapus yang mati (404/410).
async function send(payload, filter) {
    if (!enabled) return { sent: 0, skipped: 'disabled' };
    const list = loadSubs();
    const targets = filter ? list.filter(x => { try { return filter({ name: x.name, role: x.role }); } catch { return false; } }) : list;
    const body = JSON.stringify(payload || {});
    const dead = [];
    let sent = 0;
    await Promise.all(targets.map(x =>
        webpush.sendNotification(x.sub, body).then(() => { sent++; }).catch(err => {
            const code = err && err.statusCode;
            if (code === 404 || code === 410) dead.push(x.sub.endpoint);
        })
    ));
    if (dead.length) saveSubs(loadSubs().filter(x => !dead.includes(x.sub && x.sub.endpoint)));
    return { sent, removed: dead.length };
}

module.exports = { getPublicKey, addSubscription, send, isEnabled: () => enabled };
