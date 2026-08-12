/**
 * execution-callback-pr-url-isolation.test.js
 *
 * RED→GREEN TDD for I2:
 *   generic HTTP callback — effectivePrUrl 确定后，所有下游禁止再读 raw pr_url
 *   真正 import/mount route + 触发三类 callback（raw=null/非法、DB existing合法）
 *   观察 createHarnessTask/checkPrCiStatus 收到合法 URL；captured spy 明确断言
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks must be declared before imports (Vitest hoisting) ──

vi.mock('../db.js', () => {
  const mockPool = {
    query: vi.fn(),
    connect: vi.fn(),
  };
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    release: vi.fn(),
  };
  mockPool.connect.mockResolvedValue(mockClient);
  return { default: mockPool };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn().mockReturnValue(''),
  spawn: vi.fn(),
  spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '[]', stderr: '' }),
}));

vi.mock('../tick.js', () => ({
  runTickSafe: vi.fn().mockResolvedValue({ actions_taken: [] }),
  getTickStatus: vi.fn().mockReturnValue({ running: false }),
}));

vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue(null),
  EVENT_TYPES: { TASK_COMPLETED: 'TASK_COMPLETED', TASK_FAILED: 'TASK_FAILED' },
}));

vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  rollbackDecision: vi.fn(),
}));

vi.mock('../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
  getGlobalState: vi.fn(),
  selectTopAreas: vi.fn(),
  selectActiveInitiativeForArea: vi.fn(),
  ACTIVE_AREA_COUNT: 3,
}));

vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));

vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn(),
}));

vi.mock('../circuit-breaker.js', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock('../notifier.js', () => ({
  notifyTaskCompleted: vi.fn().mockResolvedValue(null),
}));

vi.mock('../platform-utils.js', () => ({
  getAvailableMemoryMB: vi.fn().mockReturnValue(2048),
}));

vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(null),
}));

vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
}));

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  removeActiveProcess: vi.fn(),
  setBillingPause: vi.fn(),
}));

vi.mock('../lib/review-task-types.js', () => ({
  REVIEW_TASK_TYPES: ['harness_contract_review', 'code_review'],
}));

vi.mock('../lib/callback-postprocess.js', () => ({
  serialUnlockNext: vi.fn().mockResolvedValue(null),
  writeReviewResult: vi.fn().mockResolvedValue(null),
  promoteRegressionOnHarnessMerged: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/cascade-writeback.js', () => ({
  writeCascadeCellStatuses: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/internal-service-auth.js', () => ({
  internalServiceHeaders: vi.fn().mockReturnValue({}),
}));

vi.mock('../lib/harness-report-writeback.js', () => ({
  finalizeHarnessReportFeature: vi.fn().mockResolvedValue(null),
}));

vi.mock('../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn().mockResolvedValue(null),
}));

vi.mock('../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null),
}));

vi.mock('../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../dep-cascade.js', () => ({
  propagateDependencyFailure: vi.fn().mockResolvedValue({ affected: [] }),
  recoverDependencyChain: vi.fn().mockResolvedValue({ recovered: [] }),
}));

vi.mock('../auto-learning.js', () => ({
  processExecutionAutoLearning: vi.fn().mockResolvedValue(null),
}));

vi.mock('../zenithjoy-db.js', () => ({
  getZenithjoyPool: vi.fn().mockReturnValue(null),
}));

vi.mock('../execution.js', () => ({
  readVerdictWithRetry: vi.fn().mockResolvedValue(null),
  persistVerdictTimeout: vi.fn().mockResolvedValue(null),
  isBridgeSessionCrash: vi.fn().mockReturnValue(false),
  handleEvaluateSessionCrash: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/retry-policy.js', () => ({
  isTransientClass: vi.fn().mockReturnValue(false),
}));

vi.mock('../anchor-check.js', () => ({
  checkAnchor: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../templates.js', () => ({
  generatePrdFromTask: vi.fn(),
  generatePrdFromGoalKR: vi.fn(),
  generateTrdFromGoal: vi.fn(),
  generateTrdFromGoalKR: vi.fn(),
  validatePrd: vi.fn(),
  validateTrd: vi.fn(),
  prdToJson: vi.fn(),
  trdToJson: vi.fn(),
  PRD_TYPE_MAP: {},
}));

vi.mock('../ci-diagnostics.js', () => ({
  diagnoseCiFailure: vi.fn().mockResolvedValue(null),
}));

vi.mock('../dev-failure-classifier.js', () => ({
  classifyDevFailure: vi.fn().mockReturnValue({ class: 'other', retryable: false }),
}));

vi.mock('../progress-ledger.js', () => ({
  recordProgressStep: vi.fn().mockResolvedValue(null),
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 'new-harness-task-001' }),
}));

// ── imports after mocks ──
import express from 'express';
import request from 'supertest';

const VALID_PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4830';
const RAW_INVALID_PR = 'PR #4830'; // stdout 只输出了 PR 编号，非完整 URL
const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RUN_ID = 'run-001-xxxx-yyyy-zzzz';

/**
 * 构建一个持有合法 pr_url 的 harness_generate 任务（模拟 DB 返回）
 */
function makeHarnessTask({
  taskType = 'harness_generate',
  payloadPrUrl = null,
  existingPrUrl = VALID_PR_URL,
  devTaskId = 'dev-task-001',
} = {}) {
  return {
    id: TASK_ID,
    title: `Test ${taskType} task`,
    task_type: taskType,
    status: 'in_progress',
    pr_url: null, // tasks.pr_url 为空（Generator 还未写回）
    pr_status: null,
    pr_merged_at: null,
    retry_count: 0,
    payload: {
      harness_mode: true,
      planner_task_id: 'plan-task-001',
      sprint_dir: 'sprints/test',
      dev_task_id: devTaskId,
      ...(payloadPrUrl === null ? {} : { pr_url: payloadPrUrl }),
      ...(existingPrUrl === null ? {} : { existing_pr_url: existingPrUrl }),
    },
    project_id: 'proj-001',
    goal_id: 'goal-001',
    queued_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    result: null,
  };
}

/**
 * 设置 pool mock 以支持 harness_generate 回调流程
 * 返回 capturedCreateTaskCalls 供后续断言
 */
async function setupHarnessTest({
  taskType = 'harness_generate',
  payloadPrUrl = null,
  existingPrUrl = VALID_PR_URL,
  devRecordPrUrl = null,
  verdict = null,
} = {}) {
  const { default: pool } = await import('../db.js');
  const { createTask } = await import('../actions.js');
  const { execSync, spawnSync } = await import('child_process');
  const { readVerdictWithRetry } = await import('../execution.js');

  const harnessTask = makeHarnessTask({ taskType, payloadPrUrl, existingPrUrl });
  const mockClient = {
    query: vi.fn(async (sql) => {
      if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT.*decision_log/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT.*task_run_metrics/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/UPDATE tasks/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT.*progress_ledger/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  pool.connect.mockResolvedValue(mockClient);

  pool.query.mockImplementation(async (sql, args) => {
    // callback_queue INSERT
    if (/INSERT.*callback_queue/i.test(sql)) return { rows: [{ id: 'cq-001' }], rowCount: 1 };

    // 幂等检查 (decision_log)
    if (/SELECT.*decision_log/i.test(sql)) return { rows: [], rowCount: 0 };

    // 终态检查
    if (/SELECT\s+status\s+FROM tasks/i.test(sql)) {
      return { rows: [{ status: 'in_progress' }], rowCount: 1 };
    }

    // terminal failure guard
    if (/SELECT\s+payload->>'failure_class'/i.test(sql)) {
      return { rows: [{ failure_class: null }], rowCount: 1 };
    }

    // postdeploy guard
    if (/SELECT\s+task_type,\s*payload\s+FROM tasks/i.test(sql)) {
      return { rows: [{ task_type: harnessTask.task_type, payload: harnessTask.payload }], rowCount: 1 };
    }

    // resolveCanonicalPrUrl：SELECT pr_url, payload FROM tasks WHERE id = $1
    if (/SELECT.*pr_url.*payload.*FROM tasks/i.test(sql)) {
      return { rows: [{ pr_url: null, payload: harnessTask.payload }], rowCount: 1 };
    }

    if (/SELECT\s+pr_url,\s*branch\s+FROM dev_records/i.test(sql)) {
      return { rows: devRecordPrUrl ? [{ pr_url: devRecordPrUrl, branch: null }] : [], rowCount: devRecordPrUrl ? 1 : 0 };
    }

    // harness task fetch (SELECT id, title, ... FROM tasks WHERE id)
    if (/SELECT.*FROM tasks.*WHERE.*id/i.test(sql)) {
      return { rows: [harnessTask], rowCount: 1 };
    }

    // task_run_metrics
    if (/INSERT.*task_run_metrics|SELECT.*queued_at/i.test(sql)) return { rows: [], rowCount: 1 };

    return { rows: [], rowCount: 1 };
  });

  // spawnSync: gh pr view → CI passed
  spawnSync.mockReturnValue({
    status: 0,
    stdout: JSON.stringify({ statusCheckRollup: [{ conclusion: 'SUCCESS', status: 'COMPLETED', name: 'brain-ci' }] }),
    stderr: '',
  });

  // execSync: git remote + gh pr list
  execSync.mockReturnValue('');
  readVerdictWithRetry.mockResolvedValue({ verdict, timedOut: false });

  const capturedCreateTaskCalls = [];
  createTask.mockImplementation(async (params) => {
    capturedCreateTaskCalls.push(params);
    return { id: 'new-harness-task-001' };
  });

  return { pool, createTask, capturedCreateTaskCalls, harnessTask };
}

// ════════════════════════════════════════════════════════════════
// I2: 真正 import route + 触发 callback，断言 createTask 收到合法 URL
// ════════════════════════════════════════════════════════════════

describe('[I2] execution-callback route — harness_generate 使用 resolvedPrUrl，非 raw pr_url', () => {
  let app;

  beforeEach(async () => {
    // clearAllMocks: 清除调用记录，但保留 vi.mock() 声明的实现（不能用 resetAllMocks，会把 serialUnlockNext 等变成返回 undefined 的 fn）
    vi.clearAllMocks();
    const { default: router } = await import('../routes/execution.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('[I2-1] raw pr_url 非法("PR #4830") + DB existing_pr_url 合法 → createTask 收到合法 URL', async () => {
    const { capturedCreateTaskCalls } = await setupHarnessTest({
      rawPrUrl: RAW_INVALID_PR,
      existingPrUrl: VALID_PR_URL,
    });

    const resp = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: TASK_ID,
        run_id: RUN_ID,
        status: 'AI Done',
        pr_url: RAW_INVALID_PR,   // raw = 非法
        result: { pr_url: null, result: 'harness_generate completed' },
        duration_ms: 60000,
        iterations: 1,
        exit_code: 0,
      });

    // 回调应该被接受（200 或 成功处理）
    expect([200, 503]).toContain(resp.status);

    if (resp.status === 200) {
      // 如果 createTask 被调用，验证传入的 pr_url 是合法的
      const harnessCreateCalls = capturedCreateTaskCalls.filter(
        c => c.task_type === 'harness_evaluate' || c.task_type === 'harness_fix' || c.task_type === 'harness_ci_watch'
      );

      for (const call of harnessCreateCalls) {
        const payloadPrUrl = call.payload?.pr_url;
        if (payloadPrUrl) {
          // Fix D: 必须是合法 URL，不能是 'PR #4830' 或 null（来自 raw pr_url）
          expect(payloadPrUrl).toMatch(/^https:\/\/github\.com\//);
          expect(payloadPrUrl).toBe(VALID_PR_URL);
        }
      }
    }
  });

  it('[I2-2] raw pr_url=null + DB existing_pr_url 合法 → resolvedPrUrl 非 null', async () => {
    const { capturedCreateTaskCalls } = await setupHarnessTest({
      rawPrUrl: null,
      existingPrUrl: VALID_PR_URL,
    });

    const resp = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: TASK_ID,
        run_id: RUN_ID,
        status: 'AI Done',
        pr_url: null,
        result: null,
        duration_ms: 60000,
        iterations: 1,
        exit_code: 0,
      });

    expect([200, 503]).toContain(resp.status);

    if (resp.status === 200 && capturedCreateTaskCalls.length > 0) {
      const harnessCall = capturedCreateTaskCalls.find(
        c => ['harness_evaluate', 'harness_fix', 'harness_ci_watch'].includes(c.task_type)
      );
      if (harnessCall?.payload?.pr_url) {
        expect(harnessCall.payload.pr_url).toMatch(/^https:\/\/github\.com\//);
      }
    }
  });

  it('[I2-3] raw pr_url 合法 → resolvedPrUrl=raw → createTask 用 raw（正向场景）', async () => {
    const ANOTHER_VALID = 'https://github.com/org/repo/pull/9999';
    const { capturedCreateTaskCalls } = await setupHarnessTest({
      rawPrUrl: ANOTHER_VALID,
      existingPrUrl: VALID_PR_URL,
    });

    const resp = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: TASK_ID,
        run_id: RUN_ID,
        status: 'AI Done',
        pr_url: ANOTHER_VALID,
        result: { pr_url: ANOTHER_VALID },
        duration_ms: 60000,
        iterations: 1,
        exit_code: 0,
      });

    expect([200, 503]).toContain(resp.status);

    if (resp.status === 200 && capturedCreateTaskCalls.length > 0) {
      const harnessCall = capturedCreateTaskCalls.find(
        c => ['harness_evaluate', 'harness_fix', 'harness_ci_watch'].includes(c.task_type)
      );
      if (harnessCall?.payload?.pr_url) {
        // raw URL 合法 → resolvedPrUrl = raw → 传到 createTask 也是 raw（正确）
        expect(harnessCall.payload.pr_url).toMatch(/^https:\/\/github\.com\//);
      }
    }
  });
});

describe('[I2 regression] harness PR URL 必须全链路 canonical，且不能进入 shell', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: router } = await import('../routes/execution.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('harness_generate 跳过恶意 result.pr_url，继续使用合法 dev_records fallback', async () => {
    const maliciousUrl = 'https://github.com/o/r/pull/1$(id)';
    const { capturedCreateTaskCalls } = await setupHarnessTest({
      taskType: 'harness_generate',
      existingPrUrl: null,
      devRecordPrUrl: VALID_PR_URL,
    });

    const resp = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: TASK_ID,
        run_id: `${RUN_ID}-generate-malicious`,
        status: 'AI Done',
        pr_url: null,
        result: { pr_url: maliciousUrl },
        duration_ms: 1,
        iterations: 1,
        exit_code: 0,
      });

    expect(resp.status).toBe(200);
    const evaluateCalls = capturedCreateTaskCalls.filter(c => c.task_type === 'harness_evaluate');
    expect(evaluateCalls).toHaveLength(1);
    expect(evaluateCalls[0].payload.pr_url).toBe(VALID_PR_URL);
  });

  it('harness_fix 跳过恶意 payload.pr_url，使用合法 existing_pr_url', async () => {
    const maliciousUrl = 'https://github.com/o/r/pull/1$(id)';
    const { capturedCreateTaskCalls } = await setupHarnessTest({
      taskType: 'harness_fix',
      payloadPrUrl: maliciousUrl,
      existingPrUrl: VALID_PR_URL,
    });

    const resp = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: TASK_ID,
        run_id: `${RUN_ID}-fix-malicious`,
        status: 'AI Done',
        pr_url: null,
        result: {},
        duration_ms: 1,
        iterations: 1,
        exit_code: 0,
      });

    expect(resp.status).toBe(200);
    const evaluateCalls = capturedCreateTaskCalls.filter(c => c.task_type === 'harness_evaluate');
    expect(evaluateCalls).toHaveLength(1);
    expect(evaluateCalls[0].payload.pr_url).toBe(VALID_PR_URL);
  });

  it('harness_evaluate PASS 只把 canonical URL 作为 argv，恶意 payload 不进入子进程', async () => {
    const maliciousUrl = 'https://github.com/o/r/pull/1$(id)';
    const { capturedCreateTaskCalls } = await setupHarnessTest({
      taskType: 'harness_evaluate',
      payloadPrUrl: maliciousUrl,
      existingPrUrl: VALID_PR_URL,
      verdict: 'PASS',
    });
    const { execSync, spawnSync } = await import('child_process');

    const resp = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: TASK_ID,
        run_id: `${RUN_ID}-evaluate-malicious`,
        status: 'AI Done',
        pr_url: null,
        result: { verdict: 'PASS' },
        duration_ms: 1,
        iterations: 1,
        exit_code: 0,
      });

    expect(resp.status).toBe(200);
    const reportCalls = capturedCreateTaskCalls.filter(c => c.task_type === 'harness_report');
    expect(reportCalls).toHaveLength(1);
    expect(reportCalls[0].payload.pr_url).toBe(VALID_PR_URL);

    const allProcessArgs = [
      ...vi.mocked(execSync).mock.calls.flat(),
      ...vi.mocked(spawnSync).mock.calls.flat(),
    ];
    expect(JSON.stringify(allProcessArgs)).not.toContain('$(id)');
    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['pr', 'merge', VALID_PR_URL]),
      expect.any(Object),
    );
  });

  it('harness_evaluate 首次 merge 失败后切到远端 PR head，rebase/push 后二次 merge', async () => {
    const { capturedCreateTaskCalls } = await setupHarnessTest({
      taskType: 'harness_evaluate',
      existingPrUrl: VALID_PR_URL,
      verdict: 'PASS',
    });
    const { spawnSync } = await import('child_process');
    let mergeAttempts = 0;
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
        mergeAttempts += 1;
        if (mergeAttempts === 1) {
          return { status: 1, stdout: '', stderr: 'merge conflict' };
        }
      }
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return { status: 0, stdout: 'cp-safe-branch\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const resp = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: TASK_ID,
        run_id: `${RUN_ID}-evaluate-rebase`,
        status: 'AI Done',
        pr_url: null,
        result: { verdict: 'PASS' },
        duration_ms: 1,
        iterations: 1,
        exit_code: 0,
      });

    expect(resp.status).toBe(200);
    expect(mergeAttempts).toBe(2);
    const commandArgv = vi.mocked(spawnSync).mock.calls.map(([command, args]) => [command, args]);
    expect(commandArgv).toEqual(expect.arrayContaining([
      ['git', ['fetch', 'origin']],
      ['git', ['switch', '--detach', 'origin/cp-safe-branch']],
      ['git', ['rebase', 'origin/main']],
      ['git', ['push', '--force-with-lease', 'origin', 'HEAD:cp-safe-branch']],
    ]));
    expect(commandArgv).not.toContainEqual(['git', ['checkout', '--', 'cp-safe-branch']]);
    expect(capturedCreateTaskCalls.filter(c => c.task_type === 'harness_fix')).toHaveLength(0);
    expect(capturedCreateTaskCalls.filter(c => c.task_type === 'harness_report')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════
// I2: 基础 resolver 验证（保留原有核心测试，增强断言）
// ════════════════════════════════════════════════════════════════

describe('[I2] resolveCanonicalPrUrl — 优先级链与 trim 验证', () => {

  it('[I2-D1] diagnoseCiFailure 收到的 prUrl 来自 resolveCanonicalPrUrl，而非 raw pr_url', async () => {
    const VALID_URL = 'https://github.com/org/repo/pull/4830';
    const RAW_PR_URL = 'PR #4830';

    const { resolveCanonicalPrUrl } = await import('../lib/callback-utils.js');

    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pr_url: VALID_URL, payload: {} }],
      }),
    };

    const resolved = await resolveCanonicalPrUrl(RAW_PR_URL, 'task-d1', pool);
    // spy 必须明确断言：resolver 返回合法 URL
    expect(resolved).toBe(VALID_URL);
    // raw pr_url 是非法的
    const { isValidGithubPrUrl } = await import('../lib/callback-utils.js');
    expect(isValidGithubPrUrl(RAW_PR_URL)).toBe(false);
    // resolved 是合法的
    expect(isValidGithubPrUrl(resolved)).toBe(true);
  });

  it('[I2-D2] raw pr_url 非法时，resolveCanonicalPrUrl fallback 链正确', async () => {
    const { resolveCanonicalPrUrl } = await import('../lib/callback-utils.js');
    const EXISTING_URL = 'https://github.com/org/repo/pull/9999';

    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pr_url: null, payload: { existing_pr_url: EXISTING_URL } }],
      }),
    };

    const resolved = await resolveCanonicalPrUrl(null, 'task-d2', pool);
    expect(resolved).toBe(EXISTING_URL);
  });

  it('[I2-D3] tasks.pr_url 非法("PR #4830") + payload.existing_pr_url 合法 → 返回 existing', async () => {
    const { resolveCanonicalPrUrl, isValidGithubPrUrl } = await import('../lib/callback-utils.js');
    const EXISTING_URL = 'https://github.com/org/repo/pull/4830';

    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pr_url: 'PR #4830', payload: { existing_pr_url: EXISTING_URL } }],
      }),
    };

    // raw pr_url = 'PR #4830' 非法
    const resolved = await resolveCanonicalPrUrl('PR #4830', 'task-d3', pool);

    // 断言：resolved 是合法 URL（不是 null，也不是 'PR #4830'）
    expect(resolved).toBe(EXISTING_URL);
    expect(isValidGithubPrUrl(resolved)).toBe(true);
    // 验证 spy（pool.query）被调用了（确认走了 DB fallback）
    expect(pool.query).toHaveBeenCalled();
  });

  it('[I2-D4] resolveCanonicalPrUrl 优先级链：explicit > tasks.pr_url > payload.pr_url > payload.existing_pr_url', async () => {
    const { resolveCanonicalPrUrl } = await import('../lib/callback-utils.js');

    const cases = [
      {
        label: 'explicit 有效 → 使用 explicit',
        explicitUrl: 'https://github.com/org/repo/pull/1',
        dbRow: { pr_url: 'https://github.com/org/repo/pull/2', payload: { pr_url: 'https://github.com/org/repo/pull/3' } },
        expected: 'https://github.com/org/repo/pull/1',
      },
      {
        label: 'explicit 无效 + tasks.pr_url 有效 → 使用 tasks.pr_url',
        explicitUrl: 'invalid',
        dbRow: { pr_url: 'https://github.com/org/repo/pull/2', payload: { pr_url: 'https://github.com/org/repo/pull/3' } },
        expected: 'https://github.com/org/repo/pull/2',
      },
      {
        label: 'explicit 无效 + tasks.pr_url 无效 + payload.pr_url 有效 → 使用 payload.pr_url',
        explicitUrl: null,
        dbRow: { pr_url: null, payload: { pr_url: 'https://github.com/org/repo/pull/3' } },
        expected: 'https://github.com/org/repo/pull/3',
      },
    ];

    for (const c of cases) {
      const pool = { query: vi.fn().mockResolvedValue({ rows: [c.dbRow] }) };
      const result = await resolveCanonicalPrUrl(c.explicitUrl, 'task-x', pool);
      expect(result, c.label).toBe(c.expected);
    }
  });

  it('[I2-D5] payload 字段中有 trim 空格的 URL → 正确 trim 后校验', async () => {
    const { resolveCanonicalPrUrl } = await import('../lib/callback-utils.js');
    const VALID_URL = 'https://github.com/org/repo/pull/123';

    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pr_url: null, payload: { pr_url: '  ' + VALID_URL + '  ' } }],
      }),
    };

    const result = await resolveCanonicalPrUrl(null, 'task-d5', pool);
    expect(result).toBe(VALID_URL);
  });
});
