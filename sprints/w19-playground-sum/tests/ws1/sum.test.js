import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { resolve } from 'path';
import process from 'process';

// 无外部依赖（fetch + child_process 均为 Node 18+ 内建）
// SERVER_PATH: 从 CWD（playground/）出发找 server.js，兼容「从 playground/ 运行」场景
// 使用 process.execPath（绝对路径）而非 'node'，规避 vitest 子进程 PATH 丢失问题
const SERVER_PATH = resolve(process.cwd(), 'server.js');
const PORT = 31099;

let serverProc;

async function waitForServer(port, maxMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

beforeAll(async () => {
  serverProc = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PLAYGROUND_PORT: String(PORT), NODE_ENV: 'development' },
    cwd: process.cwd()
  });
  const ready = await waitForServer(PORT);
  if (!ready) throw new Error('playground server 未能在 3s 内就绪');
});

afterAll(() => {
  if (serverProc) serverProc.kill();
});

describe('Workstream 1 — GET /sum [BEHAVIOR]', () => {
  test('GET /sum?a=2&b=3 → 200 + {sum:5}', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum?a=2&b=3`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sum: 5 });
    expect(typeof body.sum).toBe('number');
  });

  test('GET /sum schema 完整性：顶层 keys 恰好 ["sum"]', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum?a=2&b=3`);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['sum']);
  });

  test('禁用字段 result 不存在（防漂移到 {result:5}）', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum?a=2&b=3`);
    const body = await res.json();
    expect(Object.prototype.hasOwnProperty.call(body, 'result')).toBe(false);
  });

  test('GET /sum?a=2 (b 缺失) → 400 + 非空 error 字段', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum?a=2`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  test('GET /sum (双参数都缺) → 400 + 非空 error', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  test('GET /sum?a=abc&b=3 (a 非数字) → 400 + error，且 body 不含 sum 字段', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum?a=abc&b=3`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(body, 'sum')).toBe(false);
  });

  test('GET /sum?a=-1&b=1 → 200 + {sum:0} (负数合法)', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum?a=-1&b=1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sum: 0 });
  });

  test('GET /sum?a=1.5&b=2.5 → 200 + {sum:4} (小数合法)', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum?a=1.5&b=2.5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sum: 4 });
  });

  test('GET /sum?a=0&b=0 → 200 + {sum:0} (零合法)', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/sum?a=0&b=0`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sum: 0 });
  });

  test('GET /health 仍 200 + {ok:true} (回归)', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});
