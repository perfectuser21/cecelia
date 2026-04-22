import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { Server, AddressInfo } from 'net';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TIME_API_ABS = path.join(REPO_ROOT, 'scripts/harness-dogfood/time-api.js');
const COMPAT_ISO = path.join(REPO_ROOT, 'scripts/harness-dogfood/__tests__/iso.test.js');
const COMPAT_NOTFOUND = path.join(REPO_ROOT, 'scripts/harness-dogfood/__tests__/not-found.test.js');
const TIME_API_SPEC = '../../../scripts/harness-dogfood/time-api.js';

async function loadModule(): Promise<any> {
  const mod = await import(TIME_API_SPEC);
  if (!mod || typeof mod.createServer !== 'function') {
    throw new Error('time-api.js 未导出 createServer 函数');
  }
  return mod;
}

async function startServer(): Promise<{ server: Server; baseUrl: string; port: number }> {
  const mod = await loadModule();
  const server: Server = await mod.createServer(0);
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr.port !== 'number' || addr.port <= 0) {
    await closeServer(server);
    throw new Error('createServer(0) 返回的 server 未监听或端口非法');
  }
  return { server, baseUrl: `http://127.0.0.1:${addr.port}`, port: addr.port };
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

describe('Workstream 1 — /iso + 404/405 骨架 + routes 自动加载器（全时态）[BEHAVIOR]', () => {
  it('GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/iso`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { iso: string };
      expect(typeof body.iso).toBe('string');
      expect(body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /iso 的 Content-Type 为 application/json', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/iso`);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
    } finally {
      await closeServer(server);
    }
  });

  it('GET /iso 的 iso 字段对应时间与当前时间相差不超过 5 秒', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const before = Date.now();
      const res = await fetch(`${baseUrl}/iso`);
      const after = Date.now();
      const body = (await res.json()) as { iso: string };
      const returnedMs = Date.parse(body.iso);
      expect(Number.isFinite(returnedMs)).toBe(true);
      expect(returnedMs).toBeGreaterThanOrEqual(before - 5000);
      expect(returnedMs).toBeLessThanOrEqual(after + 5000);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /unknown-xyz 返回 404 且 body 为 {error:"not_found"}', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/unknown-xyz`);
      expect(res.status).toBe(404);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('not_found');
    } finally {
      await closeServer(server);
    }
  });

  it('POST /iso 返回 405 且 body 为 {error:"method_not_allowed"}', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/iso`, { method: 'POST' });
      expect(res.status).toBe(405);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('method_not_allowed');
    } finally {
      await closeServer(server);
    }
  });

  it('createServer(0) 返回已监听的 server，address().port 为正整数', async () => {
    const { server, port } = await startServer();
    try {
      expect(Number.isInteger(port)).toBe(true);
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
    } finally {
      await closeServer(server);
    }
  });

  it('time-api.js 源码不含 timezone/unix 相关字面量（物理隔离契约·全时态）', () => {
    const src = fs.readFileSync(TIME_API_ABS, 'utf8');
    expect(src).not.toMatch(/\/timezone/);
    expect(src).not.toMatch(/\/unix/);
    expect(src).not.toMatch(/Intl\.DateTimeFormat/);
    expect(src).not.toMatch(/resolvedOptions/);
    expect(src).not.toMatch(/Math\.floor/);
    expect(src).not.toMatch(/['"]timezone['"]/);
    expect(src).not.toMatch(/['"]unix['"]/);
  });

  it('PRD 兼容层 runtime：node --test __tests__/iso.test.js exit 0', () => {
    expect(fs.existsSync(COMPAT_ISO)).toBe(true);
    const res = runNodeTest(COMPAT_ISO);
    if (res.status !== 0) {
      throw new Error(
        `node --test ${COMPAT_ISO} 预期 exit 0，实际 ${res.status}。stderr=${res.stderr.slice(0, 500)}; stdout=${res.stdout.slice(0, 500)}`,
      );
    }
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^# pass [1-9]/m);
  });

  it('PRD 兼容层 runtime：node --test __tests__/not-found.test.js exit 0', () => {
    expect(fs.existsSync(COMPAT_NOTFOUND)).toBe(true);
    const res = runNodeTest(COMPAT_NOTFOUND);
    if (res.status !== 0) {
      throw new Error(
        `node --test ${COMPAT_NOTFOUND} 预期 exit 0，实际 ${res.status}。stderr=${res.stderr.slice(0, 500)}; stdout=${res.stdout.slice(0, 500)}`,
      );
    }
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^# pass [1-9]/m);
  });
});
