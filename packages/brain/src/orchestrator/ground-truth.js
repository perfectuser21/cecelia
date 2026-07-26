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
import { discoverPrFromGithub } from './github-pr-discovery.js';
import { deriveCounters } from './counters.js';
import {
  HUMAN_REVIEW_CLASS,
  reviewClassForReason,
} from './human-review-class.js';
import { normalizeFailureSet } from './convergence-signatures.js';

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

function mapCiStatus(checkRows) {
  if (!Array.isArray(checkRows) || checkRows.length === 0) return 'pending'; // CI 尚未挂上 → 视为 pending
  if (checkRows.some((c) => CI_FAIL_STATES.has(c.state))) return 'fail';
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
  if (run.contract_id) {
    const cRes = await pool.query('SELECT * FROM initiative_contracts WHERE id = $1', [run.contract_id]);
    contractRow = cRes.rows[0] ?? null;
  }
  const contract = { approved: contractRow?.status === 'approved', id: run.contract_id ?? null, row: contractRow };

  const tRes = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = tRes.rows[0] ?? null;
  if (!task) throw new Error(`collectGroundTruth: tasks 无此 task 行: ${taskId}`);

  const logRes = await pool.query(
    'SELECT hop, action, observed, derived_phase, gate_verdict, detail, created_at FROM orchestrator_decision_log WHERE run_id = $1 ORDER BY hop',
    [runId],
  );
  const decisionLog = logRes.rows;

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
            status, error_code, error_message, created_at, updated_at, completed_at
       FROM harness_attempts
      WHERE run_id = $1
      ORDER BY hop DESC, created_at DESC, id DESC`,
    [runId],
  );
  const attemptRows = attemptRes.rows;

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
  // PRD 完成是单调里程碑：一旦服务端曾在 append-only 决策日志中观测为 true，
  // Brain 重启/容器切换后即使看不到宿主机 task worktree，也不得倒退回 planner。
  // 复用既有回放源，不新增第二本状态账。
  const prdObservedInLog = decisionLog.some(
    (row) => asJson(row.observed)?.prdExists === true,
  );
  const prdExists = Boolean(fileExists(prdPath)) || prdObservedInLog;
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
  let prUrl = run.pr_url;
  if (!prUrl) {
    try {
      prUrl = discoverPrFromGithub(
        { ...task, payload: asJson(task.payload) ?? {} },
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
      `gh pr view ${prUrl} --json state,mergeStateStatus,headRefName,headRefOid,statusCheckRollup`,
    )) ?? {};
    const checks = normalizeStatusCheckRollup(view.statusCheckRollup);
    pr = {
      url: prUrl,
      state: view.state ?? null,
      mergeStateStatus: view.mergeStateStatus ?? null,
      merged: view.state === 'MERGED',
      head_ref: view.headRefName ?? null,
      head_sha: view.headRefOid ?? null,
      ci: mapCiStatus(checks),
      failed_checks: failedCheckNames(checks),
    };
  }

  // ---- propose 分支 rN（外部真相，ganRound 唯一权威）----
  // 必须按 task 作用域过滤：分支命名 cp-harness-propose-r{N}-{taskId前8}-a{attempt}
  //（harness-gan.graph.js proposeBranchFor）。不带 taskId 过滤会吃全仓所有 task 的 rN，
  // 并发 initiative 时 ganRound 被污染。
  const shortTask = String(taskId).slice(0, 8);
  const lsRemote = execTolerant(
    execCmd,
    `git ls-remote --heads origin "cp-harness-propose-r*-${shortTask}-*"`,
  );
  let proposeBranchRn = 0;
  let proposeBranchAttempt = -1;
  let proposeBranch = null;
  let proposeBranchSha = null;
  const rnPattern = /^(\S+)\s+refs\/heads\/(cp-harness-propose-r(\d+)-([a-zA-Z0-9]{8})-a(\d+))$/gm;
  for (const m of String(lsRemote).matchAll(rnPattern)) {
    if (m[4] !== shortTask) continue;
    const round = Number(m[3]);
    const attempt = Number(m[5]);
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
  const generatorSpawned = decisionLog.some(
    (r) => r.action === ACTION.SPAWN_GENERATOR || r.action === ACTION.SPAWN_GENERATOR_FIX,
  );
  const evalRow = latestRow(decisionLog, (r) => r.action === LOG_ACTION.VERDICT_EVALUATE);
  const judgeRow = latestRow(decisionLog, (r) => r.action === LOG_ACTION.VERDICT_JUDGE);
  const evaluateVerdict = evalRow ? asJson(evalRow.detail) : null;
  const judgeVerdict = judgeRow ? asJson(judgeRow.detail) : null;

  // GAN 本轮 verdict：只认 detail.rn === 当前分支 rN 的 reviewer verdict（旧轮不算）
  const reviewerRow = latestRow(decisionLog, (r) => r.action === LOG_ACTION.VERDICT_REVIEWER);
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

  // review gate：required 来自 tasks.payload（harness-initiative 透传 review_required）；
  // approved 权威 = 决策日志 verdict:human_review 行，锚定当前 head_sha（stale 批准不放行）
  const payload = asJson(task.payload) ?? {};
  const reviewRequired = payload.review_required === true;
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
    prdExists,
    contract,
    pr,
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
    generatorSpawned,
    evaluateVerdict,
    evaluateResult,
    judgeVerdict,
    reviewRequired,
    reviewApproved,
    decisionLog,
    authCircuit,
    callbackResult,
    noProgress,
    noProgressReason,
  };
}
