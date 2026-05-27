/**
 * harness-notify-complete-endpoints.test.js
 *
 * 回归测试：POST /api/brain/harness/complete 和 POST /api/brain/harness/notify
 *
 * 修复背景：harness-report SKILL.md Step 2/5 调用这两个端点，
 * 但 Brain 从未实现，导致每次 harness-report 都 WARN 降级。
 *
 * DoD：
 * - [ARTIFACT] POST /harness/complete 端点存在，更新 tasks.status=completed
 * - [ARTIFACT] POST /harness/notify 端点存在，调用 notifier.js 发飞书
 * - [BEHAVIOR] 缺少 initiative_id 返回 400
 * - [BEHAVIOR] harness_complete type 走 notifyHarnessFinalE2E
 * - [BEHAVIOR] harness_task_merged type 走 notifyHarnessTaskMerged
 * - [BEHAVIOR] notifier 失败不 crash，仍返回 200
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

const mockNotifyFinalE2E = vi.hoisted(() => vi.fn());
const mockNotifyTaskMerged = vi.hoisted(() => vi.fn());
const mockSendFeishu = vi.hoisted(() => vi.fn());
vi.mock('../notifier.js', () => ({
  notifyHarnessFinalE2E: mockNotifyFinalE2E,
  notifyHarnessTaskMerged: mockNotifyTaskMerged,
  sendFeishu: mockSendFeishu,
}));

import request from 'supertest';
import express from 'express';
import router from '../routes/harness.js';

const app = express();
app.use(express.json());
app.use('/harness', router);

describe('POST /harness/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('缺少 initiative_id 返回 400', async () => {
    const res = await request(app).post('/harness/complete').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/initiative_id/);
  });

  it('更新 task status=completed，写入 pr_url', async () => {
    const res = await request(app).post('/harness/complete').send({
      initiative_id: 'test-init-001',
      pr_url: 'https://github.com/org/repo/pull/100',
      sprint_dir: '/tmp/sprint',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE tasks/);
    expect(params[1]).toBe('test-init-001');
    const result = JSON.parse(params[0]);
    expect(result.pr_url).toBe('https://github.com/org/repo/pull/100');
  });

  it('DB 报错时返回 500', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));
    const res = await request(app).post('/harness/complete').send({ initiative_id: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('POST /harness/notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyFinalE2E.mockResolvedValue(true);
    mockNotifyTaskMerged.mockResolvedValue(true);
    mockSendFeishu.mockResolvedValue(true);
  });

  it('缺少 type 或 title 返回 400', async () => {
    const r1 = await request(app).post('/harness/notify').send({ title: 'x' });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/harness/notify').send({ type: 'general' });
    expect(r2.status).toBe(400);
  });

  it('type=harness_complete 调用 notifyHarnessFinalE2E', async () => {
    const res = await request(app).post('/harness/notify').send({
      type: 'harness_complete',
      title: '✅ 功能 X 完成',
      initiative_id: 'init-abc',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockNotifyFinalE2E).toHaveBeenCalledWith(
      expect.objectContaining({ initiative_id: 'init-abc', verdict: 'PASS' })
    );
  });

  it('type=harness_task_merged 调用 notifyHarnessTaskMerged', async () => {
    const res = await request(app).post('/harness/notify').send({
      type: 'harness_task_merged',
      title: 'WS1 — fix something',
      pr_url: 'https://github.com/org/repo/pull/101',
      task_id: 'task-xyz',
    });
    expect(res.status).toBe(200);
    expect(mockNotifyTaskMerged).toHaveBeenCalledWith(
      expect.objectContaining({ pr_url: 'https://github.com/org/repo/pull/101' })
    );
  });

  it('type=general 调用 sendFeishu', async () => {
    const res = await request(app).post('/harness/notify').send({
      type: 'general',
      title: '普通通知',
      message: '内容',
    });
    expect(res.status).toBe(200);
    expect(mockSendFeishu).toHaveBeenCalledWith('普通通知\n内容');
  });

  it('notifier 抛错时返回 500 不 crash', async () => {
    mockNotifyFinalE2E.mockRejectedValue(new Error('feishu timeout'));
    const res = await request(app).post('/harness/notify').send({
      type: 'harness_complete',
      title: 'test',
    });
    expect(res.status).toBe(500);
  });
});
