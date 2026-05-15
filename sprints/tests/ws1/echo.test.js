import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import app from '../../../playground/server.js';

const PORT = 3091;
let server;

async function get(path) {
  const res = await fetch(`http://localhost:${PORT}${path}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

beforeAll(() => new Promise((resolve) => {
  server = createServer(app).listen(PORT, resolve);
}));

afterAll(() => new Promise((resolve) => {
  server.close(resolve);
}));

describe('Workstream 1 — GET /echo [BEHAVIOR] (TDD Red: 改前全失败)', () => {
  test('GET /echo?msg=hello → 200 + {msg: "hello"}（字段值验证）', async () => {
    const { status, body } = await get('/echo?msg=hello');
    expect(status).toBe(200);
    expect(body.msg).toBe('hello');
  });

  test('response keys 完整性严格等于 ["msg"]（不允许多 key 不允许少 key）', async () => {
    const { status, body } = await get('/echo?msg=test');
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['msg']);
  });

  test('禁用字段 echo 不存在（反向检查）', async () => {
    const { status, body } = await get('/echo?msg=hello');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('echo');
  });

  test('GET /echo?msg= → 200 + {msg: ""}（空字符串边界，非 null 非 undefined）', async () => {
    const { status, body } = await get('/echo?msg=');
    expect(status).toBe(200);
    expect(body.msg).toBe('');
  });

  test('GET /echo（缺少 msg 参数）→ 400（error path）', async () => {
    const { status, body } = await get('/echo');
    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
  });
});
