/**
 * Contract Test: POST /api/brain/harness/judge
 * Sprint: cp-07071706-harness-judge-api
 *
 * 覆盖：
 * 1. task_id/sprint_dir/worktree 任一缺失 → 400
 * 2. agent_verdict=PASS → runJudgeGate 被调用，返回 { verdict, feedback, judged }
 * 3. agent_verdict=FIXED → 归一为 PASS 后调用 runJudgeGate
 * 4. agent_verdict 缺省且 .brain-result.json 存在 → 读文件获取 verdict
 * 5. agent_verdict 缺省且 .brain-result.json 不存在 → 降级为 FAIL
 * 6. runJudgeGate 抛错 → 500 + { error }
 * 7. HTTP 200 恒定（PASS/FAIL 均返回 200，非 4xx/5xx）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { tmpdir } from 'node:os';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const { mockRunJudgeGate } = vi.hoisted(() => ({
  mockRunJudgeGate: vi.fn(),
}));

vi.mock('../harness-judge.js', () => ({
  runJudgeGate: mockRunJudgeGate,
}));

let app;

async function buildApp() {
  const { default: router } = await import('../routes/harness.routes.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/harness', router);
  return a;
}

describe('POST /api/brain/harness/judge — Contract Tests', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    app = await buildApp();
  });

  it('GP-1: task_id 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ sprint_dir: 'sprints/x', worktree: '/tmp/wt' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('GP-1: sprint_dir 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'abc', worktree: '/tmp/wt' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('GP-1: worktree 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'abc', sprint_dir: 'sprints/x' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('GP-2: agent_verdict=PASS → runJudgeGate 调用 + 返回 verdict/feedback/judged', async () => {
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'task-1', sprint_dir: 'sprints/x', worktree: '/tmp/wt', agent_verdict: 'PASS' });
    expect(res.status).toBe(200);
    expect(mockRunJudgeGate).toHaveBeenCalledOnce();
    expect(mockRunJudgeGate.mock.calls[0][0]).toMatchObject({ agentVerdict: 'PASS', taskId: 'task-1' });
    expect(res.body).toMatchObject({ verdict: 'PASS', feedback: null, judged: true });
  });

  it('GP-3: agent_verdict=FIXED → 归一为 PASS', async () => {
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'task-2', sprint_dir: 'sprints/x', worktree: '/tmp/wt', agent_verdict: 'FIXED' });
    expect(res.status).toBe(200);
    expect(mockRunJudgeGate.mock.calls[0][0].agentVerdict).toBe('PASS');
  });

  it('GP-4: agent_verdict=FAIL → runJudgeGate 以 FAIL 调用（HTTP 200）', async () => {
    mockRunJudgeGate.mockResolvedValue({ verdict: 'FAIL', feedback: 'missing step', judged: false });
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'task-3', sprint_dir: 'sprints/x', worktree: '/tmp/wt', agent_verdict: 'FAIL' });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('FAIL');
  });

  it('GP-5: agent_verdict 缺省且 .brain-result.json 存在 → 读文件获取 verdict', async () => {
    const dir = await (async () => {
      const d = path.join(tmpdir(), `judge-test-${Date.now()}`);
      await mkdir(d, { recursive: true });
      await writeFile(path.join(d, '.brain-result.json'), JSON.stringify({ verdict: 'PASS' }));
      return d;
    })();
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'task-4', sprint_dir: 'sprints/x', worktree: dir });
    expect(res.status).toBe(200);
    expect(mockRunJudgeGate.mock.calls[0][0].agentVerdict).toBe('PASS');
  });

  it('GP-6: agent_verdict 缺省且 .brain-result.json 不存在 → 降级 FAIL', async () => {
    mockRunJudgeGate.mockResolvedValue({ verdict: 'FAIL', feedback: null, judged: false });
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'task-5', sprint_dir: 'sprints/x', worktree: '/no/such/path/xyz' });
    expect(res.status).toBe(200);
    expect(mockRunJudgeGate.mock.calls[0][0].agentVerdict).toBe('FAIL');
  });

  it('GP-7: runJudgeGate 抛错 → 500 + { error }', async () => {
    mockRunJudgeGate.mockRejectedValue(new Error('judge network timeout'));
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'task-6', sprint_dir: 'sprints/x', worktree: '/tmp/wt', agent_verdict: 'PASS' });
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('Content-Type: application/json（所有响应）', async () => {
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'task-7', sprint_dir: 'sprints/x' });
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
