/**
 * 刀B + 刀C-2 — judge API 机械校验 + judge_verdict 落库集成测试（TDD）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockPool, mockRunJudgeGate } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockRunJudgeGate: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../harness-judge.js', () => ({
  runJudgeGate: mockRunJudgeGate,
  runMechanicalPreflightChecks: vi.fn(() => null),    // 默认通过
  checkJudgmentsWritten: vi.fn(async () => null),     // 默认通过
  runMechanicalGate: vi.fn(async () => ({ pass: true, reasons: [] })),
}));

import {
  runMechanicalPreflightChecks as mockPreflight,
  checkJudgmentsWritten as mockJudgmentsCheck,
} from '../harness-judge.js';

async function buildApp() {
  const { default: router } = await import('../routes/harness.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/harness', router);
  return a;
}

function installAuthorityMock({ worktree, taskId, updateError = null }) {
  mockPool.query.mockImplementation(async (sql, params = []) => {
    if (typeof sql === 'string' && sql.includes('SELECT r.id')) {
      const exact = sql.includes('WHERE r.id = $1');
      return {
        rows: [{
          id: exact ? params[0] : '11111111-2222-4333-8444-555555555555',
          current_task_id: taskId,
          worktree_path: worktree,
          sprint_dir: 'sprints/x',
        }],
      };
    }
    if (
      updateError
      && typeof sql === 'string'
      && sql.includes('UPDATE initiative_runs')
    ) {
      throw updateError;
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('POST /api/brain/harness/judge — 刀B 机械预检', () => {
  let wt;
  beforeEach(async () => {
    wt = await mkdtemp(join(tmpdir(), 'judge-blade-'));
    mockRunJudgeGate.mockReset();
    mockPool.query.mockReset();
    installAuthorityMock({
      worktree: wt,
      taskId: 'aaaabbbb-1111-2222-3333-444455556666',
    });
    vi.mocked(mockPreflight).mockReturnValue(null);
    vi.mocked(mockJudgmentsCheck).mockResolvedValue(null);
  });

  it('behavior_tests 为空 → 直接返回 FAIL（不调 runJudgeGate）', async () => {
    vi.mocked(mockPreflight).mockReturnValue({
      verdict: 'FAIL',
      feedback: 'behavior_tests 为空：evaluator 未提供行为测试结果',
      mechFail: 'no_behavior_tests',
    });
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'PASS',
      behavior_tests: [],
      exit_code: 0,
      log_tail: 'ok',
    }));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-1111-2222-3333-444455556666', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('FAIL');
    expect(r.body.mechFail).toBe('no_behavior_tests');
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('exit_code 缺失 → 直接返回 FAIL（不调 runJudgeGate）', async () => {
    vi.mocked(mockPreflight).mockReturnValue({
      verdict: 'FAIL',
      feedback: 'verdict 缺 exit_code',
      mechFail: 'missing_exit_code',
    });
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'PASS',
      behavior_tests: ['t1'],
      log_tail: 'ok',
    }));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-1111-2222-3333-444455556666', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('FAIL');
    expect(r.body.mechFail).toBe('missing_exit_code');
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('judgments_written 不匹配 → 直接返回 FAIL（不调 runJudgeGate）', async () => {
    vi.mocked(mockPreflight).mockReturnValue(null);
    vi.mocked(mockJudgmentsCheck).mockResolvedValue({
      verdict: 'FAIL',
      feedback: 'judgments_written 声明 3 条，decisions 表实查 2 条',
      mechFail: 'judgments_written_mismatch',
    });
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'PASS',
      behavior_tests: ['t1'],
      exit_code: 0,
      log_tail: 'ok',
      judgments_written: 3,
    }));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-1111-2222-3333-444455556666', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('FAIL');
    expect(r.body.mechFail).toBe('judgments_written_mismatch');
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('机械预检全过 → 正常调 runJudgeGate', async () => {
    vi.mocked(mockPreflight).mockReturnValue(null);
    vi.mocked(mockJudgmentsCheck).mockResolvedValue(null);
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'PASS',
      behavior_tests: ['t1'],
      exit_code: 0,
      log_tail: 'ok',
    }));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-1111-2222-3333-444455556666', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(mockRunJudgeGate).toHaveBeenCalled();
  });
});

describe('POST /api/brain/harness/judge — 刀C-2 judge_verdict 落库', () => {
  let wt;
  beforeEach(async () => {
    wt = await mkdtemp(join(tmpdir(), 'judge-c2-'));
    mockRunJudgeGate.mockReset();
    mockPool.query.mockReset();
    installAuthorityMock({
      worktree: wt,
      taskId: 'aaaabbbb-cccc-dddd-eeee-111122223333',
    });
    vi.mocked(mockPreflight).mockReturnValue(null);
    vi.mocked(mockJudgmentsCheck).mockResolvedValue(null);
  });

  it('runJudgeGate 返回 PASS → UPDATE initiative_runs.judge_verdict=PASS', async () => {
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'PASS',
      behavior_tests: ['t1'],
      exit_code: 0,
      log_tail: 'ok',
    }));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-cccc-dddd-eeee-111122223333', run_id: '11111111-2222-4333-8444-555555555555', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('PASS');

    const updateCalls = mockPool.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('judge_verdict') && sql.includes('UPDATE')
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const [updateSql, updateParams] = updateCalls[0];
    expect(updateParams[0]).toBe('PASS');
    expect(updateSql).toContain('initiative_runs');
  });

  it('runJudgeGate 返回 FAIL → UPDATE initiative_runs.judge_verdict=FAIL', async () => {
    mockRunJudgeGate.mockResolvedValue({ verdict: 'FAIL', feedback: '裁判说 FAIL', judged: true });
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'PASS',
      behavior_tests: ['t1'],
      exit_code: 0,
      log_tail: 'ok',
    }));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-cccc-dddd-eeee-111122223333', run_id: '11111111-2222-4333-8444-555555555555', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('FAIL');

    const updateCalls = mockPool.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('judge_verdict') && sql.includes('UPDATE')
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    expect(updateCalls[0][1][0]).toBe('FAIL');
  });

  it('UPDATE initiative_runs 失败不影响响应（non-fatal）', async () => {
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    installAuthorityMock({
      worktree: wt,
      taskId: 'aaaabbbb-cccc-dddd-eeee-111122223333',
      updateError: new Error('DB connection lost'),
    });
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'PASS',
      behavior_tests: ['t1'],
      exit_code: 0,
      log_tail: 'ok',
    }));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-cccc-dddd-eeee-111122223333', run_id: '11111111-2222-4333-8444-555555555555', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('PASS');
  });
});
