/**
 * POST /api/brain/harness/judge — judge 环 API 化（跨 repo 刀2，Issue 98e5dff4）。
 * 语义镜像 scripts/harness-judge-cli.mjs main()：参数校验 / .brain-result.json 回退 /
 * FIXED 归一 PASS / runJudgeGate 结果透传。runJudgeGate 本体 mock（逻辑零改动不在此测）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  mockPool,
  mockRunJudgeGate,
  mockCollectGroundTruth,
  mockPersistJudgeReceipt,
  mockExecuteOneSessionMerge,
} = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockRunJudgeGate: vi.fn(),
  mockCollectGroundTruth: vi.fn(),
  mockPersistJudgeReceipt: vi.fn(),
  mockExecuteOneSessionMerge: vi.fn(),
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
  a.set('kernelOneSessionGroundTruthCollector', mockCollectGroundTruth);
  a.set('kernelOneSessionJudgeReceiptWriter', mockPersistJudgeReceipt);
  a.set('kernelOneSessionMergeExecutor', mockExecuteOneSessionMerge);
  a.use(express.json());
  a.use('/api/brain/harness', router);
  return a;
}

describe('POST /api/brain/harness/judge', () => {
  beforeEach(() => {
    authorityWorktree = null;
    mockRunJudgeGate.mockReset();
    mockCollectGroundTruth.mockReset();
    mockPersistJudgeReceipt.mockReset();
    mockPersistJudgeReceipt.mockResolvedValue({ persisted: true });
    mockExecuteOneSessionMerge.mockReset();
    mockExecuteOneSessionMerge.mockResolvedValue({ status: 'DONE', detail: 'merge requested' });
    mockCollectGroundTruth.mockImplementation(async ({ runId, taskId }) => ({
      run: { id: runId },
      task: { id: taskId },
      pr: { url: 'https://github.com/example/repo/pull/1', head_sha: 'a'.repeat(40) },
      contract: {
        id: '22222222-3333-4444-8555-666666666666',
        approved: true,
        identity: {
          contract_id: '22222222-3333-4444-8555-666666666666',
          manifest_sha256: 'b'.repeat(64),
          source_revision: 'c'.repeat(40),
        },
        artifacts: [{
          path: 'sprints/x/contract-draft.md',
          content: '# Contract',
          sha256: 'd'.repeat(64),
          byte_length: 10,
          source_revision: 'c'.repeat(40),
        }],
      },
    }));
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

  it('配置 internal token 后匿名远端不得调用 Judge receipt authority', async () => {
    const previous = process.env.CECELIA_INTERNAL_TOKEN;
    process.env.CECELIA_INTERNAL_TOKEN = 'judge-internal-secret';
    try {
      const app = await buildApp();
      const response = await request(app).post('/api/brain/harness/judge').send({});
      expect(response.status).toBe(401);
      expect(mockRunJudgeGate).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.CECELIA_INTERNAL_TOKEN;
      else process.env.CECELIA_INTERNAL_TOKEN = previous;
    }
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
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'FIXED',
      feedback: 'human evidence complete',
    }));
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-1111-2222-3333-444455556666', sprint_dir: 'sprints/x', worktree: wt, agent_verdict: 'FIXED' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verdict: 'PASS', feedback: null, judged: true });
    expect(mockRunJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS',
      worktreePath: canonicalWt,
      sprintDir: 'sprints/x',
      instanceLabel: 'judge-api-aaaabbbb',
      frozenContractArtifacts: expect.any(Array),
    }), expect.objectContaining({ dbPool: expect.anything() }));
    expect(r.body.authority).toEqual({
      run_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      task_id: 'aaaabbbb-1111-2222-3333-444455556666',
      pr_head_sha: 'a'.repeat(40),
      contract_identity: {
        contract_id: '22222222-3333-4444-8555-666666666666',
        manifest_sha256: 'b'.repeat(64),
        source_revision: 'c'.repeat(40),
      },
    });
    expect(mockPersistJudgeReceipt).toHaveBeenCalledWith(mockPool, expect.objectContaining({
      evaluatorVerdict: 'PASS',
      evaluatorFeedback: 'human evidence complete',
      prHeadSha: 'a'.repeat(40),
      contractIdentity: expect.objectContaining({ contract_id: expect.any(String) }),
      evaluatorEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('agent_verdict 缺省但独立 Judge 未完成时 fail-closed，响应不得携带 PASS', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    authorityWorktree = wt;
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({ verdict: 'PASS', feedback: 'ok' }));
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: 'ok', judged: false });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: '11111111-2222-3333-4444-555555555555', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(409);
    expect(r.body.verdict).not.toBe('PASS');
    expect(r.body.error).toBe('independent_judge_not_completed');
    expect(mockRunJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS', agentFeedback: 'ok',
    }), expect.objectContaining({ dbPool: expect.anything(), strict: true }));
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
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({
      verdict: 'PASS',
      feedback: 'ok',
    }));
    mockRunJudgeGate.mockRejectedValue(new Error('secret internal'));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: '11111111-2222-3333-4444-555555555555', sprint_dir: 'sprints/x', worktree: wt, agent_verdict: 'PASS' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret internal');
  });
});

describe('POST /api/brain/harness/runs/:runId/merge', () => {
  beforeEach(async () => {
    authorityWorktree = await mkdtemp(join(tmpdir(), 'judge-merge-'));
    mockExecuteOneSessionMerge.mockReset();
    mockExecuteOneSessionMerge.mockResolvedValue({ status: 'DONE', detail: 'merge requested' });
    mockPool.query.mockReset();
    mockPool.query.mockImplementation(async (sql, params = []) => {
      if (typeof sql === 'string' && sql.includes('SELECT r.id')) {
        return { rows: [{
          id: params[0],
          current_task_id: '11111111-2222-4333-8444-555555555555',
          worktree_path: authorityWorktree,
          sprint_dir: 'sprints/x',
        }] };
      }
      return { rows: [] };
    });
  });

  it('仅把 exact run/task 交给服务端 merge authority', async () => {
    const app = await buildApp();
    const response = await request(app)
      .post('/api/brain/harness/runs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/merge')
      .send({ task_id: '11111111-2222-4333-8444-555555555555' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'DONE' });
    expect(mockExecuteOneSessionMerge).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      taskId: '11111111-2222-4333-8444-555555555555',
    }));
  });

  it('拒绝客户端夹带 SHA/合同等 authority 字段', async () => {
    const app = await buildApp();
    const response = await request(app)
      .post('/api/brain/harness/runs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/merge')
      .send({
        task_id: '11111111-2222-4333-8444-555555555555',
        pr_head_sha: 'a'.repeat(40),
      });
    expect(response.status).toBe(400);
    expect(mockExecuteOneSessionMerge).not.toHaveBeenCalled();
  });
});

describe('harness-controller 独立 Judge 放行合同', () => {
  it('只有 verdict=PASS 且 judged=true 才允许进入 merge', async () => {
    const skill = await readFile(new URL(
      '../../../workflows/skills/harness-controller/SKILL.md',
      import.meta.url,
    ), 'utf8');

    expect(skill).toContain("JUDGED=$(echo \"$JUDGE_RESP\" | jq -r '.judged // false')");
    expect(skill).toContain(
      'if [ "$VERDICT" != "PASS" ] || [ "$JUDGED" != "true" ]; then',
    );
    expect(skill).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('Step 6 只能调用 Brain exact-run merge authority，禁止客户端直接 gh merge', async () => {
    const skill = await readFile(new URL(
      '../../../workflows/skills/harness-controller/SKILL.md',
      import.meta.url,
    ), 'utf8');
    const step6 = skill.slice(skill.indexOf('## Step 6:'), skill.indexOf('## Step 7:'));
    expect(step6).toContain('/api/brain/harness/runs/${HARNESS_RUN_ID}/merge');
    expect(step6).not.toContain('gh pr merge --squash --delete-branch');
  });

  it('Step 6 的重评分支必须是可执行 shell，不得把中文流程说明当作命令', async () => {
    const skill = await readFile(new URL(
      '../../../workflows/skills/harness-controller/SKILL.md',
      import.meta.url,
    ), 'utf8');
    const step6 = skill.slice(skill.indexOf('## Step 6:'), skill.indexOf('## Step 7:'));

    expect(step6).not.toMatch(/\|\|\s*回 Step/);
    expect(step6).not.toMatch(/^\s*回 Step/m);
    expect(step6).toContain('exit 2');
  });
});
