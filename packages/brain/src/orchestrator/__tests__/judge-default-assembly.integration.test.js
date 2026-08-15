import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildJudgePrompt, runJudgeGate } from '../../harness-judge.js';
import { buildDefaultHandlers } from '../run.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
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
    const attemptStore = { complete: vi.fn(async () => ({ deduped: false })) };
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
      attempt: { id: attemptId },
      bundle: { inputs: { worktree_path: worktreePath, sprint_dir: 'sprints/r9' } },
      observed: {
        run: { id: runId },
        pr: { state: 'OPEN', merged: false, head_sha: headSha },
        reviewApproved: false,
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: headSha },
        evaluateResult: {
          status: 'completed',
          transcript: 'callback tail only',
          summary: 'contract passed',
          checks: [{ command: 'bash contract-e2e.sh', exit_code: 0, log_tail: '8 passed' }],
          decision: { outcome: 'PASS', reason: 'verified' },
        },
      },
    });

    expect(result).toMatchObject({ status: 'DONE', detail: 'judge:PASS' });
    expect(modelBoundary).toHaveBeenCalledOnce();
    expect(renderedPrompt).toContain('FULL FORENSICS: bash contract-e2e.sh');
    expect(renderedPrompt).toContain('"current_stage": "independent_judge"');
    expect(renderedPrompt).toContain('"merge_gate_approved": false');
    expect(renderedPrompt).toContain('缺少未来的批准、merge、report 日志不得判为证据缺失');
  });

  it('Fleet bundle without a host path judges from its embedded approved contract and PRD', async () => {
    let renderedPrompt = '';
    const modelBoundary = vi.fn(async (input) => {
      renderedPrompt = buildJudgePrompt(input);
      return {
        verdict: 'PASS',
        coverage: [{
          step: 'embedded fleet step',
          passed: true,
          evidence: 'embedded evidence passed',
        }],
        feedback: null,
      };
    });
    const judgeGate = (ctx, opts) => runJudgeGate(ctx, {
      ...opts,
      judgeFn: modelBoundary,
      listTestFilesFn: async () => ['embedded-contract.test.js'],
    });
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    const attemptStore = { complete: vi.fn(async () => ({ deduped: false })) };
    const handlers = await buildDefaultHandlers({
      pool,
      execCmd: vi.fn(),
      attemptStore,
      judgeGate,
    });

    const result = await handlers['spawn:judge']({
      taskId,
      runId,
      hop: 10,
      attempt: { id: attemptId },
      bundle: {
        inputs: {
          sprint_dir: 'sprints/r9',
          contract: {
            contract_content: '## E2E 验收\n- embedded contract check\n',
            prd_content: '## Golden Path\n1. embedded fleet step\n',
          },
        },
      },
      observed: {
        run: { id: runId },
        pr: { state: 'OPEN', merged: false, head_sha: headSha },
        reviewApproved: false,
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: headSha },
        evaluateResult: {
          status: 'completed',
          transcript: 'embedded evidence passed',
          summary: 'contract passed',
          checks: [{ command: 'verify embedded evidence', exit_code: 0, log_tail: 'passed' }],
          decision: { outcome: 'PASS', reason: 'verified' },
        },
      },
    });

    expect(result).toMatchObject({ status: 'DONE', detail: 'judge:PASS' });
    expect(modelBoundary).toHaveBeenCalledOnce();
    expect(renderedPrompt).toContain('embedded contract check');
    expect(renderedPrompt).toContain('embedded fleet step');
  });

  it('Direct Runner 回执经默认 Brain 接线逐 assertion 交给独立 Judge', async () => {
    const requiredAssertions = [
      {
        assertion_id: 'A1-save',
        command: 'npm test -- save',
        covers_capability_ids: ['save-api'],
      },
      {
        assertion_id: 'A2-reload',
        command: 'npm test -- reload',
        covers_capability_ids: ['reload-api'],
      },
    ];
    const content = [
      '# Frozen impact assertions',
      '',
      '```json',
      JSON.stringify({
        impact_contract_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        impact_contract_hash: 'a'.repeat(64),
        required_assertions: requiredAssertions,
      }, null, 2),
      '```',
    ].join('\n');
    const artifact = {
      type: 'frozen_contract_test',
      path: 'direct-contracts/receipt-1/tests/impact-contract.md',
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
      source_sha: 'c'.repeat(40),
    };
    let renderedPrompt = '';
    const modelBoundary = vi.fn(async (input) => {
      renderedPrompt = buildJudgePrompt(input);
      return {
        verdict: 'PASS',
        coverage: input.goldenPathSteps.map((step) => ({
          step,
          passed: true,
          deferred: false,
          evidence: `trusted Runner receipt: ${step}`,
        })),
        failure_class: null,
        failure_signature: null,
        feedback: null,
      };
    });
    const judgeGate = (ctx, opts) => runJudgeGate(ctx, {
      ...opts,
      judgeFn: modelBoundary,
      listTestFilesFn: async () => ['impact-contract.md'],
    });
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    const attemptStore = { complete: vi.fn(async () => ({ deduped: false })) };
    const handlers = await buildDefaultHandlers({
      pool,
      execCmd: vi.fn(),
      attemptStore,
      judgeGate,
    });

    const result = await handlers['spawn:judge']({
      taskId,
      runId,
      hop: 11,
      attempt: { id: attemptId },
      bundle: { inputs: {
        sprint_dir: 'direct-contracts/receipt-1',
        artifacts: [artifact],
        contract: {
          contract_content: '# Direct profile contract',
          prd_content: '# Direct objective',
        },
      } },
      observed: {
        run: { id: runId },
        pr: { state: 'OPEN', merged: false, head_sha: headSha },
        reviewApproved: false,
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: headSha },
        evaluateResult: {
          status: 'completed',
          summary: 'human exploration and trusted assertions passed',
          checks: requiredAssertions.map((assertion) => ({
            assertion_id: assertion.assertion_id,
            command_argv: ['bash', '-lc', assertion.command],
            exit_code: 0,
            output_tail: `${assertion.assertion_id} passed`,
            output_digest: 'd'.repeat(64),
          })),
          findings: [],
          screenshots: [],
          exploration_notes: ['Explored happy path, bad input, and repeat operation.'],
          decision: { outcome: 'PASS', reason: 'human exploration passed' },
        },
      },
    });

    expect(result).toMatchObject({ status: 'DONE', detail: 'judge:PASS' });
    expect(modelBoundary).toHaveBeenCalledOnce();
    expect(renderedPrompt).toContain('required_assertion:A1-save');
    expect(renderedPrompt).toContain('required_assertion:A2-reload');
    expect(renderedPrompt).toContain('A1-save passed');
    expect(renderedPrompt).toContain('A2-reload passed');
  });
});
