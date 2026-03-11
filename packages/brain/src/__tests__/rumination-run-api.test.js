/**
 * POST /api/brain/inner-life/run — 手动触发反刍端点测试
 *
 * 覆盖：force=false 正常路径、force=true 绕过预算路径、错误处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock 设置 ──────────────────────────────────────────────

const mockRunManualRumination = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../rumination.js', () => ({
  DAILY_BUDGET: 20,
  runManualRumination: mockRunManualRumination,
}));

// ── 测试 app 设置 ──────────────────────────────────────────

import router from '../routes/inner-life.js';

const app = express();
app.use(express.json());
app.use('/api/brain/inner-life', router);

// ── 测试 ──────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/brain/inner-life/run', () => {
  it('force=false（默认）：预算充足时正常消化并返回结果', async () => {
    mockRunManualRumination.mockResolvedValueOnce({
      digested: 3,
      insights: ['[反刍洞察] 测试洞察'],
      manual: true,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '57' }] }); // 剩余积压

    const res = await request(app)
      .post('/api/brain/inner-life/run')
      .send({ force: false });

    expect(res.status).toBe(200);
    expect(res.body.digested).toBe(3);
    expect(res.body.manual).toBe(true);
    expect(res.body.remaining_backlog).toBe(57);
    expect(mockRunManualRumination).toHaveBeenCalledWith(undefined, { force: false });
  });

  it('force=false（默认）：预算耗尽时返回 skipped=daily_budget_exhausted', async () => {
    mockRunManualRumination.mockResolvedValueOnce({
      skipped: 'daily_budget_exhausted',
      digested: 0,
      insights: [],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '60' }] }); // 剩余积压

    const res = await request(app)
      .post('/api/brain/inner-life/run')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe('daily_budget_exhausted');
    expect(res.body.digested).toBe(0);
    expect(res.body.remaining_backlog).toBe(60);
    // 默认 force=false
    expect(mockRunManualRumination).toHaveBeenCalledWith(undefined, { force: false });
  });

  it('force=true：即使预算耗尽也能触发消化', async () => {
    mockRunManualRumination.mockResolvedValueOnce({
      digested: 5,
      insights: ['[反刍洞察] 强制模式洞察'],
      manual: true,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '55' }] }); // 剩余积压

    const res = await request(app)
      .post('/api/brain/inner-life/run')
      .send({ force: true });

    expect(res.status).toBe(200);
    expect(res.body.digested).toBe(5);
    expect(res.body.remaining_backlog).toBe(55);
    expect(mockRunManualRumination).toHaveBeenCalledWith(undefined, { force: true });
  });

  it('runManualRumination 抛出异常时返回 500', async () => {
    mockRunManualRumination.mockRejectedValueOnce(new Error('LLM timeout'));

    const res = await request(app)
      .post('/api/brain/inner-life/run')
      .send({ force: false });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('LLM timeout');
  });

  it('body 为空时默认 force=false', async () => {
    mockRunManualRumination.mockResolvedValueOnce({
      digested: 2,
      insights: [],
      manual: true,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '10' }] });

    const res = await request(app)
      .post('/api/brain/inner-life/run');

    expect(res.status).toBe(200);
    expect(mockRunManualRumination).toHaveBeenCalledWith(undefined, { force: false });
  });
});
