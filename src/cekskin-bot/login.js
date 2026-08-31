const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const readline = require('readline');
const fs = require('fs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log('Launching REAL Google Chrome to bypass Google Login restrictions...');
  
  // Mencari path Google Chrome asli di Mac
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  if (!fs.existsSync(chromePath)) {
    console.log('Google Chrome tidak ditemukan di /Applications/Google Chrome.app.');
    console.log('Pastikan Anda memiliki Google Chrome asli yang terinstal.');
    process.exit(1);
  }

  const browser = await chromium.launch({ 
    headless: false,
    executablePath: chromePath, // Menggunakan Chrome asli, bukan bawaan Playwright
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  await page.goto('https://cekskin.com');

  console.log('=========================================');
  console.log('Silakan login ke akun cekskin.com Anda di jendela Chrome asli ini.');
  console.log('Pastikan saldo kredit terlihat sebelum melanjutkan.');
  console.log('=========================================');

  rl.question('Tekan [ENTER] di sini jika Anda sudah selesai login...', async () => {
    console.log('Menyimpan state login ke state.json...');
    await context.storageState({ path: 'state.json' });
    console.log('State berhasil disimpan! Anda sekarang bisa menjalankan bot utama.');
    
    await browser.close();
    rl.close();
  });
}

main().catch(console.error);
