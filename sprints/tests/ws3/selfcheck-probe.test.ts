/**
 * Workstream 3 — 外部巡检脚本 health-probe.mjs [BEHAVIOR]
 *
 * 合同测试：用本地 http.Server mock 不同的 health 响应，spawn 子进程跑 health-probe.mjs，
 * 断言脚本退出码符合具体契约。具体码避免"无脑 exit 1 假实现"蒙混过关。
 *
 * 退出码契约（精确值）:
 * - exit 0 → healthy: HTTP 200 + body schema 正确 + status === "ok"
 * - exit 1 → validation 失败: HTTP 非 200 / body schema 缺字段 / status ≠ "ok"
 * - exit 2 → 连接失败: ECONNREFUSED / DNS 失败 / 超时
 *
 * 当前 Red 证据：stub packages/brain/scripts/health-probe.mjs 用 exit 99，
 * 所有 5 个 it 的 `toBe(0)`/`toBe(1)`/`toBe(2)` 断言均 FAIL。
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(
  __dirname, '..', '..', '..',
  'packages', 'brain', 'scripts', 'health-probe.mjs'
);

type Responder = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;

function startMockServer(responder: Responder): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(responder);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        resolve({
          server,
          url: `http://127.0.0.1:${address.port}/api/brain/health`,
        });
      }
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function runProbe(url: string) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, HEALTH_URL: url },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('Workstream 3 — Health Probe Script [BEHAVIOR]', () => {
  it('health-probe 对合法 200 + 三字段响应退出码为 0', async () => {
    const { server, url } = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime_seconds: 5, version: '1.222.0' }));
    });
    try {
      const result = runProbe(url);
      expect(result.status).toBe(0);
    } finally {
      await stopServer(server);
    }
  });

  it('health-probe 对缺失 version 字段的响应退出码严格等于 1（validation 失败）', async () => {
    const { server, url } = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime_seconds: 5 }));
    });
    try {
      const result = runProbe(url);
      expect(result.status).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it('health-probe 对 HTTP 500 响应退出码严格等于 1（validation 失败）', async () => {
    const { server, url } = await startMockServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal' }));
    });
    try {
      const result = runProbe(url);
      expect(result.status).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it('health-probe 对 status=degraded 的响应退出码严格等于 1（validation 失败）', async () => {
    const { server, url } = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'degraded', uptime_seconds: 5, version: '1.0.0' }));
    });
    try {
      const result = runProbe(url);
      expect(result.status).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it('health-probe 对不可达 URL（ECONNREFUSED）退出码严格等于 2（连接失败）', () => {
    // 59999 是常用的空闲测试端口
    const result = runProbe('http://127.0.0.1:59999/api/brain/health');
    expect(result.status).toBe(2);
  });
});
