import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import type { Server, AddressInfo } from 'net';
import * as path from 'path';
import * as fs from 'fs';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const E2E_SCRIPT = path.join(REPO_ROOT, 'scripts/harness-dogfood/e2e.sh');

let server: Server;
let serverPort: number;

beforeAll(async () => {
  if (!fs.existsSync(E2E_SCRIPT)) {
    throw new Error(`E2E script missing: ${E2E_SCRIPT}`);
  }
  const mod = await import('../../../scripts/harness-dogfood/time-api.js');
  server = await mod.createServer(0);
  const addr = server.address() as AddressInfo;
  serverPort = addr.port;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function runE2E(port: number): { status: number | null; stdout: string; stderr: string } {
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

describe('Workstream 4 — E2E 冒烟脚本 [BEHAVIOR]', () => {
  it('服务已启动时运行 e2e.sh 以 exit code 0 退出', () => {
    const res = runE2E(serverPort);
    expect(res.status).toBe(0);
  });

  it('服务未启动（端口空闲）时运行 e2e.sh 以非 0 exit code 退出', () => {
    // 选一个几乎不可能被占用的高位端口（与运行中的 serverPort 不同）
    const idlePort = 59999;
    if (idlePort === serverPort) {
      throw new Error('idlePort collides with serverPort, test setup invalid');
    }
    const res = runE2E(idlePort);
    expect(res.status).not.toBe(0);
  });
});
