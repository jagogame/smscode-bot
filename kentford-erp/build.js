'use strict';
/* Build script KENTFORD ERP.
   Source (kentford-erp/) dibiarkan apa adanya (14 file js/*.js terpisah) supaya tetap
   gampang di-debug/di-edit satu-satu. `npm run build` menghasilkan folder dist/ yang siap
   di-deploy: 14 file JS digabung+minify jadi satu js/app.<hash>.min.js, css/app.css
   diminify jadi css/app.<hash>.min.css, index.html di dist/ dirujuk ke file ber-hash itu
   sehingga cache-busting otomatis (hash berubah kalau isinya berubah, tidak perlu naikin
   ?v= manual lagi setiap deploy). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const JS_ORDER = [
  'core.js', 'schema.js', 'ui.js', 'admin.js', 'sales.js', 'purchasing.js',
  'finance.js', 'rental.js', 'service.js', 'knowledge.js', 'partners.js', 'neworder.js',
  'dashboard.js', 'reports.js', 'main.js'
];

function hashOf(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 10);
}

function copyRecursive(src, dest, skip) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (skip && skip.has(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), skip);
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// Hanya asset runtime yang boleh ikut ke dist/ (yang benar-benar diserve ke browser).
// build.js, package.json, test/, DESIGN.md, node_modules dst SENGAJA tidak ikut disalin.
const RUNTIME_ENTRIES = ['index.html', 'manifest.json', 'robots.txt', 'css', 'js', 'img'];

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  for (const entry of RUNTIME_ENTRIES) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) continue;
    copyRecursive(src, path.join(DIST, entry), new Set(['node_modules']));
  }

  // Bundle + minify JS (concatenate in load order so top-level const/function
  // declarations resolve exactly like the original 14 separate <script> tags did).
  const jsSource = JS_ORDER.map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n;\n');
  const jsOut = esbuild.transformSync(jsSource, { minify: true, loader: 'js', target: 'es2019' });
  const jsHash = hashOf(jsOut.code);
  const jsFile = `app.${jsHash}.min.js`;
  for (const f of JS_ORDER) fs.rmSync(path.join(DIST, 'js', f), { force: true });
  fs.writeFileSync(path.join(DIST, 'js', jsFile), jsOut.code);

  // Minify CSS
  const cssSource = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
  const cssOut = esbuild.transformSync(cssSource, { minify: true, loader: 'css' });
  const cssHash = hashOf(cssOut.code);
  const cssFile = `app.${cssHash}.min.css`;
  fs.rmSync(path.join(DIST, 'css', 'app.css'), { force: true });
  fs.writeFileSync(path.join(DIST, 'css', cssFile), cssOut.code);

  // Rewrite dist/index.html: replace the 14 <script> tags + css link with the
  // single hashed bundle references.
  let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  html = html.replace(/<link rel="stylesheet" href="css\/app\.css\?v=\d+">/, `<link rel="stylesheet" href="css/${cssFile}">`);
  const scriptBlockRe = new RegExp(JS_ORDER.map(f => `<script src="js\\/${f.replace('.', '\\.')}\\?v=\\d+"><\\/script>\\n?`).join(''));
  html = html.replace(scriptBlockRe, `<script src="js/${jsFile}"></script>\n`);
  fs.writeFileSync(path.join(DIST, 'index.html'), html);

  // Service worker: precache app shell (HTML/CSS/JS/img/manifest) supaya app tetap bisa
  // dibuka (dari cache) walau koneksi putus di lapangan. Sengaja TIDAK cache /api/* — data
  // bisnis selalu harus fresh dari server (lihat Store.pullFromServer di core.js), cache
  // cuma untuk shell statis. Nama cache pakai jsHash+cssHash supaya versi lama otomatis
  // dibuang begitu ada build baru (lihat event 'activate' di bawah).
  const precache = [
    './', 'index.html', `js/${jsFile}`, `css/${cssFile}`, 'css/glass.css', 'manifest.json',
    'img/logo-kentford.png', 'img/favicon-32.png', 'img/favicon-192.png', 'img/favicon-512.png'
  ];
  const swCacheName = `kentford-shell-${jsHash}-${cssHash}`;
  const swSource = `'use strict';
const CACHE='${swCacheName}';
const PRECACHE=${JSON.stringify(precache)};
self.addEventListener('install',e=>{
 self.skipWaiting();
 e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)));
});
self.addEventListener('activate',e=>{
 e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url);
 if(e.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
 e.respondWith(
  caches.match(e.request).then(cached=>cached||fetch(e.request).then(res=>{
   const copy=res.clone();
   caches.open(CACHE).then(c=>c.put(e.request,copy));
   return res;
  }).catch(()=>cached))
 );
});
`;
  fs.writeFileSync(path.join(DIST, 'sw.js'), swSource);

  console.log('Build selesai -> dist/');
  console.log('  js:  js/' + jsFile + '  (' + (jsOut.code.length / 1024).toFixed(1) + ' KB)');
  console.log('  css: css/' + cssFile + '  (' + (cssOut.code.length / 1024).toFixed(1) + ' KB)');
}

build();
