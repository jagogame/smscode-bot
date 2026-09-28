const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { generateDesk } = require('./desk-generator');

/**
 * Fungsi untuk menjalankan automasi CekSkin
 * @param {string} gameId - ID Game MLBB
 * @returns {Promise<{posterPath: string, descriptionText: string}>}
 */
const SKINS_TIMEOUT_MS = 60000;

async function checkSkin(gameId) {
  const statePath = path.join(__dirname, 'state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error('state.json tidak ditemukan! Bot belum login ke CekSkin.');
  }

  // Gunakan headless true untuk environment produksi/VPS.
  // Jika error sandbox Mac, ganti ke false untuk lokal, 
  // atau gunakan executablePath chrome bawaan sistem.
  const browser = await chromium.launch({ headless: true }); 
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();

  let skinsData = null;
  let playerName = 'Unknown';
  // Catat semua response /skins (bukan cuma 200) supaya error-nya jelas:
  // 401/403 = sesi state.json kadaluarsa, 429 = kena rate limit, 5xx = server CekSkin.
  const skinsResponses = [];

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/players/') && url.includes('/skins')) {
      skinsResponses.push({ status: response.status(), url });
    }
  });

  try {
    await page.goto('https://cekskin.com', { waitUntil: 'domcontentloaded', timeout: 45000 });

    const inputLocator = page.getByPlaceholder(/ID/i).first();
    await inputLocator.fill(gameId.toString());

    // Pasang penunggu SEBELUM klik biar response yang cepat nggak kelewat.
    const skinsPromise = page.waitForResponse(
      (res) => res.url().includes('/api/players/') && res.url().includes('/skins') && res.request().method() !== 'OPTIONS',
      { timeout: SKINS_TIMEOUT_MS }
    ).catch(() => null);

    const btnCari = page.getByRole('button', { name: /Cari Skin/i }).first();
    await btnCari.click();

    const btnOke = page.getByRole('button', { name: /Oke/i }).first();
    await btnOke.click({ timeout: 10000 }).catch(() => {});

    const skinsRes = await skinsPromise;

    if (!skinsRes) {
      const seen = skinsResponses.map((r) => r.status).join(', ') || 'tidak ada';
      throw new Error(`CekSkin tidak merespon data skins dalam ${SKINS_TIMEOUT_MS / 1000} detik (response /skins: ${seen}). Coba lagi beberapa saat.`);
    }

    const status = skinsRes.status();
    if (status === 401 || status === 403) {
      throw new Error(`Sesi CekSkin kadaluarsa (HTTP ${status}). Jalankan ulang login.js buat perbarui state.json.`);
    }
    if (status === 429) {
      throw new Error('CekSkin membatasi request (HTTP 429). Tunggu beberapa menit lalu coba lagi.');
    }
    if (status === 404) {
      throw new Error(`ID ${gameId} tidak ditemukan di CekSkin (HTTP 404).`);
    }
    if (status !== 200) {
      throw new Error(`CekSkin error HTTP ${status} saat ambil data skins.`);
    }

    try {
      skinsData = await skinsRes.json();
    } catch (err) {
      throw new Error('Response skins dari CekSkin bukan JSON valid.');
    }

    await page.waitForURL('**/gallery?q=**', { timeout: 30000 });

    try {
      const headerText = await page.locator('h1, h2, h3').first().innerText();
      playerName = headerText.split('\n')[0].trim();
    } catch(e) {}

    const deskResult = generateDesk(skinsData);
    let totalRare = deskResult.totalRare;
    if (totalRare === 0) totalRare = 1; 

    const currentUrl = new URL(page.url());
    const token = currentUrl.searchParams.get('q');
    await page.goto(`https://cekskin.com/poster?q=${token}`, { waitUntil: 'networkidle' });

    const slider = page.locator('input[type="range"]');
    if (await slider.count() > 0) {
      await slider.evaluate((node, val) => {
        node.value = val;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, totalRare);
    }

    try {
      const inputElement = page.getByLabel(/JUDUL POSTER/i).or(page.getByPlaceholder(/Judul/i)).first();
      await inputElement.fill('Jago Game');
    } catch (e) {
      const textInputs = page.locator('input[type="text"]');
      const count = await textInputs.count();
      for (let i = 0; i < count; i++) {
        const val = await textInputs.nth(i).inputValue();
        if (val.toUpperCase().includes('AKUN MLBB') || val.toUpperCase().includes('DIJUAL')) {
          await textInputs.nth(i).fill('Jago Game');
          break;
        }
      }
    }

    const btnPreview = page.getByRole('button', { name: /Lihat Preview/i }).first();
    if (await btnPreview.count() > 0) {
      await btnPreview.click();
    }
    
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const btnDownload = page.getByRole('button', { name: /Download Poster/i }).first();
    
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      btnDownload.click()
    ]);

    const safeNickname = playerName.replace(/[^a-z0-9]/gi, '_');
    const fileName = `${gameId} - ${safeNickname} - Jago Game.jpg`;
    
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    const outputPath = path.join(outputDir, fileName);
    await download.saveAs(outputPath);

    return {
      posterPath: outputPath,
      descriptionText: deskResult.text,
      playerName: playerName
    };

  } catch (error) {
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = { checkSkin };

// Jika dijalankan langsung dari terminal: node index.js 123456
if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.log('Cara Penggunaan: node index.js <GameID>');
    process.exit(1);
  }
  checkSkin(arg).then(res => {
    console.log('=== SUKSES ===');
    console.log('Poster Tersimpan di:', res.posterPath);
    console.log('\n--- DESKRIPSI ---');
    console.log(res.descriptionText);
  }).catch(err => {
    console.error('Error:', err.message);
  });
}
