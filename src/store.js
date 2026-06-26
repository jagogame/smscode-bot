const fs = require('fs');
const path = require('path');

const PRODUCTS_FILE = path.join(__dirname, '../data/products.json');
const ORDERS_FILE = path.join(__dirname, '../data/store-orders.json');
const SETTINGS_FILE = path.join(__dirname, '../data/store-settings.json');

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
        productId: product.id,
        productName: product.name,
        productPrice: product.price,
        category: product.category,
        customerName: data.customerName,
        customerWA: data.customerWA,
        notes: data.notes || '',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        confirmedAt: null,
    };
    orders.push(order);
    saveOrders(orders);
    return order;
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
    getOrders, createOrder, updateOrderStatus,
    getSettings, saveSettings,
};
