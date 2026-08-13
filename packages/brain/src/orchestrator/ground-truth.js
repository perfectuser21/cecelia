/**
 * ground-truth.js —— 观测采集（IO 薄层）：每跳现查外部真相，组装 derive 消费的 observed。
 *
 * 语义 SSOT：docs/superpowers/specs/2026-07-04-orchestrator-skeleton-design.md
 *   §关键设计决策 2（在途观测）/ 3（verdict 锚定 SHA）/ 4（exit·auth 通道）。
 * deps 全注入（不测真外部）：
 *   pool       —— pg pool（../db.js 复用，run.js 组装）
 *   execCmd(cmd) → stdout string —— gh/git/docker 封装；非零退出应 throw 且 err.stdout 带输出
 *   fileExists(path) → boolean
 *   readFile(path) → string
 *   readAuthCircuit() → rows —— 可选注入；缺省查 account_usage_cache
 *                  （markAuthFailure 写入表，见 src/account-usage.js:194-202；D9 熔断经 DB 共享）
 *   listHostPids({runId}) → number[] —— 可选注入；主机执行（mac_web 类）pid 检查，T3 接线，缺省 []
 */
import { ACTION, LOG_ACTION } from './constants.js';
import {
  discoverPrFromGithub,
  parseBaseRepo,
} from './github-pr-discovery.js';
import { deriveCounters } from './counters.js';
import {
  HUMAN_REVIEW_CLASS,
  reviewClassForReason,
} from './human-review-class.js';
import { normalizeFailureSet } from './convergence-signatures.js';
import { getVerifiedRemotePlannerPrdArtifact } from './planner-artifact-receipt.js';
import { parseHarnessResult, parseTaskBundle } from './execution-contract.js';
import { resolveImplementationBaseline } from './implementation-baseline.js';
import { sanitizeDiagnostic } from './failure-persistence.js';
import { loadCaseFile } from './case-file-store.js';
import { CASE_FILE_FULL_TEXT_ROUNDS } from './constants.js';
import {
  compareContractArtifactPaths,
  contractArtifactManifestDigest,
  validateContractArtifacts,
} from './contract-artifacts.js';

/** gh check state → 三态 ci 映射 */
const CI_FAIL_STATES = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const CI_PASS_STATES = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const INFLIGHT_ATTEMPT_STATUSES = new Set(['starting', 'running']);
const TERMINAL_ATTEMPT_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
]);
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const GITHUB_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const ATTEMPT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SPAWN_ROLE_BY_ACTION = Object.freeze({
  [ACTION.SPAWN_PLANNER]: 'planner',
  [ACTION.SPAWN_PROPOSER]: 'proposer',
  [ACTION.SPAWN_REVIEWER]: 'reviewer',
  [ACTION.SPAWN_CANARY]: 'reporter',
  [ACTION.SPAWN_GENERATOR]: 'generator',
  [ACTION.SPAWN_GENERATOR_FIX]: 'generator',
  [ACTION.SPAWN_EVALUATOR]: 'evaluator',
  [ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR]: 'evaluator',
  [ACTION.SPAWN_JUDGE]: 'judge',
});
const GENERATOR_SPAWN_ACTIONS = new Set([
  ACTION.SPAWN_GENERATOR,
  ACTION.SPAWN_GENERATOR_FIX,
]);
const GENERATOR_RUNTIME_ERROR_CODES = new Set([
  'provider_exit',
  'provider_timeout',
]);

function mapCiStatus(checkRows, mergeStateStatus = null) {
  if (!Array.isArray(checkRows) || checkRows.length === 0) return 'pending'; // CI 尚未挂上 → 视为 pending
  const hasFail = checkRows.some((c) => CI_FAIL_STATES.has(c.state));
  if (hasFail) {
    // run 0955c884 案卷：非 required check（如 Deploy Preview Environment）连挂时，
    // 一刀切判 fail 会把 required 全绿、实际可合并的 PR 推进 generator-fix 死循环
    // （FIXED 同 sha → no_progress_same_sha 收死）。用同一次 gh 查询里的
    // mergeStateStatus 区分：非 BLOCKED（UNSTABLE/CLEAN/BEHIND/HAS_HOOKS…）=
    // 失败的都是非 required，不算 fail；BLOCKED 且仍有未落定 check = 可能是
    // required 还在跑，等全部落定再裁，避免把"非 required 已红 + required 在跑"
    // 误判成 fail 白吃 fix round。
    if (String(mergeStateStatus ?? '').toUpperCase() !== 'BLOCKED') {
      const settled = checkRows.filter((c) => !CI_FAIL_STATES.has(c.state));
      if (settled.length === 0 || settled.every((c) => CI_PASS_STATES.has(c.state))) {
        return 'pass';
      }
      return 'pending';
    }
    const hasPending = checkRows.some(
      (c) => !CI_FAIL_STATES.has(c.state) && !CI_PASS_STATES.has(c.state),
    );
    return hasPending ? 'pending' : 'fail';
  }
  if (checkRows.every((c) => CI_PASS_STATES.has(c.state))) return 'pass';
  return 'pending'; // PENDING/QUEUED/IN_PROGRESS/EXPECTED 等
}

/**
 * gh pr view statusCheckRollup 同时包含 CheckRun 与 StatusContext：
 * - CheckRun: status=COMPLETED/IN_PROGRESS, conclusion=SUCCESS/FAILURE/...
 * - StatusContext: state=SUCCESS/FAILURE/PENDING
 * 统一为 mapCiStatus 消费的 state，避免依赖 gh 2.46+ 才支持的
 * `gh pr checks --json`。
 */
function normalizeStatusCheckRollup(checkRows) {
  if (!Array.isArray(checkRows)) return [];
  return checkRows.map((check) => {
    const name = [check?.name, check?.context]
      .find((value) => typeof value === 'string' && value.trim().length > 0);
    return {
      state: String(check?.state || check?.conclusion || check?.status || '').toUpperCase(),
      name: typeof name === 'string' ? name.trim() : '',
    };
  });
}

function failedCheckNames(checkRows) {
  return normalizeFailureSet(
    checkRows
      .filter((check) => CI_FAIL_STATES.has(check.state))
      .map((check) => check.name)
      .filter(Boolean),
  );
}

/** execCmd 容忍可解析的非零退出，用 err.stdout 兜底 */
function execTolerant(execCmd, cmd) {
  try {
    return execCmd(cmd);
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.length > 0) return err.stdout;
    throw err;
  }
}

/** jsonb 列兼容：pg 返回对象，fake/旧数据可能是 string */
function asJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function hasMatchedGeneratorLaunchEffect(attempt, logRows) {
  return logRows.some((row) => {
    if (row.action !== LOG_ACTION.ATTEMPT_LAUNCHED) return false;
    const detail = asJson(row.detail) ?? {};
    if (
      detail.attempt_id !== attempt.id
      || Number(detail.dispatch_hop) !== Number(attempt.hop)
      || !GENERATOR_SPAWN_ACTIONS.has(detail.dispatch_action)
    ) {
      return false;
    }
    return logRows.some((intent) => (
      Number(intent.hop) === Number(detail.dispatch_hop)
      && intent.action === detail.dispatch_action
    ));
  });
}

function generatorAttemptHasRuntimeEvidence(attempt, logRows) {
  if (attempt.role !== 'generator') return false;
  if (hasMatchedGeneratorLaunchEffect(attempt, logRows)) return true;
  if (attempt.result != null) return true;
  if (attempt.provider_session_id != null || attempt.heartbeat_at != null) return true;
  if (attempt.status === 'running') return true;
  return GENERATOR_RUNTIME_ERROR_CODES.has(attempt.error_code);
}

function verifiedLocalCandidate(attemptRows, runId, taskId) {
  const ordered = [...attemptRows].sort((left, right) => Number(right.hop) - Number(left.hop));
  for (const attempt of ordered) {
    if (
      attempt.role !== 'generator'
      || attempt.run_id !== runId
      || !['completed', 'completed_with_concerns'].includes(attempt.status)
    ) continue;
    const bundle = asJson(attempt.task_bundle);
    const result = asJson(attempt.result);
    const workspace = bundle?.inputs?.workspace_spec;
    const artifact = Array.isArray(result?.artifacts)
      ? result.artifacts.find((value) => value?.type === 'git_candidate')
      : null;
    if (
      artifact?.verification_status !== 'verified'
      || artifact.source_attempt_id !== attempt.id
      || !ATTEMPT_ID_PATTERN.test(artifact.source_attempt_id ?? '')
      || bundle?.inputs?.task_id !== taskId
      || workspace?.repo !== artifact.repo
      || workspace?.branch !== artifact.branch
      || workspace?.base_sha !== artifact.base_sha
      || attempt.actual_machine_id !== artifact.machine_id
      || !GITHUB_REPO_PATTERN.test(artifact.repo ?? '')
      || !/^cp-[a-z0-9][a-z0-9._-]{0,126}$/.test(artifact.branch ?? '')
      || !GIT_SHA_PATTERN.test(artifact.base_sha ?? '')
      || !GIT_SHA_PATTERN.test(artifact.head_sha ?? '')
      || artifact.base_sha === artifact.head_sha
    ) continue;
    return Object.freeze({ ...artifact });
  }
  return null;
}

/** docker --format "{{json .}}" 输出（每行一个 JSON）→ 对象数组 */
function parseJsonLines(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** docker ps 的 Labels 字段（"a=b,c=d"）→ Map */
function parseLabels(labelsStr) {
  const map = {};
  for (const kv of String(labelsStr || '').split(',')) {
    const idx = kv.indexOf('=');
    if (idx > 0) map[kv.slice(0, idx)] = kv.slice(idx + 1);
  }
  return map;
}

/** 决策日志里最新（hop 最大）的指定 action 行 */
function latestRow(logRows, predicate) {
  let best = null;
  for (const r of logRows) {
    if (predicate(r) && (best == null || r.hop > best.hop)) best = r;
  }
  return best;
}

/**
 * lastAgentExit —— 严格按最新 spawn:* intent hop 作用域（derive.js 3d 契约）：
 * 只取本 run 最新 spawn intent hop 对应容器（label cecelia.hop=<hop>）的 ExitCode；
 * 同时保留该 intent 的 action，避免 evaluator/reviewer 等基础设施退出被误判为 generator 代码失败；
 * fix 后新 intent hop 无对应已退容器 → {code:null}，旧 exit 不残留、不会反复命中 3d 白吃 fix round。
 * auth_failed 同作用域：作用域容器存在时采信 callback 文件；否则回放同 hop/role
 * 的 terminal harness_attempt（Attempt lifecycle 是远端和本地 transport 的 canonical 状态）。
 */
function scopeLastAgentExit({
  execCmd,
  exitedContainers,
  logRows,
  callbackResult,
  attemptRows,
}) {
  const lastSpawn = latestRow(logRows, (r) => typeof r.action === 'string' && r.action.startsWith('spawn:'));
  if (!lastSpawn) return { code: null, auth_failed: false };

  const scoped = exitedContainers.find(
    (c) => parseLabels(c.Labels)['cecelia.hop'] === String(lastSpawn.hop),
  );
  if (scoped) {
    const stateJson = execTolerant(execCmd, `docker inspect ${scoped.ID} --format "{{json .State}}"`);
    const state = asJson(stateJson) ?? {};
    const authFailed =
      callbackResult != null &&
      (callbackResult.ci_fail_type === 'auth_failed' || callbackResult.auth_failed === true);
    return { code: state.ExitCode ?? null, auth_failed: authFailed, action: lastSpawn.action };
  }

  const expectedRole = SPAWN_ROLE_BY_ACTION[lastSpawn.action];
  const attempt = attemptRows.find((row) => (
    String(row.hop) === String(lastSpawn.hop)
    && row.role === expectedRole
    && TERMINAL_ATTEMPT_STATUSES.has(row.status)
  ));
  if (!attempt) return { code: null, auth_failed: false };

  return {
    code: ['failed', 'cancelled'].includes(attempt.status) ? 1 : 0,
    auth_failed: attempt.error_code === 'auth_failed',
    action: lastSpawn.action,
  };
}

/**
 * collectGroundTruth(deps, {taskId, runId, prdPath?, callbackResultPath?}) → observed
 * 返回 derive(observed) 所需全部字段（counters 除外——loop 用 deriveCounters(decisionLog) 补齐），
 * 外加原始 decisionLog / authCircuit / callbackResult 供 loop 与 T3 dispatcher 消费。
 */
export async function collectGroundTruth(deps, opts) {
  const { pool, execCmd, fileExists, readFile } = deps;
  const { taskId, runId, prdPath = 'sprint-prd.md', callbackResultPath = '.brain-result.json' } = opts;

  // ---- DB 五路 ----
  const runRes = await pool.query('SELECT * FROM initiative_runs WHERE id = $1', [runId]);
  const run = runRes.rows[0];
  if (!run) throw new Error(`collectGroundTruth: initiative_runs 无此 run 行: ${runId}`);

  let contractRow = null;
  let contractArtifacts = [];
  let contractArtifactError = null;
  if (run.contract_id) {
    const cRes = await pool.query('SELECT * FROM initiative_contracts WHERE id = $1', [run.contract_id]);
    contractRow = cRes.rows[0] ?? null;
    const artifactRes = await pool.query(
      `SELECT artifact.path,
              artifact.content,
              artifact.sha256,
              artifact.byte_length,
              artifact.source_revision,
              seal.artifact_count AS sealed_artifact_count,
              seal.manifest_sha256 AS sealed_manifest_sha256,
              seal.source_revision AS sealed_source_revision
         FROM initiative_contract_artifacts AS artifact
         LEFT JOIN initiative_contract_artifact_seals AS seal
           ON seal.contract_id = artifact.contract_id
        WHERE artifact.contract_id = $1
        ORDER BY path`,
      [run.contract_id],
    );
    const orderedArtifactRows = [...artifactRes.rows].sort((left, right) => (
      compareContractArtifactPaths(left.path, right.path)
    ));
    contractArtifacts = orderedArtifactRows.map(({
      sealed_artifact_count: _sealedArtifactCount,
      sealed_manifest_sha256: _sealedManifestSha256,
      sealed_source_revision: _sealedSourceRevision,
      ...artifact
    }) => artifact);
    if (contractRow?.status === 'approved' && contractArtifacts.length > 0) {
      try {
        validateContractArtifacts(contractArtifacts, { requireTests: true, requireCore: true });
        const manifestDigest = contractArtifactManifestDigest(contractArtifacts);
        const sealRowsMatch = orderedArtifactRows.every((row) => (
          Number(row.sealed_artifact_count) === contractArtifacts.length
          && row.sealed_manifest_sha256 === manifestDigest
          && row.sealed_source_revision === contractArtifacts[0].source_revision
        ));
        if (!sealRowsMatch) {
          throw new Error('FROZEN_CONTRACT_ARTIFACT_INVALID:seal_mismatch');
        }
      } catch (error) {
        contractArtifactError = String(error?.message ?? error).startsWith('FROZEN_CONTRACT_ARTIFACT')
          ? String(error.message)
          : 'FROZEN_CONTRACT_ARTIFACT_INVALID:seal_mismatch';
      }
    }
  }
  const contract = {
    approved: contractRow?.status === 'approved',
    id: run.contract_id ?? null,
    row: contractRow,
    artifacts: contractArtifacts,
    artifact_error: contractArtifactError,
  };

  const tRes = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = tRes.rows[0] ?? null;
  if (!task) throw new Error(`collectGroundTruth: tasks 无此 task 行: ${taskId}`);
  const taskPayload = asJson(task.payload) ?? {};
  let routingReceipt = null;
  if (taskPayload.routing_receipt_id != null) {
    const receiptRes = await pool.query(
      `SELECT receipt.*,
              EXISTS (
                SELECT 1 FROM work_routing_receipts successor
                 WHERE successor.supersedes_receipt_id = receipt.id
              ) AS superseded
         FROM work_routing_receipts receipt
        WHERE receipt.id = $1
          AND receipt.task_id = $2`,
      [taskPayload.routing_receipt_id, taskId],
    );
    routingReceipt = receiptRes.rows[0] ?? null;
  }

  const logRes = await pool.query(
    'SELECT hop, action, observed, derived_phase, gate_verdict, detail, created_at FROM orchestrator_decision_log WHERE run_id = $1 ORDER BY hop',
    [runId],
  );
  const decisionLog = logRes.rows;
  const historicalFailureRes = await pool.query(
    `SELECT fix.observed->'failure_set' AS failure_set
       FROM orchestrator_decision_log fix
       JOIN initiative_runs prior_run ON prior_run.id = fix.run_id
      WHERE prior_run.current_task_id = $1
        AND prior_run.id <> $2
        AND fix.action = 'spawn:generator-fix'
        AND fix.observed->>'failure_class' = 'product_failure'
        AND jsonb_typeof(fix.observed->'failure_set') = 'array'
      ORDER BY prior_run.created_at, fix.hop`,
    [taskId, runId],
  );
  const historicalFailureSets = historicalFailureRes.rows
    .map((row) => normalizeFailureSet(asJson(row.failure_set)))
    .filter(Boolean)
    .filter((failureSet, index, all) => (
      all.findIndex((candidate) => (
        JSON.stringify(candidate) === JSON.stringify(failureSet)
      )) === index
    ));

  // evaluator 的完整机械证据存于 attempt.result；decision_log 只承载 SHA 锚定 verdict。
  // 旧 controller 的 .brain-result.json 仍在文件通道读取，供兼容路径兜底。
  const evaluatorAttemptRes = await pool.query(
    `SELECT result
       FROM harness_attempts
      WHERE run_id = $1
        AND role = 'evaluator'
        AND status IN ('completed', 'completed_with_concerns')
        AND result IS NOT NULL
      ORDER BY completed_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [runId],
  );
  const evaluateResult = asJson(evaluatorAttemptRes.rows[0]?.result);
  const attemptRes = await pool.query(
    `SELECT id, run_id, hop, phase, role, provider, account_id, machine_id,
            requested_machine_id, actual_machine_id, execution_transport,
            remote_job_id, machine_attestation_status, lease_generation,
            lease_owner, lease_expires_at, heartbeat_at,
            status, error_code, error_message, task_bundle, result,
            created_at, updated_at, completed_at
       FROM harness_attempts
      WHERE run_id = $1
      ORDER BY hop DESC, created_at DESC, id DESC`,
    [runId],
  );
  const attemptRows = attemptRes.rows;

  // 案卷式 GAN（issue ce42f68f，design doc §数据流2）：dispatcher.buildInputs
  // 对 proposer/reviewer 注入的 case_file 由这里现查现给——同一份全量历轮行，
  // 只有 rubric 历史/blocker 台账是全量的；feedback_md 全文按 P2-3 膨胀闸1
  // 只保留最近 CASE_FILE_FULL_TEXT_ROUNDS 轮（loadCaseFile 内部 SQL 截断）。
  const caseFile = await loadCaseFile(pool, runId, {
    fullTextRounds: CASE_FILE_FULL_TEXT_ROUNDS,
  });

  // 熔断状态（P0-3 通道②）：markAuthFailure 写 account_usage_cache（src/account-usage.js:194-202）。
  // derive 不读——熔断换号分路归 T3 dispatcher；这里只透传观测。
  let authCircuit;
  if (deps.readAuthCircuit) {
    authCircuit = await deps.readAuthCircuit();
  } else {
    const acRes = await pool.query(
      'SELECT account_id, is_auth_failed, auth_fail_resets_at, auth_fail_count FROM account_usage_cache WHERE is_auth_failed = true',
    );
    authCircuit = acRes.rows;
  }

  // ---- 文件通道 ----
  // 本地 PRD 完成是单调里程碑，但历史 boolean 本身不是证据。只回放由
  // collectGroundTruth 生成、且绑定相同逻辑路径的文件观测 provenance；
  // 修复前无 provenance 的 snapshot 必须 fail closed。
  const replayedFileEvidence = decisionLog
    .map((row) => asJson(row.observed))
    .filter((observed) => (
      observed?.prdExists === true
      && observed.prdEvidence?.source === 'brain_file_observation'
      && observed.prdEvidence.path === prdPath
    ))
    .at(-1)?.prdEvidence ?? null;
  const plannerPrdArtifact = getVerifiedRemotePlannerPrdArtifact({
    runId,
    task,
    logRows: decisionLog,
    attemptRows,
  });
  const localPrdExists = Boolean(fileExists(prdPath));
  const prdExists = localPrdExists
    || replayedFileEvidence != null
    || plannerPrdArtifact != null;
  const prdEvidence = localPrdExists
    ? Object.freeze({ source: 'brain_file_observation', path: prdPath })
    : (
        plannerPrdArtifact == null
          ? replayedFileEvidence
          : Object.freeze({
              source: 'server_verified_git_artifact',
              artifact: plannerPrdArtifact,
            })
      );
  let callbackResult = null;
  if (fileExists(callbackResultPath)) {
    try {
      callbackResult = JSON.parse(readFile(callbackResultPath));
    } catch {
      callbackResult = null; // 半写/损坏文件 → 视为无 callback（下一跳外部真相仍在）
    }
  }

  // ---- PR 状态（gh 封装）----
  let pr = null;
  let implementationBaseline = null;
  let implementationBaselineError = null;
  try {
    implementationBaseline = resolveImplementationBaseline({
      taskPayload,
      attemptRows,
      runId,
      taskId,
    });
  } catch (error) {
    if (error?.message !== 'implementation_baseline_unrecoverable') throw error;
    implementationBaselineError = error.message;
  }
  const declaredPrUrl = taskPayload.pr_url;
  const verifiedDeclaredPrUrl = (
    typeof declaredPrUrl === 'string'
    && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(declaredPrUrl)
  ) ? declaredPrUrl : null;
  let prUrl = run.pr_url ?? verifiedDeclaredPrUrl;
  if (!prUrl) {
    try {
      prUrl = discoverPrFromGithub(
        { ...task, payload: taskPayload },
        String(taskId).slice(0, 8),
        execCmd,
      )?.url ?? null;
    } catch {
      prUrl = null;
    }
  }
  if (prUrl) {
    const view = asJson(execTolerant(
      execCmd,
      `gh pr view ${prUrl} --json number,state,mergeStateStatus,headRefName,headRefOid,statusCheckRollup`,
    )) ?? {};
    const checks = normalizeStatusCheckRollup(view.statusCheckRollup);
    pr = {
      number: view.number ?? null,
      url: prUrl,
      state: view.state ?? null,
      mergeStateStatus: view.mergeStateStatus ?? null,
      merged: view.state === 'MERGED',
      head_ref: view.headRefName ?? null,
      head_sha: view.headRefOid ?? null,
      ci: mapCiStatus(checks, view.mergeStateStatus),
      failed_checks: failedCheckNames(checks),
    };
  }

  // A recovery run may legitimately resume at Evaluator after an earlier trusted
  // run generated the PR.  Do not trust the mutable task payload for that jump:
  // require a completed Generator Attempt and an allowed Evaluator intent from a
  // trusted prior Kernel run for the same task, then bind that server observation
  // to the exact PR URL and GitHub head currently observed above.
  let verifiedExistingPrOrigin = null;
  const recoveryBaseSha = routingReceipt?.evidence?.base_sha;
  if (
    run.created_source === 'explicit_recovery'
    && pr != null
    && run.predecessor_run_id
    && routingReceipt?.id
    && run.contract_id
    && GIT_SHA_PATTERN.test(recoveryBaseSha ?? '')
  ) {
    const originRes = await pool.query(
      `SELECT prior_run.id AS validation_origin_run_id,
              evaluator_intent.observed
         FROM initiative_runs prior_run
         JOIN initiative_contracts approved_contract
           ON approved_contract.id = prior_run.contract_id
          AND approved_contract.status = 'approved'
          AND approved_contract.approved_sha ~ '^[a-f0-9]{40}$'
         JOIN orchestrator_decision_log evaluator_intent
           ON evaluator_intent.run_id = prior_run.id
          AND evaluator_intent.action = 'spawn:evaluator'
          AND evaluator_intent.gate_verdict = 'allow'
        WHERE prior_run.current_task_id = $1
          AND prior_run.id <> $2
          AND prior_run.id = $3
          AND evaluator_intent.observed->'routingReceipt'->>'id' = $4
          AND prior_run.contract_id = $5
          AND evaluator_intent.observed->'contract'->>'id' = $5
          AND evaluator_intent.observed->'contract'->'row'->>'approved_sha'
                = approved_contract.approved_sha
          AND evaluator_intent.observed->'implementationBaseline'->>'base_sha' = $6
          AND prior_run.orchestrator_version = 'v2'
          AND prior_run.record_trust_status IN ('trusted', 'reconstructed')
          AND EXISTS (
            SELECT 1
              FROM harness_attempts generator_attempt
             WHERE generator_attempt.run_id = prior_run.id
               AND generator_attempt.role = 'generator'
               AND generator_attempt.status IN ('completed', 'completed_with_concerns')
               AND generator_attempt.result IS NOT NULL
          )
        ORDER BY evaluator_intent.created_at DESC, evaluator_intent.hop DESC`,
      [
        taskId,
        runId,
        run.predecessor_run_id,
        routingReceipt.id,
        run.contract_id,
        recoveryBaseSha,
      ],
    );
    const matchingOrigin = originRes.rows.find((row) => {
      const observedPr = asJson(row.observed)?.pr;
      return observedPr?.url === pr.url
        && GIT_SHA_PATTERN.test(observedPr?.head_sha ?? '')
        && observedPr.head_sha === pr.head_sha;
    });
    if (matchingOrigin) {
      verifiedExistingPrOrigin = Object.freeze({
        source: 'trusted_prior_kernel_run',
        run_id: matchingOrigin.validation_origin_run_id,
        pr_url: pr.url,
        pr_head_sha: pr.head_sha,
      });
    }
  }

  // ---- propose 分支 rN（外部真相，ganRound 唯一权威）----
  // 新分支同时绑定 task + run，防止同一 task 重跑时碰撞或消费旧 run 的合同。
  // 对部署前已在途的 legacy 分支，只在当前 run 的严格 TaskBundle 明确引用时兼容。
  const shortTask = String(taskId).slice(0, 8);
  const shortRun = String(runId).slice(0, 8);
  const legacyBranchesForRun = new Set();
  for (const attempt of attemptRows) {
    if (attempt.role !== 'proposer') continue;
    try {
      const bundle = parseTaskBundle(asJson(attempt.task_bundle));
      const branch = bundle.inputs?.propose_branch;
      if (
        bundle.run_id === runId
        && bundle.attempt_id === attempt.id
        && bundle.role === 'proposer'
        && bundle.inputs?.task_id === taskId
        && typeof branch === 'string'
        && new RegExp(`^cp-harness-propose-r\\d+-${shortTask}-a\\d+$`).test(branch)
      ) {
        legacyBranchesForRun.add(branch);
      }
    } catch {
      // Invalid historical TaskBundles cannot authorize a legacy branch.
    }
  }
  const taskRepo = parseBaseRepo(taskPayload.base_repo);
  const proposalRemote = GITHUB_REPO_PATTERN.test(taskRepo ?? '')
    ? `"https://github.com/${taskRepo}.git"`
    : 'origin';
  const lsRemote = execTolerant(
    execCmd,
    `git ls-remote --heads ${proposalRemote} "cp-harness-propose-r*-${shortTask}-r${shortRun}-*" "cp-harness-propose-r*-${shortTask}-a*"`,
  );
  let proposeBranchRn = 0;
  let proposeBranchAttempt = -1;
  let proposeBranch = null;
  let proposeBranchSha = null;
  const rnPattern = /^(\S+)\s+refs\/heads\/(cp-harness-propose-r(\d+)-([a-zA-Z0-9]{8})(?:-r([a-zA-Z0-9]{8}))?-a(\d+))$/gm;
  for (const m of String(lsRemote).matchAll(rnPattern)) {
    if (m[4] !== shortTask) continue;
    if (m[5] ? m[5] !== shortRun : !legacyBranchesForRun.has(m[2])) continue;
    const round = Number(m[3]);
    const attempt = Number(m[6]);
    if (round > proposeBranchRn || (round === proposeBranchRn && attempt > proposeBranchAttempt)) {
      proposeBranchRn = round;
      proposeBranchAttempt = attempt;
      proposeBranch = m[2];
      proposeBranchSha = m[1];
    }
  }

  // ---- docker 在途/已退（P0-1 / P0-3；dispatcher spawn 时必打 label：run_id+hop+role）----
  const psOut = execTolerant(execCmd, `docker ps --filter "label=cecelia.run_id=${runId}" --format "{{json .}}"`);
  const containers = parseJsonLines(psOut);
  const hostPids = deps.listHostPids ? await deps.listHostPids({ runId }) : []; // 主机执行 pid 检查，T3 接线
  const psExitedOut = execTolerant(
    execCmd,
    `docker ps -a --filter "label=cecelia.run_id=${runId}" --filter "status=exited" --format "{{json .}}"`,
  );
  const exitedContainers = parseJsonLines(psExitedOut);
  const lastAgentExit = scopeLastAgentExit({
    execCmd,
    exitedContainers,
    logRows: decisionLog,
    callbackResult,
    attemptRows,
  });

  // ---- 决策日志推导字段（verdict 权威 = 决策日志行，P0-2；initiative_runs 的 verdict 列只是展示缓存）----
  // Neither an intent nor a bare Attempt row proves launch: both are persisted
  // before the launcher side effect. Require a strictly bound launch effect or
  // durable runtime evidence written by the callback/provider lifecycle. This
  // keeps preflight/launch failures on the initial Generator route while still
  // surviving the crash window between a real launch and its audit effect.
  const generatorSpawned = attemptRows.some((row) => (
    generatorAttemptHasRuntimeEvidence(row, decisionLog)
  ));
  const candidate = verifiedLocalCandidate(attemptRows, runId, taskId);
  const evalRow = latestRow(decisionLog, (r) => r.action === LOG_ACTION.VERDICT_EVALUATE);
  const judgeRow = latestRow(decisionLog, (r) => r.action === LOG_ACTION.VERDICT_JUDGE);
  const evaluateVerdict = evalRow ? asJson(evalRow.detail) : null;
  const judgeVerdict = judgeRow ? asJson(judgeRow.detail) : null;

  // GAN 本轮 verdict：只认 detail.rn === 当前分支 rN 的 reviewer verdict（旧轮不算）。
  // 纪元规则(r43 实证):最新 reopen_gan_contract 行之前的 reviewer verdict 一律作废——
  // 否则重开前的 APPROVED(rn/SHA 仍匹配,proposer 未推新轮)会让崩溃窗口补批分支
  // 把刚降级的合同原样批回去,重开被静默撤销。
  const latestReopenHop = decisionLog.reduce(
    (max, r) => (r.action === ACTION.REOPEN_GAN_CONTRACT && Number(r.hop) > max ? Number(r.hop) : max),
    -1,
  );
  const reviewerRow = latestRow(decisionLog, (r) => (
    r.action === LOG_ACTION.VERDICT_REVIEWER && Number(r.hop) > latestReopenHop
  ));
  const reviewerDetail = reviewerRow ? asJson(reviewerRow.detail) : null;
  const reviewerShaMatches = reviewerDetail?.contract_sha == null
    || reviewerDetail.contract_sha === proposeBranchSha;
  const ganLatestRoundVerdict =
    reviewerDetail && reviewerDetail.rn === proposeBranchRn && reviewerShaMatches
      ? reviewerDetail.verdict ?? null
      : null;
  // Legacy verdicts created before SHA anchoring are accepted only for the in-flight
  // rollout and are bound to the current tip at materialization time.
  const ganLatestRoundContractSha = ganLatestRoundVerdict
    ? reviewerDetail.contract_sha ?? proposeBranchSha
    : null;
  let ganLatestRoundReviewFeedback = (
    ganLatestRoundVerdict === 'REVISION'
    && reviewerDetail?.source === 'validation_identity_policy'
    && typeof reviewerDetail.summary === 'string'
    && typeof reviewerDetail.reason === 'string'
  )
    ? Object.freeze({
        contract_round: proposeBranchRn,
        contract_sha: proposeBranchSha,
        summary: sanitizeDiagnostic(reviewerDetail.summary),
        reason: sanitizeDiagnostic(reviewerDetail.reason),
        source: 'validation_identity_policy',
      })
    : null;
  if (
    ganLatestRoundReviewFeedback == null
    && Number.isSafeInteger(proposeBranchRn)
    && proposeBranchRn > 0
    && GIT_SHA_PATTERN.test(proposeBranchSha ?? '')
  ) {
    for (const attempt of attemptRows) {
      if (
        attempt.role !== 'reviewer'
        || !['completed', 'completed_with_concerns'].includes(attempt.status)
      ) {
        continue;
      }
      try {
        const bundle = parseTaskBundle(asJson(attempt.task_bundle));
        const result = parseHarnessResult(
          asJson(attempt.result),
          'reviewer',
          'harness-result/reviewer-v1',
        );
        const inputs = bundle.inputs;
        const summary = result.summary.trim();
        const reason = result.decision?.reason?.trim() ?? '';
        if (
          bundle.run_id !== runId
          || bundle.attempt_id !== attempt.id
          || bundle.role !== 'reviewer'
          || inputs.task_id !== taskId
          || !Number.isSafeInteger(inputs.contract_round)
          || inputs.contract_round <= 0
          || inputs.contract_round !== proposeBranchRn
          || !GIT_SHA_PATTERN.test(inputs.contract_sha ?? '')
          || inputs.contract_sha !== proposeBranchSha
          || result.attempt_id !== attempt.id
          || result.status !== attempt.status
          || summary.length === 0
          || reason.length === 0
        ) {
          continue;
        }
        ganLatestRoundReviewFeedback = Object.freeze({
          attempt_id: attempt.id,
          contract_round: proposeBranchRn,
          contract_sha: proposeBranchSha,
          summary: sanitizeDiagnostic(summary),
          reason: sanitizeDiagnostic(reason),
        });
        break;
      } catch {
        // Persisted legacy/corrupt envelopes are not authoritative feedback.
      }
    }
  }

  // review gate：required 来自 tasks.payload（harness-initiative 透传 review_required）；
  // approved 权威 = 决策日志 verdict:human_review 行，锚定当前 head_sha（stale 批准不放行）
  const payload = asJson(task.payload) ?? {};
  const effectiveProfile = routingReceipt
    ? (routingReceipt.execution_profile_override ?? routingReceipt.default_execution_profile)
    : null;
  const reviewRequired = routingReceipt
    ? ['new-capability-v1', 'capability-change-v1'].includes(effectiveProfile)
    : payload.review_required === true;
  const mergeApproval = latestRow(decisionLog, (row) => {
    if (row.action !== LOG_ACTION.VERDICT_HUMAN_REVIEW || !pr) return false;
    const detail = asJson(row.detail);
    if (
      detail?.approved !== true
      || detail.review_class !== HUMAN_REVIEW_CLASS.MERGE_GATE
      || detail.pr_head_sha !== pr.head_sha
    ) {
      return false;
    }
    const request = decisionLog.find((candidate) => (
      candidate.action === LOG_ACTION.HUMAN_REVIEW_REQUESTED
      && String(candidate.hop) === String(detail.review_request_hop)
    ));
    if (!request) return false;
    const requestObserved = asJson(request.observed);
    const requestDetail = asJson(request.detail);
    return requestObserved?.pr?.head_sha === pr.head_sha
      && reviewClassForReason(requestDetail?.review_reason)
        === HUMAN_REVIEW_CLASS.MERGE_GATE;
  });
  const reviewApproved = Boolean(mergeApproval);

  // Sprint 07231527 Blocking 4：noProgress 从 decision log 推导（INV-K4）
  // deriveCounters 的 noProgress 字段：spawn:generator-fix trigger_sha === callback pr_head_sha
  const countersForNp = deriveCounters(decisionLog, { proposeBranchMaxRn: proposeBranchRn });
  const noProgress = countersForNp.noProgress ?? false;
  const noProgressReason = countersForNp.noProgressReason ?? null;

  return {
    run,
    task,
    routingReceipt,
    // harness gear 档位（sprint 08091640）：把持久化的 initiative_runs.gear 每跳注入 observed，
    // 供 derive 状态机分叉。缺省（列 NULL / 存量行）→ 'default'，行为与现行逐字节等价（零回归）。
    // gear 是 observed 的可选字段，不进 derive 的 REQUIRED_FIELDS（否则存量用例全炸）。
    gear: run.gear ?? 'default',
    // change_kind 执行 Profile（sprint 08131104）：镜像 gear 注入路径，把持久化的
    // initiative_runs.change_kind 每跳注入 observed，供 derive 按四档分派相位链。
    // 缺省（列不存在 / 存量 run / NULL）→ null，derive 不分叉（零回归）。change_kind 与
    // gear 独立注入、独立计算，禁互推导（决策 29ae54ae）。
    change_kind: routingReceipt?.change_kind ?? null,
    prdExists,
    prdEvidence,
    plannerPrdArtifact,
    implementationBaseline,
    implementationBaselineError,
    contract,
    pr,
    candidate,
    verifiedExistingPrOrigin,
    inflight: {
      containers,
      host_pids: hostPids,
      attempts: attemptRows.filter((row) => INFLIGHT_ATTEMPT_STATUSES.has(row.status)),
    },
    lastAgentExit,
    proposeBranchRn,
    proposeBranch,
    proposeBranchSha,
    ganLatestRoundVerdict,
    ganLatestRoundContractSha,
    ganLatestRoundReviewFeedback,
    generatorSpawned,
    evaluateVerdict,
    evaluateResult,
    judgeVerdict,
    reviewRequired,
    reviewApproved,
    decisionLog,
    historicalFailureSets,
    authCircuit,
    callbackResult,
    noProgress,
    noProgressReason,
    caseFile,
  };
}
