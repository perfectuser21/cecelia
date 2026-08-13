/**
 * harness-detail.test.js
 * 验证 GET /harness/initiative/:id/detail 端点（ws2 DoD）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const { default: harnessRouter } = await import('../routes/harness.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/harness', harnessRouter);
  return app;
}

const FAKE_ID = '00000000-0000-0000-0000-000000000001';

describe('GET /harness/initiative/:id/detail', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  function mockInitiativeExists() {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: FAKE_ID, result: null }] })  // tasks check（同查 result.report_content）
      .mockResolvedValueOnce({ rows: [] })                    // initiative_contracts
      .mockResolvedValueOnce({ rows: [] })                    // task_events
      .mockResolvedValueOnce({ rows: [] });                   // checkpoint_blobs
  }

  it('已存在 initiative 返回 HTTP 200', async () => {
    mockInitiativeExists();
    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
  });

  it('响应含 initiative_id (string) 且等于请求 id', async () => {
    mockInitiativeExists();
    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    expect(typeof res.body.initiative_id).toBe('string');
    expect(res.body.initiative_id).toBe(FAKE_ID);
  });

  it('响应含 step_timing (array) 和 screenshot_urls (array)', async () => {
    mockInitiativeExists();
    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.step_timing)).toBe(true);
    expect(Array.isArray(res.body.screenshot_urls)).toBe(true);
  });

  it('schema 完整性 — 顶层 keys 完全等于 PRD 定义 7 字段（含 report_content）', async () => {
    mockInitiativeExists();
    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    const actualKeys = Object.keys(res.body).sort();
    const expectedKeys = ['contract_content', 'gan_rounds', 'initiative_id', 'prd_content', 'report_content', 'screenshot_urls', 'step_timing'];
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('禁用字段不出现（steps/timeline/data/details/info/content）', async () => {
    mockInitiativeExists();
    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    // 注意：result/report 不再 banned — report_content 是闭环边界「展示」的专属字段。
    const banned = ['steps', 'timeline', 'data', 'details', 'info', 'content'];
    for (const field of banned) {
      expect(res.body).not.toHaveProperty(field);
    }
  });

  it('report_content 无数据时为 null', async () => {
    mockInitiativeExists();
    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.report_content).toBeNull();
  });

  it('tasks.result.report_content 有数据时原样返回契约对象', async () => {
    const contract = {
      contract_version: 1,
      initiative_id: FAKE_ID,
      verdict: 'PASS',
      change_summary: '加了 X 功能',
      next_action: '继续推进 Y',
      total_cost: 1.23,
      failed_scenarios: [],
      node_telemetry: [{ node: 'proposer', start_ts: null, end_ts: null, tokens: null, cost: null }],
      produced_assets: { skills: [], tests: [], decisions: [] },
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: FAKE_ID, result: { report_content: contract } }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.report_content).toEqual(contract);
    expect(res.body.report_content.verdict).toBe('PASS');
  });

  it('prd_content/contract_content 为 string|null，gan_rounds 为 number|null（无数据时默认 null）', async () => {
    mockInitiativeExists();
    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.prd_content === null || typeof res.body.prd_content === 'string').toBe(true);
    expect(res.body.contract_content === null || typeof res.body.contract_content === 'string').toBe(true);
    expect(res.body.gan_rounds === null || typeof res.body.gan_rounds === 'number').toBe(true);
  });

  it('initiative_contracts 有数据时正确返回 prd_content/contract_content/gan_rounds', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: FAKE_ID }] })
      .mockResolvedValueOnce({ rows: [{ prd_content: 'PRD 内容', contract_content: '合同正文', review_rounds: 3 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.prd_content).toBe('PRD 内容');
    expect(res.body.contract_content).toBe('合同正文');
    expect(res.body.gan_rounds).toBe(3);
  });

  it('task_events 有数据时 step_timing 返回正确条目', async () => {
    const fakeTs = new Date('2026-05-25T10:00:00Z');
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: FAKE_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ payload: { nodeName: 'proposer', attemptN: 1 }, created_at: fakeTs }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${FAKE_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.step_timing).toHaveLength(1);
    expect(res.body.step_timing[0].node).toBe('proposer');
    expect(res.body.step_timing[0].attempt).toBe(1);
  });

  it('不存在的 initiative → HTTP 404 + error 字段 (string)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/00000000-0000-0000-0000-000000000099/detail`);
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });
});

describe('GET /harness/sprint-docs path boundary', () => {
  it('拒绝目录穿越，不把 query 参数解释为任意文件系统路径', async () => {
    const res = await request(createApp())
      .get('/harness/sprint-docs')
      .query({ sprint_dir: '../../packages/brain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid sprint_dir');
  });
});
