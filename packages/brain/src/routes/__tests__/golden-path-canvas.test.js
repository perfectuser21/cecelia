// Crystal 件7（手动v3）：map↔画布对齐——只读画布生成器 + run 终态回写端点
// map=SSOT：golden_path 表（L4 step，order_no）→ n8n V4 画布 stages JSON
// 死规矩：stage 元数据必须显式携带 step_id（判定点 e66cf847——name 会改、number 会插队，回写不能打错格子）
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../abilities.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const OWNER = '11111111-1111-1111-1111-111111111111';
const STEP1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const STEP2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';

function canvasRows() {
  return [
    {
      id: STEP1, order_no: 1, note: '预检设备与账号', feature_id: 'f-1',
      feature_name: '手机预检', workflow_ref: 'douyin-phone-runtime',
      thickness: 'thin', feature_status: 'planned',
      last_run_id: null, last_verdict: null, last_run_at: null,
    },
    {
      id: STEP2, order_no: 3, note: null, feature_id: 'f-2',
      feature_name: '视频发现', workflow_ref: 'social-video-discovery',
      thickness: 'medium', feature_status: 'working',
      last_run_id: 'run-9', last_verdict: 'completed', last_run_at: '2026-09-06T00:00:00Z',
    },
  ];
}

describe('GET /golden_path/canvas（只读画布生成器）', () => {
  beforeEach(() => mockQuery.mockReset());

  it('缺 owner_task_id 返回 400', async () => {
    const res = await (await req())(await makeApp()).get('/api/brain/golden_path/canvas');
    expect(res.status).toBe(400);
  });

  it('owner_task_id 不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tasks 查不到
    const res = await (await req())(await makeApp())
      .get(`/api/brain/golden_path/canvas?owner_task_id=${OWNER}`);
    expect(res.status).toBe(404);
  });

  it('golden_path 为空返回 404（没有 step 生成不了画布）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: OWNER, title: 'T' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await (await req())(await makeApp())
      .get(`/api/brain/golden_path/canvas?owner_task_id=${OWNER}`);
    expect(res.status).toBe(404);
  });

  it('生成 V4 兼容 stages：顺序=order_no、index 连续、每格嵌 step_id/feature_id/skill', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: OWNER, title: '获客画布任务' }] });
    mockQuery.mockResolvedValueOnce({ rows: canvasRows() });
    const res = await (await req())(await makeApp())
      .get(`/api/brain/golden_path/canvas?owner_task_id=${OWNER}`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('golden_path');
    expect(res.body.owner_task_id).toBe(OWNER);
    expect(res.body.canvas_name).toBe('获客画布任务');
    expect(res.body.total_steps).toBe(2);
    const [s1, s2] = res.body.stages;
    // V4 黄金格式字段（id/skill/label/objective/index/max_attempts）
    expect(s1).toMatchObject({
      id: 'step-1', index: 1, order_no: 1,
      step_id: STEP1, feature_id: 'f-1',
      skill: 'douyin-phone-runtime', label: '手机预检',
      objective: '预检设备与账号', max_attempts: 2,
      maturity: 'thin', feature_status: 'planned',
    });
    // order_no 有洞（1,3）时 index 仍连续（V4 按数组下标取 stage）
    expect(s2.index).toBe(2);
    expect(s2.order_no).toBe(3);
    expect(s2.id).toBe('step-2');
    expect(s2.step_id).toBe(STEP2);
    // note 为空时 objective 退化为空串，不是 null（V4 合同节点字符串字段）
    expect(s2.objective).toBe('');
    // 体检表：最近回执随格子带出
    expect(s2.last_run).toMatchObject({ run_id: 'run-9', verdict: 'completed' });
    expect(s1.last_run).toBeNull();
  });

  it('feature 悬空（feature_id 为 null）时 stage 仍生成，skill 为 null、label 退化为 note', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: OWNER, title: 'T' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: STEP1, order_no: 1, note: '孤儿步骤', feature_id: null,
        feature_name: null, workflow_ref: null, thickness: null, feature_status: null,
        last_run_id: null, last_verdict: null, last_run_at: null,
      }],
    });
    const res = await (await req())(await makeApp())
      .get(`/api/brain/golden_path/canvas?owner_task_id=${OWNER}`);
    expect(res.status).toBe(200);
    expect(res.body.stages[0]).toMatchObject({ skill: null, label: '孤儿步骤' });
  });

  it('非法 owner_task_id（非 uuid）返回 400 而非 500', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('bad uuid'), { code: '22P02' }));
    const res = await (await req())(await makeApp())
      .get('/api/brain/golden_path/canvas?owner_task_id=not-a-uuid');
    expect(res.status).toBe(400);
  });
});

describe('POST /golden_path/:id/run-result（run 终态回写）', () => {
  beforeEach(() => mockQuery.mockReset());

  it('缺 run_id 返回 400', async () => {
    const res = await (await req())(await makeApp())
      .post(`/api/brain/golden_path/${STEP1}/run-result`).send({ verdict: 'completed' });
    expect(res.status).toBe(400);
  });

  it('verdict 不在封闭词表（completed|failed）返回 400', async () => {
    const res = await (await req())(await makeApp())
      .post(`/api/brain/golden_path/${STEP1}/run-result`)
      .send({ run_id: 'run-1', verdict: 'accepted' });
    expect(res.status).toBe(400);
  });

  it('step 不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // golden_path 查不到
    const res = await (await req())(await makeApp())
      .post(`/api/brain/golden_path/${STEP1}/run-result`)
      .send({ run_id: 'run-1', verdict: 'completed' });
    expect(res.status).toBe(404);
  });

  it('completed 且 feature 为 planned → 单级推进 working（禁跳级）并写回执', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: STEP1, feature_id: 'f-1', feature_status: 'planned' }],
    }); // 查 step + feature
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rcpt-1' }] }); // INSERT 回执
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f-1', status: 'working' }] }); // UPDATE feature
    const res = await (await req())(await makeApp())
      .post(`/api/brain/golden_path/${STEP1}/run-result`)
      .send({ run_id: 'run-1', verdict: 'completed', evidence: { pr: 'x' } });
    expect(res.status).toBe(201);
    expect(res.body.feature_promotion).toMatchObject({ from: 'planned', to: 'working' });
    // UPDATE 必须带 status='planned' 条件（防并发覆盖人工状态）
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE journey_features/.test(sql));
    expect(updateCall[0]).toMatch(/status\s*=\s*'planned'/);
  });

  it('completed 但 feature 已是 working → 不推进，只写回执', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: STEP1, feature_id: 'f-1', feature_status: 'working' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rcpt-2' }] });
    const res = await (await req())(await makeApp())
      .post(`/api/brain/golden_path/${STEP1}/run-result`)
      .send({ run_id: 'run-2', verdict: 'completed' });
    expect(res.status).toBe(201);
    expect(res.body.feature_promotion).toBeNull();
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE journey_features/.test(sql))).toBe(false);
  });

  it('failed → 只写回执，绝不推进成熟度', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: STEP1, feature_id: 'f-1', feature_status: 'planned' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rcpt-3' }] });
    const res = await (await req())(await makeApp())
      .post(`/api/brain/golden_path/${STEP1}/run-result`)
      .send({ run_id: 'run-3', verdict: 'failed' });
    expect(res.status).toBe(201);
    expect(res.body.feature_promotion).toBeNull();
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE journey_features/.test(sql))).toBe(false);
  });

  it('同 (step, run_id) 重放 → 幂等 200，不重复写回执、不二次推进', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: STEP1, feature_id: 'f-1', feature_status: 'working' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT ... ON CONFLICT DO NOTHING → 0 行
    const res = await (await req())(await makeApp())
      .post(`/api/brain/golden_path/${STEP1}/run-result`)
      .send({ run_id: 'run-1', verdict: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE journey_features/.test(sql))).toBe(false);
  });
});
