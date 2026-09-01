import { chromium } from 'playwright';

async function test() {
  console.log('Launching browser to inspect live Cloudflare production deployment...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const response = await page.goto('https://nuvanx-frontend.jenineferderas.workers.dev/login', { waitUntil: 'networkidle' });
  console.log('HTTP Status:', response.status());
  
  const title = await page.title();
  console.log('Page Title:', title);
  
  const bodyText = await page.innerText('body');
  console.log('\n--- PAGE CONTENT START ---');
  console.log(bodyText);
  console.log('--- PAGE CONTENT END ---\n');
  
  const hasIncompleteConfig = bodyText.includes('Configuración incompleta');
  console.log('Has Configuración incompleta error:', hasIncompleteConfig);
  
  await page.screenshot({ path: 'live-login-check.png' });
  console.log('Saved screenshot to live-login-check.png');
  
  await browser.close();
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
