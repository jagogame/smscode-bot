Lanjutan dari sesi Claude Code sebelumnya (di Mac) untuk project KENTFORD ERP (PT Kentford Group Indonesia — genset sales/rental/service). Ringkasan konteks:

## Struktur project
- `kentford-erp/` — frontend (vanilla JS/CSS, hash-routing SPA), deploy ke kentford.cloud
- `kentford-erp-auth/` — backend Express (auth, partner API, generic store sync)
- VPS: root@69.161.221.210 — nginx serve `/var/www/kentford-erp`, backend PM2 process `kentford-auth` di port 8091
- Deploy manual: build lokal (`npm run build` di `kentford-erp/`) → `tar` stream ke `/var/www/kentford-erp` → selalu verify checksum md5sum lokal vs remote setelah deploy
- Branch kerja: `claude/kentford-erp-app-b336ef`, sudah di-push, VPS punya clone terpisah di `/root/kentford-vps-session`

## Yang sudah dikerjakan (kronologis garis besar)
1. **Demo 3D landing page** (Artifact) — beberapa variasi mood (industrial dark / tech light), akhirnya diinstall beneran ke halaman login production: scene Three.js "Energy Core" (icosahedron + ring + partikel) di panel visual login
2. **Logo asli KENTFORD** dipasang jadi favicon + 3D tilt-on-hover di semua tempat logo muncul
3. **Sync data ke server**: semua koleksi (bukan cuma partners) sekarang sync ke `/api/store` (generic, lihat `Store.syncToServer`/`pullFromServer` di `core.js`), bukan cuma localStorage/IndexedDB per-browser
4. **Boot/loading screen** dibranding (bukan cuma teks "Memuat...")
5. **Mobile layout fixes**: logo login kepotong, gap kosong berlebih di bawah box login (root cause: `100vh` vs viewport asli Safari mobile → fix pakai `100dvh` + `min-height:auto` khusus mobile), scroll horizontal gak sengaja (root cause: `#side` disembunyikan pakai `transform:translateX(-100%)` tapi tetap dihitung area scroll → fix `overflow-x:hidden` di html/body), sidebar mobile sekarang ada backdrop gelap yang bisa di-tap buat nutup
6. **10 perbaikan arsitektur besar** (per review "10 kekurangan"):
   - Bundling+minify otomatis via esbuild (`build.js`, `npm run build` → folder `dist/`, cache-busting otomatis pakai content-hash di nama file, BUKAN manual `?v=`)
   - Self-host Leaflet/Three.js/html2canvas (`js/vendor/`), lazy-load cuma pas halaman yang butuh dibuka (`Loader.js()`/`Loader.css()` di `core.js`)
   - Service worker (`sw.js`, digenerate otomatis tiap build) — precache app shell buat offline
   - Error client (window.onerror dll) sekarang dikirim ke `/api/errorlog` (endpoint baru di backend, `kentford-erp-auth/errorlog.js`)
   - 10 unit test (`npm test`, Node built-in test runner, `test/core.test.js`)
7. **Top bar UI**: notifikasi jadi ikon lonceng SVG + badge count merah bulat, hamburger jadi SVG presisi (bukan karakter "☰"), semua tombol top bar disamain tinggi 34px
8. **Lighthouse audit** (login page + 3 halaman dalam setelah login via akun singapowergenset@gmail.com): accessibility naik ke 100 (label input login/reset-password di-`for=`-in ke id-nya, `<main>` landmark ditambah ke semua halaman, dimensi eksplisit width/height=847x92 di semua `<img>` logo), `robots.txt` asli dibuat (`Disallow: /` — app internal, sengaja skip SEO)
9. **WebGL retry investigation**: sempat dikira ada bug retry yang gak jalan — ternyata FALSE ALARM (salah cek `getContext('webgl')` padahal Three.js pakai `webgl2`). Sudah dikonfirmasi lewat screenshot scene render normal. Kode retry disederhanakan (2x percobaan, bukan 5x)

## Yang BELUM/pending
- User belum konfirmasi hasil visual mobile terakhir (backdrop sidebar, gap login) langsung dari HP-nya sendiri
- Import user bulk via Excel — pernah dibahas, user akan kirim spreadsheet, belum ada progress

## Cara kerja yang disepakati dengan user (penting diikuti)
- SELALU verify checksum md5sum lokal vs remote setelah deploy (scp/tar sempat pernah silent-fail)
- SELALU tanya dulu sebelum isi "data dummy" — user eksplisit minta jangan asal isi data kalau butuh sesuatu, tanya dulu
- Backup tar.gz otomatis di VPS (`/root/kentford-erp-backup-*.tar.gz`) sebelum tiap overwrite `/var/www/kentford-erp`
- Bahasa komunikasi: Indonesia santai/informal
