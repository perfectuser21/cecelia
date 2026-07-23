/**
 * kernel-failure-class-routing.test.js
 *
 * [BEHAVIOR] B-04：failure_class 五类路由矩阵全覆盖
 *
 * 先红后绿：当前代码 derive.js 在 evaluator FAIL 时统一走 fixOrFail，
 * 不区分 failure_class。只有 contract_invalid 有特判。
 * evidence_invalid / needs_context / unknown / environment_recovery 未差异路由。
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 */

import { derive } from '../derive.js';

// ---- helpers ----

const BASE_COUNTERS = { hops: 5, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 };

function makeObserved(failureClass) {
  return {
    run: { phase: 'evaluate', cost_usd: '0' },
    task: { status: 'in_progress', payload: {} },
    prdExists: true,
    contract: { approved: true, id: 'c1', row: {} },
    pr: { url: 'https://github.com/test/repo/pull/99', state: 'OPEN', merged: false, ci: 'pass', head_sha: 'sha-abc' },
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false, action: null },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: {
      verdict: 'FAIL',
      pr_head_sha: 'sha-abc',
      failure_class: failureClass ?? null,
    },
    evaluateResult: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    authCircuit: [],
    callbackResult: null,
    counters: BASE_COUNTERS,
  };
}

describe('[BEHAVIOR] B-04 failure_class 五类路由矩阵', () => {

  /**
   * T-01-a: evidence_invalid → spawn:evaluator-evidence-repair
   * 当前（先红）：derive 会路由 spawn:generator-fix（fixOrFail）
   */
  test('T-01-a: evidence_invalid → spawn:evaluator-evidence-repair', () => {
    const result = derive(makeObserved('evidence_invalid'));
    expect(result.action).toBe('spawn:evaluator-evidence-repair');
    expect(result.phase).toBe('evaluate');
  });

  /**
   * T-01-b: product_failure → spawn:generator-fix（原有行为保留）
   */
  test('T-01-b: product_failure → spawn:generator-fix', () => {
    const result = derive(makeObserved('product_failure'));
    expect(result.action).toBe('spawn:generator-fix');
  });

  /**
   * T-11-a: failure_class 缺失（null）→ spawn:generator-fix（保守，视为产品失败）
   */
  test('T-11-a: failure_class null → spawn:generator-fix（保守）', () => {
    const result = derive(makeObserved(null));
    // INV-K3：Judge 缺 failure_class → unknown，不默认归为产品代码失败
    // 但对 evaluator，null failure_class 保守路由 generator-fix
    expect(result.action).toBe('spawn:generator-fix');
  });

  /**
   * T-11-b: failure_class 缺失（undefined）→ spawn:generator-fix（保守）
   */
  test('T-11-b: failure_class undefined → spawn:generator-fix（保守）', () => {
    const obs = makeObserved(undefined);
    obs.evaluateVerdict = { verdict: 'FAIL', pr_head_sha: 'sha-abc' }; // 无 failure_class 字段
    const result = derive(obs);
    expect(result.action).toBe('spawn:generator-fix');
  });

  /**
   * T-10-a: needs_context → wait:human_review
   * 当前（先红）：derive 会路由 spawn:generator-fix
   */
  test('T-10-a: needs_context → wait:human_review', () => {
    const result = derive(makeObserved('needs_context'));
    expect(result.action).toBe('wait:human_review');
    expect(result.reason).toContain('needs_context');
  });

  /**
   * T-10-b: unknown → wait:human_review（INV-K3：禁止默认归为产品代码失败）
   * 当前（先红）：derive 会路由 spawn:generator-fix
   */
  test('T-10-b: unknown → wait:human_review（INV-K3）', () => {
    const result = derive(makeObserved('unknown'));
    expect(result.action).toBe('wait:human_review');
  });

  /**
   * T-13-a: environment_recovery（首次）→ spawn:generator-fix
   */
  test('T-13-a: environment_recovery 首次 → spawn:generator-fix', () => {
    const obs = makeObserved('environment_recovery');
    // 首次没有先前的 environment_recovery fix 记录
    obs.decisionLog = [];
    const result = derive(obs);
    expect(result.action).toBe('spawn:generator-fix');
    expect(result.reason).toContain('environment_recovery');
  });

  /**
   * T-13-b: environment_recovery（同签名第二次）→ mark_failed terminal
   * 当前（先红）：derive 不区分环境恢复重复，会继续 generator-fix
   */
  test('T-13-b: environment_recovery 同签名第二次 → mark_failed', () => {
    const obs = makeObserved('environment_recovery');
    // 模拟已有一次 environment_recovery generator-fix 记录
    obs.decisionLog = [
      {
        hop: 3,
        action: 'spawn:generator-fix',
        observed: { failure_class: 'environment_recovery', trigger_sha: 'sha-abc' },
      },
    ];
    const result = derive(obs);
    // 实现后：第二次相同签名 environment_recovery → terminal
    // 当前（先红）：fixOrFail（fixRound=0 < MAX=20，会 generator-fix）
    expect(result.action).toBe('mark_failed');
    expect(result.reason).toBe('repeated_environment_recovery');
  });

  /**
   * contract_invalid → mark_failed（已有实现，验证保留）
   */
  test('contract_invalid → mark_failed（已有实现）', () => {
    const result = derive(makeObserved('contract_invalid'));
    expect(result.action).toBe('mark_failed');
    expect(result.reason).toBe('contract_invalid');
  });
});

// ---- T-05 failure_class 在 Judge 落库时必须传递 ----

describe('[BEHAVIOR] B-04 Judge 落库保留 failure_class', () => {
  /**
   * 验证 appendJudgeVerdict 写入的 detail 含 failure_class 字段。
   * 当前 kernel-handlers.js 的 appendJudgeVerdict 不传递 failure_class（先红）。
   */
  test('T-05-kernel: judge verdict detail 应含 failure_class', async () => {
    // 验证 kernel-handlers.js 中的 appendJudgeVerdict 函数行为
    // 通过检查写入的 SQL detail JSON 是否含 failure_class
    let writtenDetail = null;
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes("'verdict:judge'")) {
          writtenDetail = JSON.parse(params[3]); // 第4个参数是 detail JSON
        }
        return { rows: [{ hop: 1 }] };
      },
    };

    // 模拟带 failure_class 的 evaluateVerdict
    const mockCtx = {
      runId: 'run-1',
      taskId: 'task-1',
      observed: {
        pr: { head_sha: 'sha-abc' },
        evaluateVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-abc', failure_class: 'evidence_invalid' },
        evaluateResult: null,
        callbackResult: null,
      },
      attempt: { id: 'attempt-1' },
      bundle: { inputs: { worktree_path: '/tmp/wt', sprint_dir: 'sprints/test' } },
    };

    // 动态 import（kernel-handlers 使用 createKernelHandlers 工厂）
    const { createKernelHandlers } = await import('../kernel-handlers.js');
    const handlers = createKernelHandlers({
      pool: mockPool,
      judgeGate: async () => ({ judged: true, verdict: 'FAIL', feedback: 'test' }),
      attemptStore: { complete: async () => {} },
    });

    await handlers['spawn:judge'](mockCtx);

    // 实现后期望：writtenDetail 含 failure_class
    // 当前（先红）：writtenDetail.failure_class 为 undefined
    expect(writtenDetail).not.toBeNull();
    expect(writtenDetail.failure_class).toBe('evidence_invalid');
  });
});
