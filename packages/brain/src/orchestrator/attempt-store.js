/**
 * Harness Attempt authority store.
 *
 * 所有状态写保持单条 SQL 且显式更新 updated_at。migration 367 的数据库 trigger
 * 在同一事务中推进 event_version 并投影 lifecycle event；这里不得双写
 * harness_run_events，也不得把 task_bundle/result/error_message 投影进去。
 */
import { isDeepStrictEqual } from 'node:util';

import { normalizeFailureSignature } from './convergence-signatures.js';
import { ATTEMPT_COST_ACCRUAL_USD, CASE_FILE_TEXT_MAX_BYTES } from './constants.js';
import { insertCaseFileRow } from './case-file-store.js';
import { redactSecrets } from './failure-persistence.js';

const TERMINAL_STATUSES = [
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
];

const SUCCESS_TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
]);

const TERMINAL_SQL = TERMINAL_STATUSES.map((status) => `'${status}'`).join(',');
const DERIVED_TIME_ROLES = new Set(['judge', 'reporter']);

// 权威裁决终态：只有这两个状态代表"角色真的跑完并产出了结果"。
// callbackRoleVerdictProjection（既有）与 callbackCaseFileProjection（案卷式
// GAN）共用同一份白名单——failed/blocked/needs_context/cancelled 即使意外带了
// decision/case_file 字段也不是权威裁决，不能投影进决策日志或案卷。
const ADVERSARIAL_TERMINAL_STATUSES = new Set(['completed', 'completed_with_concerns']);

function callbackGateVerdict(result) {
  switch (result.status) {
    case 'completed':
      return 'allow';
    case 'completed_with_concerns':
      return 'allow:concerns';
    case 'needs_context':
      return 'deny:NEEDS_CONTEXT';
    case 'blocked':
      return 'deny:BLOCKED';
    case 'failed':
      return result.failure_class === 'semantic_refusal'
        ? 'deny:SEMANTIC_REFUSAL'
        : 'deny:FAILED';
    case 'cancelled':
      return 'deny:CANCELLED';
    default:
      throw new Error(`invalid callback terminal status: ${result.status}`);
  }
}

function callbackError(result) {
  if (typeof result.error === 'string') {
    return { code: 'provider_failed', message: result.error };
  }
  return {
    code: result.error?.code ?? null,
    message: result.error?.message ?? null,
  };
}

function callbackEventDetail(attempt, result, leaseGeneration) {
  const failureSignature = normalizeFailureSignature(
    result.failure_signature ?? result.decision?.failure_signature,
  );
  const plannerGitVerification = result.server_verification?.planner_git_artifact;
  return {
    run_id: attempt.run_id,
    attempt_id: attempt.id,
    lease_owner: attempt.lease_owner,
    lease_generation: leaseGeneration,
    role: attempt.role,
    hop: attempt.hop,
    status: result.status,
    summary: result.summary ?? '',
    context_question: result.decision?.reason ?? result.summary ?? null,
    failure_class: result.failure_class ?? null,
    // 合同故障重开 GAN 的路由信号（r40 实证缺口）：derive 需要看到
    // CONTRACT_SELF_CONTRADICTION / CONTRACT_TEST_UNSATISFIABLE 才能把
    // "合同资产自身有 bug"退回 GAN,而不是按笼统 semantic_refusal 死等人工。
    error_code: typeof result.error?.code === 'string'
      ? result.error.code.slice(0, 64)
      : null,
    ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
    artifacts: result.artifacts ?? [],
    ...(plannerGitVerification == null
      ? {}
      : {
          server_verification: {
            planner_git_artifact: plannerGitVerification,
          },
        }),
  };
}

function attemptTaskBundle(attempt) {
  if (attempt?.task_bundle && typeof attempt.task_bundle === 'object') {
    return attempt.task_bundle;
  }
  if (typeof attempt?.task_bundle !== 'string') return {};
  try {
    return JSON.parse(attempt.task_bundle);
  } catch {
    return {};
  }
}

export function normalizeRoleVerdict(role, outcome) {
  const value = String(outcome ?? '').trim().toUpperCase();
  if (role === 'reviewer') {
    return ['PASS', 'APPROVED'].includes(value) ? 'APPROVED' : 'REVISION_REQUESTED';
  }
  if (role === 'evaluator') {
    if (value === 'FIXED') return 'FIXED';
    return ['PASS', 'PASS_WITH_CONCERNS'].includes(value) ? 'PASS' : 'FAIL';
  }
  return value;
}

function callbackRoleVerdictProjection(attempt, result) {
  if (attempt.role === 'commander') {
    if (result.status !== 'completed' || !result.decision) return null;
    return {
      action: 'commander.directive_proposed',
      observed: {
        commander_attempt_id: attempt.id,
        event_cursor: result.decision.event_cursor,
      },
      phase: attempt.phase,
      gateVerdict: null,
      detail: {
        attempt_id: attempt.id,
        directive: result.decision,
      },
    };
  }
  if (!result.decision || !['reviewer', 'evaluator', 'judge'].includes(attempt.role)) return null;
  if (!ADVERSARIAL_TERMINAL_STATUSES.has(result.status)) return null;

  const inputs = attemptTaskBundle(attempt).inputs ?? {};
  const verdict = normalizeRoleVerdict(attempt.role, result.decision.outcome);
  const failureSignature = normalizeFailureSignature(result.decision.failure_signature);
  const targetHeadSha = inputs.pull_request?.head_sha
    ?? inputs.candidate?.head_sha
    ?? inputs.pr_head_sha
    ?? null;
  const detail = attempt.role === 'reviewer'
    ? {
        attempt_id: attempt.id,
        verdict,
        rn: inputs.contract_round ?? null,
        contract_sha: inputs.contract_sha ?? null,
        feedback: result.decision.reason,
      }
    : {
        attempt_id: attempt.id,
        verdict,
        pr_head_sha: targetHeadSha,
        failure_class: result.decision.failure_class ?? null,
        ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
        feedback: result.decision.reason,
      };
  const allowed = ['APPROVED', 'PASS', 'FIXED'].includes(verdict);
  return {
    action: attempt.role === 'reviewer'
      ? 'verdict:reviewer'
      : attempt.role === 'judge'
        ? 'verdict:judge'
        : 'verdict:evaluate',
    observed: { attempt_id: attempt.id, role: attempt.role },
    phase: attempt.role === 'reviewer' ? 'gan' : 'evaluate',
    gateVerdict: allowed ? 'allow' : `deny:${verdict.toLowerCase()}`,
    detail,
  };
}

const CASE_FILE_ROLES = new Set(['proposer', 'reviewer']);

/**
 * 案卷行的 round：主来源是 dispatcher.buildInputs 写入的 task_bundle.inputs.
 * contract_round（proposer=正在推进的下一轮，reviewer=正在评审的当轮——两者
 * dispatcher 都会写，见 dispatcher.js buildInputs 的 proposer/reviewer 分支）。
 * 只有历史/损坏 TaskBundle 缺该字段这种边缘情况才退化读 result.decision.
 * contract_round 兜底；两处都没有就放弃写入——round 是 NOT NULL 列，不能用
 * 猜测值填一条残缺案卷行。
 *
 * P2-2：不再读 result.case_file?.round——caseFileSchema（execution-contract.js）
 * 从未声明过这个字段，callback 路由在这里之前已经跑过 parseHarnessResult，
 * 未声明字段会被 zod 静默 strip，读它是不可达死码。
 */
function caseFileRoundForAttempt(attempt, result) {
  const inputs = attemptTaskBundle(attempt).inputs ?? {};
  if (Number.isInteger(inputs.contract_round)) return inputs.contract_round;
  const resultRound = result.decision?.contract_round;
  return Number.isInteger(resultRound) ? resultRound : null;
}

function hasUsableOutcome(decision) {
  const outcome = decision?.outcome ?? decision?.verdict;
  return typeof outcome === 'string' && outcome.trim().length > 0;
}

/**
 * P3-5：decision.rubric_scores 的 zod schema 放宽为 record(unknown)（不再对
 * 非数值项 400 拒绝整个 callback），过滤到只留 number 项挪到这里——落库前
 * 的最后一道关卡，不是 transport 校验的职责。全部过滤掉后返回 null（等价于
 * "没有可用分数"），不落一个空对象。
 */
function numericRubricScores(rubricScores) {
  if (!rubricScores || typeof rubricScores !== 'object') return null;
  const numeric = Object.fromEntries(
    Object.entries(rubricScores).filter(
      ([, value]) => typeof value === 'number' && Number.isFinite(value),
    ),
  );
  return Object.keys(numeric).length > 0 ? numeric : null;
}

/**
 * P2-4（review CHANGES REQUESTED 复审修正）：feedback_md/blockers 是自由
 * 文本，可能被 Skill 意外带出日志片段里的 secret（Bearer token 等）——落库
 * 前只脱敏，不套用 sanitizeDiagnostic 那套"折叠成一行 + 砍到 2000 字符"
 * （那是给诊断日志用的，会砸烂设计里"feedback_md=完整反馈原文"这条不变量，
 * 且让 P2-3 的两道膨胀闸——loadCaseFile fullTextRounds 与 dispatcher 字节数
 * 体检——在生产环境永远摸不到真实输入，因为落库时就已经被砍到 2000）。
 * 改用只做 secret 脱敏的 redactSecrets，配一个远大于正常反馈的硬上限
 * CASE_FILE_TEXT_MAX_BYTES（32KB）兜极端输入，不折行。blockers 形状因角色
 * 而异（reviewer 带 why_not_found_earlier/prd_gap，proposer 带 closure），
 * 深度遍历所有字符串叶子值，不假设固定字段名。
 */
function sanitizeCaseFileValue(value) {
  if (typeof value === 'string') {
    return redactSecrets(value).slice(0, CASE_FILE_TEXT_MAX_BYTES);
  }
  if (Array.isArray(value)) return value.map(sanitizeCaseFileValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeCaseFileValue(entry)]),
    );
  }
  return value;
}

/**
 * 案卷式 GAN（issue ce42f68f）：proposer/reviewer 的权威终态（completed/
 * completed_with_concerns——与 ADVERSARIAL_TERMINAL_STATUSES 一致）才投影一行
 * gan_case_file。
 *
 * P1（review CHANGES REQUESTED）：触发条件从"随便带个 case_file 或 decision"
 * 收紧为"有结构化 case_file，或 reviewer 且 decision 带可用 outcome"——
 * ①失败/被否决的 attempt 不该抢占 (run_id, round, author_role) 槽位：如果
 * failed/blocked 的 attempt 先写了一行空案卷，后面真正跑完的权威 attempt
 * 撞 ON CONFLICT DO NOTHING 会被静默丢弃（同 rn 重派 + force-push 场景）；
 * 终态白名单已经堵掉大部分这类场景，这里再收紧触发条件是双重保险。
 * ②proposer 没有 case_file 就没有可落的内容——proposer 的 decision 不是
 * 必填字段、语义上也不代表"案卷"（proposer 的案卷内容是 case_file.blockers
 * 里的 closure 声明），不再对"proposer 随便带个 decision"就落一行空案卷。
 */
function callbackCaseFileProjection(attempt, result) {
  if (!CASE_FILE_ROLES.has(attempt.role)) return null;
  if (!ADVERSARIAL_TERMINAL_STATUSES.has(result.status)) return null;
  const hasCaseFile = Boolean(result.case_file);
  const hasUsableReviewerDecision = attempt.role === 'reviewer' && hasUsableOutcome(result.decision);
  if (!hasCaseFile && !hasUsableReviewerDecision) return null;
  const round = caseFileRoundForAttempt(attempt, result);
  if (round == null) return null;
  const inputs = attemptTaskBundle(attempt).inputs ?? {};
  const feedbackMd = result.case_file?.feedback_md;
  const rubricScores = numericRubricScores(result.decision?.rubric_scores);
  const blockers = sanitizeCaseFileValue(result.case_file?.blockers ?? []);
  // 空壳案卷哨兵（r36 实证）：案卷是 GAN 收敛机制的命脉——下一轮 reviewer 靠它
  // 才知道上轮提过什么、该复核哪些。三项全空说明 provider 侧根本没吐案卷
  // （2026-08-05 根因：runner structured-output schema 用 additionalProperties:
  // false 把 case_file / decision.rubric_scores 硬性禁掉），案卷连写空壳、每轮
  // 零记忆重审、GAN 打地鼠不收敛，而 zod 里两字段是 optional 所以全程零报错。
  // 静默是这个 bug 潜伏至今的唯一原因，这里必须喊出来。
  if (blockers.length === 0 && feedbackMd == null && rubricScores == null) {
    console.warn(
      `[attempt-store][case_file_empty] run=${attempt.run_id} round=${round} `
      + `role=${attempt.role} attempt=${attempt.id} —— 案卷三项全空，`
      + 'provider 未输出 case_file/rubric_scores，GAN 跨轮记忆断链、无法收敛',
    );
  }
  return {
    runId: attempt.run_id,
    round,
    authorRole: attempt.role,
    attemptId: attempt.id,
    contractSha: inputs.contract_sha ?? null,
    rubricScores,
    blockers,
    feedbackMd: feedbackMd == null ? null : sanitizeCaseFileValue(feedbackMd),
  };
}

function verifiedPullRequestArtifact(attempt, result) {
  if (attempt.role !== 'publisher') return null;
  return (result.artifacts ?? []).find((artifact) => (
    artifact?.type === 'pull_request'
    && artifact.verification_status === 'verified'
    && typeof artifact.url === 'string'
    && typeof artifact.head_sha === 'string'
  )) ?? null;
}

function verifiedGeneratorCandidateArtifact(attempt, result) {
  if (attempt.role !== 'generator') return null;
  const workspace = attemptTaskBundle(attempt).inputs?.workspace_spec;
  if (!workspace || typeof workspace !== 'object') return null;
  return (result.artifacts ?? []).find((artifact) => (
    artifact?.type === 'git_candidate'
    && artifact.verification_status === 'verified'
    && artifact.source_attempt_id === attempt.id
    && artifact.repo === workspace.repo
    && artifact.branch === workspace.branch
    && artifact.base_sha === workspace.base_sha
    && artifact.machine_id === attempt.actual_machine_id
    && /^[0-9a-f]{40}$/.test(artifact.base_sha ?? '')
    && /^[0-9a-f]{40}$/.test(artifact.head_sha ?? '')
    && artifact.base_sha !== artifact.head_sha
  )) ?? null;
}

async function appendGeneratorFixProjection(client, attempt, result, candidate) {
  if (attempt.role !== 'generator' || candidate == null) return;
  if (!['completed', 'completed_with_concerns'].includes(result.status)) return;

  const context = firstRow(await client.query(
    `SELECT observed->>'trigger_sha' AS trigger_sha
       FROM orchestrator_decision_log
      WHERE run_id=$1::uuid
        AND hop=$2
        AND action='spawn:generator-fix'
      LIMIT 1`,
    [attempt.run_id, attempt.hop],
  ));
  if (!context) return;

  const observed = {
    attempt_id: attempt.id,
    trigger_hop: attempt.hop,
    pr_head_sha: candidate.head_sha,
    provider: result.provider_metadata?.provider ?? attempt.provider ?? null,
  };
  const detail = {
    attempt_id: attempt.id,
    pr_head_sha: candidate.head_sha,
    status: result.status,
    verification_status: 'verified',
    trigger_sha: context.trigger_sha ?? null,
  };
  await client.query(
    `WITH next_hop AS (
       SELECT COALESCE(MAX(hop), 0) + 1 AS hop
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid
     )
     INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     SELECT $1::uuid, next_hop.hop, $2::jsonb, 'generate', 'allow',
            'verdict:generator-fix-callback', $3::jsonb
       FROM next_hop
      WHERE NOT EXISTS (
        SELECT 1
          FROM orchestrator_decision_log
         WHERE run_id=$1::uuid
           AND action='verdict:generator-fix-callback'
           AND detail->>'attempt_id'=$4::text
      )
     RETURNING hop`,
    [
      attempt.run_id,
      JSON.stringify(observed),
      JSON.stringify(detail),
      attempt.id,
    ],
  );
}

function firstRow(queryResult) {
  return queryResult.rows?.[0] ?? null;
}

const CREATE_ATTEMPT_WINNER_READ_ATTEMPTS = 3;
const CREATE_ATTEMPT_WINNER_READ_DELAY_MS = 5;

async function readConcurrentAttemptWinner(pool, runId, hop) {
  for (let attempt = 0; attempt < CREATE_ATTEMPT_WINNER_READ_ATTEMPTS; attempt += 1) {
    const winner = firstRow(await pool.query(
      `SELECT attempt.*
         FROM harness_attempts attempt
         JOIN initiative_runs run
           ON run.id = attempt.run_id
          AND run.orchestrator_version = 'v2'
          AND run.phase NOT IN ('done','failed')
        WHERE attempt.run_id=$1
          AND attempt.hop=$2
        FOR KEY SHARE OF run`,
      [runId, hop],
    ));
    if (winner) return winner;
    if (attempt + 1 < CREATE_ATTEMPT_WINNER_READ_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, CREATE_ATTEMPT_WINNER_READ_DELAY_MS));
    }
  }
  return null;
}

export function createAttemptStore(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createAttemptStore requires a PostgreSQL pool');
  }

  return Object.freeze({
    async createAttempt(input) {
      const skill = input.bundle?.skill ?? null;
      const result = await pool.query(
        `WITH guarded_run AS (
           SELECT run.id, run.map_recovery_contract_id
             FROM initiative_runs run
            WHERE run.id = $2
              AND run.orchestrator_version = 'v2'
              AND run.phase NOT IN ('done','failed')
              AND (
                run.map_recovery_contract_id IS NULL
                OR (
                  $5 = 'generator'
                  AND (
                    NOT EXISTS (
                      SELECT 1
                        FROM map_recovery_consumptions consumption
                       WHERE consumption.contract_id = run.map_recovery_contract_id
                    )
                    OR EXISTS (
                      SELECT 1
                        FROM map_recovery_consumptions consumption
                        JOIN harness_attempts existing
                          ON consumption.attempt_id = existing.id
                       WHERE consumption.contract_id = run.map_recovery_contract_id
                         AND existing.run_id = run.id
                         AND existing.hop = $3
                    )
                  )
                )
              )
            FOR KEY SHARE OF run
         ),
         inserted AS (
           INSERT INTO harness_attempts (
             id, run_id, hop, phase, role, provider, account_id, machine_id,
             requested_machine_id, local_container_naming,
             skill_name, skill_version, skill_digest, task_bundle,
             callback_secret_hash, logical_cycle_id, attempt_kind, retry_of_attempt_id,
             restart_reason, workstream_key, time_derived
           )
           SELECT
             $1, guarded_run.id, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             $15,$16,$17,$18,$19,$20,$21
             FROM guarded_run
           ON CONFLICT (run_id, hop) DO NOTHING
           RETURNING *
         ), consumed AS (
           INSERT INTO map_recovery_consumptions (contract_id, attempt_id)
           SELECT guarded_run.map_recovery_contract_id, inserted.id
             FROM inserted
             JOIN guarded_run ON guarded_run.id = inserted.run_id
            WHERE guarded_run.map_recovery_contract_id IS NOT NULL
              AND $5 = 'generator'
           RETURNING contract_id, attempt_id
         )
         SELECT * FROM inserted
         UNION ALL
         SELECT attempt.*
           FROM harness_attempts attempt
           JOIN guarded_run ON guarded_run.id = attempt.run_id
          WHERE attempt.hop=$3
         LIMIT 1`,
        [
          input.id,
          input.runId,
          input.hop,
          input.phase,
          input.role,
          input.provider ?? 'auto',
          input.accountId ?? null,
          input.machineId ?? null,
          input.machineId ?? null,
          'generation-v1',
          skill?.name ?? null,
          skill?.version ?? null,
          skill?.digest ?? null,
          input.bundle,
          input.callbackSecretHash,
          input.logicalCycleId ?? `intent:${input.runId}:${input.hop}`,
          input.attemptKind ?? 'initial',
          input.retryOfAttemptId ?? null,
          input.restartReason ?? null,
          input.workstreamKey ?? 'ws1',
          input.timeDerived ?? DERIVED_TIME_ROLES.has(input.role),
        ],
      );
      const winner = firstRow(result)
        ?? await readConcurrentAttemptWinner(pool, input.runId, input.hop);
      if (!winner) {
        throw new Error(`Kernel run is terminal or missing: ${input.runId}`);
      }
      return winner;
    },

    async markStarting(id, { leaseOwner, leaseSeconds }) {
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = 'starting',
                lease_owner = $2,
                lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
                started_at = COALESCE(started_at, NOW()),
                updated_at = NOW()
          WHERE id = $1 AND status = 'queued'
          RETURNING *`,
        [id, leaseOwner, leaseSeconds],
      );
      return firstRow(result);
    },

    async markRunning(id, {
      leaseOwner,
      leaseGeneration,
      providerSessionId,
      leaseSeconds,
    }) {
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('markRunning requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = 'running',
                provider_session_id = $4,
                lease_expires_at = NOW() + ($5 * INTERVAL '1 second'),
                heartbeat_at = NOW(),
                started_at = COALESCE(started_at, NOW()),
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND lease_generation = $3
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, leaseGeneration, providerSessionId, leaseSeconds],
      );
      return firstRow(result);
    },

    async heartbeat(id, { leaseOwner, leaseGeneration, leaseSeconds }) {
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('heartbeat requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET heartbeat_at = NOW(),
                lease_expires_at = NOW() + ($4 * INTERVAL '1 second'),
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND lease_generation = $3
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, leaseGeneration, leaseSeconds],
      );
      return firstRow(result);
    },

    async recordLaunchReceipt(id, {
      leaseOwner,
      leaseGeneration,
      actualMachineId,
      executionTransport,
      remoteJobId = null,
      attestationStatus,
    }) {
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('recordLaunchReceipt requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET actual_machine_id = $3,
                execution_transport = $4,
                remote_job_id = $5,
                machine_attestation_status = $6,
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND lease_generation = $7
            AND status IN ('starting','running')
          RETURNING *`,
        [
          id,
          leaseOwner,
          actualMachineId,
          executionTransport,
          remoteJobId,
          attestationStatus,
          leaseGeneration,
        ],
      );
      return firstRow(result);
    },

    async reclaim(id, { leaseOwner, leaseSeconds }) {
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = 'starting',
                lease_owner = $2,
                lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
                lease_generation = lease_generation + 1,
                updated_at = NOW()
          WHERE id = $1
            AND status IN ('starting','running')
            AND lease_expires_at < NOW()
          RETURNING *`,
        [id, leaseOwner, leaseSeconds],
      );
      return firstRow(result);
    },

    async rotateCallbackSecret(id, {
      leaseOwner,
      leaseGeneration,
      callbackSecretHash,
    }) {
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('rotateCallbackSecret requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET callback_secret_hash = $3,
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND lease_generation = $4
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, callbackSecretHash, leaseGeneration],
      );
      return firstRow(result);
    },

    async complete(id, resultPayload, { leaseOwner = null } = {}) {
      if (!SUCCESS_TERMINAL_STATUSES.has(resultPayload?.status)) {
        throw new Error(`invalid successful terminal status: ${resultPayload?.status}`);
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = $2,
                result = $3,
                provider_session_id = COALESCE($4, provider_session_id),
                failure_class = $5,
                completed_at = NOW(),
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status NOT IN (${TERMINAL_SQL})
            AND ($6::text IS NULL OR lease_owner = $6)
          RETURNING *`,
        [
          id,
          resultPayload.status,
          resultPayload,
          resultPayload.provider_metadata?.session_id ?? null,
          resultPayload.failure_class ?? null,
          leaseOwner,
        ],
      );
      const attempt = firstRow(result);
      return { attempt, deduped: attempt === null };
    },

    async fail(
      id,
      { code, message, status = 'failed', failureClass = null },
      { leaseOwner = null, leaseGeneration = null } = {},
    ) {
      if (!['failed', 'cancelled'].includes(status)) {
        throw new Error(`invalid failure status: ${status}`);
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = $2,
                error_code = $3,
                error_message = $4,
                failure_class = $5,
                completed_at = NOW(),
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status NOT IN (${TERMINAL_SQL})
            AND ($6::text IS NULL OR lease_owner = $6)
            AND ($7::integer IS NULL OR lease_generation = $7)
          RETURNING *`,
        [
          id,
          status,
          code ?? null,
          message ?? null,
          failureClass,
          leaseOwner,
          leaseGeneration,
        ],
      );
      const attempt = firstRow(result);
      return { attempt, deduped: attempt === null };
    },

    /**
     * Authoritative callback boundary. The Attempt terminal projection and the
     * append-only callback event either commit together or not at all.
     */
    async recordCallbackTerminal({
      attemptId,
      runId,
      leaseOwner,
      leaseGeneration,
      result,
      beforeCommit = null,
    }) {
      if (typeof pool.connect !== 'function') {
        throw new Error('recordCallbackTerminal requires a transactional PostgreSQL pool');
      }
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('recordCallbackTerminal requires leaseGeneration');
      }
      const gateVerdict = callbackGateVerdict(result);
      const client = await pool.connect();
      let transactionOpen = false;
      const rollbackConflict = async (conflict) => {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { attempt: null, deduped: false, conflict };
      };
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const attempt = firstRow(await client.query(
          `WITH decision_lock AS MATERIALIZED (
             SELECT pg_advisory_xact_lock(hashtext($2::text)) AS locked
           ),
           locked_run AS MATERIALIZED (
             SELECT run.id, run.phase
               FROM decision_lock
               JOIN initiative_runs run ON run.id=$2::uuid
              WHERE run.orchestrator_version='v2'
              FOR UPDATE OF run
           )
           SELECT attempt.*, locked_run.phase AS run_phase
             FROM locked_run
             JOIN harness_attempts attempt
               ON attempt.run_id=locked_run.id
            WHERE attempt.id=$1
            FOR UPDATE OF attempt`,
          [attemptId, runId],
        ));
        if (!attempt) return await rollbackConflict('attempt_identity_mismatch');
        if (attempt.lease_owner !== leaseOwner) {
          return await rollbackConflict('lease_owner_mismatch');
        }
        if (attempt.lease_generation !== leaseGeneration) {
          return await rollbackConflict('lease_generation_mismatch');
        }

        const isTerminal = TERMINAL_STATUSES.includes(attempt.status);
        const exactDuplicate = isTerminal
          && attempt.status === result.status
          && isDeepStrictEqual(attempt.result, result);
        if (
          ['done', 'failed'].includes(attempt.run_phase)
          && !isTerminal
        ) {
          return await rollbackConflict('parent_run_terminal');
        }
        if (isTerminal && !exactDuplicate) {
          return await rollbackConflict('terminal_payload_conflict');
        }

        let terminalAttempt = attempt;
        if (!isTerminal) {
          const error = callbackError(result);
          terminalAttempt = firstRow(await client.query(
            `UPDATE harness_attempts
                SET status=$5,
                    result=$6::jsonb,
                    provider_session_id=COALESCE($7, provider_session_id),
                    failure_class=$8,
                    error_code=$9,
                    error_message=$10,
                    completed_at=NOW(),
                    lease_expires_at=NULL,
                    updated_at=NOW()
              WHERE id=$1
                AND run_id=$2
                AND lease_owner=$3
                AND lease_generation=$4
                AND status NOT IN (${TERMINAL_SQL})
              RETURNING *`,
            [
              attemptId,
              runId,
              leaseOwner,
              leaseGeneration,
              result.status,
              JSON.stringify(result),
              result.provider_metadata?.session_id ?? null,
              result.failure_class ?? null,
              error.code,
              error.message,
            ],
          ));
          if (!terminalAttempt) {
            return await rollbackConflict('attempt_changed_before_terminal_write');
          }
        }

        const detail = callbackEventDetail(terminalAttempt, result, leaseGeneration);
        await client.query(
          `WITH next_hop AS (
             SELECT COALESCE(MAX(hop), 0) + 1 AS hop
               FROM orchestrator_decision_log
              WHERE run_id=$1::uuid
           )
           INSERT INTO orchestrator_decision_log
             (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
           SELECT $1::uuid, next_hop.hop, $2::jsonb, $3, $4,
                  'verdict:attempt_callback', $5::jsonb
             FROM next_hop
            WHERE NOT EXISTS (
              SELECT 1
                FROM orchestrator_decision_log
               WHERE run_id=$1::uuid
                 AND action='verdict:attempt_callback'
                 AND detail->>'attempt_id'=$6::text
            )
           RETURNING hop`,
          [
            runId,
            JSON.stringify({
              attempt_id: attemptId,
              role: terminalAttempt.role,
              status: result.status,
            }),
            terminalAttempt.phase,
            gateVerdict,
            JSON.stringify(detail),
            attemptId,
          ],
        );

        // All role-specific projections were committed with the first terminal
        // write. An exact retry only confirms the generic callback receipt; it
        // must never replay mutable projections into a run that advanced.
        if (!isTerminal) {
          const roleProjection = callbackRoleVerdictProjection(terminalAttempt, result);
          if (roleProjection) {
            await client.query(
              `WITH next_hop AS (
                 SELECT COALESCE(MAX(hop), 0) + 1 AS hop
                   FROM orchestrator_decision_log
                  WHERE run_id=$1::uuid
               )
               INSERT INTO orchestrator_decision_log
                 (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
               SELECT $1::uuid, next_hop.hop, $2::jsonb, $3, $4, $5, $6::jsonb
                 FROM next_hop
                WHERE NOT EXISTS (
                  SELECT 1
                    FROM orchestrator_decision_log
                   WHERE run_id=$1::uuid
                     AND action=$5
                     AND detail->>'attempt_id'=$7::text
                )
               RETURNING hop`,
              [
                runId,
                JSON.stringify(roleProjection.observed),
                roleProjection.phase,
                roleProjection.gateVerdict,
                roleProjection.action,
                JSON.stringify(roleProjection.detail),
                attemptId,
              ],
            );
          }

          // 案卷式 GAN：对 gan_case_file 的 INSERT 不受"同 run 行只允许一条
          // UPDATE"死锁定律约束（那条定律只管 initiative_runs 行的 UPDATE 排队，
          // 见下方 pr_url/cost_usd 投影注释）——这里插入的是新表新行。
          const caseFileProjection = callbackCaseFileProjection(terminalAttempt, result);
          if (caseFileProjection) {
            await insertCaseFileRow(client, caseFileProjection);
          }

          const pullRequest = verifiedPullRequestArtifact(terminalAttempt, result);
          const generatorCandidate = verifiedGeneratorCandidateArtifact(terminalAttempt, result);
          await appendGeneratorFixProjection(
            client,
            terminalAttempt,
            result,
            generatorCandidate,
          );

          // GAN budget cap 的唯一记账来源（决策 fbb0bc9d）：首次终态即累加固定单价。
          // exact-retry 走 isTerminal 早退不重复记账。
          // 死锁约束：本事务对同一 run 行只允许一条 UPDATE——已有 FOR UPDATE 等锁者
          // 排队时，第二条 UPDATE 需重新竞争 heavyweight tuple lock 会与排队者互等
          // （40P01，kernel-stale-attempt-reconcile.pg.integration 实证），因此
          // pr_url 投影与成本记账合并为单条语句。
          if (pullRequest) {
            const projection = await client.query(
              `UPDATE initiative_runs
                  SET pr_url=$2,
                      cost_usd = COALESCE(cost_usd, 0) + $3,
                      updated_at=NOW()
                WHERE id=$1
                  AND phase NOT IN ('done', 'failed')
                RETURNING id`,
              [runId, pullRequest.url, ATTEMPT_COST_ACCRUAL_USD],
            );
            if (!firstRow(projection)) {
              throw new Error(`generator PR projection lost run authority: ${runId}`);
            }
          } else {
            await client.query(
              `UPDATE initiative_runs
                  SET cost_usd = COALESCE(cost_usd, 0) + $2,
                      updated_at = NOW()
                WHERE id = $1`,
              [runId, ATTEMPT_COST_ACCRUAL_USD],
            );
          }

          if (typeof beforeCommit === 'function') {
            await beforeCommit(client, { attempt: terminalAttempt, result });
          }
        }

        await client.query('COMMIT');
        transactionOpen = false;
        return { attempt: terminalAttempt, deduped: exactDuplicate };
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // Preserve the authoritative persistence failure.
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async getById(id) {
      return firstRow(await pool.query('SELECT * FROM harness_attempts WHERE id=$1', [id]));
    },

    async getByRunHop(runId, hop) {
      return firstRow(await pool.query(
        'SELECT * FROM harness_attempts WHERE run_id=$1 AND hop=$2',
        [runId, hop],
      ));
    },

    async getLatestCommanderAttempt(runId) {
      return firstRow(await pool.query(
        `SELECT id,run_id,hop,phase,role,provider,account_id,
                machine_id,requested_machine_id,actual_machine_id,
                task_bundle,result,status,provider_session_id,
                failure_class,error_code,logical_cycle_id,attempt_kind,
                retry_of_attempt_id,restart_reason,workstream_key,
                created_at,updated_at,completed_at
           FROM harness_attempts
          WHERE run_id=$1
            AND role='commander'
          ORDER BY hop DESC
          LIMIT 1`,
        [runId],
      ));
    },

    async listCommanderFailoverLineage(runId, logicalCycleId) {
      const result = await pool.query(
        `SELECT id,run_id,hop,provider,account_id,requested_machine_id,
                actual_machine_id,status,failure_class,error_code,
                logical_cycle_id,attempt_kind,retry_of_attempt_id,
                restart_reason,created_at,completed_at
           FROM harness_attempts
          WHERE run_id=$1
            AND role='commander'
            AND logical_cycle_id=$2
          ORDER BY hop ASC`,
        [runId, logicalCycleId],
      );
      return result.rows;
    },

    async listFailedExecutionTargets(runId, role) {
      const result = await pool.query(
        `SELECT provider, account_id, requested_machine_id
           FROM harness_attempts
          WHERE run_id=$1
            AND role=$2
            AND (
              status IN ('failed','cancelled')
              OR (status='blocked' AND failure_class='infrastructure_blocked')
            )
            AND (
              error_code IS NULL
              OR error_code NOT IN (
                'worker_attempt_missing_after_lease',
                'worker_attempt_replacement_required_after_lease'
              )
            )
          ORDER BY hop`,
        [runId, role],
      );
      return result.rows.map((row) => ({
        provider: row.provider,
        account: row.account_id,
        machine: row.requested_machine_id,
      }));
    },

    async assertFreshRoleSession({ runId, attemptId, role, sessionId }) {
      if (!sessionId) throw new Error('sessionId is required for isolation check');
      const result = await pool.query(
        `SELECT id, role, provider_session_id
           FROM harness_attempts
          WHERE run_id=$1 AND provider_session_id=$2`,
        [runId, sessionId],
      );
      for (const existing of result.rows ?? []) {
        if (existing.id === attemptId) continue;
        if (existing.role !== role) {
          throw new Error(
            `role_session_reuse: ${role} cannot reuse ${existing.role} session ${sessionId}`,
          );
        }
        throw new Error(
          `cross_attempt_session_reuse: attempt ${attemptId} cannot reuse session from ${existing.id}`,
        );
      }
      return true;
    },
  });
}

export const __test__ = {
  TERMINAL_STATUSES,
  SUCCESS_TERMINAL_STATUSES,
  DERIVED_TIME_ROLES,
};
