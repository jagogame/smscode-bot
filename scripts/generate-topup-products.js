// Generate produk topup game (data/products.json) dari daftar harga Digiflazz.
// Jalankan manual: node scripts/generate-topup-products.js <path-ke-pricelist.json>
// Aman dijalankan ulang — semua produk lama dengan id "digi-*" diganti, produk lain (akun) tidak disentuh.
const fs = require('fs');
const path = require('path');

const PRICELIST_PATH = process.argv[2];
if (!PRICELIST_PATH) {
    console.error('Usage: node scripts/generate-topup-products.js <path-ke-digiflazz-pricelist.json>');
    process.exit(1);
}
const PRODUCTS_FILE = path.join(__dirname, '../data/products.json');
const MARGIN = 0.05; // margin minimum 5% di atas harga Digiflazz (tanpa fee gateway, pembayaran manual QRIS/transfer)

// Metadata per brand Digiflazz -> kategori toko, label form, & kebutuhan Server ID.
// requiresServerId=true dipakai untuk game yang butuh 2 info (User ID + Server/Zone) agar transaksi Digiflazz sukses.
// Mobile Legends sudah battle-tested (dipakai integrasi G2G produksi): User ID + Zone ID digabung langsung tanpa separator.
const BRAND_META = {
    'MOBILE LEGENDS': { category: 'Mobile Legends', requiresServerId: true, gameIdLabel: 'User ID', serverIdLabel: 'Zone ID' },
    'FREE FIRE': { category: 'Free Fire', requiresServerId: false, gameIdLabel: 'User ID' },
    'PUBG MOBILE': { category: 'PUBG Mobile', requiresServerId: false, gameIdLabel: 'Player ID' },
    'Call of Duty MOBILE': { category: 'Call of Duty Mobile', requiresServerId: false, gameIdLabel: 'UID (Open ID)' },
    'Valorant': { category: 'Valorant', requiresServerId: false, gameIdLabel: 'Riot ID#Tag (cth: NamaKamu#1234)' },
    'League of Legends Wild Rift': { category: 'League of Legends: Wild Rift', requiresServerId: false, gameIdLabel: 'Riot ID#Tag (cth: NamaKamu#1234)' },
    'Genshin Impact': { category: 'Genshin Impact', requiresServerId: true, gameIdLabel: 'UID', serverIdLabel: 'Server (Asia/America/Europe/TW,HK,MO)' },
    'Honkai Impact 3': { category: 'Honkai Impact 3', requiresServerId: true, gameIdLabel: 'UID', serverIdLabel: 'Server (Asia/America/Europe/TW,HK,MO)' },
    'Honkai Star Rail': { category: 'Honkai Star Rail', requiresServerId: true, gameIdLabel: 'UID', serverIdLabel: 'Server (Asia/America/Europe/TW,HK,MO)' },
    'Honor of Kings': { category: 'Honor of Kings', requiresServerId: true, gameIdLabel: 'User ID', serverIdLabel: 'Server' },
    'ARENA OF VALOR': { category: 'Arena of Valor', requiresServerId: false, gameIdLabel: 'User ID' },
    'AU2 MOBILE': { category: 'AU2 Mobile', requiresServerId: false, gameIdLabel: 'User ID' },
    'Asphalt 9': { category: 'Asphalt 9', requiresServerId: false, gameIdLabel: 'Player ID' },
    'Be The King': { category: 'Be The King', requiresServerId: false, gameIdLabel: 'Player ID' },
    'FC Mobile': { category: 'FC Mobile', requiresServerId: false, gameIdLabel: 'User ID' },
    'GARENA': { category: 'Garena', requiresServerId: false, gameIdLabel: 'User ID' },
    'Heroes Evolved': { category: 'Heroes Evolved', requiresServerId: false, gameIdLabel: 'User ID' },
    'Lords Mobile': { category: 'Lords Mobile', requiresServerId: false, gameIdLabel: 'Player ID' },
    'MU ORIGIN 3': { category: 'MU Origin 3', requiresServerId: false, gameIdLabel: 'User ID' },
    'One Punch Man': { category: 'One Punch Man', requiresServerId: false, gameIdLabel: 'User ID' },
    'POINT BLANK': { category: 'Point Blank', requiresServerId: false, gameIdLabel: 'User ID' },
    'Ragnarok M: Eternal Love': { category: 'Ragnarok M: Eternal Love', requiresServerId: false, gameIdLabel: 'Character ID / Roleplay ID' },
    'Ragnarok Origin': { category: 'Ragnarok Origin', requiresServerId: false, gameIdLabel: 'Character ID / Roleplay ID' },
    'Revelation Infinite Journey': { category: 'Revelation Infinite Journey', requiresServerId: true, gameIdLabel: 'User ID', serverIdLabel: 'Server' },
    'Sausage Man': { category: 'Sausage Man', requiresServerId: false, gameIdLabel: 'User ID' },
    'Speed Drifters': { category: 'Speed Drifters', requiresServerId: false, gameIdLabel: 'User ID' },
    'State of Survival': { category: 'State of Survival', requiresServerId: false, gameIdLabel: 'Player ID' },
    'Stumble Guys': { category: 'Stumble Guys', requiresServerId: false, gameIdLabel: 'User ID' },
    'Super Sus': { category: 'Super Sus', requiresServerId: false, gameIdLabel: 'User ID' },
    'Tom and Jerry : Chase': { category: 'Tom and Jerry: Chase', requiresServerId: false, gameIdLabel: 'User ID' },
    'Tower of Fantasy': { category: 'Tower of Fantasy', requiresServerId: true, gameIdLabel: 'UID', serverIdLabel: 'Server' },
};

// Sebagian besar product_name Digiflazz sudah enak dibaca apa adanya (mis. "AOV 230 Vouchers",
// "Honkai Star Rail 2240 (1980+260) Oneiric Shard (USA)"). Hanya beberapa brand yang menaruh
// nama brand mentah + " - " di depan (mis. "MOBILELEGEND - 112 Diamond") -> dibuang saja.
const STRIP_PREFIX_RE = [/^MOBILELEGEND\s*-\s*/i, /^MU ORIGIN 3\s*-\s*/i];
function cleanName(brand, productName) {
    let n = productName;
    for (const re of STRIP_PREFIX_RE) n = n.replace(re, '');
    return n.trim() || productName;
}

function priceWithMargin(cost) {
    const min = Math.ceil(cost / (1 - MARGIN));
    return Math.ceil(min / 100) * 100; // bulatkan ke atas ke kelipatan Rp100
}

function main() {
    const raw = JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8'));
    const items = raw.data || raw;
    const games = items.filter(i => i.category === 'Games' && i.buyer_product_status && i.seller_product_status
        && !/cek\s*(username|id|akun)/i.test(i.product_name)); // buang SKU utilitas non-topup (mis. "Cek Username")

    const existing = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    const kept = existing.filter(p => !String(p.id).startsWith('digi-'));

    let skipped = 0;
    const generated = [];
    for (const item of games) {
        const meta = BRAND_META[item.brand];
        if (!meta) { skipped++; continue; }
        const cost = Number(item.price) || 0;
        if (cost <= 0) { skipped++; continue; }
        const price = priceWithMargin(cost);
        generated.push({
            id: 'digi-' + item.buyer_sku_code,
            name: cleanName(item.brand, item.product_name),
            description: `${meta.category} — Top Up Otomatis. Isi ${meta.gameIdLabel}${meta.requiresServerId ? ' & ' + meta.serverIdLabel : ''} dengan benar, produk masuk otomatis dalam hitungan menit.`,
            category: meta.category,
            price,
            stock: -1,
            autoDeliver: false, // topup game tidak pakai gerbang stok kredensial lokal
            image: '',
            active: true,
            createdAt: new Date(0).toISOString(),
            type: 'game_topup',
            game: meta.category,
            digiSku: item.buyer_sku_code,
            digiSkus: null,
            requiresGameId: true,
            requiresServerId: meta.requiresServerId,
            gameIdLabel: meta.gameIdLabel,
            serverIdLabel: meta.serverIdLabel || 'Server',
        });
    }

    const merged = [...kept, ...generated];
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(merged, null, 2));

    const byCategory = {};
    generated.forEach(p => { byCategory[p.category] = (byCategory[p.category] || 0) + 1; });
    console.log(`Produk topup dibuat: ${generated.length} (dilewati: ${skipped}, brand tanpa metadata)`);
    console.log(`Produk lama (akun) dipertahankan: ${kept.length}`);
    console.log(`Total produk sekarang: ${merged.length}`);
    console.log('\nPer kategori:');
    for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}`);

    const brandsWithoutMeta = [...new Set(games.filter(i => !BRAND_META[i.brand]).map(i => i.brand))];
    if (brandsWithoutMeta.length) {
        console.log('\nBrand TANPA metadata (dilewati, tidak masuk katalog):');
        brandsWithoutMeta.forEach(b => console.log('  - ' + b));
    }
}
main();
