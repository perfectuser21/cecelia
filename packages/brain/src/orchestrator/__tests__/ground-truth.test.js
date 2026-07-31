/**
 * ground-truth.test.js —— collectGroundTruth 用 fake deps 断言解析逻辑（spec §测试策略 §4 观测侧）。
 * 不测真外部：pool/execCmd/fileExists/readFile 全注入。
 * 重点：PR json 解析 / ci 状态映射 / rN 解析 / inflight label 过滤 / lastAgentExit hop 作用域（P0-3）。
 */
import { describe, it, expect, vi } from 'vitest';
import { collectGroundTruth } from '../ground-truth.js';
import { derive } from '../derive.js';

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const CONTRACT_ID = '99999999-8888-7777-6666-555555555555';
const PR_URL = 'https://github.com/o/r/pull/42';

/** 按 SQL 表名路由的 fake pool */
function fakePool(rowsByTable = {}) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('FROM initiative_runs')) return { rows: rowsByTable.initiative_runs ?? [] };
      if (sql.includes('FROM initiative_contracts')) return { rows: rowsByTable.initiative_contracts ?? [] };
      if (sql.includes('FROM tasks')) return { rows: rowsByTable.tasks ?? [] };
      if (sql.includes('FROM harness_attempts')) {
        if (sql.includes("role = 'evaluator'")) {
          return { rows: rowsByTable.harness_evaluator_attempts ?? [] };
        }
        if ('harness_attempts_result' in rowsByTable) {
          return rowsByTable.harness_attempts_result;
        }
        return { rows: rowsByTable.harness_attempts ?? [] };
      }
      if (
        sql.includes('FROM orchestrator_decision_log')
        && sql.includes('JOIN initiative_runs prior_run')
      ) {
        return { rows: rowsByTable.historical_failure_sets ?? [] };
      }
      if (sql.includes('FROM orchestrator_decision_log')) {
        return { rows: rowsByTable.orchestrator_decision_log ?? [] };
      }
      if (sql.includes('FROM account_usage_cache')) return { rows: rowsByTable.account_usage_cache ?? [] };
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
}

/** 按命令片段路由的 fake execCmd（先匹配更长的片段） */
function fakeExecCmd(handlers = {}) {
  const calls = [];
  const fn = vi.fn((cmd) => {
    calls.push(cmd);
    if (cmd.includes('gh pr list')) return handlers.prList ?? '[]';
    if (cmd.includes('gh pr view')) return handlers.prView ?? '';
    if (cmd.includes('gh pr checks')) {
      if (handlers.prChecksUnsupported) {
        const err = new Error('Command failed: gh pr checks --json state');
        err.stderr = 'unknown flag: --json';
        throw err;
      }
      if (handlers.prChecksThrow) {
        const err = new Error('gh pr checks nonzero exit');
        err.stdout = handlers.prChecksThrow;
        throw err;
      }
      return handlers.prChecks ?? '[]';
    }
    if (cmd.includes('ls-remote')) return handlers.lsRemote ?? '';
    if (cmd.includes('docker ps -a')) return handlers.dockerPsExited ?? '';
    if (cmd.includes('docker ps')) return handlers.dockerPs ?? '';
    if (cmd.includes('docker inspect')) return handlers.dockerInspect ?? '{"ExitCode":0}';
    throw new Error(`unexpected cmd: ${cmd}`);
  });
  fn.calls = calls;
  return fn;
}

function makeDeps({ rows = {}, exec = {}, files = {}, readAuthCircuit } = {}) {
  const runRow = {
    id: RUN_ID, contract_id: CONTRACT_ID, phase: 'generate', pr_url: null,
    cost_usd: '1.50', current_task_id: TASK_ID,
    ...(rows.run ?? {}),
  };
  const pool = fakePool({
    initiative_runs: [runRow],
    initiative_contracts: rows.contracts ?? [{ id: CONTRACT_ID, status: 'draft' }],
    tasks: rows.tasks ?? [{ id: TASK_ID, status: 'in_progress', payload: {} }],
    harness_attempts: rows.attempts ?? [],
    harness_evaluator_attempts: rows.evaluatorAttempts ?? rows.attempts ?? [],
    orchestrator_decision_log: rows.log ?? [],
    historical_failure_sets: rows.historicalFailureSets ?? [],
    account_usage_cache: rows.circuit ?? [],
    ...(rows.attemptsQueryResult !== undefined
      ? { harness_attempts_result: rows.attemptsQueryResult }
      : {}),
    ...(rows.run === null ? { initiative_runs: [] } : {}),
  });
  return {
    pool,
    execCmd: fakeExecCmd(exec),
    fileExists: vi.fn((p) => Boolean(files[p])),
    readFile: vi.fn((p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    }),
    ...(readAuthCircuit ? { readAuthCircuit } : {}),
  };
}

describe('collectGroundTruth：DB 通道组装', () => {
  it('run/contract/task/decision_log/熔断 五路 DB 全采集，contract.approved 映射 status===approved', async () => {
    const deps = makeDeps({
      rows: {
        contracts: [{ id: CONTRACT_ID, status: 'approved' }],
        circuit: [{ account_id: 'account2', is_auth_failed: true, auth_fail_count: 2 }],
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(o.run.id).toBe(RUN_ID);
    expect(o.task.status).toBe('in_progress');
    expect(o.contract.approved).toBe(true);
    expect(o.contract.id).toBe(CONTRACT_ID);
    expect(o.decisionLog).toEqual([]);
    expect(o.authCircuit).toEqual([{ account_id: 'account2', is_auth_failed: true, auth_fail_count: 2 }]);
  });

  it('contract status=draft → approved:false；contract_id 为空 → 不查 contracts、approved:false', async () => {
    const deps1 = makeDeps();
    const o1 = await collectGroundTruth(deps1, { taskId: TASK_ID, runId: RUN_ID });
    expect(o1.contract.approved).toBe(false);

    const deps2 = makeDeps({ rows: { run: { contract_id: null } } });
    const o2 = await collectGroundTruth(deps2, { taskId: TASK_ID, runId: RUN_ID });
    expect(o2.contract.approved).toBe(false);
    expect(deps2.pool.calls.some(([sql]) => sql.includes('FROM initiative_contracts'))).toBe(false);
  });

  it('run 行不存在 → fail-fast throw', async () => {
    const deps = makeDeps({ rows: { run: null } });
    await expect(collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID })).rejects.toThrow(/initiative_runs|run/);
  });

  it('deps.readAuthCircuit 注入 → 覆盖默认 account_usage_cache SQL', async () => {
    const readAuthCircuit = vi.fn(async () => [{ account_id: 'account1', is_auth_failed: true }]);
    const deps = makeDeps({ readAuthCircuit });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.authCircuit).toEqual([{ account_id: 'account1', is_auth_failed: true }]);
    expect(deps.pool.calls.some(([sql]) => sql.includes('account_usage_cache'))).toBe(false);
  });

  it('读取最新完成 evaluator attempt 的完整 result，供 judge 取机械证据', async () => {
    const evaluatorResult = {
      contract_version: '1.0',
      status: 'completed',
      summary: 'all checks passed',
      checks: [{ command: 'npm test', exit_code: 0, log_tail: '12 tests passed' }],
      decision: { outcome: 'PASS', reason: 'verified' },
      provider_metadata: { provider: 'codex', session_id: 'thread-1' },
    };
    const deps = makeDeps({ rows: { attempts: [{ result: evaluatorResult }] } });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.evaluateResult).toEqual(evaluatorResult);
    expect(deps.pool.calls.some(([sql, params]) => (
      sql.includes('FROM harness_attempts')
      && sql.includes("role = 'evaluator'")
      && params[0] === RUN_ID
    ))).toBe(true);
  });

  it('separately restores normalized product-failure sets from prior Runs of the same task', async () => {
    const deps = makeDeps({
      rows: {
        log: [{ hop: 9, action: 'wait:poll_ci', observed: {} }],
        historicalFailureSets: [
          { failure_set: [' test:b ', 'lint', 'lint'] },
          { failure_set: ['typecheck'] },
          { failure_set: 'not-an-array' },
        ],
      },
    });

    const observed = await collectGroundTruth(deps, {
      taskId: TASK_ID,
      runId: RUN_ID,
    });

    expect(observed.decisionLog).toEqual([
      { hop: 9, action: 'wait:poll_ci', observed: {} },
    ]);
    expect(observed.historicalFailureSets).toEqual([
      ['lint', 'test:b'],
      ['typecheck'],
    ]);
    const [sql, params] = deps.pool.calls.find(([query]) => (
      query.includes('JOIN initiative_runs prior_run')
    ));
    expect(sql).toContain("fix.action = 'spawn:generator-fix'");
    expect(sql).toContain("fix.observed->>'failure_class' = 'product_failure'");
    expect(sql).toContain('prior_run.current_task_id = $1');
    expect(sql).toContain('prior_run.id <> $2');
    expect(params).toEqual([TASK_ID, RUN_ID]);
  });
});

describe('collectGroundTruth：prd 与 callback 文件', () => {
  it('prd 文件存在 → prdExists:true（路径可注入）', async () => {
    const deps = makeDeps({ files: { '/wt/sprint-prd.md': '# prd' } });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID, prdPath: '/wt/sprint-prd.md' });
    expect(o.prdExists).toBe(true);
  });

  it.each(['completed', 'completed_with_concerns'])(
    '远端 planner 的已认证 %s callback receipt 可推进 PRD 里程碑，无需读取远端 worktree',
    async (callbackStatus) => {
    const attemptId = '10000000-0000-4000-8000-000000000009';
    const sprintDir = 'sprints/07310943-kernel-remote';
    const deps = makeDeps({
      rows: {
        tasks: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: { sprint_dir: sprintDir },
        }],
        attempts: [{
          id: attemptId,
          run_id: RUN_ID,
          hop: 2,
          role: 'planner',
          status: callbackStatus,
          execution_transport: 'fleet-worker',
          machine_attestation_status: 'verified',
          actual_machine_id: 'xian-mac-m4',
          lease_generation: 0,
          task_bundle: {
            inputs: {
              planner_branch: 'cp-harness-prd-aaaaaaaa-a2',
              workspace_spec: {
                repo: 'perfectuser21/zenithjoy-workspace',
              },
            },
          },
        }],
        log: [{
          hop: 3,
          action: 'verdict:attempt_callback',
          observed: {
            attempt_id: attemptId,
            role: 'planner',
            status: callbackStatus,
          },
          detail: {
            run_id: RUN_ID,
            attempt_id: attemptId,
            role: 'planner',
            status: callbackStatus,
            lease_generation: 0,
            artifacts: [{
              type: 'git_artifact',
              kind: 'planner_prd',
              path: `${sprintDir}/sprint-prd.md`,
              repo: 'perfectuser21/zenithjoy-workspace',
              branch: 'cp-harness-prd-aaaaaaaa-a2',
              head_sha: 'a'.repeat(40),
              verification_status: 'verified',
            }],
          },
        }],
      },
    });

    const observed = await collectGroundTruth(deps, {
      taskId: TASK_ID,
      runId: RUN_ID,
      prdPath: '/untrusted/task-worktree/sprint-prd.md',
    });

    expect(deps.fileExists).toHaveBeenCalledWith('/untrusted/task-worktree/sprint-prd.md');
    expect(observed.prdExists).toBe(true);
    expect(observed.plannerPrdArtifact).toMatchObject({
      branch: 'cp-harness-prd-aaaaaaaa-a2',
      head_sha: 'a'.repeat(40),
    });
    expect(derive({
      ...observed,
      counters: {
        hops: 1,
        fixRound: 0,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    })).toMatchObject({
      phase: 'gan',
      action: 'spawn:proposer',
    });
  });

  it.each([
    ['普通 planner intent', {
      action: 'spawn:planner',
      attempt: {
        role: 'planner',
        status: 'completed',
        execution_transport: 'fleet-worker',
        machine_attestation_status: 'verified',
      },
      artifact: {
        type: 'git_artifact',
        kind: 'planner_prd',
        path: 'sprints/remote/sprint-prd.md',
        repo: 'perfectuser21/zenithjoy-workspace',
        branch: 'cp-harness-prd-aaaaaaaa-a2',
        head_sha: 'a'.repeat(40),
        verification_status: 'verified',
      },
    }],
    ['无匹配 Attempt 的 callback', {
      action: 'verdict:attempt_callback',
      attempt: null,
      artifact: {
        type: 'git_artifact',
        kind: 'planner_prd',
        path: 'sprints/remote/sprint-prd.md',
        repo: 'perfectuser21/zenithjoy-workspace',
        branch: 'cp-harness-prd-aaaaaaaa-a2',
        head_sha: 'a'.repeat(40),
        verification_status: 'verified',
      },
    }],
    ['未认证机器的 callback', {
      action: 'verdict:attempt_callback',
      attempt: {
        role: 'planner',
        status: 'completed',
        execution_transport: 'fleet-worker',
        machine_attestation_status: 'unverified',
      },
      artifact: {
        type: 'git_artifact',
        kind: 'planner_prd',
        path: 'sprints/remote/sprint-prd.md',
        repo: 'perfectuser21/zenithjoy-workspace',
        branch: 'cp-harness-prd-aaaaaaaa-a2',
        head_sha: 'a'.repeat(40),
        verification_status: 'verified',
      },
    }],
    ['错误路径的 artifact claim', {
      action: 'verdict:attempt_callback',
      attempt: {
        role: 'planner',
        status: 'completed',
        execution_transport: 'fleet-worker',
        machine_attestation_status: 'verified',
      },
      artifact: {
        type: 'git_artifact',
        kind: 'planner_prd',
        path: 'sprints/other/sprint-prd.md',
        repo: 'perfectuser21/zenithjoy-workspace',
        branch: 'cp-harness-prd-aaaaaaaa-a2',
        head_sha: 'a'.repeat(40),
        verification_status: 'verified',
      },
    }],
  ])('%s 不得伪造 PRD 里程碑', async (_label, fixture) => {
    const attemptId = '10000000-0000-4000-8000-000000000010';
    const callbackStatus = fixture.callbackStatus ?? 'completed';
    const deps = makeDeps({
      rows: {
        tasks: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: { sprint_dir: 'sprints/remote' },
        }],
        attempts: fixture.attempt
          ? [{
              id: attemptId,
              run_id: RUN_ID,
              hop: 2,
              actual_machine_id: 'xian-mac-m4',
              lease_generation: 0,
              task_bundle: {
                inputs: {
                  planner_branch: 'cp-harness-prd-aaaaaaaa-a2',
                  workspace_spec: {
                    repo: 'perfectuser21/zenithjoy-workspace',
                  },
                },
              },
              ...fixture.attempt,
            }]
          : [],
        log: [{
          hop: 3,
          action: fixture.action,
          observed: { prdExists: false },
          detail: {
            run_id: RUN_ID,
            attempt_id: attemptId,
            role: 'planner',
            status: callbackStatus,
            lease_generation: 0,
            artifacts: [fixture.artifact],
          },
        }],
      },
    });

    const observed = await collectGroundTruth(deps, {
      taskId: TASK_ID,
      runId: RUN_ID,
      prdPath: '/untrusted/task-worktree/sprint-prd.md',
    });

    expect(observed.prdExists).toBe(false);
  });

  it('Brain 容器重启后看不到 task worktree，沿用 append-only 决策日志中已观测的 PRD 里程碑', async () => {
    const deps = makeDeps({
      rows: {
        log: [
          {
            hop: 2,
            action: 'spawn:planner',
            observed: { prdExists: false },
            detail: { reason: 'no_prd' },
          },
          {
            hop: 3,
            action: 'spawn:proposer',
            observed: { prdExists: true },
            detail: { reason: 'no_contract_yet' },
          },
        ],
      },
    });

    const o = await collectGroundTruth(deps, {
      taskId: TASK_ID,
      runId: RUN_ID,
      prdPath: '/host-only-worktree/sprint-prd.md',
    });

    expect(deps.fileExists).toHaveBeenCalledWith('/host-only-worktree/sprint-prd.md');
    expect(o.prdExists).toBe(true);
  });

  it('.brain-result.json 存在 → 解析进 callbackResult；不存在 → null', async () => {
    const deps1 = makeDeps({ files: { '/wt/.brain-result.json': '{"status":"DONE","pr_url":"u"}' } });
    const o1 = await collectGroundTruth(deps1, { taskId: TASK_ID, runId: RUN_ID, callbackResultPath: '/wt/.brain-result.json' });
    expect(o1.callbackResult).toEqual({ status: 'DONE', pr_url: 'u' });

    const deps2 = makeDeps();
    const o2 = await collectGroundTruth(deps2, { taskId: TASK_ID, runId: RUN_ID });
    expect(o2.callbackResult).toBeNull();
  });
});

describe('collectGroundTruth：PR 状态（gh 封装）', () => {
  it('run.pr_url 为空 → pr:null，不调 gh', async () => {
    const deps = makeDeps();
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.pr).toBeNull();
    expect(deps.execCmd.calls.some((c) => c.includes('gh pr'))).toBe(false);
  });

  it('gh 2.45 不支持 pr checks --json 时，直接用 pr view statusCheckRollup 采集 CI，不触发 fatal', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'BLOCKED',
          headRefOid: 'sha-compat',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'SUCCESS' },
            { status: 'IN_PROGRESS', conclusion: '' },
          ],
        }),
        prChecksUnsupported: true,
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.pr).toMatchObject({ head_sha: 'sha-compat', ci: 'pending' });
    expect(deps.execCmd.calls.some((cmd) => cmd.includes('gh pr checks'))).toBe(false);
    expect(deps.execCmd.calls.some((cmd) => cmd.includes('statusCheckRollup'))).toBe(true);
  });

  it('把 GitHub headRefName 作为 evaluator checkout 的结构化真相返回', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          headRefName: 'cp-07251603-kernel-evaluator-pr-branch',
          headRefOid: 'sha-evaluator-head',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.pr).toMatchObject({
      head_ref: 'cp-07251603-kernel-evaluator-pr-branch',
      head_sha: 'sha-evaluator-head',
    });
    expect(deps.execCmd.calls.some((cmd) => cmd.includes('headRefName'))).toBe(true);
  });

  it('模型漏填 pr_url 时按 task 分支标识从 GitHub 反查 PR', async () => {
    const deps = makeDeps({
      rows: {
        run: { pr_url: null },
        tasks: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: { base_repo: 'https://github.com/o/r.git' },
        }],
      },
      exec: {
        prList: JSON.stringify([
          { headRefName: 'cp-0722-feature-11111111', title: 'feature', url: PR_URL, state: 'OPEN' },
        ]),
        prView: JSON.stringify({
          state: 'OPEN', mergeStateStatus: 'CLEAN', headRefOid: 'sha-discovered',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.pr).toMatchObject({ url: PR_URL, head_sha: 'sha-discovered', ci: 'pass' });
    expect(deps.execCmd.calls.some((cmd) => (
      cmd.includes('gh pr list --repo "o/r"') && cmd.includes('headRefName')
    ))).toBe(true);
  });

  it('gh pr view json 解析：state/headRefOid/merged 映射', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          state: 'MERGED', mergeStateStatus: 'CLEAN', headRefOid: 'sha-abc',
          statusCheckRollup: [{ state: 'SUCCESS' }],
        }),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.pr.url).toBe(PR_URL);
    expect(o.pr.state).toBe('MERGED');
    expect(o.pr.merged).toBe(true);
    expect(o.pr.head_sha).toBe('sha-abc');
  });

  it('ci 映射：任一 check FAILURE → fail', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN', mergeStateStatus: 'BLOCKED', headRefOid: 's',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'SUCCESS' },
            { status: 'COMPLETED', conclusion: 'FAILURE' },
          ],
        }),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.pr.ci).toBe('fail');
  });

  it('ci 映射：有 PENDING/IN_PROGRESS → pending', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN', mergeStateStatus: 'UNKNOWN', headRefOid: 's',
          statusCheckRollup: [
            { state: 'SUCCESS' },
            { status: 'IN_PROGRESS', conclusion: '' },
          ],
        }),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.pr.ci).toBe('pending');
  });

  it('ci 映射：全 SUCCESS → pass；空 checks → pending（CI 尚未挂上）', async () => {
    const deps1 = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: { prView: JSON.stringify({
        state: 'OPEN', mergeStateStatus: 'CLEAN', headRefOid: 's',
        statusCheckRollup: [{ state: 'SUCCESS' }, { conclusion: 'SUCCESS' }],
      }) },
    });
    expect((await collectGroundTruth(deps1, { taskId: TASK_ID, runId: RUN_ID })).pr.ci).toBe('pass');

    const deps2 = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: { prView: JSON.stringify({
        state: 'OPEN', mergeStateStatus: 'CLEAN', headRefOid: 's', statusCheckRollup: [],
      }) },
    });
    expect((await collectGroundTruth(deps2, { taskId: TASK_ID, runId: RUN_ID })).pr.ci).toBe('pending');
  });
});

describe('collectGroundTruth：propose 分支 rN 解析', () => {
  it('ls-remote 多分支 → 取最大 rN', async () => {
    const deps = makeDeps({
      exec: {
        lsRemote: [
          'aaa\trefs/heads/cp-harness-propose-r1-11111111-a0',
          'bbb\trefs/heads/cp-harness-propose-r3-11111111-a0',
          'ccc\trefs/heads/cp-harness-propose-r2-11111111-a0',
        ].join('\n'),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.proposeBranchRn).toBe(3);
    expect(o.proposeBranch).toBe('cp-harness-propose-r3-11111111-a0');
  });

  it('无 propose 分支 → 0', async () => {
    const deps = makeDeps({ exec: { lsRemote: '' } });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.proposeBranchRn).toBe(0);
    expect(o.proposeBranch).toBeNull();
  });

  it('同轮多 attempt 时返回 attempt 序号最大的精确分支', async () => {
    const deps = makeDeps({
      exec: {
        lsRemote: [
          'aaa\trefs/heads/cp-harness-propose-r2-11111111-a3',
          'bbb\trefs/heads/cp-harness-propose-r2-11111111-a9',
        ].join('\n'),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.proposeBranchRn).toBe(2);
    expect(o.proposeBranch).toBe('cp-harness-propose-r2-11111111-a9');
  });

  it('同时保留 propose tip SHA，且只接受锚定当前 SHA 的 reviewer verdict', async () => {
    const approvedSha = 'a'.repeat(40);
    const movedSha = 'b'.repeat(40);
    const branch = 'cp-harness-propose-r2-11111111-a9';
    const base = {
      exec: { lsRemote: `${approvedSha}\trefs/heads/${branch}` },
    };
    const approved = await collectGroundTruth(makeDeps({
      ...base,
      rows: {
        log: [{
          hop: 4,
          action: 'verdict:reviewer',
          observed: {},
          detail: { verdict: 'APPROVED', rn: 2, contract_sha: approvedSha },
        }],
      },
    }), { taskId: TASK_ID, runId: RUN_ID });

    expect(approved.proposeBranchSha).toBe(approvedSha);
    expect(approved.ganLatestRoundVerdict).toBe('APPROVED');
    expect(approved.ganLatestRoundContractSha).toBe(approvedSha);

    const stale = await collectGroundTruth(makeDeps({
      exec: { lsRemote: `${movedSha}\trefs/heads/${branch}` },
      rows: {
        log: [{
          hop: 4,
          action: 'verdict:reviewer',
          observed: {},
          detail: { verdict: 'APPROVED', rn: 2, contract_sha: approvedSha },
        }],
      },
    }), { taskId: TASK_ID, runId: RUN_ID });

    expect(stale.proposeBranchSha).toBe(movedSha);
    expect(stale.ganLatestRoundVerdict).toBeNull();
    expect(stale.ganLatestRoundContractSha).toBeNull();
  });

  it('task 作用域：跨 task 分支不计入（并发 initiative 的 rN 不污染 ganRound），ls-remote pattern 带 taskId 前 8 位', async () => {
    const deps = makeDeps({
      exec: {
        lsRemote: [
          'aaa\trefs/heads/cp-harness-propose-r2-11111111-a0', // 本 task（TASK_ID 前 8 位）
          'bbb\trefs/heads/cp-harness-propose-r9-deadbeef-a0', // 别的 task，禁止计入
        ].join('\n'),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.proposeBranchRn).toBe(2);
    const lsCmd = deps.execCmd.calls.find((c) => c.includes('ls-remote'));
    expect(lsCmd).toContain('cp-harness-propose-r*-11111111-*');
  });
});

describe('collectGroundTruth：inflight（P0-1）', () => {
  it('docker ps 命令带 label=cecelia.run_id=<runId> 过滤；containers 解析自 json lines', async () => {
    const deps = makeDeps({
      exec: {
        dockerPs: [
          JSON.stringify({ ID: 'c1', Labels: `cecelia.run_id=${RUN_ID},cecelia.hop=6,cecelia.role=generator` }),
        ].join('\n'),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.inflight.containers).toHaveLength(1);
    expect(o.inflight.containers[0].ID).toBe('c1');
    expect(o.inflight.host_pids).toEqual([]);
    const psCmd = deps.execCmd.calls.find((c) => c.includes('docker ps') && !c.includes('-a'));
    expect(psCmd).toContain(`cecelia.run_id=${RUN_ID}`);
  });

  it('无在途容器 → containers:[]', async () => {
    const deps = makeDeps({ exec: { dockerPs: '' } });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.inflight.containers).toEqual([]);
  });

  it('materializes starting/running Attempt lifecycle rows for the current run, regardless of transport receipt', async () => {
    const startingRemote = {
      id: '10000000-0000-4000-8000-000000000001',
      run_id: RUN_ID,
      hop: 5,
      role: 'generator',
      status: 'starting',
      error_code: null,
      execution_transport: 'remote-bridge',
    };
    const runningLocal = {
      id: '10000000-0000-4000-8000-000000000002',
      run_id: RUN_ID,
      hop: 6,
      role: 'evaluator',
      status: 'running',
      error_code: null,
      execution_transport: 'local-docker',
    };
    const completedRemote = {
      id: '10000000-0000-4000-8000-000000000003',
      run_id: RUN_ID,
      hop: 4,
      role: 'reviewer',
      status: 'completed',
      error_code: null,
      execution_transport: 'remote-bridge',
    };
    const deps = makeDeps({
      rows: { attempts: [runningLocal, completedRemote, startingRemote] },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.inflight.attempts).toEqual([runningLocal, startingRemote]);
    expect(observed.inflight.attempts).not.toContain(completedRemote);
    expect(deps.pool.calls.some(([sql, params]) => (
      sql.includes('FROM harness_attempts')
      && !sql.includes("role = 'evaluator'")
      && sql.includes('WHERE run_id = $1')
      && sql.includes('ORDER BY hop DESC')
      && params[0] === RUN_ID
    ))).toBe(true);
  });

  it('empty Attempt query materializes attempts:[]', async () => {
    const observed = await collectGroundTruth(makeDeps(), { taskId: TASK_ID, runId: RUN_ID });
    expect(observed.inflight.attempts).toEqual([]);
  });

  it('malformed Attempt query results fail instead of erasing lifecycle truth', async () => {
    const deps = makeDeps({ rows: { attemptsQueryResult: null } });
    await expect(
      collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID }),
    ).rejects.toThrow();
  });
});

describe('collectGroundTruth：lastAgentExit hop 作用域（P0-3 + derive 3d 契约）', () => {
  const logWithSpawns = [
    { hop: 3, action: 'spawn:generator', observed: {}, detail: null },
    { hop: 5, action: 'spawn:generator-fix', observed: {}, detail: null },
  ];

  function exitedContainers() {
    return [
      JSON.stringify({ ID: 'old1', Labels: `cecelia.run_id=${RUN_ID},cecelia.hop=3,cecelia.role=generator` }),
      JSON.stringify({ ID: 'new1', Labels: `cecelia.run_id=${RUN_ID},cecelia.hop=5,cecelia.role=generator` }),
    ].join('\n');
  }

  it('取最新 spawn intent hop（=5）对应容器的 ExitCode，不取旧 hop=3 的', async () => {
    const deps = makeDeps({
      rows: { log: logWithSpawns },
      exec: { dockerPsExited: exitedContainers(), dockerInspect: '{"ExitCode":137}' },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.lastAgentExit.code).toBe(137);
    expect(o.lastAgentExit.action).toBe('spawn:generator-fix');
    const inspectCmd = deps.execCmd.calls.find((c) => c.includes('docker inspect'));
    expect(inspectCmd).toContain('new1');
    expect(inspectCmd).not.toContain('old1');
  });

  it('保留最新退出 attempt 的 spawn action，供 derive 按角色分路', async () => {
    const deps = makeDeps({
      rows: {
        log: [...logWithSpawns, { hop: 7, action: 'spawn:evaluator', observed: {}, detail: null }],
      },
      exec: {
        dockerPsExited: [
          exitedContainers(),
          JSON.stringify({ ID: 'eval1', Labels: `cecelia.run_id=${RUN_ID},cecelia.hop=7,cecelia.role=evaluator` }),
        ].join('\n'),
        dockerInspect: '{"ExitCode":1}',
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.lastAgentExit).toEqual({
      code: 1,
      auth_failed: false,
      action: 'spawn:evaluator',
    });
  });

  it('fix 后：最新 spawn intent hop=7 无对应容器 → code:null（旧 exit 不残留，不反复命中 3d）', async () => {
    const deps = makeDeps({
      rows: { log: [...logWithSpawns, { hop: 7, action: 'spawn:generator-fix', observed: {}, detail: null }] },
      exec: { dockerPsExited: exitedContainers() },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.lastAgentExit).toEqual({ code: null, auth_failed: false });
    expect(deps.execCmd.calls.some((c) => c.includes('docker inspect'))).toBe(false);
  });

  it('日志无任何 spawn intent → {code:null, auth_failed:false}', async () => {
    const deps = makeDeps({ rows: { log: [] }, exec: { dockerPsExited: exitedContainers() } });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.lastAgentExit).toEqual({ code: null, auth_failed: false });
  });

  it('auth_failed：hop 作用域容器存在 && callback ci_fail_type=auth_failed → true', async () => {
    const deps = makeDeps({
      rows: { log: logWithSpawns },
      exec: { dockerPsExited: exitedContainers(), dockerInspect: '{"ExitCode":1}' },
      files: { '.brain-result.json': '{"ci_fail_type":"auth_failed"}' },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.lastAgentExit.auth_failed).toBe(true);
  });

  it('auth_failed：作用域容器不存在时即使 callback 有 auth 标记 → false（同 hop 作用域）', async () => {
    const deps = makeDeps({
      rows: { log: [...logWithSpawns, { hop: 7, action: 'spawn:generator-fix', observed: {}, detail: null }] },
      exec: { dockerPsExited: exitedContainers() },
      files: { '.brain-result.json': '{"ci_fail_type":"auth_failed"}' },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.lastAgentExit.auth_failed).toBe(false);
  });

  it.each([
    ['failed', 'provider_exit', 1, false],
    ['cancelled', 'auth_failed', 1, true],
    ['completed', null, 0, false],
    ['completed_with_concerns', null, 0, false],
  ])(
    'no scoped Docker container falls back to matching terminal Attempt status=%s',
    async (status, errorCode, code, authFailed) => {
      const deps = makeDeps({
        rows: {
          log: logWithSpawns,
          attempts: [{
            id: '20000000-0000-4000-8000-000000000001',
            run_id: RUN_ID,
            hop: 5,
            role: 'generator',
            status,
            error_code: errorCode,
            execution_transport: 'remote-bridge',
          }],
        },
      });

      const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

      expect(observed.lastAgentExit).toEqual({
        code,
        auth_failed: authFailed,
        action: 'spawn:generator-fix',
      });
      expect(observed.inflight.attempts).toEqual([]);
    },
  );

  it('a stale terminal Attempt from an older hop or wrong role cannot mask the latest spawn', async () => {
    const deps = makeDeps({
      rows: {
        log: [
          ...logWithSpawns,
          { hop: 7, action: 'spawn:evaluator', observed: {}, detail: null },
        ],
        attempts: [{
          id: '20000000-0000-4000-8000-000000000002',
          run_id: RUN_ID,
          hop: 5,
          role: 'generator',
          status: 'failed',
          error_code: 'auth_failed',
          execution_transport: 'remote-bridge',
        }, {
          id: '20000000-0000-4000-8000-000000000003',
          run_id: RUN_ID,
          hop: 7,
          role: 'generator',
          status: 'failed',
          error_code: 'provider_exit',
          execution_transport: 'local-docker',
        }],
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.lastAgentExit).toEqual({ code: null, auth_failed: false });
  });

  it('scoped Docker exit takes precedence over a conflicting terminal Attempt', async () => {
    const deps = makeDeps({
      rows: {
        log: logWithSpawns,
        attempts: [{
          id: '20000000-0000-4000-8000-000000000004',
          run_id: RUN_ID,
          hop: 5,
          role: 'generator',
          status: 'failed',
          error_code: 'auth_failed',
          execution_transport: 'remote-bridge',
        }],
      },
      exec: {
        dockerPsExited: exitedContainers(),
        dockerInspect: '{"ExitCode":0}',
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.lastAgentExit).toEqual({
      code: 0,
      auth_failed: false,
      action: 'spawn:generator-fix',
    });
    expect(deps.execCmd.calls.some((cmd) => cmd.includes('docker inspect new1'))).toBe(true);
  });

  it.each([
    ['provider_exit', 'container_exit'],
    ['auth_failed', 'auth_failed'],
  ])(
    'a failed remote Attempt with %s takes the same derive failure route as a local exit',
    async (errorCode, expectedReason) => {
      const deps = makeDeps({
        rows: {
          run: { pr_url: PR_URL },
          contracts: [{ id: CONTRACT_ID, status: 'approved' }],
          log: logWithSpawns,
          attempts: [{
            id: '20000000-0000-4000-8000-000000000005',
            run_id: RUN_ID,
            hop: 5,
            role: 'generator',
            status: 'failed',
            error_code: errorCode,
            execution_transport: 'remote-bridge',
          }],
        },
        exec: {
          prView: JSON.stringify({
            state: 'OPEN',
            headRefName: 'feature',
            headRefOid: 'sha-current',
            statusCheckRollup: [{ state: 'PENDING', name: 'ci' }],
          }),
        },
        files: { 'sprint-prd.md': '# frozen PRD' },
      });

      const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
      const decision = derive({
        ...observed,
        counters: {
          hops: 5,
          fixRound: 0,
          pollCount: 0,
          noPushStreak: 0,
          noVerdictStreak: 0,
          ganCostUsd: 0,
        },
      });

      expect(decision).toEqual({
        phase: 'generate',
        action: 'spawn:generator-fix',
        reason: expectedReason,
      });
    },
  );
});

describe('collectGroundTruth：决策日志推导字段', () => {
  it('generatorSpawned：spawn:generator 或 spawn:generator-fix 任一存在即 true', async () => {
    const deps1 = makeDeps({ rows: { log: [{ hop: 1, action: 'spawn:planner', observed: {}, detail: null }] } });
    expect((await collectGroundTruth(deps1, { taskId: TASK_ID, runId: RUN_ID })).generatorSpawned).toBe(false);

    const deps2 = makeDeps({ rows: { log: [{ hop: 2, action: 'spawn:generator', observed: {}, detail: null }] } });
    expect((await collectGroundTruth(deps2, { taskId: TASK_ID, runId: RUN_ID })).generatorSpawned).toBe(true);
  });

  it('evaluateVerdict/judgeVerdict：取最新 verdict:* 行的 detail（jsonb string 兼容）', async () => {
    const deps = makeDeps({
      rows: {
        log: [
          { hop: 6, action: 'verdict:evaluate', observed: {}, detail: JSON.stringify({ verdict: 'FAIL', pr_head_sha: 'sha-1' }) },
          { hop: 9, action: 'verdict:evaluate', observed: {}, detail: { verdict: 'PASS', pr_head_sha: 'sha-2' } },
          { hop: 11, action: 'verdict:judge', observed: {}, detail: { verdict: 'PASS', pr_head_sha: 'sha-2' } },
        ],
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.evaluateVerdict).toEqual({ verdict: 'PASS', pr_head_sha: 'sha-2' });
    expect(o.judgeVerdict).toEqual({ verdict: 'PASS', pr_head_sha: 'sha-2' });
  });

  it('无 verdict 行 → evaluateVerdict/judgeVerdict 为 null', async () => {
    const deps = makeDeps();
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.evaluateVerdict).toBeNull();
    expect(o.judgeVerdict).toBeNull();
  });

  it('ganLatestRoundVerdict：verdict:reviewer detail.rn === 当前分支 rN 才算本轮 verdict', async () => {
    const lsRemote = 'aaa\trefs/heads/cp-harness-propose-r2-11111111-a0';
    const deps1 = makeDeps({
      rows: { log: [{ hop: 4, action: 'verdict:reviewer', observed: {}, detail: { verdict: 'REVISION', rn: 2 } }] },
      exec: { lsRemote },
    });
    const o1 = await collectGroundTruth(deps1, { taskId: TASK_ID, runId: RUN_ID });
    expect(o1.ganLatestRoundVerdict).toBe('REVISION');

    // 旧轮 verdict（rn=1）不算 r2 的本轮 verdict
    const deps2 = makeDeps({
      rows: { log: [{ hop: 4, action: 'verdict:reviewer', observed: {}, detail: { verdict: 'APPROVED', rn: 1 } }] },
      exec: { lsRemote },
    });
    const o2 = await collectGroundTruth(deps2, { taskId: TASK_ID, runId: RUN_ID });
    expect(o2.ganLatestRoundVerdict).toBeNull();
  });

  it('reviewRequired 从 tasks.payload.review_required（string payload 兼容）；reviewApproved 锚定当前 head_sha', async () => {
    const deps = makeDeps({
      rows: {
        run: { pr_url: PR_URL },
        tasks: [{ id: TASK_ID, status: 'in_progress', payload: JSON.stringify({ review_required: true }) }],
        log: [
          {
            hop: 11,
            action: 'effect:human_review_requested',
            observed: { pr: { head_sha: 'sha-abc' } },
            detail: { review_reason: 'awaiting_human_review' },
          },
          {
            hop: 12,
            action: 'verdict:human_review',
            observed: {},
            detail: {
              approved: true,
              review_class: 'merge_gate',
              pr_head_sha: 'sha-abc',
              review_request_hop: 11,
            },
          },
        ],
      },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN', mergeStateStatus: 'CLEAN', headRefOid: 'sha-abc',
          statusCheckRollup: [{ state: 'SUCCESS' }],
        }),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.reviewRequired).toBe(true);
    expect(o.reviewApproved).toBe(true);
  });

  it('same-SHA evidence approval cannot satisfy the later merge gate after evaluator and judge PASS', async () => {
    const deps = makeDeps({
      rows: {
        run: { pr_url: PR_URL },
        contracts: [{ id: CONTRACT_ID, status: 'approved' }],
        tasks: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: { review_required: true },
        }],
        log: [
          {
            hop: 10,
            action: 'effect:human_review_requested',
            observed: { pr: { head_sha: 'sha-abc' } },
            detail: { review_reason: 'evidence_invalid:repeated_signature' },
          },
          {
            hop: 11,
            action: 'verdict:human_review',
            observed: {},
            detail: {
              approved: true,
              review_class: 'evidence_repair',
              pr_head_sha: 'sha-abc',
              review_request_hop: 10,
            },
          },
          {
            hop: 12,
            action: 'verdict:evaluate',
            observed: {},
            detail: { verdict: 'PASS', pr_head_sha: 'sha-abc' },
          },
          {
            hop: 13,
            action: 'verdict:judge',
            observed: {},
            detail: { verdict: 'PASS', pr_head_sha: 'sha-abc' },
          },
        ],
      },
      files: { 'sprint-prd.md': '# approved PRD' },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          headRefOid: 'sha-abc',
          statusCheckRollup: [{ state: 'SUCCESS' }],
        }),
      },
    });

    const observed = await collectGroundTruth(
      deps,
      { taskId: TASK_ID, runId: RUN_ID },
    );
    expect(observed.reviewApproved).toBe(false);
    expect(derive({
      ...observed,
      counters: {
        hops: 13,
        fixRound: 1,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    })).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'awaiting_human_review',
    });
  });

  it('reviewApproved：approved 记录是旧 sha → false（stale 批准不放行）', async () => {
    const deps = makeDeps({
      rows: {
        run: { pr_url: PR_URL },
        tasks: [{ id: TASK_ID, status: 'in_progress', payload: { review_required: true } }],
        log: [{ hop: 12, action: 'verdict:human_review', observed: {}, detail: { approved: true, pr_head_sha: 'sha-old' } }],
      },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN', mergeStateStatus: 'CLEAN', headRefOid: 'sha-new',
          statusCheckRollup: [{ state: 'SUCCESS' }],
        }),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.reviewApproved).toBe(false);
  });
});
