/**
 * CONTOH INTEGRASI KE BOT WHATSAPP (Baileys / whatsapp-web.js)
 * 
 * Anda bisa meng-copy dan mengadaptasi kode ini ke dalam file handler pesan 
 * di bot WhatsApp VPS Anda (smscode-bot).
 */

// 1. Import fungsi checkSkin dari folder bot cekskin yang sudah kita buat
// Sesuaikan path require() dengan lokasi folder cekskin-bot di VPS Anda.
const { checkSkin } = require('./cekskin-bot/index.js');
const fs = require('fs');

// --- CONTOH LOGIKA DI DALAM HANDLER PESAN ---

async function handleMessage(pesanMasuk, senderNumber, replyFunction, sendImageFunction) {
  
  // Deteksi perintah /cekskin <ID>
  if (pesanMasuk.startsWith('/cekskin ')) {
    
    // Ambil ID dari pesan (misal "/cekskin 137056094" -> "137056094")
    const gameId = pesanMasuk.split(' ')[1];
    
    if (!gameId) {
      return replyFunction('Silakan masukkan Game ID. Contoh: /cekskin 123456');
    }

    // Beri tahu user bahwa bot sedang bekerja
    await replyFunction('⏳ Sedang memproses dan merender poster CekSkin, mohon tunggu sekitar 15-20 detik...');

    try {
      // 2. Panggil fungsi automasi CekSkin
      const hasil = await checkSkin(gameId);
      
      // Hasil kembalian berupa:
      // hasil.posterPath -> lokasi file JPG poster
      // hasil.descriptionText -> teks ringkasan skin untuk caption

      // 3. Kirim gambar poster ke WhatsApp dengan caption deskripsi
      await sendImageFunction(senderNumber, hasil.posterPath, hasil.descriptionText);
      
      // Opsional: Hapus file poster setelah dikirim agar server (VPS) tidak penuh
      // fs.unlinkSync(hasil.posterPath);

    } catch (error) {
      console.error('Error CekSkin:', error);
      await replyFunction('❌ Terjadi kesalahan saat mengecek skin. Pastikan ID valid atau cek terminal VPS Anda.');
    }
  }
}

/**
 * PANDUAN DEPLOY KE VPS:
 * 1. Upload folder `cekskin-bot` (berisi index.js, desk-generator.js, package.json, state.json) ke VPS Anda.
 * 2. Di dalam folder `cekskin-bot` di VPS, jalankan `npm install`.
 * 3. Jika menggunakan Ubuntu/Linux di VPS, Playwright butuh dependensi browser. Jalankan:
 *    `npx playwright install --with-deps chromium`
 * 4. Panggil fungsinya seperti contoh di atas di dalam kode bot WA Anda.
 */
