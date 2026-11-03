import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { get, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createCompressionMiddleware, createStaticAssetMiddleware, createSpaFallback } from '../static-middleware.js';
import { startLocalHttp, localHttpUrl, closeLocalHttp } from './helpers/local-http.js';

const indexHtml = '<!doctype html><html><body>PRIVATE_SPA_DOCUMENT' + '压缩内容'.repeat(700) + '</body></html>';
const asset = 'globalThis.privateBuild = "fixture-a1b2c3";';
let directory: string;
let server: Server;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'api-static-middleware-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'assets', 'app.a1b2c3.js'), asset);
  await writeFile(join(directory, 'index.html'), indexHtml);
  const app = express();
  app.use(createCompressionMiddleware());
  app.use(createStaticAssetMiddleware(directory));
  // 与生产相同：健康路由先于SPA fallback，不能被HTML吞掉。
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.get('*', createSpaFallback(directory));
  server = await startLocalHttp(app);
});
afterEach(async () => { await closeLocalHttp(server); await rm(directory, { recursive: true, force: true }); });

describe('生产静态资源/压缩middleware', () => {
  it('哈希资源必须返回本人文件与一年immutable缓存，不能以404无断言通过', async () => {
    const response = await request(server).get('/assets/app.a1b2c3.js').set('Accept-Encoding', 'identity');
    expect(response.status).toBe(200);
    expect(response.text).toBe(asset);
    expect(response.headers['cache-control']).toContain('max-age=31536000');
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('直接index不持久缓存，浏览器能重新校验新构建', async () => {
    const response = await request(server).get('/index.html').set('Accept-Encoding', 'identity');
    expect(response.status).toBe(200);
    expect(response.text).toBe(indexHtml);
    expect(response.headers['cache-control']).toContain('max-age=0');
    expect(response.headers.etag).toBeTruthy();
  });

  it('真实深路径返回SPA文档与no-cache，健康检查仍为JSON', async () => {
    const response = await request(server).get('/reports/private-report').set('Accept-Encoding', 'identity');
    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toBe(indexHtml);
    expect(response.headers['cache-control']).toBe('no-cache');
    const health = await request(server).get('/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
  });

  it('大文档真实gzip字节解压后仍是原文，缓存协商包含Accept-Encoding', async () => {
    const response = await new Promise<{ status: number | undefined; headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
      get(localHttpUrl(server) + '/reports/private-report', { headers: { 'Accept-Encoding': 'gzip' } }, incoming => {
        const chunks: Buffer[] = [];
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
        incoming.on('error', reject);
        incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(String(response.headers.vary)).toContain('Accept-Encoding');
    expect(gunzipSync(response.body).toString('utf8')).toBe(indexHtml);
  });
  it('SPA文件读取预算跨路径和伪造来源共享，耗尽后返回429且健康检查仍可用', async () => {
    const app = express();
    app.get('/health', (_req, res) => { res.json({status: 'ok'}); });
    app.get('*', createSpaFallback(directory, {limit: 2}));
    const limitedServer = await startLocalHttp(app);
    try {
      for (const path of ['/first-page', '/second-page']) {
        const response = await request(limitedServer).get(path);
        expect(response.status).toBe(200);
        expect(response.text).toBe(indexHtml);
      }
      await rm(join(directory, 'index.html'));
      const blocked = await request(limitedServer).get('/different-page').set('X-Forwarded-For', '203.0.113.9');
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({error: 'dashboard_spa_rate_limited'});
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      const health = await request(limitedServer).get('/health');
      expect(health.status).toBe(200);
      expect(health.body).toEqual({status: 'ok'});
    } finally { await closeLocalHttp(limitedServer); }
  });
});
