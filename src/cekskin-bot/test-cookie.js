const { chromium } = require('playwright');
const fs = require('fs');

async function test() {
  const cookieValue = 'VaVx0KVvaSZ64zQt4hWHxg8IgMgoZVOj.eGMPq1%2BsI5lZelKcpPGtZGcyYIuCygeEFE8O%2FU6fw74%3D';
  // Daftar kemungkinan nama cookie untuk CekSkin
  const names = ['connect.sid', 'session', 'PHPSESSID', '__session', 'token', 'auth_token', 'cekskin_session', 'next-auth.session-token', '__Secure-next-auth.session-token'];
  
  const cookies = names.map(name => ({
    name,
    value: cookieValue,
    domain: 'cekskin.com',
    path: '/',
    expires: Date.now() / 1000 + (86400 * 30), // 30 days
    httpOnly: false,
    secure: true,
    sameSite: 'Lax'
  }));

  const state = { cookies, origins: [] };
  fs.writeFileSync('state.json', JSON.stringify(state, null, 2));

  console.log('Menguji login menggunakan nilai cookie yang diberikan...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'state.json' });
  const page = await context.newPage();
  
  await page.goto('https://cekskin.com', { waitUntil: 'networkidle' });
  
  const content = await page.content();
  const title = await page.title();
  console.log('Page Title:', title);
  
  // Mencari indikator login sukses di HTML halaman
  if (content.toLowerCase().includes('kredit') || content.toLowerCase().includes('dashboard') || content.toLowerCase().includes('keluar')) {
    console.log('SUCCESS_LOGIN');
  } else {
    console.log('FAILED_LOGIN');
    // Menyimpan screenshot untuk debug jika gagal
    await page.screenshot({ path: 'debug-login-failed.png' });
  }
  
  await browser.close();
}

test().catch(console.error);
