// final-e2e Playwright 脚本（mac_web，在 Mac 本机执行）
// 逻辑层：build dashboard → vite preview :5174 → Playwright 断言文字可见（暗/亮主题）
// 接缝层：curl staging:5223 / live:5211，验生产 promote 真生效（CI 绿 ≠ done）
const { chromium, expect } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const path = require('path');

const DASH = path.resolve(__dirname, '../../apps/dashboard');
const PREVIEW_PORT = 5174;
const SHOTS = path.resolve(__dirname, '../screenshots');
const FIXED_TEXT = 'Cecelia Harness 工厂线已贯通';

function httpCode(url) {
  try { return execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${url}"`).toString().trim(); }
  catch { return '000'; }
}

(async () => {
  execSync('mkdir -p ' + JSON.stringify(SHOTS));

  // ── 逻辑层：本机构建 + 预览，证明文字真渲染、真可见（环境无关）──
  execSync('npm ci --prefer-offline || npm install', { cwd: DASH, stdio: 'inherit' });
  execSync('npm run build', { cwd: DASH, stdio: 'inherit' });

  const server = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--host'], { cwd: DASH });
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (httpCode(`http://localhost:${PREVIEW_PORT}/`) === '200') { ready = true; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) { server.kill('SIGKILL'); console.error('FAIL: vite preview 未就绪'); process.exit(1); }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PREVIEW_PORT}/`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(SHOTS, '01-initial.png') });

    const el = page.getByTestId('harness-pipeline-status');
    await expect(el).toBeVisible({ timeout: 10000 });
    await expect(el).toHaveText(FIXED_TEXT);

    // 暗/亮主题各验一次可见（边界情况硬条款）
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(el).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '02-action.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(el).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '03-result.png') });

    console.log('✅ 逻辑层：本机构建产物文字可见（暗/亮主题）');
  } finally {
    await browser.close();
    server.kill('SIGKILL');
  }

  // ── 接缝层：真目标验证（staging:5223 / live:5211），CI 绿 ≠ done ──
  const sc = httpCode('http://localhost:5223/');
  if (sc !== '200') { console.error(`FAIL[接缝#1]: staging:5223 非 200 (=${sc}) — staging 未真部署`); process.exit(1); }

  const lc = httpCode('http://localhost:5211/');
  if (lc !== '200') { console.error(`FAIL[接缝#2]: live:5211 非 200 (=${lc}) — promote 未生效`); process.exit(1); }

  const idx = execSync('curl -sf --max-time 10 "http://localhost:5211/"').toString();
  const asset = (idx.match(/\/assets\/[A-Za-z0-9._-]+\.js/) || [])[0];
  if (!asset) { console.error('FAIL[接缝#2]: live 首页未引用 JS bundle'); process.exit(1); }
  const bundle = execSync(`curl -sf --max-time 10 "http://localhost:5211${asset}"`).toString();
  if (!bundle.includes(FIXED_TEXT)) {
    console.error('FAIL[接缝#2]: live:5211 生产 bundle 未含固定文字 — promote 未把新代码推上生产');
    process.exit(1);
  }

  console.log('✅ 接缝层：staging:5223 + live:5211 promote 真生效，生产真出固定文字');
  console.log('✅ Golden Path 端到端验证通过');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
