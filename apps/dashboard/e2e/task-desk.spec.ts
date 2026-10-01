import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const root = fileURLToPath(new URL('../.dist-task-desk-e2e/', import.meta.url));
const taskId = 'a73a7e69-5b08-460f-a290-8f8371403ac8';
const captureId = 'b73a7e69-5b08-460f-a290-8f8371403ac8';
let server: Server;
let origin: string;
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    // 本测试服务器没有Brain代理；漏掉mock的API直接失败。
    if (pathname.startsWith('/api/')) { response.writeHead(503).end(); return; }
    let path = join(root, pathname === '/' ? 'index.html' : pathname);
    try {
      let body: Buffer;
      try { body = await readFile(path); }
      catch { if (extname(pathname)) throw new Error(); path = join(root, 'index.html'); body = await readFile(path); }
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('静态服务器启动失败');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function installApi(page: Page, options: { failFirst?: boolean; listFailure?: boolean } = {}) {
  const posts: { text: string; source_id: string; answers?: Record<string, string> }[] = [];
  let status = 'queued';
  let exists = false;
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    const reply = (body: unknown, statusCode = 200) => route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/brain/task-intake' && request.method() === 'POST') {
      const body = request.postDataJSON(); posts.push(body); exists = true;
      if (options.failFirst && posts.length === 1) return route.abort('failed');
      return reply({ outcome: 'created', source_id: body.source_id, task_id: taskId, task: { id: taskId, title: '浏览器真实契约调研', status }, deduplicated: posts.length > 1 }, posts.length > 1 ? 200 : 201);
    }
    if (path === '/api/brain/task-intake') return options.listFailure ? reply({ error: 'intake_unavailable' }, 503) : reply({ tasks: exists ? [{ id: taskId, title: '浏览器真实契约调研', status }] : [] });
    if (path === `/api/brain/tasks/tasks/${taskId}`) return reply({ id: taskId, title: 'hash内部标题', status, payload: { intake: { title: '浏览器真实契约调研' } }, ...(status === 'completed_no_pr' ? { result: { summary: '已完成浏览器隔离验收', handoff: { done: ['调研完成'], not_done: [], next_steps: [], artifacts: { pr_urls: ['https://example.com/review/1', 'javascript:alert(1)'], paths: ['/tmp/research.txt'] } } } } : {}) });
    if (path === '/api/brain/captures' && request.method() === 'POST') return reply({ id: captureId, status: 'inbox', dedupe_key: request.postDataJSON().dedupe_key, created_at: '2026-10-01T00:00:00Z' }, 201);
    if (path === '/api/brain/captures') return reply({ items: [{ id: captureId, content: '以前保存的记录', source: 'dashboard', status: 'inbox', created_at: '2026-10-01T00:00:00Z' }], total: 1, counts_by_stage: { inbox: 1 } });
    if (path === '/api/brain/initiatives') return reply({ items: [] });
    if (path === '/api/capture-atoms') return reply([]);
    return reply({ error: '浏览器验收已隔离此接口' }, 503);
  });
  return { posts, setStatus: (next: string) => { status = next; } };
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`${viewport.width}px交办输入、真实编号、轮询状态和结果`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const api = await installApi(page);
    await page.goto(`${origin}/workbench/inbox`);
    const input = page.getByRole('textbox', { name: '交办内容' });
    await expect(input).toBeVisible();
    await input.fill('调研并说明问题与验收证据');
    await page.getByRole('button', { name: '提交交办' }).click();
    await expect(page.getByText(`任务编号：${taskId}`)).toBeVisible();
    await expect(page.getByRole('region', { name: '任务回执' }).getByText('排队中')).toBeVisible();
    expect(api.posts).toHaveLength(1);
    expect(Object.keys(api.posts[0]).sort()).toEqual(['source_id', 'text']);
    api.setStatus('in_progress');
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByRole('region', { name: '任务回执' }).getByText('执行中')).toBeVisible();
    api.setStatus('completed_no_pr');
    await expect(page.getByText('已完成浏览器隔离验收', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: 'https://example.com/review/1' })).toHaveAttribute('href', 'https://example.com/review/1');
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.getByText('/tmp/research.txt', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: info.outputPath(`task-desk-${viewport.width}.png`), fullPage: true });
  });
}

test('断线刷新后保留正文和source_id，明确新交办才换编号', async ({ page }, info) => {
  const api = await installApi(page, { failFirst: true });
  await page.goto(`${origin}/workbench/inbox`);
  await page.getByRole('textbox', { name: '交办内容' }).fill('不要重复建立同一个任务');
  await page.getByRole('button', { name: '提交交办' }).click();
  await expect(page.getByRole('alert')).toContainText('未收到交办回执');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '交办内容' })).toHaveValue('不要重复建立同一个任务');
  await page.getByRole('button', { name: '提交交办' }).click();
  await expect(page.getByText('已接单，任务状态和结果请查看下方回执。')).toBeVisible();
  expect(api.posts).toHaveLength(2); expect(api.posts[1]).toEqual(api.posts[0]);
  await page.screenshot({ path: info.outputPath('retry-receipt.png'), fullPage: true });
  await page.getByRole('button', { name: '新交办' }).click();
  await page.getByRole('textbox', { name: '交办内容' }).fill('新的一件事');
  await page.getByRole('button', { name: '提交交办' }).click();
  await expect.poll(() => api.posts.length).toBe(3);
  expect(api.posts[2].source_id).not.toBe(api.posts[0].source_id);
});

test('记下来保留独立草稿，旧记录及原子审阅可达', async ({ page }, info) => {
  await installApi(page); await page.goto(`${origin}/workbench/inbox`);
  await page.getByRole('textbox', { name: '交办内容' }).fill('交办草稿');
  await page.getByRole('button', { name: '记下来', exact: true }).click();
  await page.getByRole('textbox', { name: '记录内容' }).fill('记录草稿');
  await page.getByRole('button', { name: '交给 AI 办' }).click();
  await expect(page.getByRole('textbox')).toHaveValue('交办草稿');
  await page.getByRole('button', { name: '记下来', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveValue('记录草稿');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByText(`记录编号：${captureId}`)).toBeVisible();
  await expect(page.getByText(`任务编号：${captureId}`)).toHaveCount(0);
  await page.getByRole('link', { name: '旧记录' }).click();
  await expect(page.getByText('以前保存的记录')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: /Atom Review/ }).click();
  await page.screenshot({ path: info.outputPath('capture-history.png'), fullPage: true });
  await page.getByRole('link', { name: '返回交办台' }).click();
  await expect(page.getByRole('textbox', { name: '交办内容' })).toBeVisible();
});

test('列表失败不装空，存储受限不发不可恢复请求', async ({ page }) => {
  const api = await installApi(page, { listFailure: true });
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('cecelia.task-intake')) throw new DOMException('受限', 'SecurityError');
      return original.call(this, key, value);
    };
  });
  await page.goto(`${origin}/workbench/inbox`);
  await expect(page.getByText('最近交办读取失败，请刷新重试。')).toBeVisible();
  await expect(page.getByText('还没有交办记录')).toHaveCount(0);
  await page.getByRole('textbox', { name: '交办内容' }).fill('存储受限验收');
  await page.getByRole('button', { name: '提交交办' }).click();
  await expect(page.getByText(/无法保存重试凭据/)).toBeVisible();
  expect(api.posts).toHaveLength(0);
});

test('聊天提示导航到交办台，不自动提交', async ({ page }) => {
  const api = await installApi(page);
  await page.goto(`${origin}/cecelia/chat`);
  await expect(page.getByText('聊天回复不代表交办成功。需要执行的事情，请到交办台提交并查看任务编号。')).toBeVisible();
  await page.getByRole('link', { name: '去交办台' }).click();
  await expect(page).toHaveURL(/\/workbench\/inbox$/);
  await expect(page.getByRole('textbox', { name: '交办内容' })).toBeVisible();
  expect(api.posts).toHaveLength(0);
});
