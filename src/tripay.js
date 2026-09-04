const crypto = require('crypto');

const API_KEY = process.env.TRIPAY_API_KEY || '';
const PRIVATE_KEY = process.env.TRIPAY_PRIVATE_KEY || '';
const MERCHANT_CODE = process.env.TRIPAY_MERCHANT_CODE || '';
const IS_PRODUCTION = String(process.env.TRIPAY_IS_PRODUCTION || 'false') === 'true';

const BASE_URL = IS_PRODUCTION
    ? 'https://tripay.co.id/api'
    : 'https://tripay.co.id/api-sandbox';

function isConfigured() { return !!API_KEY && !!PRIVATE_KEY && !!MERCHANT_CODE; }

function generateSignature(merchantRef, amount) {
    return crypto.createHmac('sha256', PRIVATE_KEY)
        .update(MERCHANT_CODE + merchantRef + amount)
        .digest('hex');
}

async function createTransaction({ orderId, amount, customerName, customerEmail, productName, method, callbackUrl, returnUrl }) {
    if (!isConfigured()) throw new Error('Tripay belum dikonfigurasi (set TRIPAY_API_KEY, TRIPAY_PRIVATE_KEY, TRIPAY_MERCHANT_CODE)');

    const roundedAmount = Math.round(amount);
    const signature = generateSignature(orderId, roundedAmount);
    const expiredTime = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    const body = new URLSearchParams({
        method: method || 'QRIS',
        merchant_ref: orderId,
        amount: String(roundedAmount),
        customer_name: String(customerName || 'Pelanggan').slice(0, 50),
        customer_email: String(customerEmail || '').slice(0, 100),
        'order_items[0][sku]': orderId,
        'order_items[0][name]': String(productName || 'Produk').slice(0, 50),
        'order_items[0][price]': String(roundedAmount),
        'order_items[0][quantity]': '1',
        signature,
        expired_time: String(expiredTime),
    });
    if (callbackUrl) body.append('callback_url', callbackUrl);
    if (returnUrl) body.append('return_url', returnUrl);

    const res = await fetch(BASE_URL + '/transaction/create', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + API_KEY,
        },
        body,
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Gagal membuat transaksi Tripay');
    return data.data;
}

async function getPaymentChannels() {
    if (!isConfigured()) return [];
    const res = await fetch(BASE_URL + '/merchant/payment-channel', {
        headers: { 'Authorization': 'Bearer ' + API_KEY },
    });
    const data = await res.json();
    return data.success ? data.data : [];
}

function verifyCallback(rawBody, signatureHeader) {
    if (!PRIVATE_KEY || !signatureHeader) return false;
    const expected = crypto.createHmac('sha256', PRIVATE_KEY)
        .update(rawBody)
        .digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(String(signatureHeader));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isPaid(callbackData) {
    return callbackData.status === 'PAID';
}

module.exports = { isConfigured, createTransaction, getPaymentChannels, verifyCallback, isPaid };
