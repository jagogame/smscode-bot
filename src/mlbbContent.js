// Generator konten jualan akun MLBB (Mobile Legends)
// Dari data akun terstruktur → judul listing, deskripsi, promo WhatsApp, caption marketplace.
// Format judul mengikuti listing yang sudah ada di data/products.json:
//   ML #438 | Skin 529 | Mega Collector 4 | 1 Legend | Soul Vessel Benedetta | All Star Moskov

const ML_CATEGORY = 'Mobile Legend';

// Nomor akun berikutnya: cari "ML #<angka>" terbesar di produk ML yang ada, +1
function nextAccountNumber(products) {
    let max = 0;
    for (const p of products || []) {
        const m = /ML\s*#(\d+)/i.exec(p.name || '');
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
}

// Pecah teks "a, b, c" atau baris-per-baris jadi array bersih
function splitList(text) {
    if (Array.isArray(text)) return text.map(s => String(s).trim()).filter(Boolean);
    return String(text || '')
        .split(/[\n,]/)
        .map(s => s.trim())
        .filter(Boolean);
}

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

function buildTitle(d) {
    const parts = [`ML #${d.number}`];
    if (d.totalSkins) parts.push(`Skin ${d.totalSkins}`);
    if (d.collectorTitle) parts.push(d.collectorTitle);
    if (d.legendCount > 0) parts.push(`${d.legendCount} Legend`);
    parts.push(...d.highlights.slice(0, 3));
    return parts.join(' | ');
}

function buildDescription(d) {
    const skins = d.skinList.length ? d.skinList : d.highlights;
    let desc = skins.join(', ');
    const extra = [];
    if (d.rank) extra.push(`Rank ${d.rank}`);
    if (d.heroCount) extra.push(`${d.heroCount} Hero`);
    if (d.winrate) extra.push(`WR ${d.winrate}%`);
    if (d.notes) extra.push(d.notes);
    if (extra.length) desc += (desc ? '. ' : '') + extra.join(' • ');
    return desc;
}

function buildWaPromo(d, settings) {
    const s = settings || {};
    const lines = [
        '🔥 *AKUN ML READY!* 🔥',
        '',
        `✨ *${d.title}*`,
        '',
    ];
    const stat = [];
    if (d.rank) stat.push(`🏆 Rank: ${d.rank}`);
    if (d.heroCount) stat.push(`🎮 Hero: ${d.heroCount}${d.winrate ? ` | WR ${d.winrate}%` : ''}`);
    else if (d.winrate) stat.push(`🎯 Winrate: ${d.winrate}%`);
    if (d.totalSkins) stat.push(`👑 Total Skin: ${d.totalSkins}`);
    if (d.legendCount > 0) stat.push(`🌟 Skin Legend: ${d.legendCount}`);
    if (stat.length) lines.push(...stat, '');
    if (d.highlights.length) lines.push(`⭐ Highlight: ${d.highlights.join(', ')}`, '');
    lines.push(`💰 *Harga: ${rp(d.price)}*`, '');
    if (d.notes) lines.push(`📝 ${d.notes}`, '');
    lines.push('📦 Full akses — bisa ganti email & password', '🛡️ Garansi aman, proses cepat', '');
    lines.push('🛒 Order: https://www.jagogame.store');
    if (s.whatsapp) lines.push(`📱 WA: wa.me/${String(s.whatsapp).replace(/\D/g, '')}`);
    return lines.join('\n');
}

function buildCaption(d) {
    const bits = [`AKUN ML #${d.number} READY!`];
    if (d.totalSkins) bits.push(`${d.totalSkins} skin`);
    if (d.collectorTitle) bits.push(d.collectorTitle);
    if (d.legendCount > 0) bits.push(`${d.legendCount} Legend`);
    if (d.rank) bits.push(`Rank ${d.rank}`);
    const head = bits.join(' • ');
    const hl = d.highlights.length ? `\nHighlight: ${d.highlights.join(', ')}` : '';
    return `${head}${hl}\nHarga: ${rp(d.price)} (nego tipis)\nMinat? Chat langsung / order di jagogame.store\n\n#MLBB #AkunML #JualAkunML #MobileLegends #AkunMLMurah #JagoGame`;
}

// Normalisasi input mentah dari form/API → data siap generate
function normalize(input, products) {
    const number = Number(input.number) || nextAccountNumber(products);
    return {
        number,
        totalSkins: Number(input.totalSkins) || 0,
        collectorTitle: String(input.collectorTitle || '').trim(),
        legendCount: Number(input.legendCount) || 0,
        highlights: splitList(input.highlights),
        skinList: splitList(input.skinList),
        rank: String(input.rank || '').trim(),
        heroCount: Number(input.heroCount) || 0,
        winrate: String(input.winrate || '').trim(),
        notes: String(input.notes || '').trim(),
        price: Number(input.price) || 0,
    };
}

// Generate semua konten. `products` dipakai untuk auto-nomor, `settings` untuk kontak toko.
function generateContent(input, products, settings) {
    const d = normalize(input, products);
    if (!d.totalSkins) throw new Error('Jumlah total skin wajib diisi');
    if (!d.price) throw new Error('Harga wajib diisi');
    d.title = String(input.title || '').trim() || buildTitle(d);
    return {
        number: d.number,
        title: d.title,
        description: buildDescription(d),
        waPromo: buildWaPromo(d, settings),
        caption: buildCaption(d),
        price: d.price,
    };
}

module.exports = { generateContent, nextAccountNumber, ML_CATEGORY };
