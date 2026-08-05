/**
 * Sumber bookmarklet "Deskripsi Skin" — v2 (fetch interceptor).
 * Versi readable ini di-minify lalu ditempel sebagai href="javascript:..."
 * di public/desk-bookmarklet.html (installer page).
 *
 * CARA KERJA (penting): endpoint /api/players/{id}/skins cekskin.com butuh
 * token otorisasi yang cuma hidup di memory JS mereka sendiri saat proses
 * pencarian berjalan — bukan cuma cookie sesi. Re-fetch independen (setelah
 * hasil sudah tampil) akan ditolak 403 Unauthorized.
 *
 * Makanya bookmarklet ini TIDAK membuat request sendiri. Dia cuma memasang
 * "penyadap" di window.fetch buat baca response yang MEMANG SUDAH otentik
 * dibuat oleh halaman cekskin.com sendiri saat user klik "Cari Skin" seperti
 * biasa. Tidak ada proteksi yang dilewati — cuma membaca data yang sudah sah
 * diterima browser user.
 *
 * ALUR PAKAI: klik bookmark dulu (arm) → baru klik "Cari Skin" di cekskin.com
 * seperti biasa → modal deskripsi muncul otomatis begitu data skin selesai
 * dimuat.
 */
(function () {
    const BASIC_TAGS = new Set(['Normal', 'Elite', 'Season Reward']);
    const RARITY_WEIGHT = { Grand: 6, Supreme: 5, Exquisite: 4, Deluxe: 3, Exceptional: 2, Common: 1 };

    function buildDesk(skins) {
        let filtered = skins.filter(s => s.heroName && s.tag && !BASIC_TAGS.has(s.tag));
        const groups = {};
        const order = [];
        for (const s of filtered) {
            if (!groups[s.tag]) { groups[s.tag] = []; order.push(s.tag); }
            groups[s.tag].push(s);
        }
        const weight = t => Math.max(...groups[t].map(s => RARITY_WEIGHT[s.rarity] || 0));
        const tagOrder = [...order].sort((a, b) => weight(b) - weight(a));
        return tagOrder.flatMap(tag => groups[tag].map(s => `${tag} ${s.heroName}`)).join('\n');
    }

    function showModal(contentText, total) {
        document.getElementById('__dgh__')?.remove();
        const host = document.createElement('div');
        host.id = '__dgh__';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });

        root.innerHTML = `
        <style>
            .overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; font-family:'Segoe UI',sans-serif; }
            .box { background:#1a1a22; border:1px solid #2a2a35; border-radius:14px; width:min(560px,92vw); max-height:82vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.5); }
            .head { padding:18px 20px 12px; border-bottom:1px solid #2a2a35; display:flex; justify-content:space-between; align-items:center; }
            .head h3 { margin:0; color:#fbbf24; font-size:1.05em; }
            .head button { background:none; border:none; color:#8b8b96; font-size:20px; cursor:pointer; line-height:1; }
            .meta { padding:10px 20px 0; font-size:.82em; color:#9ca3af; }
            .meta b { color:#fbbf24; }
            pre { margin:12px 20px; padding:14px; background:#0f0f14; border:1px solid #2a2a35; border-radius:8px; color:#d4d4d8; font-size:13px; line-height:1.7; overflow:auto; white-space:pre-wrap; flex:1; }
            .actions { padding:0 20px 18px; display:flex; gap:10px; }
            button.primary { flex:1; padding:11px; border:none; border-radius:8px; background:linear-gradient(135deg,#fbbf24,#f59e0b); color:#1a1a22; font-weight:700; cursor:pointer; font-size:14px; }
            button.primary:active { transform:scale(.98); }
            .toast { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); background:#22c55e; color:#04240f; padding:8px 16px; border-radius:8px; font-size:.85em; font-weight:600; opacity:0; transition:opacity .2s; }
            .toast.show { opacity:1; }
        </style>
        <div class="overlay">
            <div class="box">
                <div class="head"><h3>📋 Deskripsi Skin</h3><button id="close">✕</button></div>
                <div class="meta">Total skin: <b>${total}</b></div>
                <pre id="out"></pre>
                <div class="actions"><button class="primary" id="copy">📋 Copy Deskripsi</button></div>
            </div>
            <div class="toast" id="toast">Ter-copy!</div>
        </div>`;

        root.getElementById('out').textContent = contentText;
        root.getElementById('close').onclick = () => host.remove();
        root.querySelector('.overlay').addEventListener('click', (e) => { if (e.target.classList.contains('overlay')) host.remove(); });
        root.getElementById('copy').onclick = () => {
            navigator.clipboard.writeText('Desk:\n\n' + contentText).then(() => {
                const t = root.getElementById('toast');
                t.classList.add('show');
                setTimeout(() => t.classList.remove('show'), 1500);
            });
        };
    }

    if (window.__dgArmed) {
        alert('✅ Sudah aktif dari tadi!\n\nLangsung cek Game ID seperti biasa — deskripsi bakal muncul otomatis.');
        return;
    }
    window.__dgArmed = true;

    const originalFetch = window.fetch;
    window.fetch = function (...args) {
        const promise = originalFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        if (/\/api\/players\/.+\/skins/.test(url)) {
            promise.then(res => {
                if (!res.ok) return;
                res.clone().json().then(data => {
                    const skins = data.skins || data;
                    if (Array.isArray(skins) && skins.length) {
                        showModal(buildDesk(skins), data.total || skins.length);
                    }
                }).catch(() => {});
            });
        }
        return promise;
    };

    alert('✅ Siap!\n\nSekarang cek Game ID seperti biasa di halaman ini — deskripsi bakal muncul otomatis begitu hasil skin tampil.');
})();
