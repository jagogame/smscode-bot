const axios = require('axios');
require('dotenv').config();

const api = axios.create({
    baseURL: process.env.SMSCODE_BASE_URL || 'https://api.smscode.gg/v1',
    headers: {
        Authorization: `Bearer ${process.env.SMSCODE_API_TOKEN}`,
        'Content-Type': 'application/json',
    },
});

async function getBalance() {
    const res = await api.get('/balance');
    return res.data.data;
}

async function getCountries() {
    const res = await api.get('/catalog/countries');
    return res.data.data;
}

async function getServices(countryCode) {
    const params = countryCode ? { country: countryCode } : {};
    const res = await api.get('/catalog/services', { params });
    return res.data.data;
}

async function getProducts({ country, service, page = 1, limit = 10 } = {}) {
    const res = await api.get('/catalog/products', {
        params: { country, service, page, limit },
    });
    return res.data.data;
}

async function createOrder(catalogProductId) {
    const res = await api.post('/orders/create', { catalog_product_id: catalogProductId });
    return res.data.data.orders[0];
}

async function getOrder(id) {
    const res = await api.get(`/orders/${id}`);
    return res.data.data;
}

async function getActiveOrders() {
    const res = await api.get('/orders/active');
    return res.data.data;
}

async function cancelOrder(id) {
    const res = await api.post('/orders/cancel', { id });
    return res.data.data;
}

async function finishOrder(id) {
    const res = await api.post('/orders/finish', { id });
    return res.data.data;
}

async function resendSMS(id) {
    const res = await api.post('/orders/resend', { id });
    return res.data.data;
}

module.exports = {
    getBalance,
    getCountries,
    getServices,
    getProducts,
    createOrder,
    getOrder,
    getActiveOrders,
    cancelOrder,
    finishOrder,
    resendSMS,
};
