const { chromium } = require('playwright');
const path = require('path');

// Kredensial cekskin. Bisa di-override lewat env var (lebih aman untuk produksi):
//   CEKSKIN_EMAIL, CEKSKIN_PASSWORD
const CREDS = {
  email: process.env.CEKSKIN_EMAIL || 'itsryuki@gmail.com',
  password: process.env.CEKSKIN_PASSWORD || 'b6214sxm',
};

/**
 * Isi form login yang SEDANG tampil di halaman, klik "Masuk", tunggu sampai
 * form email hilang (tanda login berhasil). Dipakai baik oleh runner standalone
 * maupun auto-recovery di index.js (checkSkin) saat sesi expired.
 * @param {import('playwright').Page} page
 */
async function fillLoginForm(page) {
  const emailInput = page.getByPlaceholder(/Email/i).first();
  // Fail-fast: kalau form email tidak muncul dalam 5 dtk, jangan hang 20 dtk —
  // kemungkinan bukan benar-benar halaman login (mis. race saat hydrate).
  await emailInput.waitFor({ timeout: 5000 });
  await emailInput.fill(CREDS.email);
  await page.getByPlaceholder(/Password/i).first().fill(CREDS.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).first().click();
  await page.waitForTimeout(5000);
  if (await page.getByPlaceholder(/Email/i).count() > 0) {
    throw new Error('Login gagal — form email masih tampil (cek kredensial cekskin).');
  }
}

/**
 * Login standalone: buka browser sendiri, trigger modal login, isi form,
 * lalu simpan sesi ke state.json. Dipakai lewat `node auto-login.js`.
 */
async function login() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to cekskin.com...');
    await page.goto('https://cekskin.com', { waitUntil: 'networkidle' });

    console.log('Filling dummy ID to trigger login modal...');
    await page.getByPlaceholder(/ID/i).first().fill('137056094');
    await page.getByRole('button', { name: /Cari Skin/i }).first().click();

    console.log('Waiting for login modal to appear...');
    await page.waitForTimeout(2000);

    console.log('Filling email and password...');
    await fillLoginForm(page);

    console.log('LOGIN BERHASIL! Menyimpan state.json...');
    const statePath = path.join(__dirname, 'state.json');
    await context.storageState({ path: statePath });
    console.log('state.json berhasil disimpan!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

module.exports = { CREDS, fillLoginForm, login };

if (require.main === module) {
  login();
}
