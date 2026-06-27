const crypto = require('crypto');

// Konfigurasi dari environment (di-set di Railway)
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';
const IS_PRODUCTION = String(process.env.MIDTRANS_IS_PRODUCTION || 'false') === 'true';

const SNAP_BASE = IS_PRODUCTION
    ? 'https://app.midtrans.com/snap/v1/transactions'
    : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

function isConfigured() { return !!SERVER_KEY && !!CLIENT_KEY; }
function getClientKey() { return CLIENT_KEY; }
function isProduction() { return IS_PRODUCTION; }

// Buat transaksi Snap, kembalikan { token, redirect_url }
async function createTransaction({ orderId, amount, customerName, productName }) {
    if (!isConfigured()) throw new Error('Midtrans belum dikonfigurasi (set MIDTRANS_SERVER_KEY & MIDTRANS_CLIENT_KEY)');
    const auth = Buffer.from(SERVER_KEY + ':').toString('base64');
    const body = {
        transaction_details: { order_id: orderId, gross_amount: Math.round(amount) },
        item_details: [{ id: orderId, price: Math.round(amount), quantity: 1, name: String(productName || 'Produk').slice(0, 50) }],
        customer_details: { first_name: String(customerName || 'Pelanggan').slice(0, 50) },
        credit_card: { secure: true },
    };
    const res = await fetch(SNAP_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Basic ' + auth,
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_messages ? data.error_messages.join(', ') : 'Gagal membuat transaksi Midtrans');
    return data; // { token, redirect_url }
}

// Verifikasi signature notifikasi Midtrans
function verifySignature({ order_id, status_code, gross_amount, signature_key }) {
    const expected = crypto
        .createHash('sha512')
        .update(order_id + status_code + gross_amount + SERVER_KEY)
        .digest('hex');
    return expected === signature_key;
}

// Apakah status notifikasi berarti pembayaran LUNAS?
function isPaid(notif) {
    const s = notif.transaction_status;
    const fraud = notif.fraud_status;
    if (s === 'capture') return fraud === 'accept' || !fraud;
    return s === 'settlement';
}

module.exports = { isConfigured, getClientKey, isProduction, createTransaction, verifySignature, isPaid };
