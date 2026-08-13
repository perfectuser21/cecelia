/**
 * ground-truth.test.js —— collectGroundTruth 用 fake deps 断言解析逻辑（spec §测试策略 §4 观测侧）。
 * 不测真外部：pool/execCmd/fileExists/readFile 全注入。
 * 重点：PR json 解析 / ci 状态映射 / rN 解析 / inflight label 过滤 / lastAgentExit hop 作用域（P0-3）。
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { collectGroundTruth, isLegacyProposalBranchForTask } from '../ground-truth.js';
import { derive } from '../derive.js';
import { contractArtifactManifestDigest } from '../contract-artifacts.js';

const RUN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const CONTRACT_ID = '99999999-8888-4777-8666-555555555555';
const ROUTING_RECEIPT_ID = '77777777-6666-4555-8444-333333333333';
const PR_URL = 'https://github.com/o/r/pull/42';

describe('legacy proposal branch parser', () => {
  it('匹配固定语法并按值绑定 task，不从 task id 构造动态正则', () => {
    expect(isLegacyProposalBranchForTask('cp-harness-propose-r12-11111111-a3', TASK_ID)).toBe(true);
    expect(isLegacyProposalBranchForTask('cp-harness-propose-r12-aaaaaaaa-a3', TASK_ID)).toBe(false);
    expect(isLegacyProposalBranchForTask('cp-harness-propose-r12-11111111-a3/../../x', TASK_ID)).toBe(false);
  });
});

/** 按 SQL 表名路由的 fake pool */
function fakePool(rowsByTable = {}) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('AS validation_origin_run_id')) {
        return { rows: rowsByTable.validation_origins ?? [] };
      }
      if (sql.includes('FROM initiative_runs')) return { rows: rowsByTable.initiative_runs ?? [] };
      if (sql.includes('FROM initiative_contracts')) return { rows: rowsByTable.initiative_contracts ?? [] };
      if (sql.includes('FROM initiative_contract_artifacts')) return { rows: rowsByTable.initiative_contract_artifacts ?? [] };
      if (sql.includes('FROM tasks')) return { rows: rowsByTable.tasks ?? [] };
      if (sql.includes('FROM work_routing_receipts')) return { rows: rowsByTable.work_routing_receipts ?? [] };
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
      if (sql.includes('FROM gan_case_file')) return { rows: rowsByTable.gan_case_file ?? [] };
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
  const taskRows = (rows.tasks ?? [{ id: TASK_ID, status: 'in_progress', payload: {} }])
    .map((task) => {
      const payload = {
        ...(typeof task.payload === 'string' ? JSON.parse(task.payload) : (task.payload ?? {})),
        routing_receipt_id: ROUTING_RECEIPT_ID,
      };
      return {
        ...task,
        payload: typeof task.payload === 'string' ? JSON.stringify(payload) : payload,
      };
    });
  const pool = fakePool({
    initiative_runs: [runRow],
    initiative_contracts: rows.contracts ?? [{ id: CONTRACT_ID, status: 'draft' }],
    initiative_contract_artifacts: rows.contractArtifacts ?? [],
    tasks: taskRows,
    work_routing_receipts: rows.routingReceipts ?? [{
      id: ROUTING_RECEIPT_ID,
      task_id: TASK_ID,
      work_kind: 'coding_mutation',
      change_kind: 'new_capability',
      pipeline: 'harness',
      canonical_task_type: 'harness_initiative',
      default_execution_profile: 'new-capability-v1',
      execution_profile_override: null,
      repo: 'cecelia',
      evidence: { branch: 'cp-baseline', base_sha: 'a'.repeat(40) },
      superseded: false,
    }],
    harness_attempts: rows.attempts ?? [],
    harness_evaluator_attempts: rows.evaluatorAttempts ?? rows.attempts ?? [],
    orchestrator_decision_log: rows.log ?? [],
    historical_failure_sets: rows.historicalFailureSets ?? [],
    validation_origins: rows.validationOrigins ?? [],
    account_usage_cache: rows.circuit ?? [],
    gan_case_file: rows.caseFile ?? [],
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
    expect(o.change_kind).toBe('new_capability');
    expect(o.decisionLog).toEqual([]);
    expect(o.authCircuit).toEqual([{ account_id: 'account2', is_auth_failed: true, auth_fail_count: 2 }]);
  });

  it('只投影 Runner 验证且与 Generator Attempt/Workspace/Machine 一致的本地候选', async () => {
    const attemptId = '22222222-2222-4222-8222-222222222222';
    const baseSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const artifact = {
      type: 'git_candidate',
      verification_status: 'verified',
      source_attempt_id: attemptId,
      repo: 'perfectuser21/cecelia',
      branch: 'cp-local-candidate',
      base_sha: baseSha,
      head_sha: headSha,
      machine_id: 'us-mac-m4',
      changed_files: ['docker/cecelia-runner/entrypoint.sh'],
    };
    const deps = makeDeps({ rows: { attempts: [{
      id: attemptId,
      run_id: RUN_ID,
      hop: 3,
      role: 'generator',
      status: 'completed',
      actual_machine_id: 'us-mac-m4',
      task_bundle: {
        inputs: {
          task_id: TASK_ID,
          workspace_spec: {
            repo: artifact.repo,
            branch: artifact.branch,
            base_sha: baseSha,
          },
        },
      },
      result: {
        status: 'completed',
        artifacts: [artifact],
      },
    }] } });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.candidate).toEqual(artifact);
  });

  it('拒绝带不安全 diff 路径的本地候选', async () => {
    const attemptId = '22222222-2222-4222-8222-222222222222';
    const deps = makeDeps({ rows: { attempts: [{
      id: attemptId, run_id: RUN_ID, hop: 3, role: 'generator', status: 'completed',
      actual_machine_id: 'us-mac-m4',
      task_bundle: { inputs: { task_id: TASK_ID, workspace_spec: {
        repo: 'perfectuser21/cecelia', branch: 'cp-local-candidate', base_sha: 'a'.repeat(40),
      } } },
      result: { status: 'completed', artifacts: [{
        type: 'git_candidate', verification_status: 'verified',
        source_attempt_id: attemptId, repo: 'perfectuser21/cecelia',
        branch: 'cp-local-candidate', base_sha: 'a'.repeat(40),
        head_sha: 'b'.repeat(40), machine_id: 'us-mac-m4', changed_files: ['../escape'],
      }] },
    }] } });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(observed.candidate).toBeNull();
  });

  it('拒绝 Provider 伪造或 machine 不一致的 git_candidate', async () => {
    const attemptId = '22222222-2222-4222-8222-222222222222';
    const deps = makeDeps({ rows: { attempts: [{
      id: attemptId,
      run_id: RUN_ID,
      hop: 3,
      role: 'generator',
      status: 'completed',
      actual_machine_id: 'xian-mac-m4',
      task_bundle: { inputs: { task_id: TASK_ID, workspace_spec: {
        repo: 'perfectuser21/cecelia', branch: 'cp-local-candidate', base_sha: 'a'.repeat(40),
      } } },
      result: { status: 'completed', artifacts: [{
        type: 'git_candidate', verification_status: 'verified',
        source_attempt_id: attemptId, repo: 'perfectuser21/cecelia',
        branch: 'cp-local-candidate', base_sha: 'a'.repeat(40),
        head_sha: 'b'.repeat(40), machine_id: 'us-mac-m4',
      }] },
    }] } });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.candidate).toBeNull();
  });

  it('未显式固定基线时，从本 Run 最早的合法 WorkspaceSpec 恢复稳定实现基线', async () => {
    const baselineSha = '1'.repeat(40);
    const laterContractSha = '2'.repeat(40);
    const plannerAttemptId = '22222222-2222-4222-8222-222222222222';
    const reviewerAttemptId = '33333333-3333-4333-8333-333333333333';
    const taskBundle = ({ attemptId, hop, role, baseSha, mode, branch }) => ({
      contract_version: '1.0',
      run_id: RUN_ID,
      attempt_id: attemptId,
      hop,
      phase: role === 'planner' ? 'planning' : 'gan',
      role,
      objective: `Run the ${role} role.`,
      skill: null,
      inputs: {
        task_id: TASK_ID,
        sprint_dir: 'sprints/stable-baseline',
        execution_surface: 'fleet-worker',
        workspace_spec: {
          repo: 'perfectuser21/cecelia',
          base_sha: baseSha,
          branch,
          expected_head_sha: role === 'reviewer' ? baseSha : null,
          mode,
          run_id: RUN_ID,
          attempt_id: attemptId,
          frozen_baseline: false,
        },
        artifacts: [],
      },
      constraints: {
        read_only: mode === 'read-only',
        fresh_session: true,
        timeout_seconds: 5400,
      },
      expected_output: `harness-result/${role}-v1`,
    });
    const deps = makeDeps({
      rows: {
        tasks: [{ id: TASK_ID, status: 'in_progress', payload: {} }],
        attempts: [
          {
            id: reviewerAttemptId,
            run_id: RUN_ID,
            hop: 4,
            role: 'reviewer',
            status: 'completed',
            task_bundle: taskBundle({
              attemptId: reviewerAttemptId,
              hop: 4,
              role: 'reviewer',
              baseSha: laterContractSha,
              mode: 'read-only',
              branch: 'cp-harness-propose-r1-contract',
            }),
          },
          {
            id: plannerAttemptId,
            run_id: RUN_ID,
            hop: 1,
            role: 'planner',
            status: 'completed',
            task_bundle: taskBundle({
              attemptId: plannerAttemptId,
              hop: 1,
              role: 'planner',
              baseSha: baselineSha,
              mode: 'read-write',
              branch: 'cp-harness-prd-stable-baseline',
            }),
          },
        ],
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.implementationBaseline).toEqual({
      repo: 'perfectuser21/cecelia',
      base_sha: baselineSha,
      source: 'initial_workspace',
      frozen: false,
    });
  });

  it('最早历史 TaskBundle 损坏时 fail-closed，不得从后续 Reviewer 合同 SHA 重建实现基线', async () => {
    const reviewerAttemptId = '33333333-3333-4333-8333-333333333333';
    const reviewerContractSha = '2'.repeat(40);
    const deps = makeDeps({
      rows: {
        tasks: [{ id: TASK_ID, status: 'in_progress', payload: {} }],
        attempts: [
          {
            id: reviewerAttemptId,
            run_id: RUN_ID,
            hop: 4,
            role: 'reviewer',
            status: 'completed',
            task_bundle: {
              contract_version: '1.0',
              run_id: RUN_ID,
              attempt_id: reviewerAttemptId,
              hop: 4,
              phase: 'gan',
              role: 'reviewer',
              objective: 'Review the contract.',
              skill: null,
              inputs: {
                task_id: TASK_ID,
                sprint_dir: 'sprints/stable-baseline',
                execution_surface: 'fleet-worker',
                workspace_spec: {
                  repo: 'perfectuser21/cecelia',
                  base_sha: reviewerContractSha,
                  branch: 'cp-harness-propose-r1-contract',
                  expected_head_sha: reviewerContractSha,
                  mode: 'read-only',
                  run_id: RUN_ID,
                  attempt_id: reviewerAttemptId,
                  frozen_baseline: false,
                },
                artifacts: [],
              },
              constraints: {
                read_only: true,
                fresh_session: true,
                timeout_seconds: 5400,
              },
              expected_output: 'harness-result/reviewer-v1',
            },
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            run_id: RUN_ID,
            hop: 1,
            role: 'planner',
            status: 'completed',
            task_bundle: { corrupted: true },
          },
        ],
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.implementationBaseline).toBeNull();
    expect(observed.implementationBaselineError)
      .toBe('implementation_baseline_unrecoverable');
  });

  it('approved contract 从不可变资产表读取按 path 排序的 TaskBundle 真相', async () => {
    const artifacts = [
      { path: 'sprints/router/tests/a.test.mjs', sha256: 'a'.repeat(64) },
      { path: 'sprints/router/tests/z.test.mjs', sha256: 'b'.repeat(64) },
    ];
    const deps = makeDeps({
      rows: {
        contracts: [{ id: CONTRACT_ID, status: 'approved' }],
        contractArtifacts: artifacts,
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.contract.artifacts).toEqual(artifacts);
    const [sql, params] = deps.pool.calls.find(([query]) => (
      query.includes('FROM initiative_contract_artifacts')
    ));
    expect(sql).toMatch(/ORDER BY path/);
    expect(params).toEqual([CONTRACT_ID]);
  });

  it('数据库 collation 把小写路径排在大写路径前时仍恢复为 JS 确定性顺序', async () => {
    const revision = '6faaa9f55e9789ffd29fd2760a9b5994df272e86';
    const artifact = (path, content) => ({
      path,
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
      byte_length: Buffer.byteLength(content),
      source_revision: revision,
    });
    const canonical = [
      artifact('sprints/router/contract-dod.md', '# DoD'),
      artifact('sprints/router/contract-draft.md', '# Contract'),
      artifact('sprints/router/sprint-prd.md', '# PRD'),
      artifact('sprints/router/tests/RED-evidence.txt', 'RED'),
      artifact('sprints/router/tests/gp-identity.test.mjs', 'test("gp", () => {})'),
    ];
    const manifestDigest = contractArtifactManifestDigest(canonical);
    const withSeal = (row) => ({
      ...row,
      sealed_artifact_count: canonical.length,
      sealed_manifest_sha256: manifestDigest,
      sealed_source_revision: revision,
    });
    // 生产 PostgreSQL locale 的真实顺序：小写 gp 在大写 RED 之前。
    const databaseOrder = [
      ...canonical.slice(0, 3),
      canonical[4],
      canonical[3],
    ].map(withSeal);
    const deps = makeDeps({
      rows: {
        contracts: [{ id: CONTRACT_ID, status: 'approved' }],
        contractArtifacts: databaseOrder,
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.contract.artifact_error).toBeNull();
    expect(observed.contract.artifacts.map(({ path }) => path)).toEqual(
      canonical.map(({ path }) => path),
    );
  });

  it('artifact 行数与 seal 不一致时标记 frozen contract 读取失败', async () => {
    const revision = '6faaa9f55e9789ffd29fd2760a9b5994df272e86';
    const artifact = (path, content) => ({
      path,
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
      byte_length: Buffer.byteLength(content),
      source_revision: revision,
      sealed_artifact_count: 3,
      sealed_manifest_sha256: 'b'.repeat(64),
      sealed_source_revision: revision,
    });
    const deps = makeDeps({
      rows: {
        contracts: [{ id: CONTRACT_ID, status: 'approved' }],
        contractArtifacts: [
          artifact('sprints/router/contract-dod.md', '# DoD'),
          artifact('sprints/router/contract-draft.md', '# Contract'),
          artifact('sprints/router/sprint-prd.md', '# PRD'),
          artifact('sprints/router/tests/appended.test.mjs', 'test("appended", () => {})'),
        ],
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.contract.artifact_error).toBe(
      'FROZEN_CONTRACT_ARTIFACT_INVALID:seal_mismatch',
    );
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

  it('案卷式 GAN（issue ce42f68f）：collectGroundTruth 透传 gan_case_file 全量行给 observed.caseFile', async () => {
    const caseFileRows = [
      {
        id: 'row-1', run_id: RUN_ID, round: 1, author_role: 'proposer',
        attempt_id: 'a1', contract_sha: null, rubric_scores: null,
        blockers: [], feedback_md: null,
      },
      {
        id: 'row-2', run_id: RUN_ID, round: 1, author_role: 'reviewer',
        attempt_id: 'a2', contract_sha: 'a'.repeat(40),
        rubric_scores: { correctness: 8 },
        blockers: [{ id: 'R1-1', status: 'open' }],
        feedback_md: '# round 1',
      },
    ];
    const deps = makeDeps({ rows: { caseFile: caseFileRows } });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.caseFile).toEqual(caseFileRows);
    const [sql, params] = deps.pool.calls.find(([query]) => query.includes('FROM gan_case_file'));
    expect(sql).toMatch(/WHERE gcf\.run_id\s*=\s*\$1/);
    expect(sql).toMatch(/ORDER BY gcf\.round ASC, gcf\.author_role ASC/);
    // ground-truth 显式传 CASE_FILE_FULL_TEXT_ROUNDS（P2-3 膨胀闸1，当前=2）。
    expect(params).toEqual([RUN_ID, 2]);
  });

  it('gan_case_file 无行时 observed.caseFile 为空数组（不是 null/undefined）', async () => {
    const deps = makeDeps();
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(observed.caseFile).toEqual([]);
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
    const artifact = {
      type: 'git_artifact',
      kind: 'planner_prd',
      path: `${sprintDir}/sprint-prd.md`,
      repo: 'perfectuser21/zenithjoy-workspace',
      branch: 'cp-harness-prd-aaaaaaaa-a2',
      head_sha: 'a'.repeat(40),
      verification_status: 'verified',
    };
    const serverVerification = {
      method: 'git_branch_head',
      artifact: {
        path: artifact.path,
        repo: artifact.repo,
        branch: artifact.branch,
        head_sha: artifact.head_sha,
      },
    };
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
          result: {
            server_verification: {
              planner_git_artifact: serverVerification,
            },
          },
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
            artifacts: [artifact],
            server_verification: {
              planner_git_artifact: serverVerification,
            },
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

  it('修复前无 provenance 的 PRD snapshot 不得绕过 server proof', async () => {
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
    expect(o.prdExists).toBe(false);
  });

  it('Brain 容器重启后只沿用带服务端文件观测 provenance 的 PRD 里程碑', async () => {
    const deps = makeDeps({
      rows: {
        log: [{
          hop: 3,
          action: 'spawn:proposer',
          observed: {
            prdExists: true,
            prdEvidence: {
              source: 'brain_file_observation',
              path: '/host-only-worktree/sprint-prd.md',
            },
          },
          detail: { reason: 'no_contract_yet' },
        }],
      },
    });

    const o = await collectGroundTruth(deps, {
      taskId: TASK_ID,
      runId: RUN_ID,
      prdPath: '/host-only-worktree/sprint-prd.md',
    });

    expect(o.prdExists).toBe(true);
    expect(o.prdEvidence).toEqual({
      source: 'brain_file_observation',
      path: '/host-only-worktree/sprint-prd.md',
    });
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

  it('run.pr_url 为空但 task payload 声明精确 PR → 直接验证声明 URL，不依赖 task 短 ID 发现', async () => {
    const declaredHeadSha = '7a07d99439c04fd01c3cd61407b040282d2846cf';
    const deps = makeDeps({
      rows: {
        run: { pr_url: null },
        tasks: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: {
            base_repo: 'https://github.com/o/r.git',
            pr_url: PR_URL,
            pr_head_sha: declaredHeadSha,
          },
        }],
      },
      exec: {
        prList: '[]',
        prView: JSON.stringify({
          number: 42,
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          headRefName: 'cp-unrelated-to-task-id',
          headRefOid: declaredHeadSha,
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.pr).toMatchObject({
      url: PR_URL,
      head_sha: declaredHeadSha,
      ci: 'pass',
    });
    expect(deps.execCmd.calls.some((cmd) => cmd.includes(`gh pr view ${PR_URL}`))).toBe(true);
    expect(deps.execCmd.calls.some((cmd) => cmd.includes('gh pr list'))).toBe(false);
  });

  it('显式恢复 run 只采信同任务可信前序 run 对精确 PR URL/SHA 的 Generator 后观测', async () => {
    const priorRunId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const headSha = '7a07d99439c04fd01c3cd61407b040282d2846cf';
    const deps = makeDeps({
      rows: {
        run: {
          pr_url: PR_URL,
          created_source: 'explicit_recovery',
          predecessor_run_id: priorRunId,
        },
        validationOrigins: [{
          validation_origin_run_id: priorRunId,
          observed: { pr: { url: PR_URL, head_sha: headSha } },
        }],
      },
      exec: {
        prView: JSON.stringify({
          number: 42,
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          headRefName: 'cp-recovery',
          headRefOid: headSha,
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.verifiedExistingPrOrigin).toEqual({
      source: 'trusted_prior_kernel_run',
      run_id: priorRunId,
      pr_url: PR_URL,
      pr_head_sha: headSha,
    });
    const [sql, params] = deps.pool.calls.find(([query]) => (
      query.includes('AS validation_origin_run_id')
    ));
    expect(sql).toMatch(/record_trust_status IN \('trusted', 'reconstructed'\)/);
    expect(sql).toMatch(/role = 'generator'/);
    expect(sql).toMatch(/status IN \('completed', 'completed_with_concerns'\)/);
    expect(sql).toMatch(/prior_run\.id = \$3/);
    expect(sql).toMatch(/prior_run\.contract_id = \$5/);
    expect(sql).toMatch(/evaluator_intent\.observed->'routingReceipt'->>'id' = \$4/);
    expect(sql).toMatch(/evaluator_intent\.observed->'implementationBaseline'->>'base_sha' = \$6/);
    expect(params).toEqual([
      TASK_ID,
      RUN_ID,
      priorRunId,
      ROUTING_RECEIPT_ID,
      CONTRACT_ID,
      'a'.repeat(40),
    ]);
  });

  it('显式恢复 run 未声明 predecessor 时不查询也不建立既有 PR 信任源', async () => {
    const headSha = '7a07d99439c04fd01c3cd61407b040282d2846cf';
    const deps = makeDeps({
      rows: {
        run: { pr_url: PR_URL, created_source: 'explicit_recovery', predecessor_run_id: null },
        validationOrigins: [{
          validation_origin_run_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          observed: { pr: { url: PR_URL, head_sha: headSha } },
        }],
      },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN', mergeStateStatus: 'CLEAN', headRefOid: headSha,
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(observed.verifiedExistingPrOrigin).toBeNull();
    expect(deps.pool.calls.some(([sql]) => sql.includes('AS validation_origin_run_id'))).toBe(false);
  });

  it('显式恢复 run 的前序证据与当前 GitHub head 不一致时不建立既有 PR 信任源', async () => {
    const deps = makeDeps({
      rows: {
        run: { pr_url: PR_URL, created_source: 'explicit_recovery' },
        validationOrigins: [{
          validation_origin_run_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          observed: { pr: { url: PR_URL, head_sha: 'a'.repeat(40) } },
        }],
      },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          headRefOid: 'b'.repeat(40),
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.verifiedExistingPrOrigin).toBeNull();
  });

  it('task payload 的 pr_url 不是严格 GitHub PR URL → fail closed，不把声明值交给 shell', async () => {
    const deps = makeDeps({
      rows: {
        run: { pr_url: null },
        tasks: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: {
            pr_url: 'https://github.com/o/r/pull/42; touch /tmp/injected',
          },
        }],
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.pr).toBeNull();
    expect(deps.execCmd.calls.some((cmd) => cmd.includes('gh pr'))).toBe(false);
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

  // run 0955c884 案卷：非 required 的 Deploy Preview Environment 连挂时，
  // ci='fail' 触发 generator-fix 死循环（FIXED 同 sha → no_progress_same_sha 收死），
  // 而 required 全绿的 PR 实际可合并（mergeStateStatus=UNSTABLE）。
  it('非 required check 失败(mergeStateStatus 非 BLOCKED) → ci=pass 不触发 fix', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'UNSTABLE',
          headRefOid: 'sha-unstable',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'SUCCESS' },
            { name: 'Deploy Preview Environment', status: 'COMPLETED', conclusion: 'FAILURE' },
          ],
        }),
      },
    });
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(observed.pr).toMatchObject({ head_sha: 'sha-unstable', ci: 'pass' });
  });

  it('check 失败且 mergeStateStatus=BLOCKED 且全部落定 → ci=fail', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'BLOCKED',
          headRefOid: 'sha-truefail',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'SUCCESS' },
            { name: 'ci-passed', status: 'COMPLETED', conclusion: 'FAILURE' },
          ],
        }),
      },
    });
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(observed.pr).toMatchObject({ head_sha: 'sha-truefail', ci: 'fail' });
  });

  it('check 有失败但仍有 pending → ci=pending（等全部落定再裁）', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'BLOCKED',
          headRefOid: 'sha-settling',
          statusCheckRollup: [
            { name: 'Deploy Preview Environment', status: 'COMPLETED', conclusion: 'FAILURE' },
            { status: 'IN_PROGRESS', conclusion: '' },
          ],
        }),
      },
    });
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(observed.pr).toMatchObject({ head_sha: 'sha-settling', ci: 'pending' });
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

  it('把 GitHub PR number 写入 evaluator evidence identity', async () => {
    const deps = makeDeps({
      rows: { run: { pr_url: PR_URL } },
      exec: {
        prView: JSON.stringify({
          number: 1571,
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          headRefName: 'cp-07311932-e76cb826',
          headRefOid: '341a7a251eb9f16593618e355c44df56a3e7c444',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.pr.number).toBe(1571);
    expect(deps.execCmd.calls.some((cmd) => cmd.includes('number'))).toBe(true);
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
  it('跨仓库任务从 payload.base_repo 查询 proposal refs，不读取 Brain origin', async () => {
    const deps = makeDeps({
      rows: {
        tasks: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: { base_repo: 'perfectuser21/zenithjoy-workspace' },
        }],
      },
      exec: {
        lsRemote: `${'a'.repeat(40)}\trefs/heads/cp-harness-propose-r1-11111111-raaaaaaaa-a18`,
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    const command = deps.execCmd.calls.find((candidate) => candidate.includes('ls-remote'));
    expect(command).toContain('https://github.com/perfectuser21/zenithjoy-workspace.git');
    expect(command).not.toMatch(/ls-remote --heads origin\b/);
    expect(observed.proposeBranch).toBe('cp-harness-propose-r1-11111111-raaaaaaaa-a18');
    expect(observed.proposeBranchRn).toBe(1);
  });

  it('ls-remote 多分支 → 取最大 rN', async () => {
    const deps = makeDeps({
      exec: {
        lsRemote: [
          'aaa\trefs/heads/cp-harness-propose-r1-11111111-raaaaaaaa-a1',
          'bbb\trefs/heads/cp-harness-propose-r3-11111111-raaaaaaaa-a2',
          'ccc\trefs/heads/cp-harness-propose-r2-11111111-raaaaaaaa-a3',
        ].join('\n'),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.proposeBranchRn).toBe(3);
    expect(o.proposeBranch).toBe('cp-harness-propose-r3-11111111-raaaaaaaa-a2');
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
          'aaa\trefs/heads/cp-harness-propose-r2-11111111-raaaaaaaa-a3',
          'bbb\trefs/heads/cp-harness-propose-r2-11111111-raaaaaaaa-a9',
        ].join('\n'),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.proposeBranchRn).toBe(2);
    expect(o.proposeBranch).toBe('cp-harness-propose-r2-11111111-raaaaaaaa-a9');
  });

  it('同时保留 propose tip SHA，且只接受锚定当前 SHA 的 reviewer verdict', async () => {
    const approvedSha = 'a'.repeat(40);
    const movedSha = 'b'.repeat(40);
    const branch = 'cp-harness-propose-r2-11111111-raaaaaaaa-a9';
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

  it('reopen_gan_contract 之前的 APPROVED 不再算本轮 verdict(r43 实证:重开后被崩溃窗口补批复辟)', async () => {
    // r43 实证:reopen 后合同已降级 draft,但重开前趋势闸的 APPROVED 行仍匹配
    // rn+SHA(proposer 尚未推新轮),ganLatestRoundVerdict='APPROVED' 复活 →
    // derive 崩溃窗口分支把合同原样补批回 approved,重开被静默撤销。
    // 纪元规则:verdict 查找只认最新 reopen 行之后的 reviewer 行。
    const approvedSha = 'a'.repeat(40);
    const branch = 'cp-harness-propose-r2-11111111-raaaaaaaa-a9';
    const reopened = await collectGroundTruth(makeDeps({
      exec: { lsRemote: `${approvedSha}\trefs/heads/${branch}` },
      rows: {
        log: [
          {
            hop: 4,
            action: 'verdict:reviewer',
            observed: {},
            detail: { verdict: 'APPROVED', rn: 2, contract_sha: approvedSha },
          },
          { hop: 7, action: 'reopen_gan_contract', observed: {}, detail: { callback_hop: 6 } },
        ],
      },
    }), { taskId: TASK_ID, runId: RUN_ID });
    expect(reopened.ganLatestRoundVerdict).toBeNull();

    const postReopenApproved = await collectGroundTruth(makeDeps({
      exec: { lsRemote: `${approvedSha}\trefs/heads/${branch}` },
      rows: {
        log: [
          { hop: 7, action: 'reopen_gan_contract', observed: {}, detail: { callback_hop: 6 } },
          {
            hop: 9,
            action: 'verdict:reviewer',
            observed: {},
            detail: { verdict: 'APPROVED', rn: 2, contract_sha: approvedSha },
          },
        ],
      },
    }), { taskId: TASK_ID, runId: RUN_ID });
    expect(postReopenApproved.ganLatestRoundVerdict).toBe('APPROVED');
  });

  it('只投影与当前 round 和 SHA 匹配的最新 Reviewer 反馈', async () => {
    const contractSha = 'b'.repeat(40);
    const branch = 'cp-harness-propose-r2-11111111-raaaaaaaa-a9';
    const attemptId = '22222222-2222-4222-8222-222222222222';
    const matchingAttempt = {
      id: attemptId,
      role: 'reviewer',
      status: 'completed_with_concerns',
      completed_at: '2026-07-31T09:00:00.000Z',
      task_bundle: {
        contract_version: '1.0',
        run_id: RUN_ID,
        attempt_id: attemptId,
        hop: 8,
        phase: 'gan',
        role: 'reviewer',
        objective: 'Review the current contract.',
        inputs: {
          task_id: TASK_ID,
          sprint_dir: 'sprints/reviewer-feedback',
          worktree_path: '/tmp/reviewer-feedback',
          contract_round: 2,
          contract_sha: contractSha,
        },
        constraints: { read_only: true, fresh_session: true, timeout_seconds: 600 },
        expected_output: 'harness-result/reviewer-v1',
      },
      result: {
        contract_version: '1.0',
        attempt_id: attemptId,
        status: 'completed_with_concerns',
        summary: 'Round 2 still misses the executable E2E oracle.',
        artifacts: [],
        checks: [],
        decision: { outcome: 'REVISION', reason: 'verification oracle below threshold' },
        error: null,
        provider_metadata: {
          provider: 'codex',
          session_id: 'session-review-2',
          transcript: 'must not cross the role boundary',
        },
      },
    };
    const staleAttempt = {
      ...matchingAttempt,
      id: '33333333-3333-4333-8333-333333333333',
      completed_at: '2026-07-31T10:00:00.000Z',
      task_bundle: {
        ...matchingAttempt.task_bundle,
        attempt_id: '33333333-3333-4333-8333-333333333333',
        inputs: {
          ...matchingAttempt.task_bundle.inputs,
          contract_round: 1,
          contract_sha: 'a'.repeat(40),
        },
      },
      result: {
        ...matchingAttempt.result,
        attempt_id: '33333333-3333-4333-8333-333333333333',
      },
    };
    const deps = makeDeps({
      exec: { lsRemote: `${contractSha}\trefs/heads/${branch}` },
      rows: { attempts: [staleAttempt, matchingAttempt] },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.ganLatestRoundReviewFeedback).toEqual({
      attempt_id: attemptId,
      contract_round: 2,
      contract_sha: contractSha,
      summary: 'Round 2 still misses the executable E2E oracle.',
      reason: 'verification oracle below threshold',
    });
    expect(JSON.stringify(observed.ganLatestRoundReviewFeedback)).not.toContain('transcript');
  });

  it('确定性 identity gate 的 REVISION 反馈优先于 Reviewer Attempt 的旧 APPROVED 文本', async () => {
    const contractSha = 'e'.repeat(40);
    const branch = 'cp-harness-propose-r2-11111111-raaaaaaaa-a9';
    const deps = makeDeps({
      exec: { lsRemote: `${contractSha}\trefs/heads/${branch}` },
      rows: {
        log: [{
          hop: 14,
          action: 'verdict:reviewer',
          observed: { proposeBranchRn: 2, proposeBranchSha: contractSha },
          detail: {
            verdict: 'REVISION',
            rn: 2,
            contract_sha: contractSha,
            summary: '合同硬编码了 GAN authoring identity。',
            reason: '改用 late-bound runtime identity。',
            source: 'validation_identity_policy',
          },
        }],
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.ganLatestRoundVerdict).toBe('REVISION');
    expect(observed.ganLatestRoundReviewFeedback).toEqual({
      contract_round: 2,
      contract_sha: contractSha,
      summary: '合同硬编码了 GAN authoring identity。',
      reason: '改用 late-bound runtime identity。',
      source: 'validation_identity_policy',
    });
  });

  it.each([
    ['boolean round', 1, (attempt) => {
      attempt.task_bundle.inputs.contract_round = true;
    }],
    ['mismatched result attempt id', 2, (attempt) => {
      attempt.result.attempt_id = '44444444-4444-4444-8444-444444444444';
    }],
    ['mismatched row/result status', 2, (attempt) => {
      attempt.result.status = 'blocked';
    }],
    ['empty decision reason', 2, (attempt) => {
      attempt.result.decision.reason = '';
    }],
  ])('畸形 Reviewer feedback fail closed：%s', async (_label, currentRound, mutate) => {
    const contractSha = 'c'.repeat(40);
    const attemptId = '55555555-5555-4555-8555-555555555555';
    const attempt = {
      id: attemptId,
      role: 'reviewer',
      status: 'completed_with_concerns',
      task_bundle: {
        contract_version: '1.0',
        run_id: RUN_ID,
        attempt_id: attemptId,
        hop: 9,
        phase: 'gan',
        role: 'reviewer',
        objective: 'Review the current contract.',
        inputs: {
          task_id: TASK_ID,
          sprint_dir: 'sprints/reviewer-feedback',
          worktree_path: '/tmp/reviewer-feedback',
          contract_round: currentRound,
          contract_sha: contractSha,
        },
        constraints: { read_only: true, fresh_session: true, timeout_seconds: 600 },
        expected_output: 'harness-result/reviewer-v1',
      },
      result: {
        contract_version: '1.0',
        attempt_id: attemptId,
        status: 'completed_with_concerns',
        summary: 'The oracle still needs one executable assertion.',
        artifacts: [],
        checks: [],
        decision: { outcome: 'REVISION', reason: 'oracle below threshold' },
        error: null,
        provider_metadata: { provider: 'codex', session_id: 'session-review-invalid' },
      },
    };
    mutate(attempt);
    const deps = makeDeps({
      exec: {
        lsRemote: `${contractSha}\trefs/heads/cp-harness-propose-r${currentRound}-11111111-a9`,
      },
      rows: { attempts: [attempt] },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.ganLatestRoundReviewFeedback).toBeNull();
  });

  it('Reviewer feedback 脱敏并限制每个文本字段长度', async () => {
    const contractSha = 'd'.repeat(40);
    const attemptId = '66666666-6666-4666-8666-666666666666';
    const attempt = {
      id: attemptId,
      role: 'reviewer',
      status: 'completed_with_concerns',
      task_bundle: {
        contract_version: '1.0',
        run_id: RUN_ID,
        attempt_id: attemptId,
        hop: 10,
        phase: 'gan',
        role: 'reviewer',
        objective: 'Review the current contract.',
        inputs: {
          task_id: TASK_ID,
          sprint_dir: 'sprints/reviewer-feedback',
          worktree_path: '/tmp/reviewer-feedback',
          contract_round: 2,
          contract_sha: contractSha,
        },
        constraints: { read_only: true, fresh_session: true, timeout_seconds: 600 },
        expected_output: 'harness-result/reviewer-v1',
      },
      result: {
        contract_version: '1.0',
        attempt_id: attemptId,
        status: 'completed_with_concerns',
        summary: `token=review-secret ${'x'.repeat(3_000)}`,
        artifacts: [],
        checks: [],
        decision: { outcome: 'REVISION', reason: 'Bearer provider-secret' },
        error: null,
        provider_metadata: { provider: 'codex', session_id: 'session-review-redact' },
      },
    };
    const deps = makeDeps({
      exec: {
        lsRemote: `${contractSha}\trefs/heads/cp-harness-propose-r2-11111111-raaaaaaaa-a9`,
      },
      rows: { attempts: [attempt] },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    const feedback = observed.ganLatestRoundReviewFeedback;

    expect(feedback.summary).not.toContain('review-secret');
    expect(feedback.reason).not.toContain('provider-secret');
    expect(feedback.summary.length).toBeLessThanOrEqual(2_000);
    expect(feedback.reason.length).toBeLessThanOrEqual(2_000);
  });

  it('task 作用域：跨 task 分支不计入（并发 initiative 的 rN 不污染 ganRound），ls-remote pattern 带 taskId 前 8 位', async () => {
    const deps = makeDeps({
      exec: {
        lsRemote: [
          'aaa\trefs/heads/cp-harness-propose-r2-11111111-raaaaaaaa-a1', // 本 task + 本 run
          'bbb\trefs/heads/cp-harness-propose-r9-deadbeef-raaaaaaaa-a2', // 别的 task，禁止计入
        ].join('\n'),
      },
    });
    const o = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(o.proposeBranchRn).toBe(2);
    const lsCmd = deps.execCmd.calls.find((c) => c.includes('ls-remote'));
    expect(lsCmd).toContain('cp-harness-propose-r*-11111111-raaaaaaaa-*');
  });

  it('run 作用域：同 task 的其他 run 即使 round 和 hop 更大也不得污染当前 run', async () => {
    const deps = makeDeps({
      exec: {
        lsRemote: [
          'aaa\trefs/heads/cp-harness-propose-r2-11111111-raaaaaaaa-a3',
          'bbb\trefs/heads/cp-harness-propose-r9-11111111-rdeadbeef-a99',
        ].join('\n'),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.proposeBranchRn).toBe(2);
    expect(observed.proposeBranch).toBe('cp-harness-propose-r2-11111111-raaaaaaaa-a3');
  });

  it('仅为当前 run 的严格 Proposer TaskBundle 兼容部署前 legacy 分支', async () => {
    const attemptId = '77777777-7777-4777-8777-777777777777';
    const legacyBranch = 'cp-harness-propose-r4-11111111-a7';
    const deps = makeDeps({
      rows: {
        attempts: [{
          id: attemptId,
          run_id: RUN_ID,
          hop: 7,
          role: 'proposer',
          status: 'completed',
          task_bundle: {
            contract_version: '1.0',
            run_id: RUN_ID,
            attempt_id: attemptId,
            hop: 7,
            phase: 'gan',
            role: 'proposer',
            objective: 'Produce the next contract revision.',
            inputs: {
              task_id: TASK_ID,
              sprint_dir: 'sprints/legacy-proposer',
              worktree_path: '/tmp/legacy-proposer',
              propose_branch: legacyBranch,
              contract_round: 4,
              artifacts: [],
            },
            constraints: { read_only: false, fresh_session: true, timeout_seconds: 600 },
            expected_output: 'harness-result/proposer-v1',
          },
        }],
      },
      exec: {
        lsRemote: [
          `aaa\trefs/heads/${legacyBranch}`,
          'bbb\trefs/heads/cp-harness-propose-r9-11111111-a99',
        ].join('\n'),
      },
    });

    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(observed.proposeBranchRn).toBe(4);
    expect(observed.proposeBranch).toBe(legacyBranch);
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
      && sql.includes('lease_owner')
      && sql.includes('lease_expires_at')
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
  it('generatorSpawned：只有 run-scoped Generator Attempt 存在才为 true，BLOCKED intent 与孤立 effect 不算启动', async () => {
    const deps1 = makeDeps({ rows: { log: [{ hop: 1, action: 'spawn:planner', observed: {}, detail: null }] } });
    expect((await collectGroundTruth(deps1, { taskId: TASK_ID, runId: RUN_ID })).generatorSpawned).toBe(false);

    const blocked = makeDeps({
      rows: {
        log: [
          { hop: 2, action: 'spawn:generator', observed: {}, detail: null },
          {
            hop: 3,
            action: 'result:dispatch',
            observed: {},
            detail: {
              dispatch_hop: 2,
              dispatch_action: 'spawn:generator',
              status: 'BLOCKED',
              failure_class: 'infrastructure_blocked',
              should_create_attempt: false,
            },
          },
        ],
      },
    });
    const blockedObserved = await collectGroundTruth(blocked, { taskId: TASK_ID, runId: RUN_ID });
    expect(blockedObserved.generatorSpawned).toBe(false);
    expect(derive({
      ...blockedObserved,
      contract: { approved: true, id: CONTRACT_ID },
      prdExists: true,
      counters: {
        hops: 3,
        fixRound: 0,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    })).toMatchObject({ action: 'spawn:generator', reason: 'contract_approved' });

    const orphanLaunchEffect = makeDeps({
      rows: {
        log: [
          { hop: 4, action: 'spawn:generator-fix', observed: {}, detail: null },
          {
            hop: 5,
            action: 'effect:attempt_launched',
            observed: {},
            detail: {
              dispatch_hop: 4,
              dispatch_action: 'spawn:generator-fix',
              attempt_id: '22222222-3333-4444-8555-666666666666',
            },
          },
        ],
      },
    });
    expect((await collectGroundTruth(orphanLaunchEffect, { taskId: TASK_ID, runId: RUN_ID })).generatorSpawned).toBe(false);

    const preLaunchAttempts = makeDeps({
      rows: {
        attempts: [
          {
            id: '44444444-5555-4666-8777-888888888888',
            run_id: RUN_ID,
            hop: 7,
            role: 'generator',
            status: 'queued',
            error_code: null,
            result: null,
            task_bundle: {},
          },
          {
            id: '55555555-6666-4777-8888-999999999999',
            run_id: RUN_ID,
            hop: 8,
            role: 'generator',
            status: 'failed',
            error_code: 'launch_failed',
            result: null,
            task_bundle: {},
          },
          {
            id: '66666666-7777-4888-8999-aaaaaaaaaaaa',
            run_id: RUN_ID,
            hop: 9,
            role: 'generator',
            status: 'failed',
            error_code: 'launch_start_failed',
            result: null,
            remote_job_id: 'prepared-but-never-started',
            task_bundle: {},
          },
        ],
        log: [
          { hop: 7, action: 'spawn:generator', observed: {}, detail: null },
          { hop: 8, action: 'spawn:generator', observed: {}, detail: null },
          { hop: 9, action: 'spawn:generator', observed: {}, detail: null },
        ],
      },
    });
    expect((await collectGroundTruth(preLaunchAttempts, { taskId: TASK_ID, runId: RUN_ID })).generatorSpawned).toBe(false);

    const matchedLaunchEffect = makeDeps({
      rows: {
        attempts: [{
          id: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
          run_id: RUN_ID,
          hop: 10,
          role: 'generator',
          status: 'starting',
          result: null,
          task_bundle: {},
        }],
        log: [
          { hop: 10, action: 'spawn:generator', observed: {}, detail: null },
          {
            hop: 11,
            action: 'effect:attempt_launched',
            observed: {},
            detail: {
              dispatch_hop: 10,
              dispatch_action: 'spawn:generator',
              attempt_id: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
            },
          },
        ],
      },
    });
    expect((await collectGroundTruth(matchedLaunchEffect, { taskId: TASK_ID, runId: RUN_ID })).generatorSpawned).toBe(true);

    const launchedWithoutEffect = makeDeps({
      rows: {
        attempts: [{
          id: '33333333-4444-4555-8666-777777777777',
          run_id: RUN_ID,
          hop: 6,
          role: 'generator',
          status: 'completed',
          result: { status: 'completed', summary: 'runtime callback proved launch' },
          task_bundle: {},
        }],
        log: [{ hop: 6, action: 'spawn:generator', observed: {}, detail: null }],
      },
    });
    const crashWindowObserved = await collectGroundTruth(
      launchedWithoutEffect,
      { taskId: TASK_ID, runId: RUN_ID },
    );
    expect(crashWindowObserved.generatorSpawned).toBe(true);
    expect(derive({
      ...crashWindowObserved,
      contract: { approved: true, id: CONTRACT_ID },
      prdExists: true,
      counters: {
        hops: 6,
        fixRound: 0,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    })).toMatchObject({ action: 'spawn:generator-fix', reason: 'no_pr' });
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
    const lsRemote = 'aaa\trefs/heads/cp-harness-propose-r2-11111111-raaaaaaaa-a1';
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
