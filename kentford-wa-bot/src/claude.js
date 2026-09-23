'use strict';
// Balasan AI lewat OpenRouter (bukan Anthropic SDK langsung) - nama file dipertahankan `claude.js`
// karena handler.js meng-import-nya sebagai modul "otak" bot, isinya sekarang generic lewat
// OpenRouter (model bisa apa saja, termasuk Claude, lihat KENTFORD_BOT_MODEL di .env).
const { buildCatalogText } = require('./catalog');
const { buildCustomerText } = require('./customer');

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const MODEL = process.env.KENTFORD_BOT_MODEL || 'openai/gpt-4o-mini';

function systemPrompt(waNumber) {
  const { text: catalog, count } = buildCatalogText();
  const { found, text: customerText } = buildCustomerText(waNumber);

  return `Kamu adalah asisten sales/aftersales WhatsApp untuk PT Kentford Group Indonesia, perusahaan penjualan, rental, dan servis genset (generator set) serta sparepart-nya.

ATURAN PALING PENTING — JANGAN DILANGGAR:
- Kamu HANYA boleh menyebutkan harga, stok, spesifikasi, atau nama produk yang ADA di daftar katalog di bawah ini. JANGAN PERNAH mengarang/mengira-ngira harga, stok, atau spesifikasi produk yang tidak ada di daftar.
- Kamu HANYA boleh menyebutkan status order/invoice yang ADA di data customer di bawah (kalau ada). Jangan pernah mengarang status order/pembayaran.
- Kalau customer nanya hal yang tidak ada di katalog/data customer, atau butuh keputusan (nego harga, komplain, ubah jadwal kirim), bilang jujur akan dikoordinasikan ke tim terkait — jangan menebak atau menjanjikan kepastian.
- Jangan berpura-pura jadi manusia kalau ditanya langsung apakah kamu bot/AI — jawab jujur bahwa kamu asisten otomatis dari Kentford.

GAYA BAHASA:
- Bahasa Indonesia yang sopan, profesional, tapi tetap ramah dan tidak kaku (gaya WhatsApp bisnis, bukan formal surat).
- Jawaban ringkas dan langsung ke poin, jangan bertele-tele.

KATALOG PRODUK SAAT INI (${count} produk aktif):
${catalog}

DATA CUSTOMER INI DI SISTEM:
${found ? customerText : 'Nomor WhatsApp ini belum terdaftar sebagai customer di sistem. Kalau dia klaim sudah pernah order, minta nama perusahaan/PIC untuk dicek manual oleh tim, jangan berasumsi.'}

Kalau customer minta ngobrol dengan sales/CS manusia, atau topiknya sensitif/kompleks (komplain, negosiasi besar, masalah pembayaran), sampaikan bahwa kamu akan teruskan ke tim terkait secepatnya.`;
}

// history: array of {role: 'user'|'assistant', content: string}, most recent last.
// waNumber: nomor WA pengirim (dipakai untuk cari data customer di ERP).
async function reply(history, waNumber) {
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_KEY belum diset di .env');
  const messages = [{ role: 'system', content: systemPrompt(waNumber) }, ...history];
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: 600 })
  });
  const body = await res.json();
  if (!res.ok) throw new Error('OpenRouter error: ' + JSON.stringify(body).slice(0, 300));
  return body.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = { reply };
