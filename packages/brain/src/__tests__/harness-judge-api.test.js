/**
 * POST /api/brain/harness/judge — judge 环 API 化（跨 repo 刀2，Issue 98e5dff4）。
 * 语义镜像 scripts/harness-judge-cli.mjs main()：参数校验 / .brain-result.json 回退 /
 * FIXED 归一 PASS / runJudgeGate 结果透传。runJudgeGate 本体 mock（逻辑零改动不在此测）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockPool, mockRunJudgeGate } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockRunJudgeGate: vi.fn(),
}));
let authorityWorktree;
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../harness-judge.js', () => ({
  runJudgeGate: mockRunJudgeGate,
  runMechanicalGate: vi.fn(async () => ({ pass: true, reasons: [] })),
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

describe('POST /api/brain/harness/judge', () => {
  beforeEach(() => {
    authorityWorktree = null;
    mockRunJudgeGate.mockReset();
    mockPool.query.mockReset();
    mockPool.query.mockImplementation(async (sql, params = []) => {
      if (typeof sql === 'string' && sql.includes('SELECT r.id')) {
        const exact = sql.includes('WHERE r.id = $1');
        return {
          rows: authorityWorktree ? [{
            id: exact ? params[0] : 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            current_task_id: exact
              ? '11111111-2222-3333-8444-555555555555'
              : params[0],
            worktree_path: authorityWorktree,
            sprint_dir: 'sprints/x',
          }] : [],
        };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('缺必填字段 → 400', async () => {
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: '11111111-2222-3333-4444-555555555555', sprint_dir: 'sprints/x' }); // 缺 worktree
    expect(r.status).toBe(400);
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('worktree 没有服务端 run authority → 404', async () => {
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: '11111111-2222-3333-4444-555555555555', sprint_dir: 'sprints/x', worktree: '/nonexistent/path/xyz' });
    expect(r.status).toBe(404);
  });

  it('拒绝 sprint_dir 路径穿越', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({
        task_id: '11111111-2222-3333-4444-555555555555',
        sprint_dir: '../../etc',
        worktree: wt,
        agent_verdict: 'PASS',
      });
    expect(r.status).toBe(400);
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('拒绝 worktree 外部的 transcript_file 与 prompt_dir', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    const outside = await mkdtemp(join(tmpdir(), 'judge-outside-'));
    const app = await buildApp();
    for (const unsafe of [
      { transcript_file: join(outside, 'transcript.txt') },
      { prompt_dir: outside },
    ]) {
      const r = await request(app).post('/api/brain/harness/judge')
        .send({
          task_id: '11111111-2222-3333-4444-555555555555',
          sprint_dir: 'sprints/x',
          worktree: wt,
          agent_verdict: 'PASS',
          ...unsafe,
        });
      expect(r.status).toBe(400);
    }
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('拒绝请求体 worktree 与服务端 run/task authority 不一致', async () => {
    const authoritative = await mkdtemp(join(tmpdir(), 'judge-authority-'));
    const supplied = await mkdtemp(join(tmpdir(), 'judge-supplied-'));
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        current_task_id: '11111111-2222-3333-8444-555555555555',
        worktree_path: authoritative,
        sprint_dir: 'sprints/x',
      }],
    });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({
        task_id: '11111111-2222-3333-8444-555555555555',
        run_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        sprint_dir: 'sprints/x',
        worktree: supplied,
        agent_verdict: 'PASS',
      });
    expect(r.status).toBe(409);
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('agent_verdict=FIXED 归一为 PASS 传给 runJudgeGate，结果透传 200', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    authorityWorktree = wt;
    const canonicalWt = await realpath(wt);
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-1111-2222-3333-444455556666', sprint_dir: 'sprints/x', worktree: wt, agent_verdict: 'FIXED' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ verdict: 'PASS', feedback: null, judged: true });
    expect(mockRunJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS',
      worktreePath: canonicalWt,
      sprintDir: 'sprints/x',
      instanceLabel: 'judge-api-aaaabbbb',
    }), expect.objectContaining({ dbPool: expect.anything() }));
  });

  it('agent_verdict 缺省 → 从 <worktree>/.brain-result.json 读', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    authorityWorktree = wt;
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({ verdict: 'PASS', feedback: 'ok' }));
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: 'ok', judged: false });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: '11111111-2222-3333-4444-555555555555', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(mockRunJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS', agentFeedback: 'ok',
    }), expect.objectContaining({ dbPool: expect.anything() }));
  });

  it('agent_verdict 缺省且 .brain-result.json 不存在 → 400', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    authorityWorktree = wt;
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: '11111111-2222-3333-4444-555555555555', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(400);
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('runJudgeGate 抛错 → 500 且不泄内部 message', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    authorityWorktree = wt;
    mockRunJudgeGate.mockRejectedValue(new Error('secret internal'));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: '11111111-2222-3333-4444-555555555555', sprint_dir: 'sprints/x', worktree: wt, agent_verdict: 'PASS' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret internal');
  });
});
