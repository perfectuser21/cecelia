const { launchPreviewBrowser } = require(process.env.CODING_WF_PREVIEW_BROWSER_HELPER);

(async () => {
  const browser = await launchPreviewBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto('http://localhost:5305/');
    await page.screenshot({ path: 'sprints/10272102-cw-b3d6f213/qa-r1/dashboard.png', fullPage: true });
    const title = await page.title();
    const body = (await page.locator('body').innerText()).slice(0, 500);
    if (!response || response.status() >= 400 || !body.trim()) throw Error('页面不可用');
    console.log(JSON.stringify({ status: response.status(), title, body, diagnostics: browser.diagnostics() }));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
