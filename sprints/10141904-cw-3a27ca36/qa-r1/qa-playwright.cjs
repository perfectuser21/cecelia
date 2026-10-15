const path = require('path');
const { launchPreviewBrowser } = require(process.env.CODING_WF_PREVIEW_BROWSER_HELPER);

(async () => {
  const browser = await launchPreviewBrowser();
  try {
    for (const q of ['Q-5', 'Q-6']) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const response = await page.goto('http://localhost:5301/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);
        if (!response || response.status() !== 200) throw new Error(`${q}: 页面 HTTP ${response?.status()}`);
        const body = (await page.locator('body').innerText()).trim();
        if (!body) throw new Error(`${q}: 页面没有可见文字`);
        await page.screenshot({ path: path.join(__dirname, `${q.toLowerCase()}-preview.png`), fullPage: true });
        console.log(`${q}: HTTP ${response.status()}, title=${JSON.stringify(await page.title())}, body=${JSON.stringify(body.slice(0, 120))}, screenshot=${q.toLowerCase()}-preview.png`);
      } finally {
        await context.close();
      }
    }
    console.log(JSON.stringify(browser.diagnostics()));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
