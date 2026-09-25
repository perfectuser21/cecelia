/**
 * POST /api/brain/tasks —— 决策分档机械守卫（决策 105a5868，链 bf5088a3 棒5，任务 3fad28e0）。
 *
 *  守卫 1  goal_id 给了必须是 key_results.id（Objective id → 400，不然任务被派发白名单静默过滤）
 *  守卫 2  status=blocked + blocked_reason=owner_decision 必须带协议，缺项 400；
 *          waiting_on=human 才生成 pending_action，machine 不进主理人待办
 *  依赖    depends_on 建单后写进 task_dependencies（单一写口），不存在的依赖 400
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));
vi.mock('../domain-detector.js', () => ({ detectDomain: () => ({ domain: 'growth' }) }));
vi.mock('../task-updater.js', () => ({ blockTask: vi.fn() }));
vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(),
  FAILURE_CLASS: { NETWORK: 'network', RATE_LIMIT: 'rate_limit', BILLING_CAP: 'billing_cap', AUTH: 'auth', RESOURCE: 'resource' },
}));

const { default: taskTasksRouter } = await import('../routes/task-tasks.js');

const KR = '11111111-1111-4111-8111-111111111111';
const OBJ = '22222222-2222-4222-8222-222222222222';
const DEP = '33333333-3333-4333-8333-333333333333';
const NEW_ID = '44444444-4444-4444-8444-444444444444';

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/brain/tasks', taskTasksRouter);
  return a;
};

const base = {
  title: '守卫测试任务',
  task_type: 'research',
  description: '一段足够长的任务描述，用来通过入口归一化。',
};

const goodDetail = () => ({
  question: '要不要把 X 摘掉？',
  options: ['A 摘', 'B 留'],
  default: 'B 留',
  deadline: '2099-01-01T00:00:00Z',
  reversible: true,
  waiting_on: 'human',
});

function sqlLog() { return queryMock.mock.calls.map(([sql]) => String(sql)); }

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql) => {
    if (/FROM key_results WHERE id/.test(sql)) return { rows: [{ id: KR, status: 'active' }] };
    if (/FROM objectives WHERE id/.test(sql)) return { rows: [{ id: OBJ, title: '某 Objective' }] };
    if (/FROM key_results WHERE objective_id/.test(sql)) return { rows: [{ id: KR, title: 'KR-1', status: 'active' }] };
    if (/SELECT id FROM tasks WHERE id = ANY/.test(sql)) return { rows: [{ id: DEP }] };
    if (/INSERT INTO tasks/.test(sql)) {
      return { rows: [{ id: NEW_ID, title: 't', status: 'queued', task_type: 'research', priority: 'P2', payload: {}, created_at: '2026-09-25T00:00:00Z' }] };
    }
    if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: 'receipt-1' }] };
    if (/INSERT INTO pending_actions/.test(sql)) return { rows: [{ id: 'pa-1' }] };
    return { rows: [] };
  });
});

describe('守卫 1：goal_id 必须是 KR 级', () => {
  it('违规输入被拒：goal_id=Objective id → 400 goal_id_not_key_result，且不 INSERT', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (/FROM key_results WHERE id/.test(sql)) return { rows: [] };
      if (/FROM objectives WHERE id/.test(sql)) return { rows: [{ id: OBJ, title: '某 Objective' }] };
      if (/FROM key_results WHERE objective_id/.test(sql)) return { rows: [{ id: KR, title: 'KR-1', status: 'active' }] };
      return { rows: [] };
    });
    const res = await request(app()).post('/api/brain/tasks').send({ ...base, goal_id: OBJ });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('goal_id_not_key_result');
    expect(res.body.details.is_objective).toBe(true);
    expect(res.body.details.key_results[0].id).toBe(KR);
    expect(sqlLog().some((s) => /INSERT INTO tasks/.test(s))).toBe(false);
  });

  it('goal_id=合法 KR → 201', async () => {
    const res = await request(app()).post('/api/brain/tasks').send({ ...base, goal_id: KR });
    expect(res.status).toBe(201);
  });

  it('不给 goal_id → 行为不变（201，且不查 key_results）', async () => {
    const res = await request(app()).post('/api/brain/tasks').send(base);
    expect(res.status).toBe(201);
    expect(sqlLog().some((s) => /key_results/.test(s))).toBe(false);
  });
});

describe('守卫 2：blocked=owner_decision 必须带协议', () => {
  it('违规输入被拒：status=blocked + owner_decision 无 blocked_detail → 400 且不 INSERT', async () => {
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, status: 'blocked', blocked_reason: 'owner_decision' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('owner_decision_protocol_violation');
    expect(res.body.violations.map((v) => v.field)).toEqual(
      expect.arrayContaining(['question', 'options', 'default', 'deadline', 'reversible', 'waiting_on']),
    );
    expect(sqlLog().some((s) => /INSERT INTO tasks/.test(s))).toBe(false);
  });

  it('违规输入被拒：options 只有 1 项 → 400', async () => {
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, status: 'blocked', blocked_reason: 'owner_decision', blocked_detail: { ...goodDetail(), options: ['A'] } });
    expect(res.status).toBe(400);
    expect(res.body.violations.map((v) => v.field)).toContain('options');
  });

  it('违规输入被拒：给了 blocked_reason 却不是 blocked 状态 → 400', async () => {
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, blocked_reason: 'owner_decision', blocked_detail: goodDetail() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('blocked_reason_requires_blocked_status');
  });

  it('完整协议 + waiting_on=human → 201 且生成 pending_action', async () => {
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, status: 'blocked', blocked_reason: 'owner_decision', blocked_detail: goodDetail() });
    expect(res.status).toBe(201);
    expect(sqlLog().some((s) => /INSERT INTO pending_actions/.test(s))).toBe(true);
  });

  it('完整协议 + waiting_on=machine → 201 但不生成 pending_action（不进主理人待办）', async () => {
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, status: 'blocked', blocked_reason: 'owner_decision', blocked_detail: { ...goodDetail(), waiting_on: 'machine' } });
    expect(res.status).toBe(201);
    expect(sqlLog().some((s) => /INSERT INTO pending_actions/.test(s))).toBe(false);
  });

  it('其它 blocked_reason（billing_cap）不受协议约束', async () => {
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, status: 'blocked', blocked_reason: 'billing_cap' });
    expect(res.status).toBe(201);
  });
});

describe('依赖单一写口：depends_on 建单后进 task_dependencies', () => {
  it('depends_on=[存在的任务] → 201 且写一条 hard 边', async () => {
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, payload: { depends_on: [DEP] } });
    expect(res.status).toBe(201);
    const ins = queryMock.mock.calls.find(([sql]) => /INSERT INTO task_dependencies/.test(sql));
    expect(ins).toBeTruthy();
    expect(JSON.stringify(ins[1])).toContain(DEP);
  });

  it('违规输入被拒：depends_on 里有不存在的任务 → 400 depends_on_not_found，且不 INSERT', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (/SELECT id FROM tasks WHERE id = ANY/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, payload: { depends_on: [DEP] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('depends_on_not_found');
    expect(res.body.missing).toEqual([DEP]);
    expect(sqlLog().some((s) => /INSERT INTO tasks/.test(s))).toBe(false);
  });

  it('违规输入被拒：depends_on 不是 uuid 数组 → 400 invalid_depends_on', async () => {
    const res = await request(app()).post('/api/brain/tasks')
      .send({ ...base, payload: { depends_on: ['不是uuid'] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_depends_on');
  });
});
