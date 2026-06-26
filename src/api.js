const express = require('express');
const path = require('path');
const { login, getSession, logout } = require('./auth');
const sms = require('./smscode');
const { submitForm, getRekapHariIni, getRekapSemua, getRekapByKasir } = require('./sales');
const store = require('./store');

const router = express.Router();

// Middleware auth
function requireAuth(req, res, next) {
    const token = req.headers['x-token'] || req.query.token;
    const session = getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.session = session;
    next();
}

// Static files
router.use(express.static(path.join(__dirname, '../public')));
router.use(express.json());

// Login
router.post('/api/login', (req, res) => {
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

router.post('/api/store/orders', (req, res) => {
    try {
        const order = store.createOrder(req.body);
        res.json(order);
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/api/store/settings', (req, res) => {
    res.json(store.getSettings());
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
