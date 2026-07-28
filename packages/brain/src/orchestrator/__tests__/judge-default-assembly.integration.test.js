import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildJudgePrompt, runJudgeGate } from '../../harness-judge.js';
import { sha256Canonical } from '../../lib/kernel-equivalence-receipts.js';
import { buildDefaultHandlers } from '../run.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const evaluatorAttemptId = '33333333-3333-4333-8333-333333333333';
const headSha = 'b'.repeat(40);

describe('independent judge default assembly integration', () => {
  let root;
  let promptDir;
  let worktreePath;
  const originalHostPromptDir = process.env.HOST_PROMPT_DIR;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'judge-default-assembly-'));
    promptDir = path.join(root, 'prompts');
    worktreePath = path.join(root, 'worktree');
    const sprintPath = path.join(worktreePath, 'sprints', 'r9');
    await mkdir(promptDir, { recursive: true });
    await mkdir(sprintPath, { recursive: true });
    await writeFile(
      path.join(sprintPath, 'contract-draft.md'),
      '## E2E 验收\n- [BEHAVIOR] bash contract-e2e.sh 必须 8/8 通过\n'
    );
    await writeFile(
      path.join(sprintPath, 'sprint-prd.md'),
      '## Golden Path\n1. 运行精确合同 E2E 并取得 8/8\n'
    );
    await writeFile(path.join(sprintPath, 'judge-flow.test.js'), '// permanent contract host\n');
    await writeFile(
      path.join(promptDir, `${taskId}.r9.stdout`),
      JSON.stringify({ result: 'FULL FORENSICS: bash contract-e2e.sh → 8 passed, exit=0' })
    );
    process.env.HOST_PROMPT_DIR = promptDir;
  });

  afterEach(async () => {
    if (originalHostPromptDir === undefined) delete process.env.HOST_PROMPT_DIR;
    else process.env.HOST_PROMPT_DIR = originalHostPromptDir;
    await rm(root, { recursive: true, force: true });
  });

  it('default runtime wiring reads full evaluator stdout and builds the stage-aware prompt', async () => {
    let renderedPrompt = '';
    const modelBoundary = vi.fn(async (input) => {
      renderedPrompt = buildJudgePrompt(input);
      return {
        verdict: 'PASS',
        coverage: [{
          step: '运行精确合同 E2E 并取得 8/8',
          passed: true,
          evidence: 'contract-e2e.sh → 8 passed, exit=0',
        }],
        feedback: null,
      };
    });
    const judgeGate = (ctx, opts) => runJudgeGate(ctx, { ...opts, judgeFn: modelBoundary });
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    const evaluateResult = {
      contract_version: '1.0',
      attempt_id: evaluatorAttemptId,
      status: 'completed',
      transcript: 'callback tail only',
      summary: 'contract passed',
      checks: [{ command: 'bash contract-e2e.sh', exit_code: 0, log_tail: '8 passed' }],
      decision: {
        outcome: 'PASS',
        reason: 'verified',
        pr_head_sha: headSha,
      },
    };
    const attemptStore = {
      complete: vi.fn(async () => ({ deduped: false })),
      getById: vi.fn(async (id) => (
        id === attemptId
          ? { id, run_id: runId, role: 'judge', status: 'running' }
          : {
              id,
              run_id: runId,
              role: 'evaluator',
              status: 'completed',
              execution_transport: 'local-docker',
              lease_owner: 'judge-fixture-worker',
              lease_generation: 2,
              completed_at: new Date('2026-07-28T12:00:00.000Z'),
              task_bundle: {
                inputs: {
                  pull_request: { head_sha: headSha },
                },
              },
              result: evaluateResult,
            }
      )),
    };
    const handlers = await buildDefaultHandlers({
      pool,
      execCmd: vi.fn(),
      attemptStore,
      judgeGate,
    });

    const result = await handlers['spawn:judge']({
      taskId,
      runId,
      hop: 9,
      attempt: { id: attemptId, run_id: runId, role: 'judge' },
      bundle: { inputs: { worktree_path: worktreePath, sprint_dir: 'sprints/r9' } },
      observed: {
        run: { id: runId },
        pr: { state: 'OPEN', merged: false, head_sha: headSha },
        reviewApproved: false,
        evaluateVerdict: {
          attempt_id: evaluatorAttemptId,
          verdict: 'PASS',
          pr_head_sha: headSha,
          feedback: 'verified',
          failure_class: null,
          executor_kind: 'local-docker',
          result_digest: sha256Canonical(evaluateResult),
          result_receipt_id: null,
          result_sha256: null,
        },
        evaluateResult,
      },
    });

    expect(result).toMatchObject({ status: 'DONE', detail: 'judge:PASS' });
    expect(modelBoundary).toHaveBeenCalledOnce();
    expect(renderedPrompt).toContain('FULL FORENSICS: bash contract-e2e.sh');
    expect(renderedPrompt).toContain('"current_stage": "independent_judge"');
    expect(renderedPrompt).toContain('"merge_gate_approved": false');
    expect(renderedPrompt).toContain('缺少未来的批准、merge、report 日志不得判为证据缺失');
  });
});
