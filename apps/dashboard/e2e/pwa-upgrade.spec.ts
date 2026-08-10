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
