import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../apps/dashboard/.dist-pwa-e2e');
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
export const captureId = 'b73a7e69-5b08-460f-a290-8f8371403ac8';
export const initiativeId = 'c73a7e69-5b08-460f-a290-8f8371403ac8';
export const content = '隔离浏览器保留的真实记录';
export const initiative = { id: initiativeId, title: '浏览器去向验收立项', status: 'planning', created_at: '2026-10-01T00:00:00Z', description: '归位去向与反向链' };
export const test = base.extend<{ api: { patches: unknown[]; failStats: boolean } }, { origin: string }>({
  origin: [async ({}, use) => {
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
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
    if (!address || typeof address === 'string') throw new Error('隔离静态服务器启动失败');
    await use(`http://127.0.0.1:${address.port}`);
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }, { scope: 'worker' }],
  api: [async ({ context, origin }, use) => {
    const api = { patches: [] as unknown[], failStats: false };
    let capture = { id: captureId, content, source: 'dashboard', status: 'captured', destination_type: null as string | null, destination_id: null as string | null, created_at: '2026-10-01T00:00:00Z' };
    const escaped: string[] = [];
    await context.routeWebSocket('**', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
      // 仅静态资产可出浏览器；其他来源（含硬编码5221）在这里终止。
      if (url.origin !== origin) { escaped.push(request.url()); return route.abort('blockedbyclient'); }
      if (!path.startsWith('/api/')) return route.continue();
      const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/api/brain/harness/stats') return api.failStats ? route.abort('failed') : reply({ completion_rate: 0.75, total_pipelines: 12, avg_duration: 180000 });
      if (path === '/api/brain/tasks') {
        const status = url.searchParams.get('status');
        return reply({ tasks: [{ id: `fixture-${status}`, title: `隔离任务-${status}`, status, created_at: '2026-10-01T00:00:00Z' }] });
      }
      if (path === '/api/brain/guard-drill/status') return reply({ guards: [{ stale: false }, { stale: false }, { stale: true }] });
      if (path === '/api/brain/design-docs') return reply({ docs: [{ id: 'fixture-diary', title: '隔离晨报', content: '浏览器点开后的晨报正文', created_at: '2026-10-01T00:00:00Z' }] });
      if (path === `/api/brain/captures/${captureId}` && request.method() === 'PATCH') {
        const patch = request.postDataJSON(); api.patches.push(patch); capture = { ...capture, ...patch }; return reply(capture);
      }
      if (path === '/api/brain/captures' || path === '/api/captures') return reply({ items: [capture], total: 1 });
      if (path === '/api/brain/initiatives') return reply({ initiatives: [initiative] });
      if (path === `/api/brain/initiatives/${initiativeId}`) return reply({ initiative });
      if (path === '/api/brain/pr-plans') return reply({ pr_plans: [] });
      if (path === '/api/brain/task-intake') return reply({ tasks: [] });
      return reply({ error: '未启用的隔离边界' }, 503);
    });
    await use(api);
    expect(escaped, '浏览器不得请求外部或生产后端').toEqual([]);
  }, { auto: true }],
});
export { expect };
