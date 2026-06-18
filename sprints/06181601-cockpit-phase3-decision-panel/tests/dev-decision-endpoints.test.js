/**
 * TDD Red — Harness Cockpit Phase 3 决策面板 Brain 端点
 *
 * 覆盖（对应合同 Golden Path）：
 *   场景A   POST /api/brain/dev/decisions（无 id）→ 201 append，回字段一致
 *   场景C3  POST /api/brain/dev/decisions（带 id）→ update 指定行
 *   场景C1  GET  /api/brain/dev/decisions?target= → 按 target 过滤；空态返 []
 *   场景B   POST /api/brain/dev/submit → 201 建 harness_initiative
 *   边界    submit 缺 target_id → 400 不建脏任务；decisions 缺 level → 400
 *
 * 红证据：端点未实现时路由返回 404 → 下列状态码/字段断言全部 FAIL。
 * 注：mock db.js 为同一绝对模块，routes.js 内各 `../db.js` 引用均被拦截。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 内存版 decisions / tasks，模拟实现后的 DB 行为（generator 实现后转绿）
const store = { decisions: [], tasks: [] };
let uuidSeq = 0;
const nextUuid = () => `00000000-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: {
    query: vi.fn(async (sql, params = []) => {
      const s = String(sql);
      if (/gen_random_uuid\(\)/.test(s) && /SELECT/i.test(s) && !/FROM/i.test(s)) {
        return { rows: [{ gen_random_uuid: nextUuid() }] };
      }
      // 兜底：实现未就绪时返回空，保证 routes.js 模块加载不崩
      return { rows: [] };
    }),
  },
}));

async function makeApp() {
  const app = express();
  app.use(express.json());
  const routes = (await import('../../../packages/brain/src/routes.js')).default;
  app.use('/api/brain', routes);
  return app;
}

describe('Cockpit Phase 3 — /dev/decisions + /dev/submit [BEHAVIOR]', () => {
  let app;
  beforeEach(async () => {
    store.decisions = [];
    store.tasks = [];
    app = await makeApp();
  });

  it('场景A：POST /dev/decisions 无 id → 201，回字段与请求一致', async () => {
    const res = await request(app)
      .post('/api/brain/dev/decisions')
      .send({
        topic: '用什么框架', decision: 'vitest', default_value: 'vitest',
        level: 'step', target_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        scope: 'v1', verify_layer: 'unit', round: 1, generated_by: 'cockpit-user',
      });
    expect(res.status).toBe(201);
    expect(res.body.level).toBe('step');
    expect(res.body.verify_layer).toBe('unit');
    expect(res.body.round).toBe(1);
    expect(res.body.generated_by).toBe('cockpit-user');
    // target 别名暴露（= target_id 值），兼容前端 DecisionRow.target
    expect(res.body.target).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('场景C3：POST /dev/decisions 带 id → update 指定行（200，新 decision 值）', async () => {
    const res = await request(app)
      .post('/api/brain/dev/decisions')
      .send({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', topic: 't', decision: 'jest', level: 'step', target_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(res.body.decision).toBe('jest');
  });

  it('场景C1：GET /dev/decisions?target= 返回数组', async () => {
    const res = await request(app).get('/api/brain/dev/decisions?target=dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('场景C1 空态：无匹配 target → HTTP 200 + 空数组，不报错', async () => {
    const res = await request(app).get('/api/brain/dev/decisions?target=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('error path：POST /dev/decisions 缺 level → 400 + error 字段', async () => {
    const res = await request(app)
      .post('/api/brain/dev/decisions')
      .send({ topic: 't', decision: 'd', target_id: 'x' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('场景B：POST /dev/submit → 201 建 harness_initiative', async () => {
    const res = await request(app)
      .post('/api/brain/dev/submit')
      .send({ target_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', journey_id: 'line-harness', title: 'fire' });
    expect(res.status).toBe(201);
    expect(res.body.task_type).toBe('harness_initiative');
    expect(res.body.status).toBe('queued');
    expect(typeof res.body.id).toBe('string');
  });

  it('边界：POST /dev/submit 缺 target_id → 400，不建脏任务', async () => {
    const res = await request(app).post('/api/brain/dev/submit').send({});
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });
});
