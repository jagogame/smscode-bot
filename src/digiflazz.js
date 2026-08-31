const crypto = require('crypto');

// Klien Digiflazz (topup game otomatis). Kredensial dari env var:
// DIGIFLAZZ_USERNAME, DIGIFLAZZ_APIKEY (produksi, bukan mode developer/sandbox).
const USERNAME = process.env.DIGIFLAZZ_USERNAME || '';
const APIKEY = process.env.DIGIFLAZZ_APIKEY || '';
const BASE = 'https://api.digiflazz.com/v1';

function isConfigured() { return !!USERNAME && !!APIKEY; }

function sign(action) {
    return crypto.createHash('md5').update(USERNAME + APIKEY + action).digest('hex');
}

async function post(path, body) {
    const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.data?.message || data?.message || 'Digiflazz request gagal');
    return data;
}

// Eksekusi 1 transaksi topup. Return { status, message, sn, rc }
async function topup(skuCode, customerNo, refId) {
    if (!isConfigured()) throw new Error('Digiflazz belum dikonfigurasi (set DIGIFLAZZ_USERNAME & DIGIFLAZZ_APIKEY)');
    const payload = {
        username: USERNAME,
        buyer_sku_code: skuCode,
        customer_no: customerNo,
        ref_id: refId,
        sign: sign(refId),
    };
    const res = await post('/transaction', payload);
    return res.data || {};
}

// Cek status transaksi yang sudah dikirim sebelumnya (pakai ref_id yang sama)
async function checkStatus(refId) {
    if (!isConfigured()) throw new Error('Digiflazz belum dikonfigurasi');
    const payload = {
        username: USERNAME,
        buyer_sku_code: '',
        customer_no: '',
        ref_id: refId,
        sign: sign(refId),
    };
    const res = await post('/transaction', payload);
    return res.data || {};
}

// Saldo deposit Digiflazz
async function getBalance() {
    if (!isConfigured()) throw new Error('Digiflazz belum dikonfigurasi');
    const payload = { cmd: 'deposit', username: USERNAME, sign: sign('depo') };
    const res = await post('/cek-saldo', payload);
    return res.data?.deposit ?? null;
}

// Daftar harga (prepaid). Type: 'prepaid'
async function getPriceList(type = 'prepaid') {
    if (!isConfigured()) throw new Error('Digiflazz belum dikonfigurasi');
    const payload = { cmd: type, username: USERNAME, sign: sign('pricelist') };
    const res = await post('/price-list', payload);
    return res.data || [];
}

// Topup 1 atau beberapa SKU sekaligus (produk yang butuh >1 transaksi Digiflazz
// untuk 1 pesanan, mis. denominasi yang bukan SKU tunggal). digiSkus: [{sku, qty}]
// atau product.digiSku tunggal. Mengembalikan { success, results, totalPurchases }.
async function multiTopup(product, customerNo, baseRefId) {
    const skus = product.digiSkus && product.digiSkus.length
        ? product.digiSkus
        : [{ sku: product.digiSku, qty: 1 }];
    const results = [];
    let allSuccess = true;
    let idx = 0;
    const total = skus.reduce((s, x) => s + (x.qty || 1), 0);

    for (const item of skus) {
        for (let i = 0; i < (item.qty || 1); i++) {
            idx++;
            const refId = `${baseRefId}-${idx}`;
            try {
                const r = await topup(item.sku, customerNo, refId);
                const ok = r.status === 'Sukses';
                const pending = r.status === 'Pending';
                results.push({ sku: item.sku, refId, status: r.status, message: r.message, sn: r.sn, rc: r.rc });
                if (!ok && !pending) allSuccess = false;
            } catch (err) {
                results.push({ sku: item.sku, refId, status: 'Error', message: err.message });
                allSuccess = false;
            }
            if (idx < total) await new Promise(r => setTimeout(r, 500));
        }
    }
    return { success: allSuccess, results, totalPurchases: idx };
}

module.exports = { isConfigured, topup, checkStatus, getBalance, getPriceList, multiTopup };
