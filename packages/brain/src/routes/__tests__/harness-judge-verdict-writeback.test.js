/**
 * 刀C2（决策 dc18d43d）：POST /harness/judge 判定后自写 initiative_runs.judge_verdict，
 * 不再依赖 controller 容器内二次 curl PATCH /relay-runs/:id 上报（dogfooding 实证 LLM 不上报）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const poolQuery = vi.fn();
vi.mock('../../db.js', () => ({
  default: { query: (...a) => poolQuery(...a) },
}));

vi.mock('../../harness-judge.js', () => ({
  runJudgeGate: vi.fn(async () => ({ verdict: 'PASS', feedback: null, judged: true })),
  runMechanicalGate: vi.fn(async () => ({ pass: true, reasons: [] })),
  runMechanicalPreflightChecks: vi.fn(() => null),   // 默认通过
  checkJudgmentsWritten: vi.fn(async () => null),    // 默认通过
}));

let app;
let worktree;

beforeEach(async () => {
  vi.clearAllMocks();
  worktree = mkdtempSync(join(tmpdir(), 'judge-writeback-'));
  poolQuery.mockImplementation(async (sql, params = []) => {
    if (typeof sql === 'string' && sql.includes('SELECT r.id')) {
      return {
        rows: [{
          id: params[0],
          current_task_id: '11111111-2222-3333-4444-555555555555',
          worktree_path: worktree,
          sprint_dir: 'sprints/judge-writeback',
        }],
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const routerMod = await import('../harness.js');
  app = express();
  app.use(express.json());
  app.use('/', routerMod.default);
});

afterEach(() => {
  try { rmSync(worktree, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

function callJudge(overrides = {}) {
  return request(app).post('/judge').send({
    task_id: '11111111-2222-3333-4444-555555555555', // uuid 入口校验（c682c9c87）要求合法 uuid
    run_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    sprint_dir: 'sprints/judge-writeback',
    worktree,
    agent_verdict: 'PASS',
    ...overrides,
  });
}

describe('C2: /judge 判定后自写 initiative_runs.judge_verdict', () => {
  it('judged=true → UPDATE judge_verdict 以 run_id 精确定位并核对 task identity', async () => {
    const res = await callJudge();
    expect(res.status).toBe(200);
    const upd = poolQuery.mock.calls.find(([sql]) => /UPDATE initiative_runs\s+SET judge_verdict/i.test(sql));
    expect(upd, '必须 UPDATE initiative_runs.judge_verdict').toBeTruthy();
    expect(upd[0]).toMatch(/WHERE id = \$2/);
    expect(upd[0]).toMatch(/current_task_id/);
    expect(upd[0]).toMatch(/IS DISTINCT FROM 'PASS'/);
    expect(upd[1]).toContain('PASS');
    expect(upd[1]).toContain('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(upd[1]).toContain('11111111-2222-3333-4444-555555555555');
  });

  it('UPDATE 抛错 → non-fatal，响应仍带裁决', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      if (typeof sql === 'string' && sql.includes('SELECT r.id')) {
        return {
          rows: [{
            id: params[0],
            current_task_id: '11111111-2222-3333-4444-555555555555',
            worktree_path: worktree,
            sprint_dir: 'sprints/judge-writeback',
          }],
        };
      }
      if (/UPDATE initiative_runs\s+SET judge_verdict/i.test(sql)) throw new Error('db down');
      return { rows: [], rowCount: 0 };
    });
    const res = await callJudge();
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('PASS');
  });
});
