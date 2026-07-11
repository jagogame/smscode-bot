#!/usr/bin/env node
// Generator konten sosmed (IG + TikTok) untuk akun ML di data/products.json
// Output per akun: feed 1080x1350 (.png), story/tiktok 1080x1920 (.png), caption (.txt)
//
// Pakai:  node scripts/social-content.js                → semua akun ML aktif
//         node scripts/social-content.js --only 438,447 → akun tertentu saja
//         node scripts/social-content.js --no-photos    → tanpa download foto
// Output: ./social-out/  (di-gitignore)
//
// Foto produk di-download dari URL di products.json (CDN itemku) lalu di-embed
// sebagai data URI. Kalau download gagal (mis. jaringan diblokir), kartu
// otomatis pakai desain tanpa foto.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const OUT = path.join(process.cwd(), 'social-out');
const CACHE = path.join(OUT, '.cache');
const CHROME = process.env.CHROME_BIN
    || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const mlbb = require(path.join(REPO, 'src/mlbbContent'));

const argv = process.argv.slice(2);
const NO_PHOTOS = argv.includes('--no-photos');
const onlyArg = argv[argv.indexOf('--only') + 1];
const ONLY = argv.includes('--only') && onlyArg ? onlyArg.split(',').map(s => s.trim()) : null;

const products = JSON.parse(fs.readFileSync(path.join(REPO, 'data/products.json'), 'utf8'));
const settings = JSON.parse(fs.readFileSync(path.join(REPO, 'data/store-settings.json'), 'utf8'));

fs.mkdirSync(CACHE, { recursive: true });

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseName(p) {
    const parts = p.name.split('|').map(s => s.trim());
    const number = (/#(\d+)/.exec(parts[0]) || [])[1] || '?';
    let skins = 0, legend = 0, collector = '';
    const highlights = [];
    for (const part of parts.slice(1)) {
        let m;
        if ((m = /^Skin\s+(\d+)$/i.exec(part))) skins = m[1];
        else if ((m = /^(\d+)\s+Legend$/i.exec(part))) legend = m[1];
        else if (/Collector/i.test(part) && /^\D*\d*$/.test(part.replace(/Collector/i, ''))) collector = part;
        else highlights.push(part);
    }
    const chips = p.description.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
    return { number, skins, legend, collector, highlights, chips, price: p.price };
}

// Download foto pertama produk → data URI (cache di disk). null bila gagal.
async function fetchPhoto(p) {
    if (NO_PHOTOS) return null;
    const url = (p.images || [])[0] || p.image;
    if (!url) return null;
    const cacheFile = path.join(CACHE, p.id + path.extname(new URL(url).pathname || '.jpg'));
    try {
        let buf;
        if (fs.existsSync(cacheFile)) buf = fs.readFileSync(cacheFile);
        else {
            const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            buf = Buffer.from(await r.arrayBuffer());
            fs.writeFileSync(cacheFile, buf);
        }
        const mime = /\.png$/i.test(cacheFile) ? 'image/png' : 'image/jpeg';
        return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (e) {
        console.warn(`  (foto ML gagal diunduh: ${e.message} — pakai desain tanpa foto)`);
        return null;
    }
}

function cardHTML(d, W, H, photo) {
    const story = H > 1500;
    const photoH = photo ? (story ? 880 : 500) : 0;
    const hl = d.highlights.slice(0, photo ? 2 : (story ? 4 : 2));
    const chips = d.chips.slice(0, photo ? (story ? 3 : 2) : (story ? 5 : 3));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;font-family:'DejaVu Sans',sans-serif;color:#EAF2FF;overflow:hidden;
  background:#070B1A;position:relative}
.bg1{position:absolute;width:1400px;height:1400px;border-radius:50%;left:-500px;top:-560px;
  background:radial-gradient(circle,rgba(99,60,255,.42),transparent 65%)}
.bg2{position:absolute;width:1300px;height:1300px;border-radius:50%;right:-560px;bottom:-500px;
  background:radial-gradient(circle,rgba(0,190,255,.30),transparent 65%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(120,140,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(120,140,255,.06) 1px,transparent 1px);background-size:90px 90px}
.photo{position:relative;width:100%;height:${photoH}px;background:url('${photo}') center/cover no-repeat}
.photo .fade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,11,26,.35) 0%,transparent 30%,transparent 55%,#070B1A 100%)}
.photo .top{position:absolute;top:44px;left:64px;right:64px}
.wrap{position:relative;display:flex;flex-direction:column;
  height:${photo ? H - photoH : H}px;padding:${photo ? 0 : (story ? 90 : 48)}px 76px ${story ? 70 : 40}px}
.top{display:flex;justify-content:space-between;align-items:center}
.brand{font-weight:bold;font-size:40px;letter-spacing:6px;text-shadow:0 2px 12px rgba(0,0,0,.8)}
.brand span{color:#38D6FF}
.tag{background:linear-gradient(90deg,#F43F5E,#F97316);padding:14px 30px;border-radius:999px;
  font-weight:bold;font-size:27px;letter-spacing:3px;box-shadow:0 4px 18px rgba(0,0,0,.45)}
.hero{margin-top:${photo ? -30 : (story ? 120 : 44)}px}
.hero .lbl{font-size:${photo ? 26 : 32}px;letter-spacing:12px;color:#8FA3C8}
.hero .num{font-size:${photo ? (story ? 120 : 88) : (story ? 190 : 132)}px;font-weight:bold;line-height:1.05;
  background:linear-gradient(90deg,#7DE3FF,#A78BFA);-webkit-background-clip:text;color:transparent}
.stats{display:flex;gap:${photo ? 20 : 26}px;margin-top:${photo ? 26 : (story ? 64 : 34)}px}
.stat{flex:1;background:rgba(255,255,255,.05);border:2px solid rgba(140,170,255,.25);
  border-radius:22px;padding:${photo ? 14 : (story ? 30 : 22)}px 10px;text-align:center}
.stat .v{font-size:${photo ? 40 : (story ? 64 : 56)}px;font-weight:bold;color:#7DE3FF}
.stat .k{font-size:${photo ? 18 : 24}px;letter-spacing:4px;color:#8FA3C8;margin-top:6px}
.coll{margin-top:${photo ? 20 : (story ? 30 : 24)}px;text-align:center;background:rgba(167,139,250,.14);border:2px solid rgba(167,139,250,.45);
  border-radius:22px;padding:${photo ? 14 : (story ? 24 : 18)}px;font-size:${photo ? 32 : (story ? 42 : 38)}px;font-weight:bold;color:#C4B5FD;letter-spacing:2px}
.hl{margin-top:${photo ? 22 : (story ? 56 : 30)}px;flex:0 1 auto;min-height:0;overflow:hidden}
.hl .t{font-size:26px;letter-spacing:6px;color:#8FA3C8;margin-bottom:16px}
.hl .row{display:flex;flex-wrap:wrap;gap:14px}
.chip{background:rgba(56,214,255,.10);border:2px solid rgba(56,214,255,.35);border-radius:14px;
  padding:${photo ? 12 : 16}px 22px;font-size:${photo ? 26 : (story ? 30 : 28)}px;font-weight:bold}
.chip.gold{background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.5);color:#FCD34D}
.price{margin-top:auto;background:linear-gradient(90deg,#FBBF24,#F59E0B);color:#1F1300;border-radius:26px;
  padding:${photo ? 22 : (story ? 34 : 24)}px 40px;display:flex;justify-content:space-between;align-items:center}
.price .l{font-size:${photo ? 26 : 30}px;font-weight:bold;letter-spacing:3px}
.price .v{font-size:${photo ? 50 : (story ? 74 : 60)}px;font-weight:bold}
.foot{display:flex;justify-content:space-between;margin-top:${photo ? 18 : (story ? 38 : 26)}px;font-size:${photo ? 24 : 28}px;color:#AFC2E4;font-weight:bold}
.foot span b{color:#7DE3FF}
.pad{display:flex;flex-direction:column;flex:1}
</style></head><body>
<div class="bg1"></div><div class="bg2"></div><div class="grid"></div>
${photo ? `
<div class="photo"><div class="fade"></div>
  <div class="top"><div class="brand">JAGO<span>GAME</span></div><div class="tag">AKUN ML READY</div></div>
</div>
<div class="wrap"><div class="pad">` : `
<div class="wrap">
  <div class="top"><div class="brand">JAGO<span>GAME</span></div><div class="tag">AKUN ML READY</div></div>`}
  <div class="hero"><div class="lbl">MOBILE LEGENDS ACCOUNT</div><div class="num">ML #${esc(d.number)}</div></div>
  <div class="stats">
    <div class="stat"><div class="v">${esc(d.skins)}</div><div class="k">TOTAL SKIN</div></div>
    ${d.legend > 0 ? `<div class="stat"><div class="v">${esc(d.legend)}</div><div class="k">LEGEND</div></div>` : ''}
    <div class="stat"><div class="v">${esc(d.chips.length)}+</div><div class="k">SKIN EPIC+</div></div>
  </div>
  ${d.collector ? `<div class="coll">${esc(d.collector.toUpperCase())}</div>` : ''}
  <div class="hl"><div class="t">HIGHLIGHT</div><div class="row">
    ${hl.map(h => `<div class="chip gold">${esc(h)}</div>`).join('')}
    ${chips.map(c => `<div class="chip">${esc(c)}</div>`).join('')}
  </div></div>
  <div class="price"><div class="l">HARGA<br>NEGO TIPIS</div><div class="v">${rp(d.price)}</div></div>
  <div class="foot"><span><b>jagogame.store</b></span><span>WA <b>0813-1778-4126</b></span><span>GARANSI AMAN</span></div>
${photo ? '</div></div>' : '</div>'}</body></html>`;
}

// Chrome headless baru mengambil ±87px dari window-size untuk UI palsunya,
// jadi viewport < window. Ukur selisihnya sekali, lalu kompensasi tiap screenshot.
let VIEWPORT_DELTA = null;
function viewportDelta() {
    if (VIEWPORT_DELTA !== null) return VIEWPORT_DELTA;
    const probe = path.join(OUT, '_probe.html');
    fs.writeFileSync(probe, '<body><script>document.body.textContent="VP:"+innerHeight</script>');
    const dom = execFileSync(CHROME, [
        '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1', '--window-size=1080,1000',
        '--dump-dom', 'file://' + probe,
    ], { stdio: 'pipe' }).toString();
    const m = /VP:(\d+)/.exec(dom);
    VIEWPORT_DELTA = m ? 1000 - Number(m[1]) : 0;
    fs.unlinkSync(probe);
    return VIEWPORT_DELTA;
}

// Crop PNG dari bawah (screenshot chrome = ukuran window, bukan viewport).
// Scanline PNG hanya bergantung baris sebelumnya, jadi aman dipotong dari akhir.
const zlib = require('zlib');
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}
function cropPngHeight(file, newH) {
    const buf = fs.readFileSync(file);
    const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
    if (height <= newH) return;
    const colorType = buf[25];
    const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
    if (!bpp || buf[24] !== 8) throw new Error('Format PNG tidak didukung untuk crop');
    // Kumpulkan semua IDAT
    const idats = [];
    let pos = 8;
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        if (type === 'IDAT') idats.push(buf.subarray(pos + 8, pos + 8 + len));
        pos += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idats));
    const stride = 1 + width * bpp;
    const cropped = zlib.deflateSync(raw.subarray(0, stride * newH), { level: 6 });
    const ihdr = Buffer.from(buf.subarray(16, 16 + 13));
    ihdr.writeUInt32BE(newH, 4);
    fs.writeFileSync(file, Buffer.concat([
        buf.subarray(0, 8),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', cropped),
        pngChunk('IEND', Buffer.alloc(0)),
    ]));
}

function shoot(html, w, h, out) {
    const tmp = path.join(OUT, '_tmp.html');
    fs.writeFileSync(tmp, html);
    if (process.env.DEBUG_HTML) fs.copyFileSync(tmp, out + '.html');
    execFileSync(CHROME, [
        '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1', `--window-size=${w},${h + viewportDelta()}`,
        `--screenshot=${out}`, 'file://' + tmp,
    ], { stdio: 'pipe' });
    cropPngHeight(out, h);
}

function captions(p, d) {
    const gen = mlbb.generateContent({
        title: p.name, number: d.number, totalSkins: d.skins || 1,
        legendCount: d.legend, collectorTitle: d.collector,
        highlights: d.highlights, skinList: p.description, price: p.price,
    }, products, settings);
    const ig = `${gen.caption}\n\n#akunmlbbmurah #jualakunmobilelegends #akunmlready #mlbbindonesia #skinml #reseller`;
    const tt = `AKUN ML #${d.number} • ${d.skins} SKIN${d.collector ? ' • ' + d.collector : ''} • ${rp(p.price)} — cek bio / DM buat detail! #mlbb #akunml #jualakunml #mobilelegends #fyp #gamingindonesia`;
    return `═══ CAPTION INSTAGRAM ═══\n\n${ig}\n\n═══ CAPTION TIKTOK ═══\n\n${tt}\n\n═══ PROMO WHATSAPP ═══\n\n${gen.waPromo}\n`;
}

(async () => {
    let ml = products.filter(p => p.category === 'Mobile Legend' && p.active);
    if (ONLY) ml = ml.filter(p => ONLY.includes(parseName(p).number));
    if (!ml.length) { console.error('Tidak ada produk ML yang cocok.'); process.exit(1); }
    for (const p of ml) {
        const d = parseName(p);
        const photo = await fetchPhoto(p);
        const base = path.join(OUT, `ml${d.number}`);
        shoot(cardHTML(d, 1080, 1350, photo), 1080, 1350, `${base}_feed.png`);
        shoot(cardHTML(d, 1080, 1920, photo), 1080, 1920, `${base}_story.png`);
        fs.writeFileSync(`${base}_caption.txt`, captions(p, d));
        console.log(`OK ML #${d.number}${photo ? ' (dengan foto)' : ''}`);
    }
    fs.unlinkSync(path.join(OUT, '_tmp.html'));
    console.log('Selesai:', ml.length, 'akun →', OUT);
})();
