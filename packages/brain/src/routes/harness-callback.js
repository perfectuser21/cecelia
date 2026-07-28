/**
 * Harness Callback 路由 — LangGraph 修正 Sprint Stream 1
 *
 * Spec: docs/superpowers/specs/2026-05-08-langgraph-fix-callback-router.md
 *
 * 端点：
 *   POST /api/brain/harness/callback/:containerId
 *
 * 用途：cecelia-runner 容器跑完任务后 POST callback 到这里，本路由
 *   1) 用 containerId 反查 thread_id（lookupHarnessThread）
 *   2) `compiledGraph.invoke(new Command({resume: {result, error, exit_code, stdout}}),
 *       { configurable: { thread_id } })` 唤回 LangGraph
 *   3) 返回 200 表示已发起 resume；找不到 thread → 404；resume 抛错 → 500
 *
 * 幂等去重（P0 修复，2026-06-11）：
 *   现场（task ed860936）抓到 GAN proposer 节点被并发 spawn 5 个容器。根因：
 *   - runner(docker/cecelia-runner/entrypoint.sh) 对本回调用 `curl -m 10` + 5 次重试。
 *   - 本路由【同步】`await compiledGraph.invoke(resume)`，而 GAN proposer 是阻塞节点(B44)，
 *     spawn 容器后 await 数分钟才返回 → HTTP 10s 内无响应 → curl 超时 → runner 重试。
 *   - 本路由无幂等 → 每次重试都在【同一 thread_id】发起一次新的并发 resume → 每次都跑
 *     proposer 节点 spawn 一个相同 env 的容器（5 次重试 = 5 个并发容器，间隔 ~13-22s）。
 *   修复：每个 containerId 的回调最多 resume 一次。进程内 claim（Node 单线程，has()->set()
 *   之间无 await，check-and-set 原子，可挡并发重试）。重复回调直接 200 ack，不再 invoke。
 *   注：claim 是进程内态，curl 重试风暴是同进程内 ~70s 的事件，完全覆盖；Brain 重启后的
 *   resume 走 startup-sync checkpoint 路径（与 containerId 回调无关），不在本修复范围。
 */

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Command } from '@langchain/langgraph';
import { lookupHarnessThread } from '../lib/harness-thread-lookup.js';
import { sendBark } from '../notifier.js';
import pool from '../db.js';
import { handleRelayExitConsistency } from '../lib/harness-orphan-guard.js';
import { createAttemptStore } from '../orchestrator/attempt-store.js';
import { parseHarnessResult } from '../orchestrator/execution-contract.js';
import { verifyCallbackSecret } from '../orchestrator/callback-auth.js';
import { verifyMachineAttestation } from '../orchestrator/machine-attestation.js';
import {
  defaultPrHeadResolver,
  normalizeGitSha,
} from '../orchestrator/pr-head-resolver.js';
import { normalizeFailureSignature } from '../orchestrator/convergence-signatures.js';

const router = Router();
const SUCCESS_TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
]);
const FAILURE_TERMINAL_STATUSES = new Set(['failed', 'cancelled']);
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FLEET_CODEX_METADATA_FIELDS = new Set([
  'provider',
  'session_id',
  'credential_ref',
  'credential_copy_mutated',
]);

function createAttemptCallbackRateLimit({ limit, identifier }) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    keyGenerator: (req) => req.params.attemptId,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    identifier,
    message: { ok: false, error: 'attempt callback rate limit exceeded' },
  });
}

const heartbeatRateLimit = createAttemptCallbackRateLimit({
  limit: 30,
  identifier: 'harness-attempt-heartbeat',
});
const callbackRateLimit = createAttemptCallbackRateLimit({
  limit: 10,
  identifier: 'harness-attempt-callback',
});

function bearerToken(req) {
  const authorization = req.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

function callbackAuthorized(req, attempt) {
  return verifyCallbackSecret(bearerToken(req), attempt?.callback_secret_hash);
}

function requestDatabase(req) {
  return req.app.get('pool') || pool;
}

function attemptExpectedOutput(attempt) {
  const value = attempt?.task_bundle;
  if (value && typeof value === 'object') return value.expected_output ?? null;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value)?.expected_output ?? null;
  } catch {
    return null;
  }
}

function attemptAuthority(attempt) {
  const value = attempt?.task_bundle;
  let bundle = null;
  if (value && typeof value === 'object') {
    bundle = value;
  } else if (typeof value === 'string') {
    try {
      bundle = JSON.parse(value);
    } catch {
      bundle = null;
    }
  }
  const inputs = bundle?.inputs ?? {};
  const taskPullRequest = inputs.pull_request && typeof inputs.pull_request === 'object'
    ? inputs.pull_request
    : {};
  const pullRequest = {
    type: 'pull_request',
    url: taskPullRequest.url ?? inputs.pr_url ?? null,
    number: taskPullRequest.number ?? null,
    head_ref: inputs.pr_branch ?? taskPullRequest.head_ref ?? null,
    head_sha: inputs.pr_head_sha ?? taskPullRequest.head_sha ?? null,
    state: taskPullRequest.state ?? null,
  };
  const commanderCursor = inputs.commander_bundle?.event_cursor;
  return {
    taskId: inputs.task_id ?? null,
    attemptId: attempt?.id ?? null,
    runId: attempt?.run_id ?? null,
    eventCursor: Number.isSafeInteger(commanderCursor) && commanderCursor >= 0
      ? commanderCursor
      : undefined,
    sprintDir: inputs.sprint_dir ?? null,
    proposerBranch: inputs.propose_branch ?? null,
    contractSha: inputs.contract_sha ?? null,
    attemptKind: inputs.attempt_kind ?? null,
    pullRequest,
    workspaceExpectedHeadSha: inputs.workspace_spec?.expected_head_sha ?? null,
  };
}

function normalizeVerdict(role, outcome) {
  const value = String(outcome ?? '').trim().toUpperCase();
  if (role === 'reviewer') {
    return ['PASS', 'APPROVED'].includes(value) ? 'APPROVED' : 'REVISION_REQUESTED';
  }
  if (role === 'evaluator') {
    return value === 'FIXED' ? 'FIXED' : (value === 'PASS' ? 'PASS' : 'FAIL');
  }
  return value;
}

export async function appendAttemptVerdict(attempt, result, db = pool) {
  if (!result.decision || !['reviewer', 'evaluator'].includes(attempt.role)) return;
  if (!['completed', 'completed_with_concerns'].includes(result.status)) return;

  const action = attempt.role === 'reviewer' ? 'verdict:reviewer' : 'verdict:evaluate';
  const inputs = attempt.task_bundle?.inputs ?? {};
  const failureSignature = normalizeFailureSignature(result.decision.failure_signature);
  const detail = attempt.role === 'reviewer'
    ? {
        attempt_id: attempt.id,
        verdict: normalizeVerdict(attempt.role, result.decision.outcome),
        rn: inputs.contract_round ?? null,
        contract_sha: inputs.contract_sha ?? null,
        feedback: result.decision.reason,
      }
    : {
        attempt_id: attempt.id,
        verdict: normalizeVerdict(attempt.role, result.decision.outcome),
        pr_head_sha: inputs.pull_request?.head_sha ?? null,
        failure_class: result.decision.failure_class ?? null,
        ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
        feedback: result.decision.reason,
      };

  // One statement + transaction-scoped advisory lock makes callback retries/concurrency
  // idempotent without adding a second mutable verdict table.
  await db.query(
    `WITH lock AS (
       SELECT pg_advisory_xact_lock(hashtext($1::text))
     ), next_hop AS (
       SELECT COALESCE(MAX(hop), 0) + 1 AS hop
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid
     )
     INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     SELECT $1::uuid, next_hop.hop, $2::jsonb, $3, $4, '${action}', $5::jsonb
       FROM lock, next_hop
      WHERE NOT EXISTS (
        SELECT 1 FROM orchestrator_decision_log
         WHERE run_id=$1::uuid AND detail->>'attempt_id'=$6::text
      )`,
    [
      attempt.run_id,
      JSON.stringify({ attempt_id: attempt.id, role: attempt.role }),
      attempt.role === 'reviewer' ? 'gan' : 'evaluate',
      detail.verdict === 'APPROVED' || detail.verdict === 'PASS' || detail.verdict === 'FIXED'
        ? 'allow'
        : `deny:${detail.verdict.toLowerCase()}`,
      JSON.stringify(detail),
      attempt.id,
    ],
  );
}

export async function appendCommanderProposal(attempt, result, db = pool) {
  if (attempt.role !== 'commander') return;
  if (result.status !== 'completed' || !result.decision) return;
  await db.query(
    `WITH lock AS (
       SELECT pg_advisory_xact_lock(hashtext($1::text))
     ), next_hop AS (
       SELECT COALESCE(MAX(hop), 0) + 1 AS hop
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid
     )
     INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     SELECT $1::uuid, next_hop.hop, $2::jsonb, $3, NULL,
            'commander.directive_proposed', $4::jsonb
       FROM lock, next_hop
      WHERE NOT EXISTS (
        SELECT 1
          FROM orchestrator_decision_log
         WHERE run_id=$1::uuid
           AND action='commander.directive_proposed'
           AND detail->>'attempt_id'=$5::text
      )`,
    [
      attempt.run_id,
      JSON.stringify({
        commander_attempt_id: attempt.id,
        event_cursor: result.decision.event_cursor,
      }),
      attempt.phase,
      JSON.stringify({
        attempt_id: attempt.id,
        directive: result.decision,
      }),
      attempt.id,
    ],
  );
}

export async function appendGeneratorFixCallback(
  attempt,
  result,
  db = pool,
  resolvePrHead = defaultPrHeadResolver,
) {
  if (attempt.role !== 'generator') return;
  // blocked / needs_context are terminal, received callbacks too. Dropping them
  // makes convergence replay misclassify a durable callback as HTTP loss.
  if (!SUCCESS_TERMINAL_STATUSES.has(result.status)) return;

  const { rows: contextRows } = await db.query(
    `SELECT r.pr_url, fix_intent.observed->>'trigger_sha' AS trigger_sha
       FROM initiative_runs r
       JOIN LATERAL (
         SELECT observed
           FROM orchestrator_decision_log
          WHERE run_id=r.id
            AND hop=$2
            AND action='spawn:generator-fix'
          LIMIT 1
       ) fix_intent ON TRUE
      WHERE r.id=$1::uuid`,
    [attempt.run_id, attempt.hop],
  );
  const context = contextRows[0];
  if (!context) return;

  const triggerSha = normalizeGitSha(context.trigger_sha)
    ?? (typeof context.trigger_sha === 'string' ? context.trigger_sha.trim() : null);
  const pullRequest = result.artifacts.find(
    (artifact) => artifact?.type === 'pull_request' && artifact.head_sha,
  );
  const claimedSha = pullRequest?.head_sha
    ?? result.decision?.pr_head_sha
    ?? result.provider_metadata?.pr_head_sha
    ?? null;
  const normalizedClaimedSha = normalizeGitSha(claimedSha);
  let prHeadSha = triggerSha;
  let verificationStatus;
  let noProgressReason;

  if (!claimedSha) {
    let resolvedSha = null;
    try {
      resolvedSha = context.pr_url
        ? normalizeGitSha(await resolvePrHead(context.pr_url))
        : null;
    } catch {
      // The callback is still durable with the trigger SHA; the next ground-truth
      // read can verify the PR head once GitHub is available again.
    }
    if (resolvedSha) {
      prHeadSha = resolvedSha;
      verificationStatus = 'verified';
    } else {
      verificationStatus = 'verification_pending';
    }
  } else if (!normalizedClaimedSha) {
    verificationStatus = 'invalid';
    noProgressReason = 'callback_sha_invalid';
  } else {
    let resolvedSha = null;
    let resolutionPending = !context.pr_url;
    try {
      resolvedSha = context.pr_url
        ? normalizeGitSha(await resolvePrHead(context.pr_url))
        : null;
    } catch {
      resolutionPending = true;
    }
    if (resolvedSha && resolvedSha === normalizedClaimedSha) {
      prHeadSha = resolvedSha;
      verificationStatus = 'verified';
    } else if (
      resolutionPending
      || !resolvedSha
      || (triggerSha != null && resolvedSha !== triggerSha)
    ) {
      verificationStatus = 'verification_pending';
    } else {
      verificationStatus = 'unverified';
      noProgressReason = 'callback_sha_unverified';
    }
  }

  const observed = {
    attempt_id: attempt.id,
    trigger_hop: attempt.hop,
    pr_head_sha: prHeadSha,
    provider: result.provider_metadata?.provider ?? attempt.provider ?? null,
  };
  const detail = {
    attempt_id: attempt.id,
    pr_head_sha: prHeadSha,
    status: result.status,
    verification_status: verificationStatus,
    ...(verificationStatus === 'verification_pending' && normalizedClaimedSha
      ? { claimed_pr_head_sha: normalizedClaimedSha }
      : {}),
    ...(noProgressReason ? { no_progress_reason: noProgressReason } : {}),
  };
  await db.query(
    `WITH lock AS (
       SELECT pg_advisory_xact_lock(hashtext($1::text)),
              $4::text AS callback_sha,
              $5::text AS callback_provider
     ), fix_intent AS (
       SELECT 1
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid AND hop=$2 AND action='spawn:generator-fix'
     ), next_hop AS (
       SELECT COALESCE(MAX(hop), 0) + 1 AS hop
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid
     )
     INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     SELECT $1::uuid, next_hop.hop, $6::jsonb, 'generate', 'allow',
            'verdict:generator-fix-callback', $7::jsonb
       FROM lock, fix_intent, next_hop
      WHERE NOT EXISTS (
        SELECT 1 FROM orchestrator_decision_log
         WHERE run_id=$1::uuid
           AND action='verdict:generator-fix-callback'
           AND detail->>'attempt_id'=$3::text
      )`,
    [
      attempt.run_id,
      attempt.hop,
      attempt.id,
      prHeadSha,
      observed.provider,
      JSON.stringify(observed),
      JSON.stringify(detail),
    ],
  );
}

function resultError(result) {
  if (typeof result.error === 'string') return { code: 'provider_failed', message: result.error };
  return {
    code: result.error?.code ?? 'provider_failed',
    message: result.error?.message ?? result.summary ?? 'provider execution failed',
  };
}

router.post('/harness/attempts/:attemptId/heartbeat', heartbeatRateLimit, async (req, res) => {
  const db = requestDatabase(req);
  const attemptStore = createAttemptStore(db);
  const attempt = await attemptStore.getById(req.params.attemptId);
  if (!attempt) return res.status(404).json({ ok: false, error: 'attempt not found' });
  if (!callbackAuthorized(req, attempt)) {
    return res.status(401).json({ ok: false, error: 'invalid attempt callback credential' });
  }
  const leaseOwner = req.body?.lease_owner;
  const leaseSeconds = Number(req.body?.lease_seconds ?? 180);
  const providerSessionId = req.body?.provider_session_id ?? null;
  if (typeof leaseOwner !== 'string' || !leaseOwner || !Number.isInteger(leaseSeconds)
      || leaseSeconds < 30 || leaseSeconds > 600
      || (providerSessionId !== null && (typeof providerSessionId !== 'string' || !providerSessionId))) {
    return res.status(400).json({ ok: false, error: 'valid lease_owner and lease_seconds (30..600) required' });
  }
  try {
    const attempt = providerSessionId
      ? await attemptStore.markRunning(req.params.attemptId, {
          leaseOwner,
          providerSessionId,
          leaseSeconds,
        })
      : await attemptStore.heartbeat(req.params.attemptId, { leaseOwner, leaseSeconds });
    if (!attempt) return res.status(409).json({ ok: false, error: 'attempt lease lost or terminal' });
    return res.json({ ok: true, attemptId: req.params.attemptId });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/harness/attempts/:attemptId/callback', callbackRateLimit, async (req, res) => {
  const { attemptId } = req.params;
  const db = requestDatabase(req);
  const attemptStore = createAttemptStore(db);
  const attempt = await attemptStore.getById(attemptId);
  if (!attempt) return res.status(404).json({ ok: false, error: 'attempt not found' });
  if (!callbackAuthorized(req, attempt)) {
    return res.status(401).json({ ok: false, error: 'invalid attempt callback credential' });
  }
  const leaseOwner = req.get('x-harness-lease-owner') ?? '';
  if (!leaseOwner || leaseOwner !== attempt.lease_owner) {
    return res.status(409).json({ ok: false, error: 'attempt lease owner mismatch' });
  }

  let result;
  try {
    result = parseHarnessResult(
      req.body,
      attempt.role,
      attemptExpectedOutput(attempt),
      attemptAuthority(attempt),
    );
    if (result.attempt_id !== attemptId) {
      throw new Error(`attempt_id mismatch: body=${result.attempt_id} path=${attemptId}`);
    }
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }

  if (attempt.provider && attempt.provider !== 'auto'
      && result.provider_metadata.provider !== attempt.provider) {
    return res.status(409).json({
      ok: false,
      error: `provider_mismatch: attempt=${attempt.provider} callback=${result.provider_metadata.provider}`,
    });
  }

  if (!['local-docker', 'remote-bridge', 'fleet-worker'].includes(
    attempt.execution_transport,
  )) {
    return res.status(409).json({ ok: false, error: 'launch_receipt_unconfirmed' });
  }

  if (
    attempt.execution_transport === 'fleet-worker'
    && attempt.provider === 'codex'
    && (
      !UUID_PATTERN.test(result.provider_metadata?.credential_ref ?? '')
      || typeof result.provider_metadata?.credential_copy_mutated !== 'boolean'
      || Object.keys(result.provider_metadata).some(
        (field) => !FLEET_CODEX_METADATA_FIELDS.has(field),
      )
    )
  ) {
    return res.status(409).json({ ok: false, error: 'credential_callback_invalid' });
  }

  if (attempt.execution_transport === 'remote-bridge') {
    const machineId = result.provider_metadata?.machine_id;
    let valid = false;
    try {
      valid = machineId === attempt.requested_machine_id
        && machineId === attempt.actual_machine_id
        && verifyMachineAttestation({
          secret: req.app.get('kernelFleetBridgeToken'),
          attemptId,
          machineId,
          jobId: attempt.remote_job_id,
          attestation: result.provider_metadata?.machine_attestation,
        });
    } catch {
      valid = false;
    }
    if (!valid) {
      return res.status(409).json({ ok: false, error: 'machine_attestation_mismatch' });
    }
  }

  const sessionId = result.provider_metadata?.session_id ?? null;
  if (sessionId) {
    try {
      await attemptStore.assertFreshRoleSession({
        runId: attempt.run_id,
        attemptId,
        role: attempt.role,
        sessionId,
      });
    } catch (error) {
      return res.status(409).json({ ok: false, error: error.message });
    }
  }

  try {
    let outcome;
    if (result.status === 'failed' || result.status === 'cancelled') {
      const error = resultError(result);
      outcome = await attemptStore.fail(
        attemptId,
        {
          ...error,
          status: result.status,
          failureClass: result.failure_class,
        },
        { leaseOwner },
      );
      if (!outcome.attempt) {
        const current = await attemptStore.getById(attemptId);
        if (current?.lease_owner !== leaseOwner || !FAILURE_TERMINAL_STATUSES.has(current?.status)) {
          return res.status(409).json({ ok: false, error: 'attempt lease lost before terminal write' });
        }
      }
    } else {
      outcome = await attemptStore.complete(attemptId, result, { leaseOwner });
      let completedAttempt = outcome.attempt;
      let persistedResult = completedAttempt?.result ?? result;
      if (!completedAttempt) {
        const current = await attemptStore.getById(attemptId);
        if (current?.lease_owner !== leaseOwner || !SUCCESS_TERMINAL_STATUSES.has(current?.status)) {
          return res.status(409).json({ ok: false, error: 'attempt lease lost before terminal write' });
        }
        completedAttempt = current;
        persistedResult = current.result ?? result;
      }
      await appendCommanderProposal(attempt, persistedResult, db);
      await appendAttemptVerdict(attempt, persistedResult, db);
      const resolver = req.app.get('kernelPrHeadResolver') || defaultPrHeadResolver;
      await appendGeneratorFixCallback(attempt, persistedResult, db, resolver);

      if (attempt.role === 'generator') {
        const pullRequest = persistedResult.artifacts.find(
          (artifact) => artifact?.type === 'pull_request' && artifact.url,
        );
        if (pullRequest) {
          await db.query(
            'UPDATE initiative_runs SET pr_url=$2, updated_at=NOW() WHERE id=$1',
            [attempt.run_id, pullRequest.url],
          );
        }
      }
    }
    return res.json({ ok: true, attemptId, deduped: outcome.deduped });
  } catch (error) {
    console.error(`[harness-attempt-callback] attempt=${attemptId}: ${error.message}`);
    return res.status(500).json({ ok: false, error: 'attempt callback persistence failed' });
  }
});

// relay 容器认证失败特征（Claude Code CLI 未登录/token 失效时的典型话术）。
// 只聚焦"未登录"这个具体信号，不做通用失败分类——那是 quarantine.js 的事，
// 且 quarantine.js 的分类路径本来就打不到 cecelia-relay-* 容器的 callback（见下方分支说明）。
const AUTH_FAILURE_PATTERN = /not\s+logged\s+in|please\s+run\s*\/?login/i;

// containerId 格式 cecelia-relay-<short8>-<suffix>（见 harness-skill-relay.js shortId）。
// 反查 task 标题给告警信息用；查不到就只带 containerId，不阻塞告警本身。
async function _lookupTaskTitleByContainerId(containerId) {
  const match = containerId.match(/^cecelia-relay-([a-f0-9]{8})-/);
  if (!match) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, title FROM tasks WHERE REPLACE(id::text, '-', '') LIKE $1 LIMIT 1`,
      [`${match[1]}%`]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn(`[harness-callback] 反查任务标题失败（不影响告警本身）: ${err.message}`);
    return null;
  }
}

// containerId -> claimedAtMs。已 claim 的 containerId 的回调不再重入 resume。
const _claimedCallbacks = new Map();
const CLAIM_TTL_MS = 2 * 60 * 60 * 1000; // 2h，防无界增长（远超单次 pipeline + 重试窗口）

function _pruneClaims(nowMs) {
  for (const [cid, ts] of _claimedCallbacks) {
    if (nowMs - ts > CLAIM_TTL_MS) _claimedCallbacks.delete(cid);
  }
}

// 测试 hook：清空 claim 表
export function _resetCallbackDedupeForTests() {
  _claimedCallbacks.clear();
}

router.post('/harness/callback/:containerId', async (req, res) => {
  const { containerId } = req.params;
  const { result, error, exit_code, stdout } = req.body || {};

  if (result === undefined && !error) {
    return res.status(400).json({ ok: false, error: 'result or error required' });
  }

  // v1.0.1：skill-relay controller session（cecelia-relay-*）没有 thread_lookup（不走
  // LangGraph resume），直接 200 ack——否则 entrypoint 对 404 重试 5 次（~36s/session 白等）。
  // stdout 落盘由 entrypoint tee 完成，状态回写由 controller 的 report 步骤走 PATCH relay-runs。
  if (containerId.startsWith('cecelia-relay-')) {
    console.log(`[harness-callback] relay 容器 ${containerId} 回调 ack（exit=${exit_code ?? '?'}，无 resume）`);

    // 刀A7：exit_code 落库 → last_container_exit_code（watchdog OOM 感知重试用）
    // 仅在 exit_code 存在且可解析时写入，不影响 200 ack 行为（best-effort）
    if (exit_code !== undefined) {
      const exitCodeNum = Number(exit_code);
      if (!isNaN(exitCodeNum)) {
        const match = containerId.match(/^cecelia-relay-([a-f0-9]{8})-/);
        if (match) {
          try {
            await pool.query(
              `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('last_container_exit_code', $2::int)
                WHERE REPLACE(id::text, '-', '') LIKE $1`,
              [`${match[1]}%`, exitCodeNum]
            );
          } catch (err) {
            console.warn(`[harness-callback] last_container_exit_code 写入失败（non-fatal）: ${err.message}`);
          }
        }
      }
    }

    // 认证失败告警（catch 兜底——告警本身失败不能拖累原有 200 ack 行为）。
    // exit_code 未提供时不判定为失败——Number(undefined)===NaN，NaN!==0 恒真，会把"没传
    // exit_code 但 result/stdout 里恰好出现相关字样"误判成登录失效（例如日志回显场景）。
    const hasFailureExitCode = exit_code !== undefined && Number(exit_code) !== 0;
    const failureText = [result, error, stdout].filter(Boolean).join(' ');
    if (hasFailureExitCode && AUTH_FAILURE_PATTERN.test(failureText)) {
      try {
        const task = await _lookupTaskTitleByContainerId(containerId);
        const taskLabel = task ? `${task.title}（${task.id}）` : containerId;
        await sendBark(
          '⚠️ Harness session 登录失效',
          `${taskLabel} 的 relay session 因未登录崩溃，需要人工检查账号状态并可能重新登录`,
          { dedupeKey: `harness-auth-fail-${containerId}`, dedupeTtlSec: 3600 }
        );
      } catch (err) {
        console.error(`[harness-callback] 认证失败告警发送异常（不影响 ack）: ${err.message}`);
      }
    }

    // 守卫补链刀(72e2b7a6):容器退出但任务非终态 → 一致性闸自动 requeue(封顶3次,fail-open)
    try {
      const consistency = await handleRelayExitConsistency({
        pool,
        containerId,
        exitCode: exit_code,
        resultText: [result, error, stdout].filter(Boolean).join(' '),
      });
      if (consistency.action !== 'noop') {
        console.warn(`[harness-callback] 一致性闸处置 ${containerId}: ${consistency.action}${consistency.suicide ? '(等待自杀)' : ''}`);
      }
    } catch (err) {
      console.error(`[harness-callback] 一致性闸异常(不影响 ack): ${err.message}`);
    }

    return res.json({ ok: true, relayAck: true, containerId });
  }

  // 幂等 claim（同步 check-and-set，原子）：已 claim 过 = 重复回调（curl 重试 / 并发），
  // 直接 ack，绝不重入 resume（重入会重 spawn 容器 —— 正是本 P0 bug）。
  const nowMs = Date.now();
  _pruneClaims(nowMs);
  if (_claimedCallbacks.has(containerId)) {
    console.warn(`[harness-callback] containerId ${containerId} 回调重复（已在处理/已处理），跳过重 resume（幂等去重）`);
    return res.json({ ok: true, deduped: true, containerId });
  }
  _claimedCallbacks.set(containerId, nowMs);

  // Lookup thread_id by containerId
  let lookup;
  try {
    lookup = await lookupHarnessThread(containerId);
  } catch (err) {
    // 未进入 resume → 释放 claim，允许后续重试（可能是瞬时 PG 错）
    _claimedCallbacks.delete(containerId);
    console.error(`[harness-callback] lookup failed containerId=${containerId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: `lookup: ${err.message}` });
  }

  if (!lookup) {
    // 未进入 resume → 释放 claim（404 重试无副作用；真未知容器只会再 404）
    _claimedCallbacks.delete(containerId);
    console.warn(`[harness-callback] containerId ${containerId} 找不到对应 thread_id`);
    return res.status(404).json({ ok: false, error: 'thread not found for containerId' });
  }

  // Resume graph。claim 已持有：invoke 期间/之后到达的重复回调都会被上面的 dedup 挡掉，
  // 即使 invoke 因 proposer 阻塞数分钟不返回，也只会有这一次 resume。
  try {
    const { compiledGraph, threadId } = lookup;
    await compiledGraph.invoke(
      new Command({ resume: { result, error, exit_code, stdout } }),
      { configurable: { thread_id: threadId } }
    );
    return res.json({ ok: true, threadId, containerId });
  } catch (err) {
    // 注意：invoke 抛错时【保留】claim —— resume 可能已 spawn 了容器，重试会重 spawn（本 bug）。
    // 卡住的 thread 交给 harness watchdog/patrol 恢复，回调侧坚持 at-most-once。
    console.error(`[harness-callback] graph resume failed containerId=${containerId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
