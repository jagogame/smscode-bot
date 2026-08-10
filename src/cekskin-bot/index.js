const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { generateDesk } = require('./desk-generator');

/**
 * Fungsi untuk menjalankan automasi CekSkin
 * @param {string} gameId - ID Game MLBB
 * @returns {Promise<{posterPath: string, descriptionText: string}>}
 */
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

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/players/') && url.endsWith('/skins') && response.status() === 200) {
      try {
        skinsData = await response.json();
      } catch (err) {}
    }
  });

  try {
    await page.goto('https://cekskin.com', { waitUntil: 'networkidle' });

    const inputLocator = page.getByPlaceholder(/ID/i).first();
    await inputLocator.fill(gameId.toString());

    const btnCari = page.getByRole('button', { name: /Cari Skin/i }).first();
    await btnCari.click();

    const btnOke = page.getByRole('button', { name: /Oke/i }).first();
    await btnOke.click();

    await page.waitForURL('**/gallery?q=**', { timeout: 30000 });
    
    for(let i = 0; i < 15; i++) {
      if(skinsData) break;
      await page.waitForTimeout(1000);
    }

    if (!skinsData) {
      throw new Error('Gagal mendapatkan data skins dari CekSkin.');
    }

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
