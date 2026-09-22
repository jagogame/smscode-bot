# Design System: KENTFORD ERP

Sumber: halaman pertama brosur trifold resmi PT KENTFORD GROUP INDONESIA
("brosur kentford singapower 2026 UPDATE.pptx", panel kiri — hero "Reliable
Power & Energy Solutions"). Ini bukan brand fiktif — warna, tipografi, dan
foto produk diambil dari materi pemasaran asli perusahaan, diterapkan ke
halaman login/landing KENTFORD ERP untuk konsistensi identitas.

## 1. Visual Theme & Atmosphere
Industrial-trustworthy, bukan playful-startup. Kentford menjual genset,
solar panel, dan infrastruktur daya — audiensnya adalah procurement/teknik
di pabrik, gedung komersial, dan proyek konstruksi. Atmosfer: "ruang kontrol
pembangkit listrik yang bersih dan modern" — hijau korporat tegas di atas
putih bersih, diselingi foto produk nyata (genset, panel surya) yang
menunjukkan skala dan keandalan fisik, bukan ilustrasi abstrak.
- Density: Daily App Balanced (4/10) — form login tetap ringkas, panel
  visual di sisi lain membawa berat visual lewat foto, bukan teks ramai.
- Variance: Offset Asymmetric (6/10) — split-screen 55/45, bukan hero
  tersentral. Sudah diterapkan di halaman login saat ini, dipertahankan.
- Motion: Fluid CSS (3/10) — transisi halus standar, tanpa animasi
  berlebihan; ini alat kerja B2B, bukan halaman pemasaran flashy.

## 2. Color Palette & Roles
- **Kentford Forest** (#0f3d24) — Latar gradasi panel visual, warna dasar sidebar.
- **Kentford Green** (#166534) — Aksen utama: tombol primer, link, border fokus.
- **Signal Green** (#16a34a) — Highlight/sukses, titik aksen pada bullet list.
- **Canvas White** (#faf9f5) — Latar utama form/card.
- **Charcoal Ink** (#141413) — Teks utama (bukan hitam murni).
- **Muted Sage** (#6b7280) — Teks sekunder/label.
(Satu keluarga aksen hijau saja, sesuai logo Kentford — tidak ada ungu/neon.
Sudah konsisten dengan palet `css/app.css` yang ada, dipertahankan.)

## 3. Typography Rules
- **Display/Headline:** System sans-serif tebal (700–800), tracking rapat
  negatif tipis pada judul besar — meniru bobot wordmark "KENTFORD" di
  brosur (huruf besar, tebal, solid).
- **Body:** System sans-serif reguler, leading nyaman untuk keterbacaan form.
- **Banned:** Serif apa pun (brand asli tidak pakai serif sama sekali).

## 4. Hero / Panel Visual (Login)
- Foto produk ASLI dari brosur (EV Charger + Genset SINGAPOWER, dan ladang
  Solar Panel) menggantikan foto stok generik (tulip/hutan) yang dipakai
  sebelumnya — koneksi visual langsung ke identitas Kentford yang sebenarnya.
- Overlay gradasi hijau gelap di atas foto (readability teks putih di atasnya),
  bukan foto polos.
- Tagline mengikuti bahasa asli brosur: "Reliable Power & Energy Solutions."
- Maks. 1 CTA utama (tombol Masuk) — sudah sesuai.
- Tidak ada "scroll to explore" atau chevron — halaman login tidak butuh itu.

## 5. Component Stylings
- **Tombol:** Isi hijau solid untuk primer, sudah sesuai `.btn` di app.css.
  Tidak ada glow neon.
- **Card login:** Radius sedang (12–14px), shadow ditint hijau (bukan hitam
  murni) — sudah diterapkan sesi sebelumnya, dipertahankan.
- **Badge kepercayaan:** Ikon shield/gear/leaf seperti di brosur ("Reliable
  Performance", "Advanced Technology", "Sustainable Energy") bisa jadi
  referensi untuk 3 bullet poin di panel visual — sudah ada polanya, tinggal
  disesuaikan kata-katanya agar match brosur.

## 6. Layout Principles
Split-screen asimetris (panel visual kiri ~55%, form kanan ~45%) sudah
diterapkan dan sesuai arah brosur yang juga membagi ruang jadi blok tegas
per panel. Dipertahankan, tidak diubah strukturnya — hanya asetnya.

## 7. Anti-Patterns (Banned)
Tidak ada emoji, tidak ada foto stok generik tak relevan (tulip/hutan sudah
diganti foto produk asli), tidak ada ungu/neon, tidak ada nama brand palsu
(logo dan nama perusahaan yang dipakai adalah PT KENTFORD GROUP INDONESIA
yang sesungguhnya, bukan placeholder).
