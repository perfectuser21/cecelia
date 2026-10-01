import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url));
const legacyRoot = join(dashboardRoot, 'e2e/fixtures/legacy-pwa');
const currentRoot = join(dashboardRoot, '.dist-pwa-e2e');
const buildVersion = 'pwa-upgrade-e2e';

const contentTypes: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

let serveCurrentBuild = false;
let server: Server;
let origin: string;
const requestPaths: string[] = [];
const workbenchPaths = [
  '/workbench/overview',
  '/workbench/inbox',
  '/workbench/tasks',
  '/workbench/activity',
  '/workbench/projections',
] as const;

function safePath(root: string, requestPath: string): string {
  const relativePath = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '');
  return join(root, relativePath);
}

async function readResponseFile(root: string, requestPath: string, spaFallback: boolean) {
  const pathname = requestPath === '/' ? '/index.html' : requestPath;
  try {
    return { filePath: safePath(root, pathname), body: await readFile(safePath(root, pathname)) };
  } catch {
    if (!spaFallback || extname(pathname)) return null;
    const filePath = join(root, 'index.html');
    return { filePath, body: await readFile(filePath) };
  }
}

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requestPaths.push(url.pathname);
    const root = serveCurrentBuild ? currentRoot : legacyRoot;
    const file = await readResponseFile(root, url.pathname, serveCurrentBuild);

    if (!file) {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[extname(file.filePath)] ?? 'application/octet-stream',
      'Service-Worker-Allowed': '/',
    });
    response.end(file.body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('PWA E2E server failed to bind');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('旧版 catch-all Service Worker 升级后保留 Workbench 深层路由', async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByTestId('legacy-home')).toBeVisible();

  const legacyCaches = await page.evaluate(() => caches.keys());
  expect(legacyCaches).toContain('legacy-navigation-cache');

  await page.evaluate(() => sessionStorage.setItem('legacy-page-loads', '0'));
  serveCurrentBuild = true;

  await page.goto(`${origin}/workbench/tasks`);
  await expect.poll(() => requestPaths.filter((path) => path === '/sw.js').length).toBeGreaterThan(1);
  await expect(page.getByRole('textbox', { name: '搜索 Task...' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_000);

  expect(new URL(page.url()).pathname).toBe('/workbench/tasks');
  expect(await page.evaluate(() => localStorage.getItem('app-cache-version'))).toBe(buildVersion);
  expect(await page.evaluate(() => caches.has('legacy-navigation-cache'))).toBe(false);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(requestPaths.filter((path) => path === '/workbench/tasks')).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem('legacy-page-loads'))).toBe('1');
});

for (const targetPath of workbenchPaths) {
  test(`隐私存储受限时升级旧 Service Worker 仍保留 ${targetPath}`, async ({ browser }) => {
    test.setTimeout(90_000);
    serveCurrentBuild = false;
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.addInitScript(() => {
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function getItem(key: string) {
        if (location.pathname.startsWith('/workbench')) {
          throw new DOMException('Storage is unavailable in private mode', 'SecurityError');
        }
        return originalGetItem.call(this, key);
      };
    });

    await page.goto(origin);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    serveCurrentBuild = true;

    await page.goto(`${origin}${targetPath}`);
    await page.waitForTimeout(10_000);
    expect(new URL(page.url()).pathname).toBe(targetPath);

    await page.reload();
    await page.waitForTimeout(10_000);
    expect(new URL(page.url()).pathname).toBe(targetPath);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);

    await context.close();
  });
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
]) {
  test(`首页交代入口在 ${viewport.width}px 视口中可输入且提交按钮完整可见`, async ({ page }) => {
    serveCurrentBuild = true;
    await page.setViewportSize(viewport);
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/brain/task-intake') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"tasks":[]}' });
      if (pathname === '/api/brain/captures' || pathname === '/api/brain/initiatives') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' });
      }
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"首页布局验收：数据服务隔离"}' });
    });

    await page.goto(origin);
    await expect(page).toHaveURL(/\/workbench\/inbox$/);
    const input = page.getByRole('textbox', { name: '交办内容' });
    const submit = page.getByRole('button', { name: '提交交办' });
    await expect(input).toBeVisible();
    await input.fill('检查首页输入区在不同设备上的布局');
    await expect(submit).toBeEnabled();
    await page.locator('main').evaluate(async main => {
      const animations = main.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity);
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    });

    const inputBox = (await input.boundingBox())!;
    const submitBox = (await submit.boundingBox())!;
    const mainBox = (await page.locator('main').boundingBox())!;
    const inputAreaBox = (await input.locator('..').boundingBox())!;
    expect(inputBox.width, '输入框应使用交办输入面的主要可用宽度').toBeGreaterThanOrEqual(Math.max(160, inputAreaBox.width * 0.6));
    expect(inputBox.height, '输入框应便于手机触控').toBeGreaterThanOrEqual(44);
    expect(submitBox.width).toBeGreaterThanOrEqual(64);
    expect(submitBox.height).toBeGreaterThanOrEqual(44);

    for (const box of [inputBox, submitBox]) {
      expect(box.x).toBeGreaterThanOrEqual(mainBox.x);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(
      inputBox.x + inputBox.width <= submitBox.x || inputBox.y + inputBox.height <= submitBox.y,
      '输入框与提交按钮不能重叠',
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
