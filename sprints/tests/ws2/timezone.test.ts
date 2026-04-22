import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { Server, AddressInfo } from 'net';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TIME_API_ABS = path.join(REPO_ROOT, 'scripts/harness-dogfood/time-api.js');
const COMPAT_TZ = path.join(REPO_ROOT, 'scripts/harness-dogfood/__tests__/timezone.test.js');
const TIME_API_SPEC = '../../../scripts/harness-dogfood/time-api.js';

async function loadModule(): Promise<any> {
  const mod = await import(TIME_API_SPEC);
  if (!mod || typeof mod.createServer !== 'function') {
    throw new Error('time-api.js 未导出 createServer 函数');
  }
  return mod;
}

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const mod = await loadModule();
  const server: Server = await mod.createServer(0);
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr.port !== 'number') {
    await closeServer(server);
    throw new Error('createServer(0) 未监听');
  }
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function runNodeTest(absPath: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync('node', ['--test', absPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

describe('Workstream 2 — /timezone 端点（只新增文件，不改 time-api.js）[BEHAVIOR]', () => {
  it('GET /timezone 返回 200 且 timezone 字段为非空字符串', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/timezone`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { timezone: string };
      expect(typeof body.timezone).toBe('string');
      expect(body.timezone.length).toBeGreaterThan(0);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /timezone 返回的 timezone 严格等于进程 Intl.DateTimeFormat 的 timeZone（UTC 兜底）', async () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/timezone`);
      const body = (await res.json()) as { timezone: string };
      expect(body.timezone).toBe(expected);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /timezone 的 Content-Type 为 application/json', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/timezone`);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
    } finally {
      await closeServer(server);
    }
  });

  it('routes["/timezone"] 为 handler 函数（自动加载器识别新文件）', async () => {
    const mod = await loadModule();
    expect(mod.routes).toBeDefined();
    expect(typeof mod.routes['/timezone']).toBe('function');
  });

  it('WS2 合并后 /iso 端点仍正常 200 响应（骨架未被污染）', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/iso`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { iso: string };
      expect(body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      await closeServer(server);
    }
  });

  it('WS2 合并后 time-api.js 源码不含 timezone 相关字面量（物理隔离契约）', () => {
    const src = fs.readFileSync(TIME_API_ABS, 'utf8');
    expect(src).not.toMatch(/\/timezone/);
    expect(src).not.toMatch(/Intl\.DateTimeFormat/);
    expect(src).not.toMatch(/resolvedOptions/);
    expect(src).not.toMatch(/['"]timezone['"]/);
  });

  it('PRD 兼容层 runtime：node --test __tests__/timezone.test.js exit 0', () => {
    expect(fs.existsSync(COMPAT_TZ)).toBe(true);
    const res = runNodeTest(COMPAT_TZ);
    if (res.status !== 0) {
      throw new Error(
        `node --test ${COMPAT_TZ} 预期 exit 0，实际 ${res.status}。stderr=${res.stderr.slice(0, 500)}; stdout=${res.stdout.slice(0, 500)}`,
      );
    }
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^# pass [1-9]/m);
  });
});
