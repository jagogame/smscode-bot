'use strict';
// Read-only view of the Kentford ERP product catalog (products/categories/brands/stock),
// so the bot only ever talks about real data entered in the ERP — never invented data.
const fs = require('fs');

const DB_FILE = process.env.ERP_DB_FILE || '/root/kentford-erp-auth/data/db.json';

function readErpStore() {
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const data = JSON.parse(raw);
  return data.store || {};
}

// Returns { text, count } — text is a plain-language catalog listing for the Claude system
// prompt, count is how many active products it found (0 means the ERP has no catalog yet).
function buildCatalogText() {
  let store;
  try {
    store = readErpStore();
  } catch (e) {
    return { text: '(Katalog produk tidak bisa diakses saat ini — error teknis.)', count: 0 };
  }

  const products = (store.products || []).filter((p) => p.active !== false);
  if (products.length === 0) {
    return { text: '(Belum ada produk yang terdaftar di sistem ERP.)', count: 0 };
  }

  const catById = Object.fromEntries((store.categories || []).map((c) => [c.id, c.name]));
  const brandById = Object.fromEntries((store.brands || []).map((b) => [b.id, b.name]));
  const stockByProduct = {};
  for (const s of store.stock || []) {
    stockByProduct[s.productId] = (stockByProduct[s.productId] || 0) + (Number(s.qty) || 0);
  }

  const lines = products.map((p) => {
    const brand = brandById[p.brandId] || '';
    const cat = catById[p.catId] || '';
    const qty = stockByProduct[p.id] || 0;
    const price = p.price ? `Rp${Number(p.price).toLocaleString('id-ID')}` : 'harga belum diisi';
    return [
      `- SKU ${p.sku} | ${p.name}`,
      `  Jenis: ${p.kind}${cat ? ` (${cat})` : ''}${brand ? `, Merek: ${brand}` : ''}`,
      p.capacity ? `  Kapasitas: ${p.capacity}` : null,
      `  Harga jual: ${price} / ${p.uom || 'unit'}`,
      `  Stok tersedia: ${qty} ${p.uom || 'unit'}`,
      p.warranty ? `  Garansi: ${p.warranty} bulan` : null,
      p.condition ? `  Kondisi: ${p.condition}` : null,
    ].filter(Boolean).join('\n');
  });

  return { text: lines.join('\n\n'), count: products.length };
}

module.exports = { buildCatalogText };
