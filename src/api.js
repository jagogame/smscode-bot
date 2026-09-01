const express = require('express');
const path = require('path');
const auth = require('./auth');
const { login, getSession, logout } = auth;
const audit = require('./audit');
const sms = require('./smscode');
const { submitForm, getRekapHariIni, getRekapSemua, getRekapByKasir } = require('./sales');
const store = require('./store');
const midtrans = require('./midtrans');
const digiflazz = require('./digiflazz');
const wa = require('./wa');
const backup = require('./backup');
const otp = require('./otp');
const { encrypt, decrypt } = require('./crypto');

const router = express.Router();

// Kunci untuk cegah double-delivery order yang sama (mis. webhook ganda)
const delivering = new Set();

// Kirim invoice sukses + notif admin (dipakai oleh kedua jalur pengiriman)
async function notifySuccess(order, detailText) {
    const settings = store.getSettings();
    if (wa.isReady()) {
        const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
        let inv = `✅ *PEMBAYARAN BERHASIL — Jago Game*\n\nTerima kasih ${order.customerName}! 🎉\n\n🧾 *INVOICE*\nID: ${order.id}\nProduk: ${order.productName}\nHarga: ${rp(order.productPrice)}`;
        if (order.discount > 0) inv += `\nDiskon${order.voucherCode ? ' (' + order.voucherCode + ')' : ''}: -${rp(order.discount)}`;
        inv += `\n*Total Bayar: ${rp(order.finalPrice != null ? order.finalPrice : order.productPrice)}*\nStatus: LUNAS ✅\n\n━━━━━━━━━━━━━━\n${detailText}\n━━━━━━━━━━━━━━\n\nAda kendala? Balas chat ini. 🙏`;
        wa.sendText(order.customerWA, inv).catch(() => {});
    }
    if (settings.whatsapp && wa.isReady()) {
        wa.sendText(settings.whatsapp, `💰 TERJUAL!\n${order.productName}\nRp ${Number(order.productPrice).toLocaleString('id-ID')}\nPembeli: ${order.customerName} (${order.customerWA})`).catch(() => {});
    }
    try { require('./push').send({ title: '💰 Transaksi selesai', body: `${order.productName} — ${order.customerName}`, url: '/app' }, u => u.role === 'admin').catch(() => {}); } catch (_) {}
}

// Kirim topup game otomatis via Digiflazz
async function deliverTopup(order) {
    const settings = store.getSettings();
    const product = store.getProducts().find(p => p.id === order.productId);
    const customerNo = String(order.gameId || '') + String(order.serverId || '');

    if (!digiflazz.isConfigured()) {
        const updated = store.patchOrder(order.id, { status: 'PAID_NO_STOCK', paymentStatus: 'PAID', paidAt: new Date().toISOString() });
        if (settings.whatsapp && wa.isReady()) {
            wa.sendText(settings.whatsapp, `⚠️ TOPUP MANUAL DIPERLUKAN\nDigiflazz belum dikonfigurasi.\nPesanan ${order.id} (${order.productName}) sudah LUNAS.\nID: ${order.gameId}${order.serverId ? ' / ' + order.serverId : ''}\nPembeli: ${order.customerName} (${order.customerWA})`).catch(() => {});
        }
        return updated;
    }
    if (!product || !customerNo) {
        const updated = store.patchOrder(order.id, { status: 'PAID_NO_STOCK', paymentStatus: 'PAID', paidAt: new Date().toISOString() });
        if (settings.whatsapp && wa.isReady()) {
            wa.sendText(settings.whatsapp, `⚠️ TOPUP GAGAL — data tidak lengkap\nPesanan ${order.id} (${order.productName}) sudah LUNAS tapi produk/Game ID tidak valid. Kirim manual.\nPembeli: ${order.customerName} (${order.customerWA})`).catch(() => {});
        }
        return updated;
    }

    const baseRefId = `jg-store-${order.id}-${Date.now()}`;
    let result;
    try {
        result = await digiflazz.multiTopup(product, customerNo, baseRefId);
    } catch (err) {
        result = { success: false, results: [{ status: 'Error', message: err.message }], totalPurchases: 0 };
    }

    const okCount = result.results.filter(r => r.status === 'Sukses').length;
    const pendingCount = result.results.filter(r => r.status === 'Pending').length;
    const failed = result.results.filter(r => r.status !== 'Sukses' && r.status !== 'Pending');

    if (okCount > 0 && failed.length === 0) {
        // Semua sukses (Pending dianggap masih diproses Digiflazz, tetap tandai terkirim)
        const sns = result.results.map(r => r.sn).filter(Boolean).join(', ');
        const updated = store.patchOrder(order.id, {
            status: 'DELIVERED', paymentStatus: 'PAID',
            credential: encrypt(`Topup ke ID ${order.gameId}${order.serverId ? ' (' + order.serverId + ')' : ''}${sns ? ' — SN: ' + sns : ''}`),
            paidAt: new Date().toISOString(), deliveredAt: new Date().toISOString(),
        });
        if (order.voucherCode) store.useVoucher(order.voucherCode);
        await notifySuccess(order, `📦 *TOPUP BERHASIL*\n\nID: ${order.gameId}${order.serverId ? ' / Server: ' + order.serverId : ''}\nProduk sudah masuk ke akun kamu.${pendingCount ? '\n(Sebagian item masih diproses sistem, akan otomatis masuk beberapa menit lagi.)' : ''}`);
        return updated;
    }

    // Gagal total atau sebagian gagal -> perlu tindakan admin
    const updated = store.patchOrder(order.id, { status: 'PAID_NO_STOCK', paymentStatus: 'PAID', paidAt: new Date().toISOString() });
    if (settings.whatsapp && wa.isReady()) {
        const errMsg = failed.map(f => f.message).filter(Boolean).join('; ') || 'Tidak diketahui';
        wa.sendText(settings.whatsapp, `❌ TOPUP GAGAL (${okCount} sukses, ${failed.length} gagal)\nPesanan ${order.id} — ${order.productName}\nID: ${order.gameId}${order.serverId ? ' / ' + order.serverId : ''}\nPembeli: ${order.customerName} (${order.customerWA})\nError: ${errMsg}\n\nCek saldo Digiflazz & kirim manual bila perlu.`).catch(() => {});
    }
    return updated;
}

// Kirim produk otomatis setelah pembayaran lunas
async function deliverOrder(order) {
    // Selalu baca status terbaru dari penyimpanan
    const fresh = store.getOrderById(order.id) || order;
    if (fresh.status === 'DELIVERED') return fresh;
    if (delivering.has(order.id)) return fresh;
    delivering.add(order.id);
    try {
    if (order.productType === 'game_topup' || fresh.productType === 'game_topup') {
        return await deliverTopup({ ...fresh, ...order });
    }
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
    await notifySuccess(order, `📦 *DETAIL AKUN KAMU:*\n\n${cred}\n\nSimpan baik-baik & segera ganti email/password.`);
    if (settings.whatsapp && wa.isReady()) {
        wa.sendText(settings.whatsapp, `Sisa stok: ${store.getStockCount(order.productId)}`).catch(() => {});
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

// Middleware khusus admin — dipakai SETELAH requireAuth, cek role di atas sesi yang sudah diverifikasi
function requireAdmin(req, res, next) {
    if (!req.session || req.session.role !== 'admin') {
        return res.status(403).json({ error: 'Khusus admin' });
    }
    next();
}

// Security headers dasar
router.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // HSTS: paksa browser selalu pakai HTTPS selama 1 tahun (termasuk subdomain)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Subdomain cekskin.jagogame.store: root diarahkan ke tool deskripsi skin,
// bukan homepage toko akun ML. Domain lain tidak terpengaruh.
router.get('/', (req, res, next) => {
    const host = String(req.hostname || '').toLowerCase();
    if (host === 'cekskin.jagogame.store') {
        return res.sendFile(path.join(__dirname, '../public/desk-bookmarklet.html'));
    }
    next();
});

// Static files
router.use(express.static(path.join(__dirname, '../public')));
router.use(express.json({ limit: '256kb' }));

// Admin panel
router.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Toko topup (Codashop-style)
router.get('/store', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/store.html'));
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

// Login (maks 8 percobaan / 5 menit). 2FA via WhatsApp bila ADMIN_2FA=true
const loginLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 8, message: 'Terlalu banyak percobaan login. Tunggu 5 menit.' });
router.post('/api/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    const user = auth.checkCredentials(username, password);
    if (!user) { audit.log({ headers: req.headers, session: { username } }, 'LOGIN_GAGAL', String(username || '')); return res.status(401).json({ error: 'Username atau password salah' }); }
    // 2FA: kirim OTP ke WhatsApp admin (dari settings)
    const adminWA = store.getSettings().whatsapp;
    if (auth.twoFAEnabled() && wa.isReady() && adminWA) {
        try { await otp.send(adminWA); } catch (e) { return res.status(500).json({ error: 'Gagal kirim OTP: ' + e.message }); }
        return res.json({ twofa: true });
    }
    const token = auth.issueToken(user);
    audit.log({ headers: req.headers, session: user }, 'LOGIN', '');
    res.json({ token, role: user.role, name: user.name });
});

// Verifikasi OTP 2FA admin -> terbitkan token
router.post('/api/login/2fa', loginLimiter, (req, res) => {
    const { username, password, code } = req.body;
    const user = auth.checkCredentials(username, password);
    if (!user) return res.status(401).json({ error: 'Sesi tidak valid, ulangi login' });
    const adminWA = store.getSettings().whatsapp;
    const v = otp.verify(adminWA, code);
    if (!v.ok) return res.status(400).json({ error: v.message });
    const token = auth.issueToken(user);
    audit.log({ headers: req.headers, session: user }, 'LOGIN_2FA', '');
    res.json({ token, role: user.role, name: user.name });
});

// Logout
router.post('/api/logout', requireAuth, (req, res) => {
    const token = req.headers['x-token'];
    logout(token);
    res.json({ ok: true });
});

// Saldo
router.get('/api/saldo', requireAuth, requireAdmin, async (req, res) => {
    try {
        const bal = await sms.getBalance();
        res.json(bal);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Order aktif
router.get('/api/orders/active', requireAuth, requireAdmin, async (req, res) => {
    try {
        const orders = await sms.getActiveOrders();
        res.json(orders || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Cek order
router.get('/api/orders/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const order = await sms.getOrder(req.params.id);
        res.json(order);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Beli nomor
router.post('/api/orders/buy', requireAuth, requireAdmin, async (req, res) => {
    try {
        const order = await sms.createOrder(6220);
        res.json(order);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Cancel order
router.post('/api/orders/cancel', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await sms.cancelOrder(req.body.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Finish order
router.post('/api/orders/finish', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await sms.finishOrder(req.body.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Resend SMS
router.post('/api/orders/resend', requireAuth, requireAdmin, async (req, res) => {
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
        // Tolak bila produk auto-deliver tapi stok habis (tidak berlaku untuk topup game,
        // yang stoknya bergantung ke saldo Digiflazz, bukan stok kredensial lokal)
        const product = store.getProducts().find(p => p.id === req.body.productId);
        if (product && product.type !== 'game_topup' && product.autoDeliver && store.getStockCount(product.id) <= 0) {
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

// Flash sale publik (untuk countdown bar di frontend)
router.get('/api/store/flash-sale', (req, res) => {
    res.json(store.getFlashSale());
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
router.post('/api/store/pay', rateLimiter({ windowMs: 60 * 1000, max: 15, message: 'Terlalu banyak percobaan pembayaran. Tunggu sebentar.' }), async (req, res) => {
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
router.get('/api/admin/products', requireAuth, requireAdmin, (req, res) => {
    res.json(store.getProducts());
});

router.post('/api/admin/products', requireAuth, requireAdmin, (req, res) => {
    try { const p = store.addProduct(req.body); audit.log(req, 'PRODUK_TAMBAH', p.name); res.json(p); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/api/admin/products/:id', requireAuth, requireAdmin, (req, res) => {
    try { const p = store.updateProduct(req.params.id, req.body); audit.log(req, 'PRODUK_UBAH', p.name); res.json(p); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/api/admin/products/:id', requireAuth, requireAdmin, (req, res) => {
    store.deleteProduct(req.params.id);
    audit.log(req, 'PRODUK_HAPUS', req.params.id);
    res.json({ ok: true });
});

// Stok kredensial per produk
router.get('/api/admin/stock/:productId', requireAuth, requireAdmin, (req, res) => {
    const items = store.getStockItems(req.params.productId);
    res.json({ count: items.length, items });
});
router.put('/api/admin/stock/:productId', requireAuth, requireAdmin, (req, res) => {
    const count = store.setStock(req.params.productId, req.body.items || []);
    audit.log(req, 'STOK_UBAH', `${req.params.productId} -> ${count} akun`);
    res.json({ ok: true, count });
});
// Ringkasan jumlah stok semua produk
router.get('/api/admin/stock', requireAuth, requireAdmin, (req, res) => {
    const stock = store.getStock();
    const out = {};
    for (const k in stock) out[k] = (stock[k] || []).length;
    res.json(out);
});

// Voucher (admin)
router.get('/api/admin/vouchers', requireAuth, requireAdmin, (req, res) => res.json(store.getVouchers()));
router.post('/api/admin/vouchers', requireAuth, requireAdmin, (req, res) => {
    try { const v = store.addVoucher(req.body); audit.log(req, 'VOUCHER_TAMBAH', v.code); res.json(v); }
    catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/api/admin/vouchers/:code', requireAuth, requireAdmin, (req, res) => {
    audit.log(req, 'VOUCHER_TOGGLE', req.params.code);
    res.json(store.toggleVoucher(req.params.code, req.body.active));
});
router.delete('/api/admin/vouchers/:code', requireAuth, requireAdmin, (req, res) => {
    store.deleteVoucher(req.params.code);
    audit.log(req, 'VOUCHER_HAPUS', req.params.code);
    res.json({ ok: true });
});

// Audit log (admin)
router.get('/api/admin/audit', requireAuth, requireAdmin, (req, res) => res.json(audit.recent(150)));

// Backup (admin)
router.get('/api/admin/backup/now', requireAuth, requireAdmin, (req, res) => { audit.log(req, 'BACKUP_MANUAL', ''); res.json(backup.runBackup()); });
router.get('/api/admin/backup/download', requireAuth, requireAdmin, (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="jagogame-backup-${Date.now()}.json"`);
    res.json(backup.currentSnapshot());
});
router.get('/api/admin/backup/list', requireAuth, requireAdmin, (req, res) => res.json(backup.listBackups()));

// Status koneksi WhatsApp
router.get('/api/admin/wa-status', requireAuth, requireAdmin, (req, res) => res.json(wa.getStatus()));

// Saldo Digiflazz (buat topup game otomatis)
router.get('/api/admin/digiflazz/balance', requireAuth, requireAdmin, async (req, res) => {
    if (!digiflazz.isConfigured()) return res.json({ configured: false, balance: null });
    try {
        const balance = await digiflazz.getBalance();
        res.json({ configured: true, balance });
    } catch (e) { res.status(500).json({ configured: true, error: e.message }); }
});


// Laporan penjualan
router.get('/api/admin/report', requireAuth, requireAdmin, (req, res) => {
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
router.get('/api/admin/orders/export.csv', requireAuth, requireAdmin, (req, res) => {
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
router.post('/api/admin/orders/:id/deliver', requireAuth, requireAdmin, async (req, res) => {
    try {
        const order = store.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        const updated = await deliverOrder({ ...order, status: 'PAID' });
        res.json(updated);
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/api/admin/orders', requireAuth, requireAdmin, (req, res) => {
    res.json(store.getOrders());
});

router.put('/api/admin/orders/:id', requireAuth, requireAdmin, (req, res) => {
    try { res.json(store.updateOrderStatus(req.params.id, req.body.status)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
    res.json(store.getSettings());
});

router.put('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
    store.saveSettings(req.body);
    audit.log(req, 'PENGATURAN_UBAH', '');
    res.json({ ok: true });
});

module.exports = router;
