const fs = require('fs');
const path = require('path');

const VOL_DIR = fs.existsSync('/app/auth_info') ? '/app/auth_info' : path.join(__dirname, '../data');
const BACKUP_DIR = path.join(VOL_DIR, 'backups');
const KEEP = 14; // simpan 14 backup terakhir

function ensureDir() { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

function readSafe(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

// Buat 1 file backup berisi orders, stock, settings, products
function runBackup() {
    try {
        ensureDir();
        const snapshot = {
            createdAt: new Date().toISOString(),
            orders: readSafe(path.join(VOL_DIR, 'store-orders.json')) || [],
            stock: readSafe(path.join(VOL_DIR, 'store-stock.json')) || {},
            vouchers: readSafe(path.join(VOL_DIR, 'store-vouchers.json')) || [],
            settings: readSafe(path.join(__dirname, '../data/store-settings.json')) || {},
            products: readSafe(path.join(__dirname, '../data/products.json')) || [],
        };
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(path.join(BACKUP_DIR, `backup-${stamp}.json`), JSON.stringify(snapshot));
        // Bersihkan backup lama
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup-')).sort();
        while (files.length > KEEP) { fs.unlinkSync(path.join(BACKUP_DIR, files.shift())); }
        return { ok: true, file: `backup-${stamp}.json`, total: snapshot.orders.length };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function listBackups() {
    ensureDir();
    return fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup-')).sort().reverse();
}

// Snapshot terkini (untuk diunduh admin)
function currentSnapshot() {
    return {
        createdAt: new Date().toISOString(),
        orders: readSafe(path.join(VOL_DIR, 'store-orders.json')) || [],
        stock: readSafe(path.join(VOL_DIR, 'store-stock.json')) || {},
        vouchers: readSafe(path.join(VOL_DIR, 'store-vouchers.json')) || [],
        settings: readSafe(path.join(__dirname, '../data/store-settings.json')) || {},
        products: readSafe(path.join(__dirname, '../data/products.json')) || [],
    };
}

// Jalankan otomatis: saat start + tiap 24 jam
function startSchedule() {
    runBackup();
    setInterval(runBackup, 24 * 60 * 60 * 1000);
}

module.exports = { runBackup, listBackups, currentSnapshot, startSchedule };
