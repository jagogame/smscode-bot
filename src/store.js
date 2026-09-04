const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./crypto');

// Produk & setting: selalu dari data/ (git), agar update produk langsung berlaku
// Pesanan: di volume auth_info (Railway) agar tidak hilang saat restart
const GIT_DIR = path.join(__dirname, '../data');
const VOL_DIR = fs.existsSync('/app/auth_info') ? '/app/auth_info' : GIT_DIR;

const PRODUCTS_FILE = path.join(GIT_DIR, 'products.json');
const SETTINGS_FILE = path.join(GIT_DIR, 'store-settings.json');
const ORDERS_FILE = path.join(VOL_DIR, 'store-orders.json');
// Stok kredensial akun (sensitif & berubah saat terjual) -> di volume
const STOCK_FILE = path.join(VOL_DIR, 'store-stock.json');
const VOUCHERS_FILE = path.join(VOL_DIR, 'store-vouchers.json');

// Token akses pesanan (dipakai buka /api/store/order-status & lihat kredensial akun) —
// wajib acak kriptografis: Math.random() bisa ditebak/direkonstruksi dari beberapa output.
function randToken() { return crypto.randomBytes(24).toString('hex'); }

function readJSON(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return def; }
}
function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// PRODUCTS
function getProducts() { return readJSON(PRODUCTS_FILE, []); }
function saveProducts(p) { writeJSON(PRODUCTS_FILE, p); }

function addProduct(data) {
    const products = getProducts();
    const type = data.type === 'game_topup' ? 'game_topup' : 'account';
    const product = {
        id: data.id || Date.now().toString(),
        name: data.name,
        description: data.description || '',
        category: data.category || 'Umum',
        price: Number(data.price),
        stock: data.stock === undefined ? -1 : Number(data.stock), // -1 = unlimited
        autoDeliver: data.autoDeliver === true || data.autoDeliver === 'true',
        image: data.image || '',
        active: data.active === undefined ? true : !!data.active,
        createdAt: data.createdAt || new Date().toISOString(),
        type, // 'account' (stok kredensial) | 'game_topup' (kirim otomatis via Digiflazz)
        // Field khusus type=game_topup:
        game: data.game || '',                                   // nama game (untuk grup & label form)
        digiSku: data.digiSku || null,                            // 1 SKU Digiflazz
        digiSkus: Array.isArray(data.digiSkus) ? data.digiSkus : null, // atau beberapa SKU: [{sku, qty}]
        requiresGameId: type === 'game_topup' ? (data.requiresGameId !== false) : false,
        requiresServerId: type === 'game_topup' ? !!data.requiresServerId : false,
        gameIdLabel: data.gameIdLabel || 'User ID',
        serverIdLabel: data.serverIdLabel || 'Zone ID / Server',
    };
    products.push(product);
    saveProducts(products);
    return product;
}

function updateProduct(id, data) {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) throw new Error('Produk tidak ditemukan');
    products[idx] = { ...products[idx], ...data, id };
    saveProducts(products);
    return products[idx];
}

function deleteProduct(id) {
    const products = getProducts();
    const filtered = products.filter(p => p.id !== id);
    saveProducts(filtered);
}

function getActiveProducts() {
    const stock = getStock();
    return getProducts().filter(p => p.active).map(p => ({
        ...p,
        stockCount: Array.isArray(stock[p.id]) ? stock[p.id].length : 0,
    }));
}

// STOCK (kredensial akun untuk auto-delivery)
function getStock() { return readJSON(STOCK_FILE, {}); }
function saveStock(s) { writeJSON(STOCK_FILE, s); }
function getStockCount(productId) {
    const arr = getStock()[productId];
    return Array.isArray(arr) ? arr.length : 0;
}
// Ganti seluruh stok sebuah produk dengan daftar kredensial (disimpan terenkripsi)
function setStock(productId, items) {
    const stock = getStock();
    stock[productId] = (items || []).map(x => String(x).trim()).filter(Boolean).map(encrypt);
    saveStock(stock);
    return stock[productId].length;
}
// Daftar kredensial yang sudah didekripsi (untuk tampilan admin)
function getStockItems(productId) {
    const arr = getStock()[productId];
    return Array.isArray(arr) ? arr.map(decrypt) : [];
}
// Ambil & hapus 1 kredensial (FIFO). Return string terdekripsi atau null bila habis.
function popStock(productId) {
    const stock = getStock();
    const arr = stock[productId];
    if (!Array.isArray(arr) || !arr.length) return null;
    const cred = arr.shift();
    stock[productId] = arr;
    saveStock(stock);
    return decrypt(cred);
}

// VOUCHERS
function getVouchers() { return readJSON(VOUCHERS_FILE, []); }
function saveVouchers(v) { writeJSON(VOUCHERS_FILE, v); }
function addVoucher(data) {
    const vouchers = getVouchers();
    const v = {
        code: String(data.code || '').trim().toUpperCase(),
        type: data.type === 'fixed' ? 'fixed' : 'percent', // percent | fixed
        value: Number(data.value) || 0,
        minPrice: Number(data.minPrice) || 0,
        maxDiscount: Number(data.maxDiscount) || 0, // 0 = tanpa batas (untuk percent)
        usageLimit: Number(data.usageLimit) || 0,    // 0 = tak terbatas
        used: 0,
        active: true,
        createdAt: new Date().toISOString(),
    };
    if (!v.code) throw new Error('Kode voucher wajib diisi');
    if (vouchers.some(x => x.code === v.code)) throw new Error('Kode voucher sudah ada');
    vouchers.push(v);
    saveVouchers(vouchers);
    return v;
}
function deleteVoucher(code) {
    saveVouchers(getVouchers().filter(v => v.code !== String(code).toUpperCase()));
}
function toggleVoucher(code, active) {
    const vouchers = getVouchers();
    const v = vouchers.find(x => x.code === String(code).toUpperCase());
    if (v) { v.active = active; saveVouchers(vouchers); }
    return v;
}
// Validasi voucher untuk sebuah harga. Return {valid, discount, finalPrice, message, code}
function validateVoucher(code, amount) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return { valid: false, message: 'Kode kosong' };
    const v = getVouchers().find(x => x.code === c);
    if (!v || !v.active) return { valid: false, message: 'Voucher tidak ditemukan' };
    if (v.usageLimit > 0 && v.used >= v.usageLimit) return { valid: false, message: 'Voucher sudah habis' };
    if (amount < v.minPrice) return { valid: false, message: `Min. pembelian Rp ${v.minPrice.toLocaleString('id-ID')}` };
    let discount = v.type === 'percent' ? Math.round(amount * v.value / 100) : v.value;
    if (v.type === 'percent' && v.maxDiscount > 0) discount = Math.min(discount, v.maxDiscount);
    discount = Math.min(discount, amount);
    return { valid: true, discount, finalPrice: amount - discount, code: c, message: 'Voucher diterapkan' };
}
function useVoucher(code) {
    if (!code) return;
    const vouchers = getVouchers();
    const v = vouchers.find(x => x.code === String(code).toUpperCase());
    if (v) { v.used = (v.used || 0) + 1; saveVouchers(vouchers); }
}

// FLASH SALE (dari settings)
function getFlashSale() {
    const s = getSettings();
    const f = s.flashSale || {};
    const active = !!f.enabled && f.endsAt && new Date(f.endsAt).getTime() > Date.now();
    return { active, endsAt: f.endsAt || null, percent: Number(f.percent) || 0, text: f.text || 'Flash Sale' };
}

// ORDERS
function getOrders() { return readJSON(ORDERS_FILE, []); }
function saveOrders(o) { writeJSON(ORDERS_FILE, o); }
function countDeliveredByWA(wa) {
    const n = String(wa || '').replace(/\D/g, '').replace(/^0/, '62');
    return getOrders().filter(o => o.status === 'DELIVERED' && String(o.customerWA || '').replace(/\D/g, '').replace(/^0/, '62') === n).length;
}

function createOrder(data) {
    const products = getProducts();
    const product = products.find(p => p.id === data.productId);
    if (!product) throw new Error('Produk tidak ditemukan');
    if (!product.active) throw new Error('Produk tidak tersedia');
    if (!data.customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.customerEmail)) throw new Error('Email wajib diisi dengan format yang valid');

    // Topup game: wajib isi Game ID (& Server ID bila game-nya butuh)
    const gameId = String(data.gameId || '').trim();
    const serverId = String(data.serverId || '').trim();
    if (product.type === 'game_topup') {
        if (product.requiresGameId && !gameId) throw new Error(`${product.gameIdLabel || 'Game ID'} wajib diisi`);
        if (product.requiresServerId && !serverId) throw new Error(`${product.serverIdLabel || 'Server ID'} wajib diisi`);
    }

    // Diskon: ambil yang TERBAIK antara voucher / flash sale / loyalty
    const base = product.price;
    let discount = 0, voucherCode = null, discountType = null;
    // Voucher
    if (data.voucherCode) {
        const vr = validateVoucher(data.voucherCode, base);
        if (!vr.valid) throw new Error('Voucher: ' + vr.message);
        if (vr.discount > discount) { discount = vr.discount; voucherCode = vr.code; discountType = 'voucher'; }
    }
    // Flash sale (store-wide, dari settings)
    const fs = getFlashSale();
    if (fs.active && fs.percent > 0) {
        const d = Math.round(base * fs.percent / 100);
        if (d > discount) { discount = d; voucherCode = null; discountType = 'flashsale'; }
    }
    // Loyalty: pembeli berulang (WA pernah order DELIVERED)
    const settings = getSettings();
    const loyP = Number(settings.loyaltyPercent) || 0;
    if (loyP > 0 && data.customerWA && countDeliveredByWA(data.customerWA) > 0) {
        const d = Math.round(base * loyP / 100);
        if (d > discount) { discount = d; voucherCode = null; discountType = 'loyalty'; }
    }
    const finalPrice = base - discount;

    const orders = getOrders();
    const order = {
        id: 'ORD-' + Date.now(),
        accessToken: randToken(),
        productId: product.id,
        productName: product.name,
        productPrice: product.price,
        voucherCode,
        discount,
        discountType,
        finalPrice,
        category: product.category,
        customerName: data.customerName,
        customerEmail: data.customerEmail || '',
        customerWA: data.customerWA || '',
        notes: data.notes || '',
        productType: product.type,
        gameId: product.type === 'game_topup' ? gameId : null,
        serverId: product.type === 'game_topup' ? serverId : null,
        status: 'PENDING',          // PENDING -> PAID -> DELIVERED (atau PAID_NO_STOCK / PAID_TOPUP_FAILED)
        paymentStatus: 'UNPAID',
        credential: null,
        createdAt: new Date().toISOString(),
        paidAt: null,
        deliveredAt: null,
        confirmedAt: null,
    };
    orders.push(order);
    saveOrders(orders);
    return order;
}

function getOrderById(id) {
    return getOrders().find(o => o.id === id) || null;
}

function patchOrder(id, patch) {
    const orders = getOrders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) throw new Error('Order tidak ditemukan');
    orders[idx] = { ...orders[idx], ...patch };
    saveOrders(orders);
    return orders[idx];
}

function updateOrderStatus(id, status) {
    const orders = getOrders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) throw new Error('Order tidak ditemukan');
    orders[idx].status = status;
    if (status === 'CONFIRMED') orders[idx].confirmedAt = new Date().toISOString();
    saveOrders(orders);
    return orders[idx];
}

// SETTINGS (QRIS, rekening)
function getSettings() {
    return readJSON(SETTINGS_FILE, {
        qrisImage: '',
        bankName: 'BCA',
        bankAccount: '',
        bankHolder: 'Jago Game',
        whatsapp: '',
        storeName: 'Jago Game',
        storeDesc: 'Toko digital terpercaya — YouTube Premium, Gemini Pro, Mobile Legend',
    });
}
function saveSettings(data) {
    const current = getSettings();
    writeJSON(SETTINGS_FILE, { ...current, ...data });
}

module.exports = {
    getProducts, addProduct, updateProduct, deleteProduct, getActiveProducts,
    getOrders, createOrder, updateOrderStatus, getOrderById, patchOrder,
    getStock, getStockCount, setStock, getStockItems, popStock,
    getVouchers, addVoucher, deleteVoucher, toggleVoucher, validateVoucher, useVoucher,
    getFlashSale, countDeliveredByWA,
    getSettings, saveSettings,
};
