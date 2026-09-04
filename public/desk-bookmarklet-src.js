(function () {
    function skinPriority(s) {
        if (s.rarity === 'Supreme') return 1;
        if (s.rarity === 'Grand') return 2;
        if (s.rarity === 'Exquisite') return 3;
        return null;
    }

    function getTag(s) {
        return s.tag || (Array.isArray(s.tags) && s.tags[0]) || s.skinName || s.rarity;
    }

    function buildDesk(skins) {
        let filtered = skins.filter(s => s.heroName && skinPriority(s) !== null);
        const groups = {};
        const order = [];
        for (const s of filtered) {
            const tag = getTag(s);
            if (!groups[tag]) { groups[tag] = []; order.push(tag); }
            groups[tag].push(s);
        }
        const tagPriority = t => Math.min(...groups[t].map(s => skinPriority(s)));
        const tagOrder = [...order].sort((a, b) => tagPriority(a) - tagPriority(b));
        return { tagOrder, groups, filtered };
    }

    function scrapeCollectorFromDOM(retries) {
        const spans = document.querySelectorAll('span');
        for (const el of spans) {
            const t = el.textContent.trim();
            if (/collector\s*\d/i.test(t) && !t.includes('·')) return t;
        }
        return '';
    }

    function showModal(skins, playerInfo) {
        const totalAll = (playerInfo.collection && playerInfo.collection.skin_count) || playerInfo.skinCount || playerInfo.total || skins.length;
        const rare = skins.filter(s => skinPriority(s) !== null);
        const supreme = rare.filter(s => s.rarity === 'Supreme').length;
        const grand = rare.filter(s => s.rarity === 'Grand').length;
        const exquisite = rare.filter(s => s.rarity === 'Exquisite').length;
        const { tagOrder, groups, filtered } = buildDesk(skins);
        const deskText = tagOrder.flatMap(tag => groups[tag].map(s => `${getTag(s)} ${s.heroName}`)).join('\n');

        const nickname = playerInfo.nickname || playerInfo.name || '';
        const collector = playerInfo.collectorTitle || '';
        const col = playerInfo.collection || {};
        const pointAll = col.total_point_all || 0;
        const pointSkin = col.total_point_skin || 0;
        const levelAll = col.collection_level_all || 0;

        document.getElementById('__dgh__')?.remove();
        const host = document.createElement('div');
        host.id = '__dgh__';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });

        let galleryHtml = '';
        for (const s of filtered) {
            const img = s.imageUrl || '';
            galleryHtml += `<div class="skin-card">` +
                (img ? `<img src="${img}" alt="${s.skinName}" loading="lazy">` : `<div class="no-img">No img</div>`) +
                `<div class="skin-name">${s.skinName}</div>` +
                `<div class="skin-hero">${s.heroName}</div>` +
                `<div class="skin-rarity r-${s.rarity.toLowerCase()}">${s.rarity}</div>` +
                `</div>`;
        }

        root.innerHTML = `
        <style>
            .overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; font-family:'Segoe UI',sans-serif; }
            .box { background:#1a1a22; border:1px solid #2a2a35; border-radius:14px; width:min(720px,95vw); max-height:90vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.5); }
            .head { padding:18px 20px 12px; border-bottom:1px solid #2a2a35; display:flex; justify-content:space-between; align-items:center; }
            .head h3 { margin:0; color:#fbbf24; font-size:1.05em; }
            .head button { background:none; border:none; color:#8b8b96; font-size:20px; cursor:pointer; line-height:1; }
            .player-info { padding:10px 20px 4px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
            .player-name { font-size:.95em; color:#e5e5e5; font-weight:700; }
            .player-collector { font-size:.82em; color:#fbbf24; background:#2a2410; border:1px solid #7a5f0e; padding:3px 10px; border-radius:20px; font-weight:600; }
            .player-level { font-size:.78em; color:#9ca3af; background:#26262f; padding:3px 8px; border-radius:12px; }
            .stats { padding:6px 20px 10px; font-size:.82em; color:#9ca3af; display:flex; flex-wrap:wrap; gap:6px 18px; }
            .stats b { color:#fbbf24; }
            .stats .supreme { color:#ff6b6b; } .stats .grand { color:#c084fc; } .stats .exquisite { color:#60a5fa; }
            .tabs { display:flex; gap:0; padding:0 20px; border-bottom:1px solid #2a2a35; }
            .tab { padding:10px 18px; cursor:pointer; color:#8b8b96; font-size:.88em; font-weight:600; border-bottom:2px solid transparent; }
            .tab.active { color:#fbbf24; border-bottom-color:#fbbf24; }
            .content { flex:1; overflow:auto; }
            .panel { display:none; }
            .panel.active { display:block; }
            .panel.active.gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); gap:10px; padding:12px 20px; }
            pre { margin:12px 20px; padding:14px; background:#0f0f14; border:1px solid #2a2a35; border-radius:8px; color:#d4d4d8; font-size:13px; line-height:1.7; overflow:auto; white-space:pre-wrap; }
            .gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); gap:10px; padding:12px 20px; }
            .skin-card { background:#0f0f14; border:1px solid #2a2a35; border-radius:8px; overflow:hidden; text-align:center; }
            .skin-card img { width:100%; aspect-ratio:1; object-fit:cover; }
            .no-img { width:100%; aspect-ratio:1; background:#26262f; display:flex; align-items:center; justify-content:center; color:#6b6b76; font-size:.7em; }
            .skin-name { padding:4px 6px 0; font-size:.72em; color:#e5e5e5; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .skin-hero { padding:0 6px; font-size:.68em; color:#9ca3af; }
            .skin-rarity { padding:2px 6px 6px; font-size:.65em; font-weight:700; }
            .r-supreme { color:#ff6b6b; } .r-grand { color:#c084fc; } .r-exquisite { color:#60a5fa; }
            .actions { padding:12px 20px 18px; display:flex; gap:10px; }
            button.primary { flex:1; padding:11px; border:none; border-radius:8px; background:linear-gradient(135deg,#fbbf24,#f59e0b); color:#1a1a22; font-weight:700; cursor:pointer; font-size:14px; }
            button.primary:active { transform:scale(.98); }
            .toast { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); background:#22c55e; color:#04240f; padding:8px 16px; border-radius:8px; font-size:.85em; font-weight:600; opacity:0; transition:opacity .2s; }
            .toast.show { opacity:1; }
        </style>
        <div class="overlay">
            <div class="box">
                <div class="head"><h3>📋 Deskripsi Skin</h3><button id="close">✕</button></div>
                <div class="player-info">
                    ${nickname ? `<span class="player-name">${nickname}</span>` : ''}
                    ${collector ? `<span class="player-collector">${collector}</span>` : ''}
                    ${levelAll ? `<span class="player-level">Lv.${levelAll} · ${pointAll.toLocaleString()} pts</span>` : ''}
                </div>
                <div class="stats">
                    <span>Total Skin: <b>${totalAll}</b></span>
                    <span>Rare: <b>${filtered.length}</b></span>
                    <span>Legend: <b class="supreme">${supreme}</b></span>
                    <span>Grand: <b class="grand">${grand}</b></span>
                    <span>Exquisite: <b class="exquisite">${exquisite}</b></span>
                </div>
                <div class="tabs">
                    <div class="tab active" data-tab="gallery">Foto Skin (${filtered.length})</div>
                    <div class="tab" data-tab="desk">Deskripsi</div>
                </div>
                <div class="content">
                    <div class="panel active" id="p-gallery">${galleryHtml}</div>
                    <div class="panel" id="p-desk"><pre id="out"></pre></div>
                </div>
                <div class="actions"><button class="primary" id="copy">📋 Copy Deskripsi</button></div>
            </div>
            <div class="toast" id="toast">Ter-copy!</div>
        </div>`;

        root.getElementById('p-gallery').classList.add('gallery');
        root.getElementById('out').textContent = deskText;
        root.getElementById('close').onclick = () => host.remove();
        root.querySelector('.overlay').addEventListener('click', (e) => { if (e.target.classList.contains('overlay')) host.remove(); });
        root.querySelectorAll('.tab').forEach(tab => {
            tab.onclick = () => {
                root.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                root.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                root.getElementById('p-' + tab.dataset.tab).classList.add('active');
            };
        });
        root.getElementById('copy').onclick = () => {
            navigator.clipboard.writeText('Desk:\n\n' + deskText).then(() => {
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
    window.__dgPlayerInfo = {};

    const originalFetch = window.fetch;
    window.fetch = function (...args) {
        const promise = originalFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';

        if (/\/api\/players\/.+\/lookup/.test(url)) {
            promise.then(res => {
                if (!res.ok) return;
                res.clone().json().then(data => {
                    window.__dgPlayerInfo = data || {};
                }).catch(() => {});
            });
        }

        if (/\/api\/players\/.+\/skins/.test(url)) {
            promise.then(res => {
                if (!res.ok) return;
                res.clone().json().then(data => {
                    const skins = data.skins || data;
                    if (Array.isArray(skins) && skins.length) {
                        let tries = 0;
                        function tryShow() {
                            const collectorTitle = scrapeCollectorFromDOM();
                            if (!collectorTitle && tries < 5) { tries++; setTimeout(tryShow, 600); return; }
                            const playerInfo = Object.assign({}, window.__dgPlayerInfo, {
                                total: data.total || skins.length,
                                collection: data.collection || {},
                                collectorTitle: collectorTitle
                            });
                            showModal(skins, playerInfo);
                        }
                        setTimeout(tryShow, 1000);
                    }
                }).catch(() => {});
            });
        }
        return promise;
    };

    alert('✅ Siap!\n\nSekarang cek Game ID seperti biasa di halaman ini — deskripsi bakal muncul otomatis begitu hasil skin tampil.');
})();
