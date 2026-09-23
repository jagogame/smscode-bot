'use strict';
// Read-only lookup of a customer's order/invoice/piutang status from the Kentford ERP, by
// WhatsApp number — same db.json read pattern as catalog.js, so the bot can answer "gimana
// status order saya" accurately instead of guessing.
const fs = require('fs');

const DB_FILE = process.env.ERP_DB_FILE || '/root/kentford-erp-auth/data/db.json';

function readErpStore() {
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const data = JSON.parse(raw);
  return data.store || {};
}

function normalizePhone(p) {
  return String(p || '').replace(/[^\d]/g, '').replace(/^0/, '62');
}

// Returns { found, text } — text is a plain-language summary for the system prompt, or null
// when no matching customer record exists (bot should say so honestly, not invent one).
function buildCustomerText(waNumber) {
  let store;
  try {
    store = readErpStore();
  } catch (e) {
    return { found: false, text: null };
  }
  const tail = normalizePhone(waNumber).slice(-8);
  const customer = (store.customers || []).find((c) => !c.deletedAt && normalizePhone(c.phone).slice(-8) === tail);
  if (!customer) return { found: false, text: null };

  const so = (store.salesorders || []).filter((r) => r.customerId === customer.id && !r.deletedAt);
  const inv = (store.invoices || []).filter((r) => r.customerId === customer.id && !r.deletedAt && !r.cancelled);
  const outstanding = inv.filter((i) => {
    const paid = (i.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    return paid < Number(i.total || 0) - 0.5;
  });

  const recentOrders = so
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 5)
    .map((o) => `${o.no} (${o.date}, status: ${o.status}, total Rp${Number(o.total || 0).toLocaleString('id-ID')})`);

  const outstandingLines = outstanding.map((i) => {
    const paid = (i.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    return `${i.no} jatuh tempo ${i.dueDate}, sisa tagihan Rp${(Number(i.total || 0) - paid).toLocaleString('id-ID')}`;
  });

  const text = [
    `Nama customer terdaftar: ${customer.name}`,
    recentOrders.length ? `Order terakhir:\n${recentOrders.map((l) => '  - ' + l).join('\n')}` : 'Belum ada order tercatat.',
    outstandingLines.length ? `Invoice belum lunas:\n${outstandingLines.map((l) => '  - ' + l).join('\n')}` : 'Tidak ada invoice yang belum lunas.'
  ].join('\n');

  return { found: true, text };
}

module.exports = { buildCustomerText };
