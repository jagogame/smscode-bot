const fs = require('fs');
const path = require('path');

const VOL_DIR = fs.existsSync('/app/auth_info') ? '/app/auth_info' : path.join(__dirname, '../data');
const FILE = path.join(VOL_DIR, 'audit-log.json');
const MAX = 2000; // simpan maksimal 2000 entri terakhir

function read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function write(a) { try { fs.writeFileSync(FILE, JSON.stringify(a)); } catch {} }

// Catat satu aksi admin
function log(req, action, detail) {
    const arr = read();
    arr.push({
        at: new Date().toISOString(),
        user: (req.session && req.session.username) || 'unknown',
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '',
        action,
        detail: detail || '',
    });
    while (arr.length > MAX) arr.shift();
    write(arr);
}

function recent(limit = 100) { return read().slice(-limit).reverse(); }

module.exports = { log, recent };
