/**
 * dispatcher-pg-capability.test.js — PG capability fail-closed + recollect judge_feedback 回灌。
 *
 * B-03: PG 不可供给 → dispatch() fail-closed 返回 control_status=BLOCKED，未创建 attempt。
 * 附: recollect 轮真实 buildInputs 组装出的 bundle inputs 携带 judge_feedback（缺证清单 + 原始反馈）。
 *
 * 禁 mock 被改的边：dispatcher(evaluator buildInputs) ↔ Evaluator TaskBundle.inputs 走真实
 * buildInputs / dispatch；preflightGate 作为 dispatcher 外部注入依赖以 stub 提供 status 输入
 * （合同「允许 mock 的更外层无关依赖」），由此驱动的 dispatcher 分支为真实。
 */
import { describe, expect, it, vi } from 'vitest';

import { createDispatcher, resolveAction, __test__ } from '../dispatcher.js';

const { buildInputs } = __test__;

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';

function makeDeps({ preflightStatus = 'blocked' } = {}) {
  return {
    attemptStore: {
      createAttempt: vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle })),
      markStarting: vi.fn(),
      recordLaunchReceipt: vi.fn(),
      fail: vi.fn(),
      listFailedExecutionTargets: vi.fn(async () => []),
    },
    registry: { resolve: vi.fn(() => ({ name: 'codex', start: vi.fn(() => ({ provider: 'codex', args: [], stdin: '{}' })) })) },
    launcher: { launch: vi.fn(), cancel: vi.fn() },
    loadSkill: vi.fn((name) => ({ name, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, content: name })),
    randomUUID: () => attemptId,
    createCallbackSecret: () => 'attempt-secret',
    machineId: 'brain-1',
    leaseOwner: 'dispatcher-pg-test:4242',
    onPreflightBlocked: vi.fn(),
    preflightGate: {
      evaluate: vi.fn(async () => ({
        status: preflightStatus,
        action: 'wait:human_review',
        failure_class: 'infrastructure_blocked',
        fallback_reason: 'postgres_capability_missing',
        should_create_attempt: false,
        should_enter_generator_fix: false,
        evidence: { capability_snapshot_id: 'snap-1', fallback_reason: 'postgres_capability_missing' },
      })),
      validateSnapshotForDispatch: vi.fn(async (snapshot) => ({ status: 'ok', snapshot })),
    },
  };
}

function blockedContext() {
  return {
    taskId,
    runId,
    hop: 9,
    decision: { phase: 'evaluate', reason: 'no_evaluate_verdict_for_head_sha' },
    observed: {
      task: {
        id: taskId,
        title: 'PG capability fail-closed',
        payload: {
          sprint_dir: 'sprints/pg-capability',
          worktree_path: '/tmp/worktree',
          // 合同要求 postgres（机械派生的等价结构入口）
          contract_requirements: { postgres: true },
          role_assignments: { evaluator: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' } },
        },
      },
      run: { id: runId, phase: 'evaluate' },
      contract: { approved: true, row: { branch: 'cp-approved-contract' } },
      pr: { url: 'https://github.com/perfectuser21/cecelia/pull/1', head_ref: 'cp-approved-contract', head_sha: 'b'.repeat(40), ci: 'pass' },
    },
  };
}

describe('dispatcher PG capability fail-closed', () => {
  it('PG 不可供给返回 control_status BLOCKED', async () => {
    const deps = makeDeps({ preflightStatus: 'blocked' });
    const result = await createDispatcher(deps)('spawn:evaluator', blockedContext());

    expect(result.control_status).toBe('BLOCKED');
    expect(result.should_create_attempt).toBe(false);
    // fail-closed：绝不创建会自报 PASS 的 Evaluator attempt
    expect(deps.attemptStore.createAttempt).not.toHaveBeenCalled();
    expect(deps.onPreflightBlocked).toHaveBeenCalledOnce();
  });
});

describe('recollect 轮 bundle inputs 携带 judge_feedback', () => {
  const spec = resolveAction('spawn:evaluator');
  const attemptMetadata = { logicalCycleId: 'lc-1', attemptKind: 'initial', workstreamKey: 'ws1' };

  function recollectCtx(judgeVerdict, { reason = 'judge_evidence_insufficient_recollect' } = {}) {
    return {
      taskId,
      runId,
      hop: 12,
      decision: { phase: 'evaluate', reason },
      observed: {
        task: { id: taskId, title: 'recollect', payload: { sprint_dir: 'sprints/pg-capability', worktree_path: '/tmp/worktree' } },
        run: { id: runId, phase: 'evaluate' },
        contract: { approved: true, row: { branch: 'cp-approved-contract' } },
        pr: { url: 'https://github.com/perfectuser21/cecelia/pull/1', head_ref: 'cp-approved-contract', head_sha: 'b'.repeat(40) },
        judgeVerdict,
      },
    };
  }

  it('recollect 轮注入 judge_feedback（缺证清单 + 原始反馈非空）', () => {
    const judgeVerdict = {
      verdict: 'FAIL',
      pr_head_sha: 'b'.repeat(40),
      failure_class: 'evidence_insufficient',
      missing_evidence: ['缺 PG 必验项 psql exit code', '缺隔离库写入行回读证据'],
      feedback: '需要真实 psql 建/查隔离库的 stdout 与退出码',
    };
    const inputs = buildInputs('spawn:evaluator', spec, recollectCtx(judgeVerdict), attemptMetadata);

    expect(inputs.judge_feedback).toBeTruthy();
    expect(inputs.judge_feedback.missing_evidence).toEqual([
      '缺 PG 必验项 psql exit code',
      '缺隔离库写入行回读证据',
    ]);
    expect(inputs.judge_feedback.raw_feedback).toBe('需要真实 psql 建/查隔离库的 stdout 与退出码');
  });

  it('recollect 轮 judge 未给结构化缺证 → 降级但不静默丢弃（raw_feedback 回退 verdict 文本）', () => {
    const judgeVerdict = { verdict: 'FAIL', pr_head_sha: 'b'.repeat(40), failure_class: 'evidence_insufficient' };
    const inputs = buildInputs('spawn:evaluator', spec, recollectCtx(judgeVerdict), attemptMetadata);

    expect(inputs.judge_feedback).toBeTruthy();
    expect(Array.isArray(inputs.judge_feedback.missing_evidence)).toBe(true);
    // 结构缺失也不允许 null/空——raw_feedback 回退为原始 verdict 文本（打破同构重跑）
    expect(inputs.judge_feedback.raw_feedback.length).toBeGreaterThan(0);
  });

  it('非 recollect 轮不注入 judge_feedback（边界不变）', () => {
    const judgeVerdict = { verdict: 'FAIL', missing_evidence: ['x'], feedback: 'y' };
    const inputs = buildInputs(
      'spawn:evaluator',
      spec,
      recollectCtx(judgeVerdict, { reason: 'no_evaluate_verdict_for_head_sha' }),
      attemptMetadata,
    );
    expect(inputs.judge_feedback).toBeUndefined();
  });
});
