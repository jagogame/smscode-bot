const express = require('express');
const path = require('path');
const { login, getSession, logout } = require('./auth');
const sms = require('./smscode');
const { submitForm, getRekapHariIni, getRekapSemua, getRekapByKasir } = require('./sales');
const store = require('./store');
const midtrans = require('./midtrans');
const wa = require('./wa');
const backup = require('./backup');
const otp = require('./otp');
const { encrypt, decrypt } = require('./crypto');

const router = express.Router();

// Kunci untuk cegah double-delivery order yang sama (mis. webhook ganda)
const delivering = new Set();

// Kirim produk otomatis setelah pembayaran lunas
async function deliverOrder(order) {
    // Selalu baca status terbaru dari penyimpanan
    const fresh = store.getOrderById(order.id) || order;
    if (fresh.status === 'DELIVERED') return fresh;
    if (delivering.has(order.id)) return fresh;
    delivering.add(order.id);
    try {
    const cred = store.popStock(order.productId);
    const settings = store.getSettings();
    if (!cred) {
        const updated = store.patchOrder(order.id, { status: 'PAID_NO_STOCK', paymentStatus: 'PAID', paidAt: new Date().toISOString() });
        // Beritahu admin agar kirim manual
        if (settings.whatsapp && wa.isReady()) {
            wa.sendText(settings.whatsapp, `⚠️ STOK HABIS!\nPesanan ${order.id} (${order.productName}) sudah LUNAS tapi stok akun kosong.\nPembeli: ${order.customerName} (${order.customerWA})\nSegera kirim manual & isi stok.`).catch(() => {});
        }
        return updated;
    }
    const updated = store.patchOrder(order.id, {
        status: 'DELIVERED', paymentStatus: 'PAID',
        credential: encrypt(cred), paidAt: new Date().toISOString(), deliveredAt: new Date().toISOString(),
    });
    if (order.voucherCode) store.useVoucher(order.voucherCode);
    // Kirim invoice + akun ke WhatsApp pembeli
    if (wa.isReady()) {
        const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
        let inv = `✅ *PEMBAYARAN BERHASIL — Jago Game*\n\nTerima kasih ${order.customerName}! 🎉\n\n🧾 *INVOICE*\nID: ${order.id}\nProduk: ${order.productName}\nHarga: ${rp(order.productPrice)}`;
        if (order.discount > 0) inv += `\nDiskon${order.voucherCode ? ' (' + order.voucherCode + ')' : ''}: -${rp(order.discount)}`;
        inv += `\n*Total Bayar: ${rp(order.finalPrice != null ? order.finalPrice : order.productPrice)}*\nStatus: LUNAS ✅\n\n━━━━━━━━━━━━━━\n📦 *DETAIL AKUN KAMU:*\n\n${cred}\n━━━━━━━━━━━━━━\n\nSimpan baik-baik & segera ganti email/password. Ada kendala? Balas chat ini. 🙏`;
        wa.sendText(order.customerWA, inv).catch(() => {});
    }
    // Beritahu admin
    if (settings.whatsapp && wa.isReady()) {
        wa.sendText(settings.whatsapp, `💰 TERJUAL!\n${order.productName}\nRp ${Number(order.productPrice).toLocaleString('id-ID')}\nPembeli: ${order.customerName} (${order.customerWA})\nSisa stok: ${store.getStockCount(order.productId)}`).catch(() => {});
    }
    return updated;
    } finally {
        delivering.delete(order.id);
    }
}

// Rate limiter sederhana (in-memory) per IP
function rateLimiter({ windowMs, max, message }) {
    const hits = new Map();
    return (req, res, next) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
        const now = Date.now();
        const rec = hits.get(ip) || { count: 0, reset: now + windowMs };
        if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
        rec.count++;
        hits.set(ip, rec);
        if (rec.count > max) return res.status(429).json({ error: message || 'Terlalu banyak permintaan, coba lagi nanti.' });
        next();
    };
}

// Middleware auth
function requireAuth(req, res, next) {
    const token = req.headers['x-token'] || req.query.token;
    const session = getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.session = session;
    next();
}

// Security headers dasar
router.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

// Static files
router.use(express.static(path.join(__dirname, '../public')));
router.use(express.json({ limit: '256kb' }));

// Admin panel
router.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Halaman lacak pesanan
router.get('/lacak', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/lacak.html'));
});

// Halaman kebijakan & syarat
router.get('/kebijakan', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/kebijakan.html'));
});

// SEO: robots.txt & sitemap.xml
const SITE = 'https://www.jagogame.store';
router.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE}/sitemap.xml\n`);
});
router.get('/sitemap.xml', (req, res) => {
    const urls = [`${SITE}/`, `${SITE}/lacak`, `${SITE}/kebijakan`];
    const today = new Date().toISOString().slice(0, 10);
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`).join('\n') +
        `\n</urlset>`;
    res.type('application/xml').send(body);
});
// Data terstruktur produk (JSON-LD) untuk Google
router.get('/api/store/structured-data', (req, res) => {
    const products = store.getActiveProducts();
    const data = {
        '@context': 'https://schema.org', '@type': 'ItemList',
        itemListElement: products.map((p, i) => ({
            '@type': 'ListItem', position: i + 1,
            item: {
                '@type': 'Product', name: p.name,
                description: (p.description || '').slice(0, 200),
                image: p.image || undefined,
                offers: {
                    '@type': 'Offer', price: p.price, priceCurrency: 'IDR',
                    availability: (!p.autoDeliver || (p.stockCount || 0) > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                },
            },
        })),
    };
    res.json(data);
});

// Login (maks 8 percobaan / 5 menit)
router.post('/api/login', rateLimiter({ windowMs: 5 * 60 * 1000, max: 8, message: 'Terlalu banyak percobaan login. Tunggu 5 menit.' }), (req, res) => {
    const { username, password } = req.body;
    const token = login(username, password);
    if (!token) return res.status(401).json({ error: 'Username atau password salah' });
    const session = getSession(token);
    res.json({ token, role: session.role, name: session.name });
});

// Logout
router.post('/api/logout', requireAuth, (req, res) => {
    const token = req.headers['x-token'];
    logout(token);
    res.json({ ok: true });
});

// Saldo
router.get('/api/saldo', requireAuth, async (req, res) => {
    try {
        const bal = await sms.getBalance();
        res.json(bal);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Order aktif
router.get('/api/orders/active', requireAuth, async (req, res) => {
    try {
        const orders = await sms.getActiveOrders();
        res.json(orders || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Cek order
router.get('/api/orders/:id', requireAuth, async (req, res) => {
    try {
        const order = await sms.getOrder(req.params.id);
        res.json(order);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Beli nomor
router.post('/api/orders/buy', requireAuth, async (req, res) => {
    try {
        const order = await sms.createOrder(6220);
        res.json(order);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Cancel order
router.post('/api/orders/cancel', requireAuth, async (req, res) => {
    try {
        const result = await sms.cancelOrder(req.body.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Finish order
router.post('/api/orders/finish', requireAuth, async (req, res) => {
    try {
        const result = await sms.finishOrder(req.body.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Resend SMS
router.post('/api/orders/resend', requireAuth, async (req, res) => {
    try {
        const result = await sms.resendSMS(req.body.id);
        res.json(result || { ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Submit laporan
router.post('/api/laporan', requireAuth, async (req, res) => {
    try {
        await submitForm(req.body);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Rekap
router.get('/api/rekap', requireAuth, (req, res) => {
    const { filter, kasir } = req.query;
    let data;
    if (filter === 'hari-ini') data = getRekapHariIni();
    else if (filter === 'kasir' && kasir) data = getRekapByKasir(kasir);
    else data = getRekapSemua();
    res.json(data);
});

// ── STORE: PUBLIC ──────────────────────────────────────────
router.get('/api/store/products', (req, res) => {
    res.json(store.getActiveProducts());
});

router.post('/api/store/orders', rateLimiter({ windowMs: 60 * 1000, max: 10, message: 'Terlalu banyak pesanan. Tunggu sebentar.' }), (req, res) => {
    try {
        // Tolak bila produk auto-deliver tapi stok habis
        const product = store.getProducts().find(p => p.id === req.body.productId);
        if (product && product.autoDeliver && store.getStockCount(product.id) <= 0) {
            return res.status(400).json({ error: 'Stok produk ini sedang habis. Silakan chat WhatsApp kami.' });
        }
        // Verifikasi OTP WhatsApp bila diaktifkan
        if (store.getSettings().otpRequired && wa.isReady() && !otp.isVerified(req.body.customerWA)) {
            return res.status(400).json({ error: 'Nomor WhatsApp belum diverifikasi. Minta & masukkan kode OTP dulu.', needOtp: true });
        }
        const order = store.createOrder(req.body);
        res.json(order);
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// OTP WhatsApp (verifikasi nomor sebelum order)
router.post('/api/store/otp/send', rateLimiter({ windowMs: 60 * 1000, max: 5 }), async (req, res) => {
    try {
        if (!wa.isReady()) return res.status(503).json({ error: 'Verifikasi OTP sedang tidak tersedia' });
        await otp.send(req.body.wa);
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/api/store/otp/verify', rateLimiter({ windowMs: 60 * 1000, max: 10 }), (req, res) => {
    const r = otp.verify(req.body.wa, req.body.code);
    if (!r.ok) return res.status(400).json({ error: r.message });
    res.json({ ok: true });
});

router.get('/api/store/settings', (req, res) => {
    res.json(store.getSettings());
});

// Konfigurasi pembayaran untuk frontend
router.get('/api/store/config', (req, res) => {
    res.json({
        midtransEnabled: midtrans.isConfigured(),
        clientKey: midtrans.getClientKey(),
        isProduction: midtrans.isProduction(),
        otpRequired: !!store.getSettings().otpRequired && wa.isReady(),
    });
});

// Buat transaksi Midtrans untuk sebuah order -> kembalikan snap token
router.post('/api/store/pay', async (req, res) => {
    try {
        const order = store.getOrderById(req.body.orderId);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        if (!midtrans.isConfigured()) return res.status(400).json({ error: 'Pembayaran otomatis belum aktif' });
        const tx = await midtrans.createTransaction({
            orderId: order.id,
            amount: order.finalPrice != null ? order.finalPrice : order.productPrice,
            customerName: order.customerName,
            productName: order.productName,
        });
        res.json({ token: tx.token, redirect_url: tx.redirect_url });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Cek voucher untuk sebuah produk
router.post('/api/store/voucher/check', rateLimiter({ windowMs: 60 * 1000, max: 20 }), (req, res) => {
    const product = store.getProducts().find(p => p.id === req.body.productId);
    if (!product) return res.status(404).json({ valid: false, message: 'Produk tidak ditemukan' });
    res.json(store.validateVoucher(req.body.code, product.price));
});

// Webhook notifikasi dari Midtrans
router.post('/api/store/midtrans/notification', async (req, res) => {
    try {
        if (!midtrans.isConfigured()) return res.status(503).json({ error: 'Payment not configured' });
        const n = req.body;
        if (!midtrans.verifySignature(n)) return res.status(403).json({ error: 'Invalid signature' });
        const order = store.getOrderById(n.order_id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        if (midtrans.isPaid(n)) {
            await deliverOrder(order);
        } else if (['deny', 'cancel', 'expire', 'failure'].includes(n.transaction_status)) {
            store.patchOrder(order.id, { paymentStatus: n.transaction_status.toUpperCase() });
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cek status order (untuk halaman sukses) - butuh accessToken
router.get('/api/store/order-status', (req, res) => {
    const order = store.getOrderById(req.query.id);
    if (!order || order.accessToken !== req.query.token) return res.status(404).json({ error: 'Order tidak ditemukan' });
    res.json({
        id: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        credential: order.status === 'DELIVERED' ? decrypt(order.credential) : null,
    });
});

// Lacak pesanan pakai ID + nomor WhatsApp (untuk pembeli yang tutup browser)
router.post('/api/store/track', rateLimiter({ windowMs: 60 * 1000, max: 15 }), (req, res) => {
    const { orderId, wa: waNum } = req.body;
    const order = store.getOrderById((orderId || '').trim());
    const norm = s => String(s || '').replace(/\D/g, '').replace(/^0/, '62');
    if (!order || norm(order.customerWA) !== norm(waNum)) {
        return res.status(404).json({ error: 'Pesanan tidak ditemukan. Pastikan ID & nomor WhatsApp benar.' });
    }
    res.json({
        id: order.id,
        productName: order.productName,
        productPrice: order.productPrice,
        status: order.status,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        credential: order.status === 'DELIVERED' ? decrypt(order.credential) : null,
    });
});

// ── STORE: ADMIN ───────────────────────────────────────────
router.get('/api/admin/products', requireAuth, (req, res) => {
    res.json(store.getProducts());
});

router.post('/api/admin/products', requireAuth, (req, res) => {
    try { res.json(store.addProduct(req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/api/admin/products/:id', requireAuth, (req, res) => {
    try { res.json(store.updateProduct(req.params.id, req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/api/admin/products/:id', requireAuth, (req, res) => {
    store.deleteProduct(req.params.id);
    res.json({ ok: true });
});

// Stok kredensial per produk
router.get('/api/admin/stock/:productId', requireAuth, (req, res) => {
    const items = store.getStockItems(req.params.productId);
    res.json({ count: items.length, items });
});
router.put('/api/admin/stock/:productId', requireAuth, (req, res) => {
    const count = store.setStock(req.params.productId, req.body.items || []);
    res.json({ ok: true, count });
});
// Ringkasan jumlah stok semua produk
router.get('/api/admin/stock', requireAuth, (req, res) => {
    const stock = store.getStock();
    const out = {};
    for (const k in stock) out[k] = (stock[k] || []).length;
    res.json(out);
});

// Voucher (admin)
router.get('/api/admin/vouchers', requireAuth, (req, res) => res.json(store.getVouchers()));
router.post('/api/admin/vouchers', requireAuth, (req, res) => {
    try { res.json(store.addVoucher(req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/api/admin/vouchers/:code', requireAuth, (req, res) => {
    res.json(store.toggleVoucher(req.params.code, req.body.active));
});
router.delete('/api/admin/vouchers/:code', requireAuth, (req, res) => {
    store.deleteVoucher(req.params.code);
    res.json({ ok: true });
});

// Backup (admin)
router.get('/api/admin/backup/now', requireAuth, (req, res) => res.json(backup.runBackup()));
router.get('/api/admin/backup/download', requireAuth, (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="jagogame-backup-${Date.now()}.json"`);
    res.json(backup.currentSnapshot());
});
router.get('/api/admin/backup/list', requireAuth, (req, res) => res.json(backup.listBackups()));

// Status koneksi WhatsApp
router.get('/api/admin/wa-status', requireAuth, (req, res) => res.json(wa.getStatus()));

// Laporan penjualan
router.get('/api/admin/report', requireAuth, (req, res) => {
    const orders = store.getOrders();
    const paid = orders.filter(o => ['DELIVERED', 'PAID', 'PAID_NO_STOCK'].includes(o.status));
    const rev = o => (o.finalPrice != null ? o.finalPrice : o.productPrice) || 0;
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const sum = arr => arr.reduce((a, o) => a + rev(o), 0);
    const todayOrders = paid.filter(o => (o.paidAt || o.createdAt || '').slice(0, 10) === today);
    const monthOrders = paid.filter(o => (o.paidAt || o.createdAt || '').slice(0, 7) === month);
    const byProduct = {};
    paid.forEach(o => { byProduct[o.productName] = (byProduct[o.productName] || 0) + 1; });
    const best = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));
    res.json({
        totalRevenue: sum(paid), totalOrders: paid.length,
        todayRevenue: sum(todayOrders), todayOrders: todayOrders.length,
        monthRevenue: sum(monthOrders), monthOrders: monthOrders.length,
        pending: orders.filter(o => o.status === 'PENDING').length,
        delivered: orders.filter(o => o.status === 'DELIVERED').length,
        bestSellers: best,
    });
});

// Export pesanan ke CSV
router.get('/api/admin/orders/export.csv', requireAuth, (req, res) => {
    const orders = store.getOrders();
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['ID', 'Tanggal', 'Produk', 'Harga', 'Diskon', 'Total', 'Voucher', 'Customer', 'WhatsApp', 'Status', 'Pembayaran'];
    const rows = orders.map(o => [
        o.id, o.createdAt, o.productName, o.productPrice, o.discount || 0,
        o.finalPrice != null ? o.finalPrice : o.productPrice, o.voucherCode || '',
        o.customerName, o.customerWA, o.status, o.paymentStatus,
    ].map(esc).join(','));
    const csv = '﻿' + [head.map(esc).join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pesanan-jagogame-${Date.now()}.csv"`);
    res.send(csv);
});

// Kirim ulang / kirim manual sebuah order (mis. setelah isi stok)
router.post('/api/admin/orders/:id/deliver', requireAuth, async (req, res) => {
    try {
        const order = store.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        const updated = await deliverOrder({ ...order, status: 'PAID' });
        res.json(updated);
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/api/admin/orders', requireAuth, (req, res) => {
    res.json(store.getOrders());
});

router.put('/api/admin/orders/:id', requireAuth, (req, res) => {
    try { res.json(store.updateOrderStatus(req.params.id, req.body.status)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/api/admin/settings', requireAuth, (req, res) => {
    res.json(store.getSettings());
});

router.put('/api/admin/settings', requireAuth, (req, res) => {
    store.saveSettings(req.body);
    res.json({ ok: true });
});

module.exports = router;
