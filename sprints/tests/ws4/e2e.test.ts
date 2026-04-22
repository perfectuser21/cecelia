import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import type { Server, AddressInfo } from 'net';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const E2E_SCRIPT = path.join(REPO_ROOT, 'scripts/harness-dogfood/e2e.sh');
const README = path.join(REPO_ROOT, 'scripts/harness-dogfood/README.md');
const TIME_API_SPEC = '../../../scripts/harness-dogfood/time-api.js';

async function loadModule(): Promise<any> {
  const mod = await import(TIME_API_SPEC);
  if (!mod || typeof mod.createServer !== 'function') {
    throw new Error('time-api.js 未导出 createServer 函数');
  }
  return mod;
}

async function startServer(): Promise<{ server: Server; port: number }> {
  const mod = await loadModule();
  const server: Server = await mod.createServer(0);
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr.port !== 'number') {
    throw new Error('createServer(0) 未监听');
  }
  return { server, port: addr.port };
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

async function pickIdlePort(excludePort: number): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as AddressInfo;
        const p = addr.port;
        srv.close(() => resolve(p));
      });
    });
    if (port !== excludePort) {
      return port;
    }
  }
  throw new Error('找不到空闲端口');
}

function requireE2EScript(): void {
  if (!fs.existsSync(E2E_SCRIPT)) {
    throw new Error(`E2E 脚本不存在: ${E2E_SCRIPT}`);
  }
}

function runE2E(port: number): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync('bash', [E2E_SCRIPT], {
    env: { ...process.env, PORT: String(port) },
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('Workstream 4 — E2E 冒烟脚本 + README [BEHAVIOR]', () => {
  it('e2e.sh 文件存在', () => {
    requireE2EScript();
    expect(fs.existsSync(E2E_SCRIPT)).toBe(true);
  });

  it('e2e.sh 具备可执行权限位', () => {
    requireE2EScript();
    const stat = fs.statSync(E2E_SCRIPT);
    const execBits = stat.mode & 0o111;
    expect(execBits).not.toBe(0);
  });

  it('服务已启动 + PORT 环境变量指向运行端口时，e2e.sh exit 0', async () => {
    requireE2EScript();
    const { server, port } = await startServer();
    try {
      const res = runE2E(port);
      if (res.status !== 0) {
        throw new Error(
          `预期 exit 0，实际 ${res.status}。stderr=${res.stderr}; stdout=${res.stdout}`,
        );
      }
      expect(res.status).toBe(0);
    } finally {
      await closeServer(server);
    }
  });

  it('端口空闲（没有服务）时，e2e.sh 以非 0 exit 退出', async () => {
    requireE2EScript();
    const { server, port: busyPort } = await startServer();
    let idlePort: number;
    try {
      idlePort = await pickIdlePort(busyPort);
    } finally {
      await closeServer(server);
    }
    const res = runE2E(idlePort);
    expect(res.status).not.toBe(0);
  });

  it('README.md 文件存在', () => {
    expect(fs.existsSync(README)).toBe(true);
  });

  it('README 含启动命令 node scripts/harness-dogfood/time-api.js', () => {
    expect(fs.existsSync(README)).toBe(true);
    const content = fs.readFileSync(README, 'utf8');
    expect(content).toMatch(/node\s+scripts\/harness-dogfood\/time-api\.js/);
  });

  it('README 含 E2E 冒烟脚本调用说明', () => {
    expect(fs.existsSync(README)).toBe(true);
    const content = fs.readFileSync(README, 'utf8');
    expect(content).toMatch(/scripts\/harness-dogfood\/e2e\.sh/);
  });
});
