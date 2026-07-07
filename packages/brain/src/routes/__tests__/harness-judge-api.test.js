/**
 * POST /api/brain/harness/judge 路由单测
 *
 * 覆盖：
 * 1. 参数缺失（task_id/sprint_dir/worktree 缺任一）→ 400
 * 2. agent_verdict 缺省 → 从 .brain-result.json 读（FIXED 归一 PASS）
 * 3. runJudgeGate 调用正确 → 200 + {verdict, feedback, judged}
 * 4. runJudgeGate FAIL → 200 + verdict=FAIL（HTTP 200 恒定，verdict 承载裁决）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFile } from 'node:fs/promises';

const { mockRunJudgeGate } = vi.hoisted(() => ({
  mockRunJudgeGate: vi.fn(),
}));

vi.mock('../../harness-judge.js', () => ({
  runJudgeGate: mockRunJudgeGate,
}));

// mock fs/promises readFile for .brain-result.json
const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

let app;

async function buildApp() {
  const { default: router } = await import('../harness.routes.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/harness', router);
  return a;
}

beforeEach(async () => {
  vi.resetAllMocks();
  app = await buildApp();
});

const VALID_BODY = {
  task_id: 'aaaabbbb-1111-2222-3333-444455556666',
  sprint_dir: 'sprints/07071706-test',
  worktree: '/tmp/wt/test',
  agent_verdict: 'PASS',
};

describe('POST /api/brain/harness/judge — 参数校验', () => {
  it('task_id 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ sprint_dir: 's', worktree: '/w' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('sprint_dir 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'abc', worktree: '/w' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('worktree 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ task_id: 'abc', sprint_dir: 's' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/brain/harness/judge — 正常路径', () => {
  it('agent_verdict=PASS + runJudgeGate PASS → 200 {verdict:PASS, judged:true}', async () => {
    mockRunJudgeGate.mockResolvedValueOnce({ verdict: 'PASS', feedback: null, judged: true });

    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('PASS');
    expect(res.body.judged).toBe(true);
    expect(res.body.feedback).toBeNull();
  });

  it('agent_verdict=FAIL → 200 {verdict:FAIL}（裁判不调）', async () => {
    mockRunJudgeGate.mockResolvedValueOnce({ verdict: 'FAIL', feedback: 'fix x', judged: false });

    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send({ ...VALID_BODY, agent_verdict: 'FAIL' });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('FAIL');
  });

  it('FIXED 归一 PASS（传给 runJudgeGate 的 agentVerdict=PASS）', async () => {
    mockRunJudgeGate.mockResolvedValueOnce({ verdict: 'PASS', feedback: null, judged: true });

    await request(app)
      .post('/api/brain/harness/judge')
      .send({ ...VALID_BODY, agent_verdict: 'FIXED' });

    expect(mockRunJudgeGate).toHaveBeenCalledOnce();
    const ctx = mockRunJudgeGate.mock.calls[0][0];
    expect(ctx.agentVerdict).toBe('PASS');
  });

  it('agent_verdict 缺省 → 从 <worktree>/.brain-result.json 读', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ verdict: 'PASS', status: 'success' }));
    mockRunJudgeGate.mockResolvedValueOnce({ verdict: 'PASS', feedback: null, judged: true });

    const { agent_verdict: _av, ...bodyWithoutVerdict } = VALID_BODY;
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send(bodyWithoutVerdict);

    expect(res.status).toBe(200);
    const ctx = mockRunJudgeGate.mock.calls[0][0];
    expect(ctx.agentVerdict).toBe('PASS');
  });

  it('.brain-result.json 读不到时 agent_verdict 默认 FAIL', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    mockRunJudgeGate.mockResolvedValueOnce({ verdict: 'FAIL', feedback: null, judged: false });

    const { agent_verdict: _av, ...bodyWithoutVerdict } = VALID_BODY;
    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send(bodyWithoutVerdict);

    expect(res.status).toBe(200);
    const ctx = mockRunJudgeGate.mock.calls[0][0];
    expect(ctx.agentVerdict).toBe('FAIL');
  });

  it('runJudgeGate 调用时传入正确 ctx 字段', async () => {
    mockRunJudgeGate.mockResolvedValueOnce({ verdict: 'PASS', feedback: null, judged: true });

    await request(app)
      .post('/api/brain/harness/judge')
      .send({ ...VALID_BODY, prompt_dir: '/prompts', agent_feedback: 'ok' });

    const ctx = mockRunJudgeGate.mock.calls[0][0];
    expect(ctx.worktreePath).toBe('/tmp/wt/test');
    expect(ctx.sprintDir).toBe('sprints/07071706-test');
    expect(ctx.taskId).toBe(VALID_BODY.task_id);
    expect(ctx.promptDir).toBe('/prompts');
    expect(ctx.agentFeedback).toBe('ok');
  });

  it('HTTP 200 恒定（verdict 承载裁决，不用 HTTP 状态区分 PASS/FAIL）', async () => {
    mockRunJudgeGate.mockResolvedValueOnce({ verdict: 'FAIL', feedback: '不通过', judged: true });

    const res = await request(app)
      .post('/api/brain/harness/judge')
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('FAIL');
  });
});
