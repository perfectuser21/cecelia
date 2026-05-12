// W34 TDD red 证据 — 不依赖 supertest（playground/node_modules 不在仓库根 resolution path）
// 用 node:child_process 启 playground/server.js，原生 fetch hit /uppercase
// 当前 server.js 无 /uppercase 路由 → Express 默认 404 → 全部断言失败 = real red
//
// 跑法：cd /workspace && npx vitest run sprints/w34-walking-skeleton-happy-v2/tests/ws1/uppercase.test.ts
//
// 真红→绿 anchor: generator 在 playground/server.js 加 /uppercase 路由 + 在 playground/tests/server.test.js:1442 起加 describe 块后，
//                  本文件全绿 + playground 仓内 vitest 全绿

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3399;
const BASE = `http://localhost:${PORT}`;
let proc: ChildProcess | null = null;

beforeAll(async () => {
  // 用绝对路径 + 仓库根 cwd，避免 vitest worker cwd 偏移；inherit stderr 便于诊断
  const repoRoot = process.cwd();
  proc = spawn('node', ['playground/server.js'], {
    cwd: repoRoot,
    // 关键：playground/server.js 只在 NODE_ENV!=='test' 时 app.listen()；vitest 把 NODE_ENV 设为 test
    // 须显式覆盖为 'development'，否则 spawn 出来的 server 直接 export 返主进程不 bind 端口
    env: { ...process.env, PLAYGROUND_PORT: String(PORT), NODE_ENV: 'development' },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: false,
  });
  proc.on('error', (e) => console.error('spawn error:', e));
  proc.on('exit', (code, sig) => console.error('server exit code=', code, 'sig=', sig));
  // 轮询 readiness 而不是固定 sleep
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status === 200) break;
    } catch { /* not yet */ }
    await sleep(200);
  }
}, 15_000);

afterAll(async () => {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    await sleep(200);
  }
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`);
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

describe('GET /uppercase — happy path (TDD red evidence)', () => {
  test('GET /uppercase?text=hello → 200 + {result:"HELLO", operation:"uppercase"}', async () => {
    const r = await get('/uppercase?text=hello');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: 'HELLO', operation: 'uppercase' });
  });

  test('GET /uppercase?text=a → 200 + {result:"A", operation:"uppercase"}（单字符 happy）', async () => {
    const r = await get('/uppercase?text=a');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: 'A', operation: 'uppercase' });
  });

  test('GET /uppercase?text=Z → 200 + {result:"Z", operation:"uppercase"}（单字符大写 happy）', async () => {
    const r = await get('/uppercase?text=Z');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: 'Z', operation: 'uppercase' });
  });

  test('GET /uppercase?text=HELLO → 200 + {result:"HELLO", operation:"uppercase"}（已大写幂等）', async () => {
    const r = await get('/uppercase?text=HELLO');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: 'HELLO', operation: 'uppercase' });
  });

  test('GET /uppercase?text=AbCdEf → 200 + {result:"ABCDEF", operation:"uppercase"}（混合大小写）', async () => {
    const r = await get('/uppercase?text=AbCdEf');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: 'ABCDEF', operation: 'uppercase' });
  });

  test('happy 响应 operation 严字面字符串 "uppercase"', async () => {
    const r = await get('/uppercase?text=hello');
    expect(r.status).toBe(200);
    expect(r.body?.operation).toBe('uppercase');
    expect(typeof r.body?.result).toBe('string');
  });
});

describe('GET /uppercase — schema 完整性 oracle', () => {
  test('happy 响应顶层 keys 字面集合 == ["operation","result"]', async () => {
    const r = await get('/uppercase?text=hello');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body ?? {}).sort()).toEqual(['operation', 'result']);
  });

  test('happy 响应不含禁用字段 uppercased / upper / transformed / mapped / output', async () => {
    const r = await get('/uppercase?text=hello');
    expect(r.status).toBe(200);
    for (const bad of ['uppercased', 'upper', 'upper_text', 'transformed', 'transformed_text', 'mapped', 'output']) {
      expect(r.body).not.toHaveProperty(bad);
    }
  });

  test('happy 响应不含 generic 禁用字段 value / input / data / payload / response / answer / meta / original', async () => {
    const r = await get('/uppercase?text=hello');
    expect(r.status).toBe(200);
    for (const bad of ['value', 'input', 'text', 'data', 'payload', 'response', 'answer', 'out', 'meta', 'original']) {
      expect(r.body).not.toHaveProperty(bad);
    }
  });

  test('happy 响应不含跨 endpoint 禁用字段 sum / product / quotient / power / remainder / factorial / negation', async () => {
    const r = await get('/uppercase?text=hello');
    expect(r.status).toBe(200);
    for (const bad of ['sum', 'product', 'quotient', 'power', 'remainder', 'factorial', 'negation']) {
      expect(r.body).not.toHaveProperty(bad);
    }
  });
});

describe('GET /uppercase — strict-schema 拒（非法字符）', () => {
  test('GET /uppercase?text= → 400（空串）', async () => {
    const r = await get('/uppercase?text=');
    expect(r.status).toBe(400);
    expect(typeof r.body?.error).toBe('string');
    expect((r.body?.error ?? '').length).toBeGreaterThan(0);
    expect(r.body).not.toHaveProperty('result');
    expect(r.body).not.toHaveProperty('operation');
  });

  test('GET /uppercase?text=hello123 → 400（含数字）', async () => {
    const r = await get('/uppercase?text=hello123');
    expect(r.status).toBe(400);
    expect(typeof r.body?.error).toBe('string');
  });

  test('GET /uppercase?text=hello%20world → 400（含空格）', async () => {
    const r = await get('/uppercase?text=hello%20world');
    expect(r.status).toBe(400);
  });

  test('GET /uppercase?text=hello-world → 400（含短横线）', async () => {
    const r = await get('/uppercase?text=hello-world');
    expect(r.status).toBe(400);
  });

  test('GET /uppercase?text=hello_world → 400（含下划线）', async () => {
    const r = await get('/uppercase?text=hello_world');
    expect(r.status).toBe(400);
  });

  test('GET /uppercase?text=hello! → 400（含标点）', async () => {
    const r = await get('/uppercase?text=hello%21');
    expect(r.status).toBe(400);
  });

  test('GET /uppercase?text=café → 400（Unicode 字母 é）', async () => {
    const r = await get('/uppercase?text=caf%C3%A9');
    expect(r.status).toBe(400);
  });

  test('GET /uppercase?text=中文 → 400（CJK）', async () => {
    const r = await get('/uppercase?text=%E4%B8%AD%E6%96%87');
    expect(r.status).toBe(400);
  });

  test('GET /uppercase?text=123 → 400（纯数字）', async () => {
    const r = await get('/uppercase?text=123');
    expect(r.status).toBe(400);
  });
});

describe('GET /uppercase — 缺参 / 错 query 名 / 多 query 名', () => {
  test('GET /uppercase（无 query）→ 400', async () => {
    const r = await get('/uppercase');
    expect(r.status).toBe(400);
    expect(typeof r.body?.error).toBe('string');
    expect(r.body).not.toHaveProperty('result');
    expect(r.body).not.toHaveProperty('operation');
  });

  test('GET /uppercase?value=hello（错 query 名 value）→ 400', async () => {
    const r = await get('/uppercase?value=hello');
    expect(r.status).toBe(400);
  });

  test('GET /uppercase?input=hello（错 query 名 input）→ 400', async () => {
    const r = await get('/uppercase?input=hello');
    expect(r.status).toBe(400);
  });

  test('GET /uppercase?text=hello&text=world（多 text query）→ 400', async () => {
    const r = await get('/uppercase?text=hello&text=world');
    expect(r.status).toBe(400);
  });

  test('strict 拒错误体顶层 keys 字面集合 == ["error"]', async () => {
    const r = await get('/uppercase?text=hello123');
    expect(r.status).toBe(400);
    expect(Object.keys(r.body ?? {}).sort()).toEqual(['error']);
  });
});

describe('GET /uppercase — 8 路由回归不破坏', () => {
  test('/health 仍返 {ok:true}', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  test('/sum?a=2&b=3 仍返 {sum:5}', async () => {
    const r = await get('/sum?a=2&b=3');
    expect(r.status).toBe(200);
    expect(r.body?.sum).toBe(5);
  });

  test('/multiply?a=7&b=5 仍返 {product:35}', async () => {
    const r = await get('/multiply?a=7&b=5');
    expect(r.status).toBe(200);
    expect(r.body?.product).toBe(35);
  });

  test('/divide?a=10&b=2 仍返 {quotient:5}', async () => {
    const r = await get('/divide?a=10&b=2');
    expect(r.status).toBe(200);
    expect(r.body?.quotient).toBe(5);
  });

  test('/power?a=2&b=3 仍返 {power:8}', async () => {
    const r = await get('/power?a=2&b=3');
    expect(r.status).toBe(200);
    expect(r.body?.power).toBe(8);
  });

  test('/modulo?a=7&b=3 仍返 {remainder:1}', async () => {
    const r = await get('/modulo?a=7&b=3');
    expect(r.status).toBe(200);
    expect(r.body?.remainder).toBe(1);
  });

  test('/factorial?n=5 仍返 {factorial:120}', async () => {
    const r = await get('/factorial?n=5');
    expect(r.status).toBe(200);
    expect(r.body?.factorial).toBe(120);
  });

  test('/increment?value=10 仍返 {result:11, operation:"increment"}', async () => {
    const r = await get('/increment?value=10');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: 11, operation: 'increment' });
  });
});
