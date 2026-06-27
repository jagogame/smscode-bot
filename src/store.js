const fs = require('fs');
const path = require('path');

// Produk & setting: selalu dari data/ (git), agar update produk langsung berlaku
// Pesanan: di volume auth_info (Railway) agar tidak hilang saat restart
const GIT_DIR = path.join(__dirname, '../data');
const VOL_DIR = fs.existsSync('/app/auth_info') ? '/app/auth_info' : GIT_DIR;

const PRODUCTS_FILE = path.join(GIT_DIR, 'products.json');
const SETTINGS_FILE = path.join(GIT_DIR, 'store-settings.json');
const ORDERS_FILE = path.join(VOL_DIR, 'store-orders.json');
// Stok kredensial akun (sensitif & berubah saat terjual) -> di volume
const STOCK_FILE = path.join(VOL_DIR, 'store-stock.json');

function randToken() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); }

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
    const product = {
        id: Date.now().toString(),
        name: data.name,
        description: data.description || '',
        category: data.category || 'Umum',
        price: Number(data.price),
        stock: data.stock === undefined ? -1 : Number(data.stock), // -1 = unlimited
        image: data.image || '',
        active: true,
        createdAt: new Date().toISOString(),
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

function getActiveProducts() { return getProducts().filter(p => p.active); }

// STOCK (kredensial akun untuk auto-delivery)
function getStock() { return readJSON(STOCK_FILE, {}); }
function saveStock(s) { writeJSON(STOCK_FILE, s); }
function getStockCount(productId) {
    const arr = getStock()[productId];
    return Array.isArray(arr) ? arr.length : 0;
}
// Ganti seluruh stok sebuah produk dengan daftar kredensial (1 baris kosong dipisah --- atau newline ganda)
function setStock(productId, items) {
    const stock = getStock();
    stock[productId] = (items || []).map(x => String(x).trim()).filter(Boolean);
    saveStock(stock);
    return stock[productId].length;
}
// Ambil & hapus 1 kredensial (FIFO). Return string atau null bila habis.
function popStock(productId) {
    const stock = getStock();
    const arr = stock[productId];
    if (!Array.isArray(arr) || !arr.length) return null;
    const cred = arr.shift();
    stock[productId] = arr;
    saveStock(stock);
    return cred;
}

// ORDERS
function getOrders() { return readJSON(ORDERS_FILE, []); }
function saveOrders(o) { writeJSON(ORDERS_FILE, o); }

function createOrder(data) {
    const products = getProducts();
    const product = products.find(p => p.id === data.productId);
    if (!product) throw new Error('Produk tidak ditemukan');
    if (!product.active) throw new Error('Produk tidak tersedia');

    const orders = getOrders();
    const order = {
        id: 'ORD-' + Date.now(),
        accessToken: randToken(),
        productId: product.id,
        productName: product.name,
        productPrice: product.price,
        category: product.category,
        customerName: data.customerName,
        customerWA: data.customerWA,
        notes: data.notes || '',
        status: 'PENDING',          // PENDING -> PAID -> DELIVERED (atau PAID_NO_STOCK)
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
    getStock, getStockCount, setStock, popStock,
    getSettings, saveSettings,
};
