/**
 * loop.js —— reconcile loop 编排（DI 可测）。
 *
 * 每跳：collectGroundTruth → deriveCounters → derive（含 gates caps）→
 *   控制 action 自消费（exit / mark_failed / persist_contract_approval）
 *   | wait:* 只心跳+sleep（不派 dispatcher、不 append hop，避免日志灌水）
 *   | 派发 action：nextHop → appendHop（intent-before-dispatch）→ dispatch → 四态处理 → 心跳。
 *
 * 四态最小语义（spec，T3 细化分路）：DONE/DONE_WITH_CONCERNS 记 detail 继续；
 * NEEDS_CONTEXT/语义 BLOCKED 记 detail 不推进，连续 2 次同态 → run failed；
 * infrastructure_blocked 记证据后退避复探，由 run deadline 收敛。
 * （"绝不同模型无变化重试"铁律骨架版。）
 * SingletonConflictError → 立即退出（并发实例信号，交 watchdog）。
 *
 * deps：{pool, dispatch(action, ctx), sleep?, now?, host?, pid?, log?,
 *        collectGroundTruth?, appendHop?, nextHop?, writeHeartbeat?}（后四者可注入 fake）
 */
import { derive } from './derive.js';
import { parseBaseRepo } from './github-pr-discovery.js';
import { COMMANDER_ACTIONS } from './commander-contract.js';
import { parseCommanderProfile } from './commander-profile.js';
import { isPassVerdict, mergeGate } from './gates.js';
import { deriveCounters } from './counters.js';
import { collectGroundTruth as defaultCollect } from './ground-truth.js';
import { appendHop as defaultAppendHop, nextHop as defaultNextHop, SingletonConflictError } from './decision-log.js';
import { writeHeartbeat as defaultWriteHeartbeat } from './heartbeat.js';
import { materializeApprovedContract } from './contract-store.js';
import { collectApprovedContractArtifacts } from './contract-artifacts.js';
import { insertCaseFileRow } from './case-file-store.js';
import { evaluateValidationIdentityPolicy } from './validation-identity-policy.js';
import {
  resolveValidationClock,
  VERIFIED_EXISTING_PR_ORIGIN,
} from './validation-clock.js';
import {
  ACTION,
  LOG_ACTION,
  BLOCKED_SAME_STATE_CAP,
  POLL_INTERVAL_MS,
  BUDGET_CAP_USD,
  MAX_HOPS,
  WAIT_ACTIONS,
} from './constants.js';
import {
  asStructuredJson,
  failureSetKey,
  generatorCrashSignature,
  normalizeFailureSet,
  normalizeFailureSignature,
} from './convergence-signatures.js';
import { finalizeKernelRun, persistKernelRunPhase } from './kernel-run-store.js';
import { oldestExpiredAttempt } from './expired-attempt-reconciler.js';
import { sanitizeDiagnostic } from './failure-persistence.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// r17 实证修复：run.phase 前进持久化只对这些活跃相位生效，且仅当最终决策不是
// WAIT_ACTIONS 里的动作才写（wait:* 只是复查在途状态，不代表相位真的前进了）。
// 终态永远只归 finalizeKernelRun 独有，这里绝不写 done/failed。导出供集成测试
// 参数化遍历（I-4 审查修正：白名单必须和 DB CHECK 约束联动验证，防止漂移后
// 静默失败）。
export const PROGRESSING_KERNEL_PHASES = new Set(['planning', 'gan', 'generate', 'evaluate', 'judge']);

/** runId 缺省解析：task 当前挂着的最新 v2 run（双轨期 D7：过滤 orchestrator_version，防误伤 v1/LangGraph run） */
async function resolveRunId(pool, taskId) {
  const { rows } = await pool.query(
    `SELECT id FROM initiative_runs
      WHERE current_task_id = $1 AND orchestrator_version = 'v2'
      ORDER BY created_at DESC LIMIT 1`,
    [taskId],
  );
  if (!rows[0]) throw new Error(`runLoop: task ${taskId} 无对应 v2 initiative_runs 行（需先建 run）`);
  return rows[0].id;
}

function asPayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const DETERMINISTIC_IMPACT_ERROR_CODES = new Set([
  'impact_contract_schema_invalid',
  'impact_assertion_authority_invalid',
  'mapper_evidence_invalid',
  'mapper_evidence_missing',
  'task_not_found',
]);
function allowsVerifiedExistingPrEvaluatorOrigin(observed, action) {
  if (action !== ACTION.SPAWN_EVALUATOR || observed.gear !== 'hotfix') return false;
  if (observed.generatorSpawned === true) return false;
  if ((observed.decisionLog ?? []).some((row) => (
    ['spawn:generator', 'spawn:generator-fix'].includes(row?.action)
    || asPayload(row?.detail).validation_origin === VERIFIED_EXISTING_PR_ORIGIN
  ))) return false;

  const payload = asPayload(observed.task?.payload);
  const declaredUrl = payload.pr_url;
  const declaredHeadSha = payload.pr_head_sha;
  return typeof declaredUrl === 'string'
    && declaredUrl.length > 0
    && declaredUrl === observed.pr?.url
    && GIT_SHA_PATTERN.test(declaredHeadSha ?? '')
    && declaredHeadSha === observed.pr?.head_sha;
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedText(value) {
  return String(value ?? '').slice(0, 4_000);
}

function commanderRetryCount(decisionLog) {
  return decisionLog.filter((row) => (
    row.action === 'commander.directive_accepted'
    && asPayload(row.detail)?.directive?.action === 'retry_attempt'
  )).length;
}

function frozenContractArtifacts(deps, observed, groundTruthPaths, approvedSha) {
  const payload = asPayload(observed.task?.payload);
  const sprintDir = String(payload.sprint_dir ?? '').replace(/\/$/, '');
  const prdPath = groundTruthPaths.prdPath
    ?? (sprintDir ? `${sprintDir}/sprint-prd.md` : 'sprint-prd.md');
  const contractPath = sprintDir ? `${sprintDir}/contract-draft.md` : 'contract-draft.md';
  const dodPath = sprintDir ? `${sprintDir}/contract-dod.md` : 'contract-dod.md';
  const paths = [prdPath, contractPath, dodPath];
  if (typeof deps.readGitFile !== 'function') return { missing: paths };
  // 跨 repo initiative（如 base_repo=zenithjoy-workspace）的批准 SHA 不在本仓 origin，
  // 必须从 payload.base_repo 解析出的权威仓库按精确 SHA 读取（生产实弹 run 4925488b）。
  const requestedRepo = payload.base_repo;
  const repo = parseBaseRepo(requestedRepo);
  if (requestedRepo != null && requestedRepo !== '' && repo == null) {
    return { missing: paths };
  }
  if (typeof deps.listGitFiles !== 'function') {
    return { missing: [`${sprintDir}/tests/`] };
  }
  try {
    return {
      missing: [],
      ...collectApprovedContractArtifacts({
        sourceRevision: approvedSha,
        sprintDir,
        prdPath,
        repo,
        readGitFile: deps.readGitFile,
        listGitFiles: deps.listGitFiles,
      }),
    };
  } catch (error) {
    return { missing: [boundedText(error.message)] };
  }
}

async function resolveGroundTruthPaths(pool, taskId) {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const payload = asPayload(rows[0]?.payload);
  const sprintDir = String(payload.sprint_dir ?? '').replace(/\/$/, '');
  return {
    prdPath: sprintDir ? `${sprintDir}/sprint-prd.md` : 'sprint-prd.md',
    callbackResultPath: payload.callback_result_path ?? '.brain-result.json',
  };
}

/**
 * appendHop 的 observed 快照：摘要而非全量（jsonb 列，回放/streak 推导用）。
 * counters 的 streak 契约（spec 决策 5）：proposer/reviewer intent 行必须带
 * "上一跳产物出现与否"——propose_branch_advanced / verdict_parsed，从上一同类 intent 对比现查真相得出。
 */
function structuredEvidenceVerdict(observed) {
  return [observed.judgeVerdict, observed.evaluateVerdict]
    .find((verdict) => (
      verdict?.pr_head_sha === observed.pr?.head_sha
      && verdict?.failure_class === 'evidence_invalid'
    )) ?? null;
}

function currentFailureVerdict(observed) {
  return [observed.judgeVerdict, observed.evaluateVerdict]
    .find((verdict) => (
      verdict?.pr_head_sha === observed.pr?.head_sha
      && !isPassVerdict(verdict?.verdict)
    )) ?? null;
}

function currentProductFailureSet(observed) {
  if (observed.pr?.ci === 'fail') {
    return normalizeFailureSet(observed.pr.failed_checks);
  }
  const verdict = currentFailureVerdict(observed);
  if (verdict?.failure_class === 'product_failure' || verdict?.failure_class == null) {
    return normalizeFailureSet(verdict?.failure_signature);
  }
  return null;
}

function isFailureSetReview(reason) {
  return [
    'failure_set_repeated',
    'failure_set_patience_exhausted',
    'failure_set_repeated_across_runs',
  ].includes(reason);
}

function buildSnapshot(observed, counters, action, reason = null) {
  const snapshot = {
    prdExists: observed.prdExists,
    prdEvidence: observed.prdEvidence ?? null,
    contractApproved: observed.contract.approved,
    pr: observed.pr
      ? {
          url: observed.pr.url,
          state: observed.pr.state,
          mergeStateStatus: observed.pr.mergeStateStatus,
          ci: observed.pr.ci,
          merged: observed.pr.merged,
          head_sha: observed.pr.head_sha,
          failed_checks: normalizeFailureSet(observed.pr.failed_checks),
        }
      : null,
    inflightContainers: observed.inflight.containers.length,
    lastAgentExit: observed.lastAgentExit,
    proposeBranchRn: observed.proposeBranchRn,
    proposeBranchSha: observed.proposeBranchSha,
    counters,
  };
  const prev = (a) => {
    let best = null;
    for (const r of observed.decisionLog) {
      if (r.action === a && (best == null || r.hop > best.hop)) best = r;
    }
    return best;
  };
  if (action === ACTION.SPAWN_PROPOSER) {
    const prevProposer = prev(ACTION.SPAWN_PROPOSER);
    if (prevProposer) {
      const prevRn = prevProposer.observed?.proposeBranchRn;
      snapshot.propose_branch_advanced = typeof prevRn === 'number' ? observed.proposeBranchRn > prevRn : undefined;
    }
  }
  if (action === ACTION.SPAWN_REVIEWER) {
    const prevReviewer = prev(ACTION.SPAWN_REVIEWER);
    if (prevReviewer) {
      snapshot.verdict_parsed = observed.decisionLog.some(
        (r) => r.action === LOG_ACTION.VERDICT_REVIEWER && r.hop > prevReviewer.hop,
      );
    }
  }
  if (action === ACTION.SPAWN_GENERATOR_FIX) {
    const infrastructureRetry = reason === 'callback_infrastructure_blocked';
    snapshot.trigger_sha = observed.pr?.head_sha ?? null;
    const failureVerdict = currentFailureVerdict(observed);
    snapshot.failure_class = infrastructureRetry
      ? 'infrastructure_blocked'
      : observed.pr?.ci === 'fail'
        ? 'product_failure'
        : failureVerdict?.failure_class
          ?? (failureVerdict ? 'product_failure' : null);
    if (snapshot.failure_class === 'product_failure') {
      snapshot.failure_set = currentProductFailureSet(observed);
      snapshot.failure_set_key = failureSetKey(snapshot.failure_set);
    }
    if (!observed.pr && !infrastructureRetry) {
      const crashSignature = generatorCrashSignature(observed.lastAgentExit);
      if (crashSignature != null) snapshot.crash_signature = crashSignature;
    }
  }
  if (action === ACTION.WAIT_GENERATOR_FIX_CALLBACK) {
    const latestIntent = prev(ACTION.SPAWN_GENERATOR_FIX);
    snapshot.trigger_hop = latestIntent?.hop ?? null;
  }
  if (
    isFailureSetReview(reason)
    && [ACTION.WAIT_HUMAN_REVIEW, LOG_ACTION.HUMAN_REVIEW_REQUESTED].includes(action)
  ) {
    const failureSet = currentProductFailureSet(observed);
    snapshot.review_reason = reason;
    snapshot.failure_set = failureSet;
    snapshot.failure_set_key = failureSetKey(failureSet);
  }
  const evidenceVerdict = structuredEvidenceVerdict(observed);
  if (evidenceVerdict && [
    ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR,
    ACTION.WAIT_HUMAN_REVIEW,
    LOG_ACTION.HUMAN_REVIEW_REQUESTED,
  ].includes(action)) {
    snapshot.failure_class = 'evidence_invalid';
    snapshot.failure_signature = normalizeFailureSignature(
      evidenceVerdict.failure_signature,
    );
    if ([ACTION.WAIT_HUMAN_REVIEW, LOG_ACTION.HUMAN_REVIEW_REQUESTED].includes(action)) {
      snapshot.review_reason = reason;
    }
  }
  if ([ACTION.WAIT_HUMAN_REVIEW, LOG_ACTION.HUMAN_REVIEW_REQUESTED].includes(action)) {
    snapshot.review_reason = reason;
  }
  return snapshot;
}

function humanReviewDetail(observed, reason) {
  if ([
    'evidence_invalid:repeated_signature',
    'unknown:missing_failure_signature',
  ].includes(reason)) {
    const verdict = structuredEvidenceVerdict(observed);
    if (!verdict) return { review_reason: reason };
    return {
      review_reason: reason,
      failure_signature: normalizeFailureSignature(verdict.failure_signature),
    };
  }
  if (isFailureSetReview(reason)) {
    const failureSet = currentProductFailureSet(observed);
    return {
      review_reason: reason,
      failure_set: failureSet,
      failure_set_key: failureSetKey(failureSet),
    };
  }
  return { review_reason: reason };
}

async function markRunFailed(deps, runId, taskId, reason) {
  const finalizeRun = deps.finalizeRun ?? finalizeKernelRun;
  await finalizeRun(deps.pool, {
    runId,
    expectedTaskId: taskId,
    outcome: 'failed',
    reason,
  });
}

function frozenArtifactErrorCode(error) {
  return String(error?.message ?? '').match(/FROZEN_CONTRACT_ARTIFACT[A-Z_]*/)?.[0] ?? null;
}

async function materializeApprovedContractOrFail(deps, params, { runId, taskId }) {
  const materialize = deps.materializeApprovedContract ?? materializeApprovedContract;
  try {
    await materialize(deps.pool, params);
    return null;
  } catch (error) {
    const code = frozenArtifactErrorCode(error);
    if (!code) throw error;
    await markRunFailed(deps, runId, taskId, `assembly_fault:${code}`);
    return code;
  }
}

async function markRunPaused(pool, runId, observed) {
  const callback = [...(observed.decisionLog ?? [])]
    .sort((a, b) => Number(b.hop) - Number(a.hop))
    .find((row) => (
      row.action === LOG_ACTION.ATTEMPT_CALLBACK
      && (asStructuredJson(row.detail) ?? {}).status === 'needs_context'
    ));
  if (!callback) {
    throw new Error(`needs_context callback missing for run ${runId}`);
  }
  const callbackDetail = asStructuredJson(callback.detail) ?? {};
  const callbackHop = Number(callback.hop);
  const contextVersion = `context-v1:${callbackHop}:${callbackDetail.attempt_id}`;
  const resumePhase = callback.derived_phase ?? observed.run.phase;
  await pool.query(
    `WITH lock AS (
       SELECT pg_advisory_xact_lock(hashtext($1::text))
     ), callback AS (
       SELECT hop
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid
          AND hop=$2
          AND action='verdict:attempt_callback'
          AND detail->>'status'='needs_context'
     ), next_hop AS (
       SELECT COALESCE(MAX(log.hop), 0) + 1 AS hop
         FROM lock
         LEFT JOIN orchestrator_decision_log log
           ON log.run_id=$1::uuid
     ), request AS (
       INSERT INTO orchestrator_decision_log
         (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
       SELECT $1::uuid, next_hop.hop, $3::jsonb, 'paused', NULL,
              'effect:context_requested', $4::jsonb
         FROM lock, callback, next_hop
        WHERE NOT EXISTS (
          SELECT 1
            FROM orchestrator_decision_log
           WHERE run_id=$1::uuid
             AND action='effect:context_requested'
             AND detail->>'callback_hop'=$2::text
        )
       RETURNING hop
     )
     UPDATE initiative_runs
        SET phase = 'paused', updated_at = NOW()
      WHERE id = $1::uuid
        AND phase NOT IN ('done', 'failed')
        AND EXISTS (SELECT 1 FROM callback)
      RETURNING id`,
    [
      runId,
      callbackHop,
      JSON.stringify({
        callback_hop: callbackHop,
        attempt_id: callbackDetail.attempt_id ?? null,
        role: callbackDetail.role ?? null,
      }),
      JSON.stringify({
        callback_hop: callbackHop,
        context_version: contextVersion,
        resume_phase: resumePhase,
        question: callbackDetail.context_question
          ?? callbackDetail.summary
          ?? callbackDetail.failure_class
          ?? 'context required',
      }),
    ],
  );
}

async function loadRunDeadlineState(pool, runId) {
  const deadlineResult = await pool.query(
    'SELECT deadline_at FROM initiative_runs WHERE id = $1',
    [runId],
  );
  const reviewResult = await pool.query(
    `SELECT request.hop AS review_request_hop,
            request.observed,
            request.observed #>> '{pr,head_sha}' AS review_head_sha,
            request.created_at
       FROM orchestrator_decision_log request
      WHERE request.run_id = $1
        AND request.action = 'effect:human_review_requested'
        AND NOT EXISTS (
          SELECT 1
            FROM orchestrator_decision_log approval
           WHERE approval.run_id = request.run_id
             AND approval.action = 'verdict:human_review'
             AND approval.detail->>'review_request_hop' = request.hop::text
        )
      ORDER BY request.hop DESC
      LIMIT 1`,
    [runId],
  );
  const deadline = deadlineResult.rows[0] ?? {};
  const review = reviewResult.rows[0] ?? {};
  const reviewObserved = asPayload(review.observed);
  return {
    deadline_at: deadline.deadline_at ?? null,
    review_request_hop: review.review_request_hop ?? null,
    review_head_sha: review.review_head_sha ?? reviewObserved.pr?.head_sha ?? null,
    open_human_review: review.review_request_hop != null,
  };
}

const CONTEXT_RESUME_PHASE_SQL = "'planning','gan','generate','evaluate','review','merge'";

/**
 * Child-side startup fence for a needs_context recovery. The new Controller
 * may not collect ground truth or dispatch until its one-use token atomically
 * publishes the latest answered request's resume phase and its real liveness
 * receipt.
 */
export async function activateContextResume(pool, {
  runId,
  resumeToken,
  host,
  pid,
  now,
}) {
  const claimHost = `context-resume:${resumeToken}`;
  const result = await pool.query(
    `WITH latest_request AS (
       SELECT request.hop, request.detail, $2::text AS resume_token
         FROM orchestrator_decision_log request
        WHERE request.run_id=$1::uuid
          AND request.action='effect:context_requested'
        ORDER BY request.hop DESC
        LIMIT 1
     ), answered AS (
       SELECT latest_request.*
         FROM latest_request
        WHERE EXISTS (
          SELECT 1
            FROM orchestrator_decision_log answer
           WHERE answer.run_id=$1::uuid
             AND answer.action='verdict:context_answer'
             AND answer.detail->>'context_request_hop'=latest_request.hop::text
        )
     )
     UPDATE initiative_runs r
        SET phase=answered.detail->>'resume_phase',
            orchestrator_heartbeat_at=$3,
            orchestrator_host=$4,
            orchestrator_pid=$5,
            updated_at=NOW()
       FROM answered
      WHERE r.id=$1::uuid
        AND r.phase='paused'
        AND r.orchestrator_host=$6
        AND answered.resume_token=$2
        AND answered.detail->>'resume_phase' IN (${CONTEXT_RESUME_PHASE_SQL})
      RETURNING r.id, r.phase`,
    [runId, resumeToken, now, host, pid, claimHost],
  );
  return result.rows?.[0] ?? null;
}

/**
 * runLoop(deps, {taskId, runId?, dryRun?}) → {exitReason, hops, decision?}
 * hops = 本进程实际派发（appendHop 成功）的跳数。
 * dryRun（F5 前台雏形）：只观测+推导+打印，单跳即返回，零写入零派发。
 */
export async function runLoop(
  deps,
  {
    taskId,
    runId,
    resumeToken = null,
    controllerSessionId = null,
    dryRun = false,
  },
) {
  const collect = deps.collectGroundTruth ?? defaultCollect;
  // DI 包装：fake（测试）注入 appendHop(opts) 单对象接口；默认实现是 (pool, opts) 两参数接口
  const append = deps.appendHop
    ? (_pool, opts) => deps.appendHop(opts)
    : defaultAppendHop;
  const next = deps.nextHop ?? defaultNextHop;
  const heartbeat = deps.writeHeartbeat ?? defaultWriteHeartbeat;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console.log;
  const host = deps.host ?? 'unknown-host';
  const pid = deps.pid ?? process.pid;

  const resolvedRunId = runId ?? (await resolveRunId(deps.pool, taskId));
  if (resumeToken) {
    const activate = deps.activateContextResume ?? activateContextResume;
    const activated = await activate(deps.pool, {
      runId: resolvedRunId,
      resumeToken,
      host,
      pid,
      now: now(),
    });
    if (!activated) {
      return { exitReason: 'context_resume_claim_lost', hops: 0 };
    }
  }
  const groundTruthPaths = collect === defaultCollect
    ? await resolveGroundTruthPaths(deps.pool, taskId)
    : {};

  let hops = 0;
  // Controller lease CAS 心跳（sprint 08132021）：每跳携带创建端 controllerSessionId
  // 续租 lease，心跳不再仅凭 run_id。writeHeartbeat 返回 rowCount=0（session mismatch
  // 或 run 已终态）= 本 Kernel 已失去 Controller ownership，置 leaseLost 让下一跳
  // fail-closed 退出，绝不静默续跑（INV-9 无主 fail-closed）。
  let leaseLost = false;
  const beat = async () => {
    const res = await heartbeat(deps.pool, {
      runId: resolvedRunId, host, pid, now: now(), controllerSessionId,
    });
    if (res && res.rowCount === 0) leaseLost = true;
    return res;
  };

  // deadline fence 辅助：检查 run.deadline_at 是否已超过当前时间
  function deadlineExceeded(run) {
    if (!run || !run.deadline_at) return false;
    return now() >= new Date(run.deadline_at);
  }

  while (true) {
    // ---- Controller lease fence：上一跳心跳 CAS rowCount=0 → 已失去 ownership ----
    // 失去 Controller ownership 的 Kernel 绝不继续观测/派发，fail-closed 退出交
    // reconcileOwnerlessKernelRuns 回收（sprint 08132021，INV-9）。
    if (leaseLost) {
      return { exitReason: 'controller_lease_lost', hops };
    }

    // ---- Deadline fence 1：collect 前 ----
    // collect 会调用 git/gh/docker，过期 run 不应再触发任何外部观测。
    const deadlineState = await loadRunDeadlineState(deps.pool, resolvedRunId);
    const hasOpenHumanReview = deadlineState.open_human_review === true
      || deadlineState.open_human_review === 'true'
      || deadlineState.review_request_hop != null;
    if (deadlineExceeded(deadlineState) && !hasOpenHumanReview) {
      await markRunFailed(deps, resolvedRunId, taskId, 'automation_deadline_exceeded');
      return { exitReason: 'automation_deadline_exceeded', hops };
    }

    const observed = await collect(deps, {
      taskId,
      runId: resolvedRunId,
      ...groundTruthPaths,
    });

    // Expired Fleet attempts are reconciled before derive can mistake a stale
    // starting/running row for live work forever. The Worker keeps the original
    // owner/generation: changing only the DB lease would fence out its callback.
    const expiredAttempt = !dryRun
      && !['done', 'failed'].includes(observed.run?.phase)
      && typeof deps.reconcileExpiredAttempt === 'function'
      ? oldestExpiredAttempt(observed.inflight?.attempts, now())
      : null;
    if (expiredAttempt) {
      const recovery = await deps.reconcileExpiredAttempt({ attempt: expiredAttempt });
      if (['missing_terminalized', 'replacement_required'].includes(recovery.status)) {
        if (Number.isSafeInteger(recovery.hop)) hops++;
        await beat();
        continue;
      }
      if (recovery.status === 'parent_terminal') {
        await beat();
        continue;
      }
      if (recovery.status === 'ownership_lost') {
        return { exitReason: 'singleton_conflict', hops };
      }
      if (['adopted_prepared', 'adopted_running'].includes(recovery.status)) {
        await beat();
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (recovery.status === 'infrastructure_blocked') {
        const recoveryHop = await next(deps.pool, resolvedRunId);
        try {
          await append(deps.pool, {
            runId: resolvedRunId,
            hop: recoveryHop,
            observed: {
              attempt_id: expiredAttempt.id,
              role: expiredAttempt.role,
              status: expiredAttempt.status,
            },
            derivedPhase: expiredAttempt.phase ?? observed.run.phase,
            gateVerdict: 'deny:infrastructure_blocked',
            action: 'result:expired_attempt_reconcile',
            detail: {
              attempt_id: expiredAttempt.id,
              signature: boundedText(recovery.signature),
              failure_class: 'infrastructure_blocked',
            },
          });
          hops++;
        } catch (error) {
          if (error instanceof SingletonConflictError) {
            return { exitReason: 'singleton_conflict', hops };
          }
          throw error;
        }
        await beat();
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
    }

    const counters = deriveCounters(observed.decisionLog, { proposeBranchMaxRn: observed.proposeBranchRn });
    // pollCount 从 DB 持久化推导（Sprint 07231527 Blocking 2：进程内变量改为 DB 推导）
    const pollCount = counters.pollCount;
    const fullCounters = { ...counters, pollCount, ganCostUsd: Number(observed.run.cost_usd ?? 0) };
    const defaultDecision = derive({
      ...observed,
      noProgress: counters.noProgress,
      noProgressReason: counters.noProgressReason,
      counters: fullCounters,
    });
    let decision = defaultDecision;
    let commanderDispatchContext = null;
    let retryDispatchContext = null;
    let latestKnownHop = observed.decisionLog.reduce(
      (max, row) => Math.max(max, Number(row.hop) || 0),
      0,
    );
    // collect 前只凭“有开放 request”允许进行一次外部对账；collect 后必须确认
    // request 仍锚定当前 GitHub head，旧 SHA 的人审不能暂停新 SHA 的活动时钟。
    let deadlinePaused = defaultDecision.action === ACTION.WAIT_HUMAN_REVIEW
      && hasOpenHumanReview
      && Boolean(observed.pr?.head_sha)
      && deadlineState.review_head_sha === observed.pr.head_sha;
    const decisionIsTerminal = [
      ACTION.EXIT,
      ACTION.MARK_FAILED,
      ACTION.REPORT,
    ].includes(defaultDecision.action);

    // ---- Deadline fence 2：derive 后 ----
    // wait/control 分支都在此 fence 之后，不能绕开硬上限。
    if (deadlineExceeded(observed.run) && !deadlinePaused && !decisionIsTerminal) {
      await markRunFailed(deps, resolvedRunId, taskId, 'automation_deadline_exceeded');
      return { exitReason: 'automation_deadline_exceeded', hops };
    }

    if (dryRun) {
      log(`[orchestrator][dry-run] run=${resolvedRunId} phase=${defaultDecision.phase} action=${defaultDecision.action} reason=${defaultDecision.reason}`);
      return { exitReason: 'dry_run', hops, decision: defaultDecision };
    }

    if (deps.commanderCoordinator) {
      const commanderMode = observed.run.commander_mode ?? 'kernel-only';
      const payload = asPayload(observed.task?.payload);
      const runProfile = parseCommanderProfile({ commanderMode, payload });
      const strictMachine = payload.routing?.strict_affinity === true
        ? payload.routing?.preferred_machine
        : null;
      if (
        payload.routing?.strict_affinity === true
        && (typeof strictMachine !== 'string' || strictMachine.length < 1)
      ) {
        throw new Error('commander_strict_machine_missing');
      }
      const configuredRetryBudget = Number.isSafeInteger(payload.commander_retry_budget)
        ? Math.max(0, Math.min(8, payload.commander_retry_budget))
        : 2;
      const remainingRetryBudget = Math.max(
        0,
        configuredRetryBudget - commanderRetryCount(observed.decisionLog),
      );
      const effectiveDeadline = observed.run.deadline_at
        ?? '9999-12-31T23:59:59.999Z';
      const commanderResult = await deps.commanderCoordinator.reconcile({
        run: {
          id: resolvedRunId,
          phase: observed.run.phase,
          commander_mode: commanderMode,
        },
        commanderMode,
        runProfile,
        objective: {
          task_id: observed.task?.id ?? taskId,
          title: boundedText(observed.task?.title),
          description: boundedText(observed.task?.description),
        },
        observed: jsonValue(buildSnapshot(
          observed,
          fullCounters,
          defaultDecision.action,
          defaultDecision.reason,
        )),
        defaultDecision,
        historySummary: {
          counters: jsonValue(fullCounters),
        },
        budgets: {
          spent_usd: Number(observed.run.cost_usd ?? 0),
          max_usd: BUDGET_CAP_USD,
          remaining_hops: Math.max(0, MAX_HOPS - latestKnownHop),
          remaining_retry_attempts: remainingRetryBudget,
          deadline_at: effectiveDeadline,
        },
        allowedActions: COMMANDER_ACTIONS,
      });

      if (Number.isSafeInteger(commanderResult.authoritative_hop)) {
        latestKnownHop = commanderResult.authoritative_hop;
        hops++;
      }
      if (commanderResult.kind === 'wait') {
        await beat();
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (commanderResult.kind === 'dispatch') {
        decision = {
          phase: defaultDecision.phase,
          action: commanderResult.action,
          reason: commanderResult.context?.wakeup_reasons?.join(',')
            || 'commander_material_boundary',
        };
        commanderDispatchContext = commanderResult.context;
      } else if (commanderResult.kind === 'continue') {
        decision = commanderResult.decision ?? defaultDecision;
      } else if (commanderResult.kind === 'control') {
        if (!deps.commanderDirectiveExecutor) {
          throw new Error('commander_directive_executor_unavailable');
        }
        const adjudicationHop = await next(deps.pool, resolvedRunId);
        const directiveResult = await deps.commanderDirectiveExecutor.execute({
          directive: commanderResult.decision,
          defaultDecision,
          validation: {
            runId: resolvedRunId,
            eventCursor: commanderResult.event_cursor
              ?? commanderResult.decision?.event_cursor,
            phase: defaultDecision.phase,
            allowedActions: COMMANDER_ACTIONS,
            nextHop: adjudicationHop,
            maxHops: MAX_HOPS,
            duplicateHop: adjudicationHop <= latestKnownHop,
            spentUsd: Number(observed.run.cost_usd ?? 0),
            maxUsd: BUDGET_CAP_USD,
            deadlineAt: effectiveDeadline,
            now: now(),
            strictMachine,
            capabilityAllowed: true,
            evidenceOwned: true,
            remainingRetryBudget,
          },
        });
        const directiveAction = directiveResult.accepted
          ? 'commander.directive_accepted'
          : 'commander.directive_rejected';
        await append(deps.pool, {
          runId: resolvedRunId,
          hop: adjudicationHop,
          observed: {
            commander_attempt_id: commanderResult.attempt_id ?? null,
            event_cursor: commanderResult.decision?.event_cursor ?? null,
          },
          derivedPhase: defaultDecision.phase,
          gateVerdict: directiveResult.accepted
            ? 'allow'
            : `deny:${directiveResult.reason_code}`,
          action: directiveAction,
          detail: {
            attempt_id: commanderResult.attempt_id ?? null,
            ...(directiveResult.reason_code
              ? { reason_code: directiveResult.reason_code }
              : {}),
            directive: commanderResult.decision,
          },
        });
        hops++;
        latestKnownHop = adjudicationHop;
        decision = directiveResult.accepted
          ? directiveResult.decision
          : defaultDecision;
        retryDispatchContext = directiveResult.dispatch_context ?? null;
      }
    }

    // ---- run.phase 前进持久化（r17 实证修复）----
    // 以最终被执行的 decision 为准（commander 改写后的版本）；WAIT_ACTIONS 只是
    // 复查在途状态不算前进，terminal/mark_failed 的 phase 不在活跃集合里天然被
    // 过滤掉。非关键路径：持久化失败只告警，不阻断 loop。
    if (
      PROGRESSING_KERNEL_PHASES.has(decision.phase)
      && !WAIT_ACTIONS.has(decision.action)
    ) {
      try {
        await persistKernelRunPhase(deps.pool, resolvedRunId, decision.phase);
      } catch (err) {
        log(
          `[orchestrator] run.phase 持久化失败 run=${resolvedRunId} `
          + `phase=${decision.phase}: ${err.message}`,
        );
      }
    }

    // ---- 控制 action 自消费（不派 dispatcher、不 append hop）----
    if (decision.action === ACTION.EXIT) {
      return { exitReason: decision.reason, hops };
    }
    if (decision.action === ACTION.MARK_FAILED) {
      await markRunFailed(deps, resolvedRunId, taskId, decision.reason);
      return { exitReason: decision.reason, hops };
    }
    if (decision.action === ACTION.PAUSE_RUN) {
      await markRunPaused(deps.pool, resolvedRunId, observed);
      return { exitReason: decision.reason, hops };
    }
    if (decision.action === ACTION.PERSIST_CONTRACT_APPROVAL) {
      if (!observed.proposeBranch || !Number.isInteger(observed.proposeBranchRn)
          || observed.proposeBranchRn < 1) {
        await markRunFailed(deps, resolvedRunId, taskId, 'approved_but_no_contract_branch');
        return { exitReason: 'approved_but_no_contract_branch', hops };
      }
      const approvedSha = observed.ganLatestRoundContractSha ?? null;
      if (!approvedSha) {
        await markRunFailed(deps, resolvedRunId, taskId, 'approved_but_no_contract_sha');
        return { exitReason: 'approved_but_no_contract_sha', hops };
      }
      const artifacts = frozenContractArtifacts(
        deps,
        observed,
        groundTruthPaths,
        approvedSha,
      );
      if (artifacts.missing.length > 0) {
        await markRunFailed(
          deps,
          resolvedRunId,
          taskId,
          'approved_but_contract_artifacts_missing',
        );
        return { exitReason: 'approved_but_contract_artifacts_missing', hops };
      }
      const identityPolicy = evaluateValidationIdentityPolicy(artifacts.contractContent);
      if (!identityPolicy.ok) {
        const policyHop = await next(deps.pool, resolvedRunId);
        try {
          await append(deps.pool, {
            runId: resolvedRunId,
            hop: policyHop,
            observed: {
              proposeBranchRn: observed.proposeBranchRn,
              proposeBranchSha: approvedSha,
            },
            derivedPhase: 'gan',
            gateVerdict: 'deny:premature_validation_identity_binding',
            action: LOG_ACTION.VERDICT_REVIEWER,
            detail: {
              rn: observed.proposeBranchRn,
              contract_sha: approvedSha,
              verdict: 'REVISION',
              summary: '合同在执行角色产生前硬编码了可变 validation identity。',
              reason: '删除 GAN authoring attempt/capability snapshot 字面值；使用 Runner 注入的 HARNESS_ATTEMPT_ID、CAPABILITY_SNAPSHOT_ID 与当前角色 attestation late-bound，并让后续角色以证据摘要串联。',
              source: 'validation_identity_policy',
              violations: identityPolicy.violations,
            },
          });
          hops++;
        } catch (error) {
          if (error instanceof SingletonConflictError) {
            return { exitReason: 'singleton_conflict', hops };
          }
          throw error;
        }
        await beat();
        continue;
      }
      const artifactFailure = await materializeApprovedContractOrFail(deps, {
        runId: resolvedRunId,
        version: observed.proposeBranchRn,
        branch: observed.proposeBranch,
        prdContent: artifacts.prdContent,
        contractContent: artifacts.contractContent,
        ...(artifacts.artifacts ? { artifacts: artifacts.artifacts } : {}),
        approvedAt: now(),
      }, { runId: resolvedRunId, taskId });
      if (artifactFailure) return { exitReason: 'assembly_fault', hops };
      await beat();
      continue;
    }
    if (decision.action === ACTION.ARBITRATE_CONTRACT_FAULT) {
      // 合同申诉仲裁(Alex 拍板 2026-08-06):Generator 的合同故障码只是申诉。
      // 独立仲裁器(Judge 同模型,in-process 调用,与 kernel judge 同路径)裁定
      // 后写 verdict:contract_arbitration 行,下一跳 derive 按 upheld 分流:
      // true→reopen_gan_contract;false→generator-fix;null→人工。
      const faultRow = observed.decisionLog.find(
        (r) => Number(r.hop) === Number(decision.callbackHop),
      );
      const faultDetail = faultRow ? (asStructuredJson(faultRow.detail) ?? {}) : {};
      let contractText = '';
      if (observed.contract.id) {
        try {
          const { rows } = await deps.pool.query(
            `SELECT contract_content, e2e_acceptance FROM initiative_contracts WHERE id = $1`,
            [observed.contract.id],
          );
          contractText = [rows[0]?.contract_content, rows[0]?.e2e_acceptance]
            .filter(Boolean).join('\n\n---\n\n');
        } catch { /* 合同读取失败 → contractText 空,仲裁器将因证据不足报 null → 人工 */ }
      }
      let verdict;
      if (deps.arbitrateContractAppeal) {
        verdict = await deps.arbitrateContractAppeal({
          contractText,
          errorCode: faultDetail.error_code ?? null,
          claimSummary: faultDetail.summary ?? '',
        });
      } else {
        const { arbitrateContractAppeal } = await import('../harness-judge.js');
        verdict = contractText
          ? await arbitrateContractAppeal({
            contractText,
            errorCode: faultDetail.error_code ?? null,
            claimSummary: faultDetail.summary ?? '',
          })
          : { upheld: null, reasoning: 'contract text unavailable for arbitration' };
      }
      const arbHop = await next(deps.pool, resolvedRunId);
      try {
        await append(deps.pool, {
          runId: resolvedRunId,
          hop: arbHop,
          observed: { contract_id: observed.contract.id ?? null },
          derivedPhase: 'gan',
          gateVerdict: 'allow',
          action: LOG_ACTION.CONTRACT_ARBITRATION,
          detail: {
            callback_hop: decision.callbackHop ?? null,
            upheld: verdict.upheld,
            reasoning: String(verdict.reasoning ?? '').slice(0, 2000),
            error_code: faultDetail.error_code ?? null,
          },
        });
        hops++;
      } catch (error) {
        if (error instanceof SingletonConflictError) {
          return { exitReason: 'singleton_conflict', hops };
        }
        throw error;
      }
      await beat();
      continue;
    }
    if (decision.action === ACTION.REOPEN_GAN_CONTRACT) {
      // 合同故障重开 GAN（r40 实证）：下游执行证伪合同资产（CONTRACT_SELF_
      // CONTRADICTION / CONTRACT_TEST_UNSATISFIABLE）。三步：①写 reopen 决策行
      // （detail.callback_hop 消费触发它的 callback，防重复路由）②把下游发现的
      // 故障写进案卷（下一轮 proposer/reviewer 从 inputs.case_file 看到"为什么
      // 重开"，与既有跨轮记忆通道一致）③降级合同 approved→revision，下一跳
      // derive 自然回到 GAN。
      const reopenHop = await next(deps.pool, resolvedRunId);
      try {
        await append(deps.pool, {
          runId: resolvedRunId,
          hop: reopenHop,
          observed: { contract_id: observed.contract.id ?? null },
          derivedPhase: 'gan',
          gateVerdict: 'allow',
          action: ACTION.REOPEN_GAN_CONTRACT,
          detail: {
            callback_hop: decision.callbackHop ?? null,
            reason: decision.reason,
          },
        });
        hops++;
      } catch (error) {
        if (error instanceof SingletonConflictError) {
          return { exitReason: 'singleton_conflict', hops };
        }
        throw error;
      }
      const faultRow = observed.decisionLog.find(
        (r) => Number(r.hop) === Number(decision.callbackHop),
      );
      const faultDetail = faultRow ? (asStructuredJson(faultRow.detail) ?? {}) : {};
      const faultRound = (observed.caseFile ?? []).reduce(
        (max, r) => Math.max(max, Number(r.round) || 0),
        0,
      ) + 1;
      if (faultDetail.attempt_id) {
        await insertCaseFileRow(deps.pool, {
          runId: resolvedRunId,
          round: faultRound,
          authorRole: 'reviewer',
          attemptId: faultDetail.attempt_id,
          contractSha: observed.ganLatestRoundContractSha ?? null,
          rubricScores: null,
          blockers: [{
            id: `E${faultRound}-1`,
            dimension: 'internal_consistency',
            title: '合同资产被下游执行证伪（合同故障重开）',
            detail: String(faultDetail.summary ?? faultDetail.error_code ?? '').slice(0, 2000),
            status: 'open',
            why_not_found_earlier: 'GAN 阶段无人真正执行合同内验证脚本，缺陷只能在 Generator/Evaluator 真跑时暴露',
            prd_gap: 'N/A —— 合同资产缺陷，非 PRD 缺口',
          }],
          feedbackMd: `## 合同故障重开（${faultDetail.error_code ?? 'contract_fault'}）\n\n${String(faultDetail.summary ?? '').slice(0, 2000)}\n\n要求：Proposer 修复合同资产中被证伪的部分（禁止削弱断言强度来"绕过"），Reviewer 复审时优先核验本条。`,
        });
      }
      if (observed.contract.id) {
        // 降级回 'draft'(schema 约束合法集: draft/approved/superseded;r43 实证
        // 'revision' 违反 check 约束直接炸 run)。derive 只看 approved 与否,
        // draft → !approved → 下一跳自然回 GAN spawn:proposer(revision_requested)。
        await deps.pool.query(
          `UPDATE initiative_contracts SET status = 'draft', updated_at = $2 WHERE id = $1`,
          [observed.contract.id, now()],
        );
      }
      await beat();
      continue;
    }
    if (decision.action === ACTION.FORCE_APPROVE_CONTRACT) {
      // 案卷式 GAN 趋势观测安全网（PR-B，issue ce42f68f）：detectRubricTrend 判
      // diverging/oscillating 时，代码层跳过 reviewer 直接强制批准当前 propose 分支。
      // 消费路径对齐 ACTION.PERSIST_CONTRACT_APPROVAL（同一持久化函数 materializeApprovedContract
      // / 同一 UPDATE 语句），区别：①无既有 reviewer APPROVED 决策日志可复用，必须自己写一条
      // verdict:reviewer 行留痕（source=rubric_trend_force_approval，供审计与崩溃窗口重放识别）；
      // ②多发一条 P1 告警（这是"代码越过 reviewer 拍板"，理应被人看到）。
      //
      // F3（审查修复）：raise('P1', ...) 只是把事件推进 Brain 主进程内存缓冲区（每小时刷一次
      // 飞书汇总）——Kernel run 常年跑在 stdio ignore 的子进程/容器里，主进程重启或子进程
      // 退出都会把还没刷出去的 P1 缓冲区一并蒸发，raise() 本身对此毫无感知（既有系统缺口，
      // 不是本次改动引入的新问题）。cecelia_events 这一行 DB 记录落在事务外独立 INSERT，
      // 是这条告警唯一保证可查、可被后续巡检/Dashboard 读到的送达通道；raise() 依旧保留
      // （命中时飞书汇总仍会正常收到），两者并行、互不替代。
      const recordForcedApprovalSideEffects = async (contractSha) => {
        try {
          const { raise } = await import('../alerting.js');
          await raise(
            'P1',
            'gan_forced_approval',
            `GAN rubric 趋势观测强制批准合同：run=${resolvedRunId} task=${taskId} `
            + `reason=${decision.reason}`,
          );
        } catch (err) {
          log(`[orchestrator] gan_forced_approval P1 告警发送失败 run=${resolvedRunId}: ${err.message}`);
        }
        try {
          await deps.pool.query(
            `INSERT INTO cecelia_events (event_type, payload) VALUES ($1, $2::jsonb)`,
            [
              'gan_forced_approval',
              JSON.stringify({
                run_id: resolvedRunId,
                trend: String(decision.reason ?? '').replace(/^convergence_/, ''),
                contract_sha: contractSha ?? null,
                reason: decision.reason,
              }),
            ],
          );
        } catch (err) {
          log(`[orchestrator] gan_forced_approval cecelia_events 写入失败 run=${resolvedRunId}: ${err.message}`);
        }
      };
      if (!observed.contract.id) {
        if (!observed.proposeBranch || !Number.isInteger(observed.proposeBranchRn)
            || observed.proposeBranchRn < 1) {
          await markRunFailed(deps, resolvedRunId, taskId, 'force_approve_but_no_contract_branch');
          return { exitReason: 'force_approve_but_no_contract_branch', hops };
        }
        const approvedSha = observed.proposeBranchSha ?? null;
        if (!approvedSha) {
          await markRunFailed(deps, resolvedRunId, taskId, 'force_approve_but_no_contract_sha');
          return { exitReason: 'force_approve_but_no_contract_sha', hops };
        }
        const artifacts = frozenContractArtifacts(
          deps,
          observed,
          groundTruthPaths,
          approvedSha,
        );
        if (artifacts.missing.length > 0) {
          await markRunFailed(
            deps,
            resolvedRunId,
            taskId,
            'force_approve_but_contract_artifacts_missing',
          );
          return { exitReason: 'force_approve_but_contract_artifacts_missing', hops };
        }
        // 硬安全门不因"强制批准"而豁免：合同硬编码了可变 validation identity 时仍判 REVISION，
        // 落一条决策日志后回 GAN（不 materialize）——对齐 persist_contract_approval 同款检查。
        const identityPolicy = evaluateValidationIdentityPolicy(artifacts.contractContent);
        if (!identityPolicy.ok) {
          const policyHop = await next(deps.pool, resolvedRunId);
          try {
            await append(deps.pool, {
              runId: resolvedRunId,
              hop: policyHop,
              observed: {
                proposeBranchRn: observed.proposeBranchRn,
                proposeBranchSha: approvedSha,
              },
              derivedPhase: 'gan',
              gateVerdict: 'deny:premature_validation_identity_binding',
              action: LOG_ACTION.VERDICT_REVIEWER,
              detail: {
                rn: observed.proposeBranchRn,
                contract_sha: approvedSha,
                verdict: 'REVISION',
                summary: '合同在执行角色产生前硬编码了可变 validation identity。',
                reason: '删除 GAN authoring attempt/capability snapshot 字面值；使用 Runner 注入的 HARNESS_ATTEMPT_ID、CAPABILITY_SNAPSHOT_ID 与当前角色 attestation late-bound，并让后续角色以证据摘要串联。',
                source: 'validation_identity_policy',
                violations: identityPolicy.violations,
              },
            });
            hops++;
          } catch (error) {
            if (error instanceof SingletonConflictError) {
              return { exitReason: 'singleton_conflict', hops };
            }
            throw error;
          }
          await beat();
          continue;
        }
        const forceHop = await next(deps.pool, resolvedRunId);
        try {
          await append(deps.pool, {
            runId: resolvedRunId,
            hop: forceHop,
            observed: {
              proposeBranchRn: observed.proposeBranchRn,
              proposeBranchSha: approvedSha,
            },
            derivedPhase: 'gan',
            gateVerdict: 'force_approved',
            action: LOG_ACTION.VERDICT_REVIEWER,
            detail: {
              rn: observed.proposeBranchRn,
              contract_sha: approvedSha,
              verdict: 'APPROVED',
              reason: decision.reason,
              source: 'rubric_trend_force_approval',
            },
          });
          hops++;
        } catch (error) {
          if (error instanceof SingletonConflictError) {
            return { exitReason: 'singleton_conflict', hops };
          }
          throw error;
        }
        const artifactFailure = await materializeApprovedContractOrFail(deps, {
          runId: resolvedRunId,
          version: observed.proposeBranchRn,
          branch: observed.proposeBranch,
          prdContent: artifacts.prdContent,
          contractContent: artifacts.contractContent,
          ...(artifacts.artifacts ? { artifacts: artifacts.artifacts } : {}),
          approvedAt: now(),
        }, { runId: resolvedRunId, taskId });
        if (artifactFailure) return { exitReason: 'assembly_fault', hops };
        await recordForcedApprovalSideEffects(approvedSha);
        await beat();
        continue;
      }
      // 崩溃窗口对称分支（force 落库前进程中断，contract 行已建但未 approved）
      const approvedSha = observed.proposeBranchSha ?? null;
      if (!approvedSha) {
        await markRunFailed(deps, resolvedRunId, taskId, 'force_approve_but_no_contract_sha');
        return { exitReason: 'force_approve_but_no_contract_sha', hops };
      }
      const artifacts = frozenContractArtifacts(
        deps,
        observed,
        groundTruthPaths,
        approvedSha,
      );
      if (artifacts.missing.length > 0) {
        await markRunFailed(
          deps,
          resolvedRunId,
          taskId,
          'force_approve_but_contract_artifacts_missing',
        );
        return { exitReason: 'force_approve_but_contract_artifacts_missing', hops };
      }
      const identityPolicy = evaluateValidationIdentityPolicy(artifacts.contractContent);
      if (!identityPolicy.ok) {
        await markRunFailed(deps, resolvedRunId, taskId, 'force_approve_contract_identity_invalid');
        return { exitReason: 'force_approve_contract_identity_invalid', hops };
      }
      const artifactFailure = await materializeApprovedContractOrFail(deps, {
        runId: resolvedRunId,
        version: observed.proposeBranchRn,
        branch: observed.proposeBranch,
        prdContent: artifacts.prdContent,
        contractContent: artifacts.contractContent,
        ...(artifacts.artifacts ? { artifacts: artifacts.artifacts } : {}),
        approvedAt: now(),
      }, { runId: resolvedRunId, taskId });
      if (artifactFailure) return { exitReason: 'assembly_fault', hops };
      await recordForcedApprovalSideEffects(approvedSha);
      await beat();
      continue;
    }

    // ---- 纯轮询 wait：只心跳+sleep（部分需 append 持久化计数）、不派发 ----
    // wait:human_review 首次必须经过 dispatcher，才能真正创建预览并通知人；同一
    // PR SHA 已写过 intent 后才转为纯等待，避免每 90s 重复通知。
    if (decision.action === ACTION.WAIT_HUMAN_REVIEW) {
      const reviewAlreadyRequested = observed.decisionLog.some(
        (row) => {
          if (row.action !== LOG_ACTION.HUMAN_REVIEW_REQUESTED) return false;
          const snapshot = asStructuredJson(row.observed) ?? {};
          const detail = asStructuredJson(row.detail) ?? {};
          if (snapshot.pr?.head_sha !== observed.pr?.head_sha) return false;
          if ([
            'evidence_invalid:repeated_signature',
            'unknown:missing_failure_signature',
          ].includes(decision.reason)) {
            const evidenceVerdict = structuredEvidenceVerdict(observed);
            return detail.review_reason === decision.reason
              && JSON.stringify(normalizeFailureSignature(detail.failure_signature))
                === JSON.stringify(
                  normalizeFailureSignature(evidenceVerdict?.failure_signature),
                );
          }
          if (isFailureSetReview(decision.reason)) {
            const currentSet = currentProductFailureSet(observed);
            return detail.review_reason === decision.reason
              && failureSetKey(detail.failure_set) === failureSetKey(currentSet);
          }
          return detail.review_reason === decision.reason
            || (
              detail.review_reason == null
              && decision.reason === 'awaiting_human_review'
            );
        },
      );
      if (reviewAlreadyRequested) {
        await beat();
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
    }
    if (decision.action === ACTION.WAIT_RUNNING) {
      await beat();
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (decision.action === ACTION.WAIT_GENERATOR_FIX_CALLBACK) {
      const callbackWaitHop = await next(deps.pool, resolvedRunId);
      const snapshot = buildSnapshot(
        observed,
        fullCounters,
        ACTION.WAIT_GENERATOR_FIX_CALLBACK,
      );
      try {
        await append(deps.pool, {
          runId: resolvedRunId,
          hop: callbackWaitHop,
          observed: snapshot,
          derivedPhase: decision.phase,
          gateVerdict: null,
          action: ACTION.WAIT_GENERATOR_FIX_CALLBACK,
          detail: {
            reason: decision.reason,
            trigger_hop: snapshot.trigger_hop,
          },
        });
        hops++;
      } catch (err) {
        if (err instanceof SingletonConflictError) {
          log(`[orchestrator] singleton conflict on generator callback wait ${resolvedRunId} hop ${callbackWaitHop}, exiting`);
          return { exitReason: 'singleton_conflict', hops };
        }
        throw err;
      }
      await beat();
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (decision.action === ACTION.WAIT_POLL_CI) {
      // Sprint 07231527 Blocking 2：wait:poll_ci 必须写 decision log，持久化计数跨重启不归零
      // pollCount 从 deriveCounters 推导，appendHop 后重启恢复正确值
      const pollHop = await next(deps.pool, resolvedRunId);
      try {
        await append(deps.pool, {
          runId: resolvedRunId,
          hop: pollHop,
          observed: buildSnapshot(observed, fullCounters, ACTION.WAIT_POLL_CI),
          derivedPhase: decision.phase,
          gateVerdict: null,
          action: ACTION.WAIT_POLL_CI,
          detail: { reason: decision.reason, ci: observed.pr?.ci ?? 'pending' },
        });
        hops++;
      } catch (err) {
        if (err instanceof SingletonConflictError) {
          log(`[orchestrator] singleton conflict on poll_ci ${resolvedRunId} hop ${pollHop}, exiting`);
          return { exitReason: 'singleton_conflict', hops };
        }
        throw err;
      }
      await beat();
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // ---- 派发 action：intent-log-before-dispatch ----
    const hop = await next(deps.pool, resolvedRunId);
    // collectGroundTruth 在读 decision log 后还会做 gh/git/docker IO。外部
    // callback 可能在这段窗口追加 verdict，使当前 decision 已经过期。nextHop
    // 看到的数据库版本若领先于 observed 快照，就必须丢弃快照重新观测；否则
    // 会在 PASS 已落库后重复 spawn 同一角色。hop=0 的初始兼容路径继续交给
    // appendHop UNIQUE(run_id,hop) 做最终并发栅栏。
    if (latestKnownHop > 0 && hop !== latestKnownHop + 1) {
      log(
        `[orchestrator] stale observation on run ${resolvedRunId}: ` +
        `observed max hop ${latestKnownHop}, database next hop ${hop}; re-observing`,
      );
      await beat();
      continue;
    }
    let gateVerdict = 'allow';
    let impactGateReceipt = null;
    const impactGateMethod = [ACTION.SPAWN_GENERATOR, ACTION.SPAWN_GENERATOR_FIX]
      .includes(decision.action)
      ? 'beforeGenerate'
      : [ACTION.SPAWN_EVALUATOR, ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR]
        .includes(decision.action)
        ? 'beforeEvaluate'
        : decision.action === ACTION.MERGE_PR
          ? 'beforeMerge'
          : null;
    if (impactGateMethod) {
      try {
        const evaluator = deps.impactGate?.[impactGateMethod];
        impactGateReceipt = typeof evaluator === 'function'
          ? await evaluator({
              task: observed.task,
              pr: observed.pr,
              decisionLog: observed.decisionLog,
              run: observed.run,
            })
          : {
              stage: impactGateMethod,
              gate: 'blocked',
              reason: 'impact_gate_unavailable',
              retryable: true,
            };
      } catch (error) {
        const errorCode = String(error?.code ?? 'impact_gate_error');
        const deterministic = DETERMINISTIC_IMPACT_ERROR_CODES.has(errorCode);
        impactGateReceipt = {
          stage: impactGateMethod,
          gate: 'blocked',
          reason: deterministic ? errorCode : 'impact_gate_error',
          retryable: !deterministic,
          failure_class: deterministic
            ? 'impact_contract_invalid'
            : 'infrastructure_blocked',
          error: sanitizeDiagnostic(error?.message ?? String(error)),
        };
      }
      if (!['pass', 'extend'].includes(impactGateReceipt?.gate)) {
        gateVerdict = `deny:impact:${impactGateReceipt?.reason ?? 'unknown'}`;
      }
    }
    if (decision.action === ACTION.MERGE_PR) {
      // F6 双保险：derive 说 merge，仍过一遍 mergeGate（唯一 merge 权威）
      const gate = mergeGate({
        evaluateVerdict: observed.evaluateVerdict,
        judgeVerdict: observed.judgeVerdict,
        prHeadSha: observed.pr.head_sha,
        reviewRequired: observed.reviewRequired,
        reviewApproved: observed.reviewApproved,
      });
      if (gateVerdict === 'allow') {
        gateVerdict = gate.allow ? 'allow' : `deny:${gate.reason}`;
      }
    }
    const intentAt = now();
    const taskPayload = asPayload(observed.task?.payload);
    const allowEvaluatorOrigin = allowsVerifiedExistingPrEvaluatorOrigin(
      observed,
      decision.action,
    );
    const validationClock = resolveValidationClock({
      action: decision.action,
      decisionLog: observed.decisionLog,
      intentAt,
      timeoutSeconds: Number(taskPayload.timeout_seconds ?? 5400),
      allowEvaluatorOrigin,
    });

    try {
      await append(deps.pool, {
        runId: resolvedRunId,
        hop,
        observed: buildSnapshot(
          observed,
          fullCounters,
          decision.action,
          decision.reason,
        ),
        derivedPhase: decision.phase,
        gateVerdict,
        action: decision.action,
        detail: {
          reason: decision.reason,
          crossCheckMismatch: counters.crossCheckMismatch,
          ...(validationClock ?? {}),
          ...(allowEvaluatorOrigin
            ? { validation_origin: VERIFIED_EXISTING_PR_ORIGIN }
            : {}),
          ...humanReviewDetail(observed, decision.reason),
          ...(impactGateReceipt ? { impact_gate: impactGateReceipt } : {}),
        },
      });
    } catch (err) {
      if (err instanceof SingletonConflictError) {
        // UNIQUE(run_id,hop) 冲突 = 并发 orchestrator 实例 → 本进程立即让位，交 watchdog
        log(`[orchestrator] singleton conflict on run ${resolvedRunId} hop ${hop}, exiting`);
        return { exitReason: 'singleton_conflict', hops };
      }
      throw err;
    }
    hops++;

    // ---- Deadline fence 3：dispatch 前 ----
    // intent 持久化与真实副作用之间仍可能跨过 deadline；此时保留审计 intent，但不派发。
    if (deadlineExceeded(observed.run) && !deadlinePaused) {
      await markRunFailed(deps, resolvedRunId, taskId, 'automation_deadline_exceeded');
      return { exitReason: 'automation_deadline_exceeded', hops };
    }

    // gateVerdict deny（derive 与 mergeGate 意见不一致 = 观测竞态）→ 不派发，按 BLOCKED 同态处理
    const result = gateVerdict?.startsWith('deny:')
      ? {
          status: 'BLOCKED',
          detail: gateVerdict,
          failure_class: impactGateReceipt?.reason === 'CONTRACT_IMPACT_DRIFT'
            || impactGateReceipt?.reason === 'gap_dependencies'
            ? 'gap_dependencies'
            : impactGateReceipt?.retryable === false
              ? 'impact_contract_invalid'
              : 'infrastructure_blocked',
          fallback_reason: impactGateReceipt?.reason ?? null,
          evidence: impactGateReceipt,
        }
      : await deps.dispatch(decision.action, {
          taskId,
          runId: resolvedRunId,
          hop,
          observed,
          decision,
          ...(validationClock ? { validationClock } : {}),
          ...(commanderDispatchContext ? { commander: commanderDispatchContext } : {}),
          ...(retryDispatchContext ? { retry: retryDispatchContext } : {}),
          ...(impactGateReceipt ? { impactGateReceipt } : {}),
        });
    const controlStatus = result.control_status ?? result.status;

    if (controlStatus === 'LAUNCHED') {
      const launchHop = await next(deps.pool, resolvedRunId);
      try {
        await append(deps.pool, {
          runId: resolvedRunId,
          hop: launchHop,
          observed: buildSnapshot(
            observed,
            fullCounters,
            LOG_ACTION.ATTEMPT_LAUNCHED,
            decision.reason,
          ),
          derivedPhase: decision.phase,
          gateVerdict: null,
          action: LOG_ACTION.ATTEMPT_LAUNCHED,
          detail: {
            dispatch_hop: hop,
            dispatch_action: decision.action,
            run_id: result.run_id,
            attempt_id: result.attempt_id,
            lease_generation: result.lease_generation,
            provider: result.provider,
          },
        });
      } catch (err) {
        if (err instanceof SingletonConflictError) {
          log(
            `[orchestrator] singleton conflict on attempt launch effect ` +
            `${resolvedRunId} hop ${launchHop}, exiting`,
          );
          return { exitReason: 'singleton_conflict', hops };
        }
        throw err;
      }
      hops++;
    }

    if (controlStatus === 'NEEDS_CONTEXT' || controlStatus === 'BLOCKED') {
      const resultHop = await next(deps.pool, resolvedRunId);
      await append(deps.pool, {
        runId: resolvedRunId,
        hop: resultHop,
        observed: buildSnapshot(observed, fullCounters, LOG_ACTION.DISPATCH_RESULT),
        derivedPhase: decision.phase,
        gateVerdict: `deny:${controlStatus}`,
        action: LOG_ACTION.DISPATCH_RESULT,
        detail: {
          dispatch_hop: hop,
          dispatch_action: decision.action,
          status: controlStatus,
          transport_status: result.status,
          result: result.detail ?? null,
          redirect_action: result.action ?? null,
          failure_class: result.failure_class ?? null,
          fallback_reason: result.fallback_reason ?? null,
          should_create_attempt: result.should_create_attempt ?? null,
          should_enter_generator_fix: result.should_enter_generator_fix ?? null,
          evidence: result.evidence ?? null,
        },
      });
      hops++;
    }

    // Intent 只能证明“准备通知”，不能证明 preview/通知副作用成功。成功后追加独立
    // effect marker；若首次派发失败，下一轮看不到 marker，仍会重试而不是永久空等。
    if (decision.action === ACTION.WAIT_HUMAN_REVIEW
        && (result.status === 'DONE' || result.status === 'DONE_WITH_CONCERNS')) {
      const effectHop = await next(deps.pool, resolvedRunId);
      await append(deps.pool, {
        runId: resolvedRunId,
        hop: effectHop,
        observed: buildSnapshot(
          observed,
          fullCounters,
          LOG_ACTION.HUMAN_REVIEW_REQUESTED,
          decision.reason,
        ),
        derivedPhase: decision.phase,
        gateVerdict: null,
        action: LOG_ACTION.HUMAN_REVIEW_REQUESTED,
        detail: {
          dispatch_hop: hop,
          result: result.detail ?? null,
          ...humanReviewDetail(observed, decision.reason),
        },
      });
      hops++;
      // effect 已持久化且 snapshot 锚定当前 SHA；从这一刻起人审等待停表。
      deadlinePaused = Boolean(observed.pr?.head_sha);
    }

    if (controlStatus === 'NEEDS_CONTEXT' || controlStatus === 'BLOCKED') {
      const failureClass = result.failure_class ?? null;
      if (controlStatus === 'BLOCKED' && failureClass === 'assembly_fault') {
        const reason = result.fallback_reason ?? 'FROZEN_CONTRACT_ARTIFACT_INVALID';
        await markRunFailed(
          deps,
          resolvedRunId,
          taskId,
          `assembly_fault:${reason}`,
        );
        return { exitReason: 'assembly_fault', hops };
      }
      if (controlStatus === 'BLOCKED' && failureClass === 'impact_contract_invalid') {
        const reason = result.fallback_reason ?? 'impact_gate_error';
        await markRunFailed(
          deps,
          resolvedRunId,
          taskId,
          `impact_gate_deterministic:${reason}`,
        );
        return { exitReason: 'impact_gate_deterministic', hops };
      }
      if (controlStatus === 'BLOCKED' && ['infrastructure_blocked', 'gap_dependencies'].includes(failureClass)) {
        log(
          `[orchestrator] hop ${hop} ${decision.action} → BLOCKED `
          + `(infrastructure backoff): ${result.detail ?? ''}`,
        );
        await beat();
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const currentBlockedStreak = counters.blockedStatus === controlStatus
          && counters.blockedFailureClass === failureClass
        ? counters.blockedStreak
        : 0;
      const streak = currentBlockedStreak + 1; // 本轮实际 streak
      log(`[orchestrator] hop ${hop} ${decision.action} → ${controlStatus} (streak ${streak}): ${result.detail ?? ''}`);
      if (streak >= BLOCKED_SAME_STATE_CAP) {
        await markRunFailed(
          deps,
          resolvedRunId,
          taskId,
          `blocked_same_state:${controlStatus}`,
        );
        return { exitReason: 'blocked_same_state', hops };
      }
    } else {
      // LAUNCHED 只代表外部执行接管；下一轮必须重新 collect callback/inflight 真相。
      // DONE / DONE_WITH_CONCERNS 仅保留给同步控制动作。
      log(`[orchestrator] hop ${hop} ${decision.action} → ${result.status}${result.detail ? `: ${result.detail}` : ''}`);
    }

    // ---- Deadline fence 3：DONE 心跳后检查（崩溃窗口补丁）----
    // INV-K1：三道 fence，防止在 deadline 后派遣下一轮 intent（即使 dispatch 已返回 DONE）
    if (deadlineExceeded(observed.run) && !deadlinePaused) {
      await markRunFailed(deps, resolvedRunId, taskId, 'automation_deadline_exceeded');
      return { exitReason: 'automation_deadline_exceeded', hops };
    }

    await beat();
  }
}
