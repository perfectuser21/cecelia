import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../playground/server.js';

describe('Workstream 1 — GET /echo [BEHAVIOR] (TDD Red: 改前全失败)', () => {
  test('GET /echo?msg=hello → 200 + {msg: "hello"}（字段值验证）', async () => {
    const res = await request(app).get('/echo').query({ msg: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('hello');
  });

  test('response keys 完整性严格等于 ["msg"]（不允许多 key 不允许少 key）', async () => {
    const res = await request(app).get('/echo').query({ msg: 'test' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['msg']);
  });

  test('禁用字段 echo 不存在（反向检查）', async () => {
    const res = await request(app).get('/echo').query({ msg: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('echo');
  });

  test('GET /echo?msg= → 200 + {msg: ""}（空字符串边界，非 null 非 undefined）', async () => {
    const res = await request(app).get('/echo').query({ msg: '' });
    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('');
  });

  test('GET /echo（缺少 msg 参数）→ 400（error path）', async () => {
    const res = await request(app).get('/echo');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
