const axios = require('axios');
const fs = require('fs');
const path = require('path');

const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSepagJOwTrfm2l0xl05pLWbn20tEC7Esz3LtkPZ4wYAIaNkkw/formResponse';

const ENTRY = {
    namaKasir:      'entry.1294513398',
    namaPembeli:    'entry.782300204',
    detailAkun:     'entry.197719696',
    durasi:         'entry.1636348355',
    emailAdmin:     'entry.1257666637',
    emailBuyer:     'entry.1917596714',
    tanggalHabis:   'entry.269504320',
    platform:       'entry.2122069246',
    keterangan:     'entry.1525660566',
};

const DB_PATH = path.join(__dirname, '../data/sales.json');

function loadDB() {
    if (!fs.existsSync(DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveDB(data) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

async function submitForm(record) {
    const tgl = record.tanggalHabis || '';
    const [day='', month='', year=''] = tgl ? tgl.split('/') : [];

    const params = new URLSearchParams({
        [ENTRY.namaKasir]:              record.namaKasir || '',
        [ENTRY.namaPembeli]:            record.namaPembeli || record.usernamePembeli || '',
        [ENTRY.detailAkun]:             record.detailAkun || '',
        [ENTRY.durasi]:                 record.durasi || '',
        [ENTRY.emailAdmin]:             record.emailAdmin || '',
        [ENTRY.emailBuyer]:             record.emailBuyer || '',
        [`${ENTRY.tanggalHabis}_year`]:  year,
        [`${ENTRY.tanggalHabis}_month`]: month,
        [`${ENTRY.tanggalHabis}_day`]:   day,
        [ENTRY.platform]:               record.platform || '',
        [ENTRY.keterangan]:             record.keterangan || '',
    });
    const res = await axios.post(FORM_URL, params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0',
        },
        maxRedirects: 5,
        validateStatus: s => true,
    });

    if (res.status >= 400) {
        throw new Error(`Google Form error ${res.status} — data: ${params.toString()}`);
    }

    // Simpan ke DB lokal
    const db = loadDB();
    db.push({ ...record, submittedAt: new Date().toISOString() });
    saveDB(db);
}

// Simpan laporan YT G2G ke DB lokal saja (tanpa Google Form)
function submitLocalOnly(record) {
    const db = loadDB();
    db.push({ ...record, submittedAt: new Date().toISOString(), source: 'yt_g2g' });
    saveDB(db);
}

function getRekapHariIni() {
    const db = loadDB();
    const today = new Date().toISOString().slice(0, 10);
    return db.filter(r => r.submittedAt?.startsWith(today));
}

function getRekapSemua() {
    return loadDB();
}

function getRekapByKasir(nama) {
    const db = loadDB();
    return db.filter(r => r.namaKasir.toLowerCase() === nama.toLowerCase());
}

module.exports = { submitForm, submitLocalOnly, getRekapHariIni, getRekapSemua, getRekapByKasir };
