/**
 * 收账权收归 — POST /harness/complete 不允许在 PR 未确认 MERGED 前收账
 * generator callback 提前收账（initiative_run.phase != 'done'）→ 409 打回
 * 终态只能来自：report 回写（phase=done 之后）或 watchdog 确认 MERGED
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../harness-judge.js', () => ({
  runJudgeGate: vi.fn(),
  runMechanicalPreflightChecks: vi.fn(() => null),
  checkJudgmentsWritten: vi.fn(async () => null),
}));

async function buildApp() {
  const { default: router } = await import('../routes/harness.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/harness', router);
  return a;
}

describe('POST /api/brain/harness/complete — 收账权收归', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('initiative_run.phase=generate（未 MERGED）→ 409 拒绝收账', async () => {
    // run 行存在且 phase != 'done'
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('initiative_runs') && sql.includes('SELECT')) {
        return { rows: [{ phase: 'generate' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/complete')
      .send({ initiative_id: 'aaaabbbb-cccc-dddd-eeee-111122223333' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/未达到.*done|prevent.*premature|提前收账|not.*done/i);
  });

  it('initiative_run.phase=evaluate（未 MERGED）→ 409 拒绝收账', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('initiative_runs') && sql.includes('SELECT')) {
        return { rows: [{ phase: 'evaluate' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/complete')
      .send({ initiative_id: 'aaaabbbb-cccc-dddd-eeee-111122223333' });
    expect(r.status).toBe(409);
  });

  it('initiative_run.phase=done（watchdog 已确认 MERGED）→ 允许收账，返回 200', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('initiative_runs') && sql.includes('SELECT')) {
        return { rows: [{ phase: 'done' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/complete')
      .send({ initiative_id: 'aaaabbbb-cccc-dddd-eeee-111122223333' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('initiative_run 行不存在（历史任务无 relay run）→ 允许收账（保守继续），返回 200', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('initiative_runs') && sql.includes('SELECT')) {
        return { rows: [], rowCount: 0 }; // 无 run 行
      }
      return { rows: [], rowCount: 1 };
    });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/complete')
      .send({ initiative_id: 'aaaabbbb-cccc-dddd-eeee-111122223333' });
    expect(r.status).toBe(200);
  });

  it('initiative_run 查询失败 → 保守继续（不因收账权检查而 500）', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('initiative_runs')) {
        throw new Error('DB error');
      }
      return { rows: [], rowCount: 1 };
    });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/complete')
      .send({ initiative_id: 'aaaabbbb-cccc-dddd-eeee-111122223333' });
    // 保守继续，不因检查失败而拒绝
    expect(r.status).toBe(200);
  });
});
