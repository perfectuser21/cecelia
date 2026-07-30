/**
 * harness-relay-watchdog — skill-relay run 的重点火看门狗（eval-1 实证的产品化）。
 *
 * 病：relay session 会在 25-47 turns 后自判完成早退（v1.1.0 硬约束 6 的 prompt 纪律拦不住）。
 * 药：外部有界重点火——外部真相接续已四次实证（run-3 两段、eval-1 两段），
 *     新 session 从台账+git/PR 接续，重点火即免费恢复（relay-loop.sh 雏形一轮收敛到 merge）。
 *
 * 管辖分工：
 * - v2 run（orchestrator_version='v2'）归本 watchdog；harness-initiative-patrol 已排除 v2
 * - task 状态 queued 的不管（dispatcher 自然路径会经 relay 分支重 spawn，防双 spawn）
 * - deadline 逾期的不管（scanStuckHarness 既有逻辑负责标 failed）
 */
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

import pool from './db.js';
import { createAttemptStore } from './orchestrator/attempt-store.js';
import { HEADED_HOSTS, HEADED_TMUX_PREFIXES } from './harness-skill-relay.js';
import {
  parseBaseRepo as _parseBaseRepo,
  discoverPrFromGithub as _discoverPrFromGithub,
} from './orchestrator/github-pr-discovery.js';
import { defaultPrHeadResolver } from './orchestrator/pr-head-resolver.js';
import {
  generateCallbackSecret,
  hashCallbackSecret,
} from './orchestrator/callback-auth.js';
import {
  aggregateFailureEvidence,
  buildFailurePersistenceEvidence,
  errorMessage,
  sanitizeDiagnostic,
} from './orchestrator/failure-persistence.js';
import {
  createCredentialBroker,
  createFileCredentialLoader,
} from './orchestrator/credential-broker.js';
import {
  createProductionExecutionTransport,
  DEFAULT_LOCAL_MACHINE_ID,
} from './orchestrator/production-transport.js';
import { patchKernelRunById } from './orchestrator/kernel-run-store.js';

export { _parseBaseRepo, _discoverPrFromGithub };

// ── CI 状态映射（复用 ground-truth.js 的等价逻辑，不重复造轮子）────────────────
const CI_FAIL_STATES = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const CI_PASS_STATES = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

/** gh check state → 三态 ci 映射（'fail' | 'pass' | 'pending'） */
function mapCiStatus(checkRows) {
  if (!Array.isArray(checkRows) || checkRows.length === 0) return 'pending';
  if (checkRows.some((c) => CI_FAIL_STATES.has(c.state))) return 'fail';
  if (checkRows.every((c) => CI_PASS_STATES.has(c.state))) return 'pass';
  return 'pending';
}

/** execFn 容忍非零退出（gh pr checks 对 pending=8 / fail=1），用 err.stdout 兜底 */
function execTolerant(execFn, cmd) {
  try {
    return execFn(cmd);
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.length > 0) return err.stdout;
    throw err;
  }
}

/** safe JSON parse，失败返回 null */
function tryParseJson(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}
// ── end CI 状态映射 ──────────────────────────────────────────────────────────

const HEADED_HOST_VALUES = Object.values(HEADED_HOSTS); // ['skill-relay-codex-headed','skill-relay-claude-headed']

export const MAX_RELAY_ATTEMPTS = 5;
// B6: codex 路径上限更低（外部 codex API 更贵，不允许无限重试）
export const MAX_CODEX_RELAY_ATTEMPTS = 2;

// generator 完成后 6h 无 MERGED → failed（防 e90c0fbb pr_url 空永挂）
export const GENERATOR_DONE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const KERNEL_RECONCILE_STALE_MS = 3 * 60 * 1000;

function sameMachineResumeBundle(rawBundle, { attemptId, hop }) {
  const bundle = tryParseJson(rawBundle);
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('resume_task_bundle_invalid');
  }
  const inputs = tryParseJson(bundle.inputs) ?? {};
  const constraints = tryParseJson(bundle.constraints) ?? {};
  const workspaceSpec = tryParseJson(inputs.workspace_spec);
  return {
    ...bundle,
    attempt_id: attemptId,
    hop,
    inputs: {
      ...inputs,
      ...(workspaceSpec
        ? {
            workspace_spec: {
              ...workspaceSpec,
              attempt_id: attemptId,
            },
          }
        : {}),
    },
    constraints: {
      ...constraints,
      fresh_session: false,
    },
  };
}

async function reserveResumeIntent(db, attempt) {
  const next = await db.query(
    `SELECT GREATEST(
              COALESCE(MAX(hop), 0),
              $2::integer
            ) + 1 AS next_hop
       FROM orchestrator_decision_log
      WHERE run_id=$1`,
    [attempt.run_id, Number(attempt.hop)],
  );
  const hop = Number(next.rows?.[0]?.next_hop);
  if (!Number.isInteger(hop) || hop <= Number(attempt.hop)) {
    throw new Error(`invalid resume hop for attempt ${attempt.id}`);
  }
  try {
    const inserted = await db.query(
      `INSERT INTO orchestrator_decision_log
         (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
       VALUES ($1,$2,$3::jsonb,$4,'allow','spawn:resume',$5::jsonb)
       RETURNING hop`,
      [
        attempt.run_id,
        hop,
        JSON.stringify({
          recovery_parent_attempt_id: attempt.id,
          logical_cycle_id: attempt.logical_cycle_id ?? `intent:${attempt.run_id}:${attempt.hop}`,
        }),
        attempt.phase,
        JSON.stringify({
          reason: 'lease_expired',
          retry_of_attempt_id: attempt.id,
        }),
      ],
    );
    return inserted.rows?.[0] ? hop : null;
  } catch (error) {
    if (error?.code === '23505') return null;
    throw error;
  }
}

export async function reconcileExpiredKernelAttempt({
  db,
  attemptStore: injectedAttemptStore,
  attemptId,
  leaseOwner,
  resumeAttempt,
  reservedChildHop = null,
  randomUUIDFn = randomUUID,
  onRecoveryAlert,
}) {
  const store = injectedAttemptStore ?? createAttemptStore(db);
  const originalParentAttempt = await store.getById(attemptId);
  if (
    !originalParentAttempt
    || !['queued', 'starting', 'running'].includes(originalParentAttempt.status)
  ) {
    return { ok: false, deduped: true };
  }
  if (
    originalParentAttempt.lease_expires_at
    && new Date(originalParentAttempt.lease_expires_at).getTime() >= Date.now()
  ) {
    return { ok: false, deduped: true };
  }

  const reclaimed = await store.reclaim(attemptId, {
    leaseOwner,
    leaseSeconds: 300,
  });
  if (!reclaimed) return { ok: false, deduped: true };

  const rotatedParent = await store.rotateCallbackSecret(attemptId, {
    leaseOwner: reclaimed.lease_owner,
    leaseGeneration: reclaimed.lease_generation,
    callbackSecretHash: hashCallbackSecret(generateCallbackSecret()),
  });
  if (!rotatedParent) return { ok: false, deduped: true };

  const childHop = reservedChildHop ?? (Number(originalParentAttempt.hop) + 1);
  const callbackSecret = generateCallbackSecret();
  const childId = randomUUIDFn();
  const resumeMachineId = originalParentAttempt.actual_machine_id
    ?? originalParentAttempt.machine_id
    ?? originalParentAttempt.requested_machine_id;
  const resumeBundle = sameMachineResumeBundle(
    originalParentAttempt.task_bundle,
    { attemptId: childId, hop: childHop },
  );
  const child = await store.createAttempt({
    id: childId,
    runId: originalParentAttempt.run_id,
    hop: childHop,
    phase: originalParentAttempt.phase,
    role: originalParentAttempt.role,
    provider: originalParentAttempt.provider,
    accountId: originalParentAttempt.account_id,
    machineId: resumeMachineId,
    bundle: resumeBundle,
    callbackSecretHash: hashCallbackSecret(callbackSecret),
    logicalCycleId: originalParentAttempt.logical_cycle_id
      ?? `intent:${originalParentAttempt.run_id}:${originalParentAttempt.hop}`,
    attemptKind: 'resume',
    retryOfAttemptId: originalParentAttempt.id,
    restartReason: 'lease_expired',
    workstreamKey: originalParentAttempt.workstream_key ?? 'ws1',
    timeDerived: originalParentAttempt.time_derived === true,
  });
  if (!child || child.id !== childId) {
    return { ok: false, deduped: true };
  }
  const claimedChild = await store.markStarting(child.id, {
    leaseOwner,
    leaseSeconds: 300,
  });
  if (!claimedChild) return { ok: false, deduped: true };
  const resumableChild = {
    ...child,
    ...claimedChild,
    task_bundle: child.task_bundle ?? originalParentAttempt.task_bundle,
    callbackSecret,
  };

  let resumed;
  let resumeAggregateError = null;
  try {
    resumed = await resumeAttempt(resumableChild, {
      parentAttempt: reclaimed,
      originalParentAttempt,
      reclaimedParentAttempt: reclaimed,
      callbackSecret,
      leaseOwner,
      attemptStore: store,
      onRecoveryAlert,
    });
  } catch (error) {
    if (error instanceof AggregateError || error?.code === 'kernel_recovery_alert_failed') {
      resumeAggregateError = error;
    }
    resumed = {
      ok: false,
      failure_code: error?.failureCode ?? 'resume_launch_failed',
      error: error?.message ?? String(error),
    };
  }
  if (!resumed?.ok) {
    const failureCode = resumed === null
      ? 'resume_returned_null'
      : resumed === false
        ? 'resume_returned_false'
        : resumed?.failure_code ?? 'resume_failed';
    const lifecycleDetail = resumed?.lifecycle_detail
      ? `; ${sanitizeDiagnostic(resumed.lifecycle_detail)}`
      : '';
    const childFailure = await tryFailClaimedAttempt(store, childId, {
      code: failureCode,
      message: `resume child launch failed: ${failureCode}${lifecycleDetail}`,
    }, {
      leaseOwner: resumableChild.lease_owner,
      leaseGeneration: resumableChild.lease_generation,
    });
    const parentFailure = await tryFailClaimedAttempt(store, attemptId, {
      code: failureCode,
      message: `expired attempt resume failed: ${failureCode}${lifecycleDetail}`,
    }, {
      leaseOwner: reclaimed.lease_owner,
      leaseGeneration: reclaimed.lease_generation,
    });
    const persistenceEvidence = [
      childFailure.evidence,
      parentFailure.evidence,
    ].filter(Boolean);
    const alertErrors = await deliverRecoveryAlerts(onRecoveryAlert, [
      ...persistenceEvidence.map((entry) => entry.alert),
      resumed?.recovery_alert,
    ].filter(Boolean));
    const additionalErrors = [
      ...alertErrors,
      resumeAggregateError,
    ].filter(Boolean);
    if (persistenceEvidence.length > 0 || additionalErrors.length > 0) {
      throw aggregateFailureEvidence(persistenceEvidence, additionalErrors);
    }
    return parentFailure.result?.deduped
      ? { ok: false, deduped: true }
      : { ok: false, terminal: true, failure_code: failureCode };
  }

  await failClaimedAttempt(store, attemptId, {
    code: 'resumed_as_child',
    message: 'expired attempt resumed as a new lineage child',
  }, {
    leaseOwner: reclaimed.lease_owner,
    leaseGeneration: reclaimed.lease_generation,
  }, onRecoveryAlert);
  return {
    ok: true,
    resumed: true,
    attempt_id: child.id,
    provider_session_id: resumed.provider_session_id ?? null,
  };
}

/** C3：按 initiative 批量关闭 skill-relay-spawn 事件（写点在 executor.js spawn，写完即弃无 id 可用）。 */
async function _closeSpawnEvents(dbPool, initiativeId, status) {
  try {
    await dbPool.query(
      `UPDATE initiative_run_events SET status = $3, ts_end = $2
        WHERE initiative_id = $1 AND node = 'skill-relay-spawn' AND status = 'running'`,
      [initiativeId, Date.now(), status === 'done' ? 'done' : 'failed']
    );
  } catch (err) { console.warn(`[relay-watchdog] spawn 事件收尾失败（non-fatal）：${err.message}`); }
}

function shortId(id) {
  return String(id).replace(/-/g, '').slice(0, 8);
}

function isProvableLegacyLocalParent(attempt, target) {
  return (
    target?.machine === 'us-mac-m4'
    && attempt?.local_container_naming === 'legacy-unsuffixed'
  );
}

function unsafeCleanupDiagnostic(result) {
  if (result?.status === 'cancelled') return null;
  const status = result?.status ?? 'unknown';
  const httpStatus = result?.httpStatus == null ? '' : ` (HTTP ${result.httpStatus})`;
  return `orphan cancellation unsafe: ${status}${httpStatus}`;
}

async function deliverRecoveryAlerts(onRecoveryAlert, alerts) {
  if (typeof onRecoveryAlert !== 'function') return [];
  const failures = [];
  for (const detail of alerts) {
    try {
      await onRecoveryAlert(detail);
    } catch {
      const error = new Error(
        `kernel_recovery_alert_failed:${sanitizeDiagnostic(detail.lifecycleCode)}`,
      );
      error.code = 'kernel_recovery_alert_failed';
      failures.push(error);
    }
  }
  return failures;
}

async function tryFailClaimedAttempt(store, attemptId, failure, claim) {
  try {
    return {
      result: await store.fail(attemptId, failure, claim),
      evidence: null,
    };
  } catch (persistenceError) {
    const lifecycleError = new Error(failure.message);
    lifecycleError.code = failure.code;
    return {
      result: null,
      evidence: buildFailurePersistenceEvidence({
        attemptId,
        lifecycleCode: failure.code,
        originalError: lifecycleError,
        persistenceError,
      }),
    };
  }
}

async function failClaimedAttempt(store, attemptId, failure, claim, onRecoveryAlert) {
  const failed = await tryFailClaimedAttempt(store, attemptId, failure, claim);
  if (!failed.evidence) return failed.result;
  const alertErrors = await deliverRecoveryAlerts(onRecoveryAlert, [failed.evidence.alert]);
  throw aggregateFailureEvidence([failed.evidence], alertErrors);
}

function deferredRecoveryAlert({
  attemptId,
  lifecycleCode,
  cleanupStatus,
  diagnostic,
}) {
  return {
    kind: 'cleanup_unconfirmed',
    attemptId,
    lifecycleCode,
    cleanupStatus,
    diagnostic,
  };
}

export async function resumeKernelAttempt(attempt, {
  originalParentAttempt,
  reclaimedParentAttempt,
  task,
  dbPool,
  callbackSecret,
  leaseOwner = `watchdog:${process.pid}`,
  attemptStore: injectedAttemptStore,
  launcher: injectedLauncher,
  transportFactory = createProductionExecutionTransport,
  credentialBroker: injectedCredentialBroker,
  loadCredential: injectedLoadCredential,
  env = process.env,
  fetchFn,
  spawnDetached: injectedSpawnDetached,
  removeContainer: injectedRemoveContainer,
  brainUrl,
  remoteBridgeTimeoutMs,
}) {
  const [
    { createProviderRegistry },
    { claudeAdapter },
    { codexAdapter },
    { grokAdapter },
    { resolveProviderAccountHome },
    detached,
  ] = await Promise.all([
    import('./orchestrator/provider-registry.js'),
    import('./orchestrator/providers/claude.js'),
    import('./orchestrator/providers/codex.js'),
    import('./orchestrator/providers/grok.js'),
    import('./orchestrator/dispatcher.js'),
    injectedLauncher && injectedRemoveContainer
      ? Promise.resolve({})
      : import('./spawn/detached.js'),
  ]);
  const store = injectedAttemptStore ?? createAttemptStore(dbPool);
  if (
    !originalParentAttempt?.id
    || !reclaimedParentAttempt?.id
    || !callbackSecret
    || !attempt?.lease_owner
    || !Number.isInteger(attempt?.lease_generation)
  ) {
    return { ok: false, reason: 'resume_child_context_missing' };
  }

  const registry = createProviderRegistry([claudeAdapter, codexAdapter, grokAdapter]);
  const adapter = registry.resolve({
    provider: originalParentAttempt.provider,
    requires: ['resume'],
  });
  const execution = {};
  if (task.payload?.model && task.payload.model !== 'auto') execution.model = task.payload.model;
  if (task.payload?.codex_home) execution.codexHome = task.payload.codex_home;
  if (task.payload?.claude_home) execution.claudeHome = task.payload.claude_home;
  if (task.payload?.grok_home) execution.grokHome = task.payload.grok_home;
  if (originalParentAttempt.account_id) {
    const accountHome = resolveProviderAccountHome(
      originalParentAttempt.provider,
      originalParentAttempt.account_id,
    );
    if (originalParentAttempt.provider === 'codex') execution.codexHome = accountHome;
    if (originalParentAttempt.provider === 'claude') execution.claudeHome = accountHome;
    if (originalParentAttempt.provider === 'grok') execution.grokHome = accountHome;
  }
  const spec = adapter.resume({
    attempt: {
      ...originalParentAttempt,
      task_bundle: originalParentAttempt.task_bundle,
    },
    input: 'Continue this same Harness attempt from its last durable checkpoint.',
    execution,
  });
  const credentialBroker = injectedCredentialBroker
    ?? (originalParentAttempt.provider === 'codex'
      ? createCredentialBroker({
        controllerMachineId: env.CECELIA_MACHINE_ID ?? DEFAULT_LOCAL_MACHINE_ID,
        loadCredential: injectedLoadCredential
          ?? createFileCredentialLoader({
            accountHomeResolver: (accountId) => (
              resolveProviderAccountHome('codex', accountId)
            ),
          }),
      })
      : undefined);
  const launcher = injectedLauncher ?? transportFactory({
    env,
    attemptStore: store,
    spawnDetached: injectedSpawnDetached ?? detached.spawnDockerDetached,
    removeContainer: injectedRemoveContainer ?? detached.removeDockerContainer,
    brainUrl,
    leaseOwner,
    fetchFn,
    credentialBroker,
    remoteBridgeTimeoutMs,
  });
  const target = {
    provider: originalParentAttempt.provider,
    account: originalParentAttempt.account_id ?? null,
    machine: originalParentAttempt.actual_machine_id
      ?? originalParentAttempt.machine_id
      ?? originalParentAttempt.requested_machine_id,
  };

  let parentCleanup;
  if (isProvableLegacyLocalParent(originalParentAttempt, target)) {
    const legacyContainerId = `cecelia-harness-${shortId(originalParentAttempt.id)}`;
    try {
      const removeContainer = injectedRemoveContainer ?? detached.removeDockerContainer;
      const removed = await removeContainer(legacyContainerId);
      parentCleanup = {
        status: removed ? 'cancelled' : 'missing',
        containerId: legacyContainerId,
      };
    } catch (error) {
      parentCleanup = {
        status: 'unavailable',
        reason: `legacy local cleanup failed: ${errorMessage(error)}`,
      };
    }
  } else {
    try {
      await launcher.inspect({
        attempt: originalParentAttempt,
        target,
      });
    } catch (error) {
      const errorDetail = errorMessage(error);
      const diagnostic = `parent inspection failed: ${errorDetail}`;
      const recoveryAlert = deferredRecoveryAlert({
        attemptId: originalParentAttempt.id,
        lifecycleCode: 'resume_parent_cleanup_unconfirmed',
        cleanupStatus: 'unavailable',
        diagnostic,
      });
      return {
        ok: false,
        failure_code: 'resume_parent_cleanup_unconfirmed',
        cleanup_status: 'unavailable',
        error: errorDetail,
        recovery_alert: recoveryAlert,
      };
    }
    try {
      parentCleanup = await launcher.cancel({
        attempt: originalParentAttempt,
        target,
      });
    } catch (error) {
      parentCleanup = {
        status: 'unavailable',
        reason: `parent cancellation failed: ${errorMessage(error)}`,
      };
    }
  }
  if (parentCleanup?.status !== 'cancelled') {
    const diagnostic = parentCleanup?.reason ?? unsafeCleanupDiagnostic(parentCleanup);
    const recoveryAlert = deferredRecoveryAlert({
      attemptId: originalParentAttempt.id,
      lifecycleCode: 'resume_parent_cleanup_unconfirmed',
      cleanupStatus: parentCleanup?.status ?? 'unknown',
      diagnostic,
    });
    return {
      ok: false,
      failure_code: 'resume_parent_cleanup_unconfirmed',
      cleanup_status: parentCleanup?.status ?? 'unknown',
      error: diagnostic,
      recovery_alert: recoveryAlert,
    };
  }

  let launched;
  try {
    launched = await launcher.launch({
      attempt: { ...attempt, callbackSecret },
      bundle: attempt.task_bundle,
      spec,
      adapter,
      task,
      target,
      leaseClaimed: true,
    });
  } catch (error) {
    let childCleanup;
    try {
      childCleanup = await launcher.cancel({
        attempt,
        target,
      });
    } catch (cleanupError) {
      childCleanup = {
        status: 'unavailable',
        reason: `orphan cancellation failed: ${errorMessage(cleanupError)}`,
      };
    }
    const cleanupDiagnostic = childCleanup?.reason ?? unsafeCleanupDiagnostic(childCleanup);
    if (childCleanup?.status !== 'cancelled') {
      const diagnostic = [
        errorMessage(error),
        cleanupDiagnostic,
      ].filter(Boolean).join('; ');
      const recoveryAlert = deferredRecoveryAlert({
        attemptId: attempt.id,
        lifecycleCode: 'resume_launch_failed',
        cleanupStatus: childCleanup?.status ?? 'unknown',
        diagnostic,
      });
      return {
        ok: false,
        failure_code: 'resume_child_cleanup_unconfirmed',
        cleanup_status: childCleanup?.status ?? 'unknown',
        error: diagnostic,
        recovery_alert: recoveryAlert,
      };
    }
    return {
      ok: false,
      failure_code: 'resume_launch_failed',
      cleanup_status: 'cancelled',
      error: errorMessage(error),
    };
  }

  let receiptRow;
  let receiptError;
  try {
    receiptRow = await store.recordLaunchReceipt(attempt.id, {
      leaseOwner: attempt.lease_owner,
      leaseGeneration: attempt.lease_generation,
      actualMachineId: launched.actualMachineId,
      executionTransport: launched.executionTransport,
      remoteJobId: launched.remoteJobId ?? null,
      attestationStatus: launched.attestationStatus,
    });
    if (!receiptRow) receiptError = new Error('launch receipt was not persisted');
  } catch (error) {
    receiptError = error;
  }
  if (receiptError) {
    let cleanupStatus = 'unknown';
    let cleanupDiagnostic = null;
    try {
      const cleanup = await launcher.cancel({
        attempt,
        target,
        launchReceipt: launched,
      });
      cleanupStatus = cleanup?.status ?? 'unknown';
      cleanupDiagnostic = unsafeCleanupDiagnostic(cleanup);
    } catch (error) {
      cleanupStatus = 'unavailable';
      cleanupDiagnostic = `orphan cancellation failed: ${errorMessage(error)}`;
    }
    const sanitizedCleanupDiagnostic = cleanupDiagnostic == null
      ? null
      : sanitizeDiagnostic(cleanupDiagnostic);
    const recoveryAlert = cleanupStatus === 'cancelled'
      ? null
      : deferredRecoveryAlert({
        attemptId: attempt.id,
        lifecycleCode: 'resume_receipt_persist_failed',
        cleanupStatus,
        diagnostic: sanitizedCleanupDiagnostic,
      });
    const lifecycleDetail = sanitizeDiagnostic([
      `resume receipt persistence failed: ${errorMessage(receiptError)}`,
      `child cleanup ${cleanupStatus}`,
      sanitizedCleanupDiagnostic,
    ].filter(Boolean).join('; '));
    return {
      ok: false,
      failure_code: 'resume_receipt_persist_failed',
      cleanup_status: cleanupStatus,
      cleanup_diagnostic: sanitizedCleanupDiagnostic,
      lifecycle_detail: lifecycleDetail,
      recovery_alert: recoveryAlert,
    };
  }
  return {
    ok: true,
    resumed: true,
    ...launched,
  };
}

async function _recoverKernelRun(run, task, deps, out) {
  const dbPool = deps.pool || deps.dbPool || pool;
  const onRecoveryAlert = deps.onRecoveryAlert ?? (async (detail) => {
    const { raise } = await import('./alerting.js');
    const alertCode = detail.kind === 'failure_persistence'
      ? 'kernel_failure_persistence_failed'
      : 'kernel_recovery_cleanup_unconfirmed';
    await raise(
      'P1',
      alertCode,
      [
        `attempt=${sanitizeDiagnostic(detail.attemptId)}`,
        `lifecycle=${sanitizeDiagnostic(detail.lifecycleCode)}`,
        `cleanup=${sanitizeDiagnostic(detail.cleanupStatus)}`,
        `diagnostic=${sanitizeDiagnostic(
          detail.diagnostic ?? detail.originalError?.message ?? 'unknown',
        )}`,
        `persistence=${sanitizeDiagnostic(detail.persistenceError?.message ?? 'none')}`,
      ].join('; '),
    );
  });
  const heartbeatAt = run.orchestrator_heartbeat_at
    ? new Date(run.orchestrator_heartbeat_at).getTime()
    : 0;
  // Kernel wait loops beat every 90s. A heartbeat inside two intervals plus
  // scheduling margin means the original reconcile process still owns the run.
  if (heartbeatAt && Date.now() - heartbeatAt <= KERNEL_RECONCILE_STALE_MS) return;
  const latestQ = await dbPool.query(
    `SELECT * FROM harness_attempts
      WHERE run_id=$1
      ORDER BY hop DESC LIMIT 1`,
    [run.id],
  );
  const attempt = latestQ.rows?.[0] ?? null;
  const activeStatus = attempt && ['queued', 'starting', 'running'].includes(attempt.status);
  const leaseLive = activeStatus && attempt.lease_expires_at
    && new Date(attempt.lease_expires_at).getTime() > Date.now();
  if (leaseLive) return;

  if (activeStatus && attempt.provider_session_id) {
    const lowerResume = deps.resumeAttempt || resumeKernelAttempt;
    const reservedChildHop = await reserveResumeIntent(dbPool, attempt);
    if (reservedChildHop == null) return;
    const resumed = await reconcileExpiredKernelAttempt({
      db: dbPool,
      attemptId: attempt.id,
      leaseOwner: `watchdog:${process.pid}`,
      reservedChildHop,
      onRecoveryAlert,
      resumeAttempt: (child, context) => lowerResume(child, {
        ...context,
        task,
        run,
        dbPool,
        launcher: deps.launcher,
        transportFactory: deps.transportFactory,
        env: deps.env,
        fetchFn: deps.fetchFn,
        spawnDetached: deps.spawnDetached,
        removeContainer: deps.removeContainer,
        brainUrl: deps.brainUrl,
        remoteBridgeTimeoutMs: deps.remoteBridgeTimeoutMs,
      }),
    });
    if (resumed.ok) {
      out.resumed++;
      console.log(`[relay-watchdog][kernel-v1] resumed attempt=${attempt.id} session=${attempt.provider_session_id}`);
    }
    // Whether resume won or lost the reclaim race, never start a second reconcile
    // process in the same watchdog pass.
    return;
  }

  if (activeStatus && attempt) {
    await dbPool.query(
      `UPDATE harness_attempts
          SET status='failed', error_code='recovery_without_session',
              error_message='expired attempt had no resumable provider session',
              completed_at=NOW(), lease_owner=NULL, lease_expires_at=NULL, updated_at=NOW()
        WHERE id=$1 AND status IN ('queued','starting','running')
          AND (lease_expires_at IS NULL OR lease_expires_at < NOW())`,
      [attempt.id],
    );
  }

  // No resumable session: restart only the deterministic reconcile process. It re-reads
  // Git/PR/DB and allocates a new hop; it never reuses another role's conversation.
  const launchKernel = deps.launchKernel
    || (await import('./harness-skill-relay.js')).launchKernelProcess;
  const launched = await launchKernel({
    taskId: task.id,
    runId: run.id,
    worktreePath: task.payload?.worktree_path,
  });
  if (launched) {
    out.resumed++;
    console.log(`[relay-watchdog][kernel-v1] reconcile restarted run=${run.id} pid=${launched.pid ?? '?'}`);
  }
}

const CONTEXT_RESUME_PHASES = new Set([
  'planning',
  'gan',
  'generate',
  'evaluate',
  'review',
  'merge',
]);

/**
 * Claim an answered needs_context checkpoint before launching its replacement
 * Controller. The phase remains orphan-safe `paused`; a leased
 * context-resume:* host/pid/heartbeat prevents duplicate recovery. Only after
 * the detached child receipt is durable is the original phase exposed.
 */
export async function _resumePausedKernelContext(run, task, deps, out) {
  const dbPool = deps.pool || deps.dbPool || pool;
  const contextResume = tryParseJson(run.context_resume);
  const requestHop = Number(contextResume?.context_request_hop);
  const resumePhase = contextResume?.resume_phase;
  if (!Number.isInteger(requestHop) || !CONTEXT_RESUME_PHASES.has(resumePhase)) {
    return false;
  }
  const now = deps.now?.() ?? new Date();
  const watchdogPid = deps.watchdogPid ?? process.pid;
  const resumeToken = (deps.randomUUID ?? randomUUID)();
  const claimHost = `context-resume:${resumeToken}`;
  const claimed = await dbPool.query(
    `UPDATE initiative_runs r
        SET orchestrator_heartbeat_at=$3,
            orchestrator_host=$4,
            orchestrator_pid=$5,
            updated_at=NOW()
      WHERE r.id=$1::uuid
        AND r.phase='paused'
        AND (
          r.orchestrator_host IS NULL
          OR r.orchestrator_host NOT LIKE 'context-resume:%'
          OR r.orchestrator_heartbeat_at < NOW() - INTERVAL '5 minutes'
        )
        AND EXISTS (
          SELECT 1
            FROM orchestrator_decision_log answer
           WHERE answer.run_id=r.id
             AND answer.action='verdict:context_answer'
             AND answer.detail->>'context_request_hop'=$2
        )
        AND NOT EXISTS (
          SELECT 1
            FROM orchestrator_decision_log newer
           WHERE newer.run_id=r.id
             AND newer.action='effect:context_requested'
             AND newer.hop>$2::integer
        )
      RETURNING r.id`,
    [run.id, String(requestHop), now, claimHost, watchdogPid],
  );
  if (claimed.rowCount !== 1) return false;

  const launchKernel = deps.launchKernel
    || (await import('./harness-skill-relay.js')).launchKernelProcess;
  let launched;
  try {
    launched = await launchKernel({
      taskId: task.id,
      runId: run.id,
      worktreePath: task.payload?.worktree_path,
      resumeToken,
    });
  } catch (error) {
    await dbPool.query(
      `UPDATE initiative_runs
          SET orchestrator_heartbeat_at=NULL,
              orchestrator_host=NULL,
              orchestrator_pid=NULL,
              updated_at=NOW()
        WHERE id=$1::uuid
          AND phase='paused'
          AND orchestrator_host=$2`,
      [run.id, claimHost],
    ).catch(() => {});
    throw error;
  }

  out.resumed++;
  console.log(
    `[relay-watchdog][kernel-v1] context child launched run=${run.id} `
    + `phase=${resumePhase} pid=${launched.pid ?? '?'}`,
  );
  return true;
}

/**
 * 查 initiative_run_events 是否存在 evaluator 已完成的心跳记录——
 * "PR 已 MERGED" 不等于"harness 验收流程走完了"，这是唯一能区分两者的机器信号。
 */
export async function _hasEvaluatorGate(dbPool, initiativeId) {
  const { rows } = await dbPool.query(
    `SELECT 1 FROM initiative_run_events WHERE initiative_id=$1 AND node='evaluator' AND status='done' LIMIT 1`,
    [initiativeId]
  );
  return rows.length > 0;
}

/**
 * PR 在 evaluator 从未执行时被合并（大概率人工看 CI 绿手动 merge）——开 P1 Issue + Bark。
 * best-effort：写入失败只 warn，绝不让告警失败拖垮 watchdog 主循环。
 */
export async function _raiseUngatedMergeAlert(dbPool, initiativeId, prUrl) {
  try {
    await dbPool.query(
      `INSERT INTO issues (title, priority, status, sub_area, body, journey_id)
       VALUES ($1, 'P1', 'In progress', 'brain', $2, NULL)`,
      [
        `[harness] initiative ${initiativeId} 的 PR 在 evaluator 未执行时被合并`,
        `PR ${prUrl} 已 MERGED，但 initiative_run_events 里从未出现 node='evaluator' AND status='done' 的记录——` +
          `这次合并绕过了 harness 的 evaluator+judge 验收流程（很可能是人工看 CI 绿之后手动合并）。` +
          `relay-watchdog 已把该 run 标 done 但打上 failure_reason='merged_without_evaluator_gate'，` +
          `不会触发 promoteRegressionOnHarnessMerged。请人工复核这份改动是否需要补验收。`,
      ]
    );
  } catch (err) {
    console.warn(`[relay-watchdog] 未验收合并 issue 写入失败 (non-fatal): ${err.message}`);
  }
  try {
    const { sendBark } = await import('./notifier.js');
    await sendBark(
      '⚠️ Harness PR 未经 evaluator 验收被合并',
      `initiative=${initiativeId}\nPR=${prUrl}\n请立即核查这份改动是否符合合同验收标准。`
    );
  } catch (err) {
    console.warn(`[relay-watchdog] 未验收合并 Bark 发送失败 (non-fatal): ${err.message}`);
  }
}

export async function _terminalizeRelayRun(dbPool, run, {
  outcome,
  reason = null,
  prUrl = null,
  patchRun = patchKernelRunById,
} = {}) {
  if (!run?.id) throw new Error('relay run identity missing');
  if (!run.current_task_id) {
    throw new Error(`relay run task identity missing: ${run.id}`);
  }
  if (!['done', 'failed'].includes(outcome)) {
    throw new Error(`invalid relay terminal outcome: ${outcome}`);
  }
  return patchRun(dbPool, {
    runId: run.id,
    phase: outcome,
    failureReason: reason,
    prUrl,
  });
}

/**
 * PR 已确认 MERGED 时的统一收口：门禁通过 → 原行为（标 done/completed + 触发 regression 提升）；
 * 门禁未通过 → 仍标 done/completed（PR 客观已合并无法撤销）但打 failure_reason，跳过 regression
 * 提升，并发未验收合并告警。opts.setPrUrl=true 用于 GitHub 反查分支（run 行本无 pr_url，顺手回写）。
 */
export async function _finalizeMergedRun(dbPool, run, prUrl, out, opts = {}) {
  const { terminalizeRun = _terminalizeRelayRun } = opts;
  const { initiative_id: initiativeId } = run;
  const gated = await _hasEvaluatorGate(dbPool, initiativeId);

  await terminalizeRun(dbPool, run, {
    outcome: 'done',
    reason: gated ? null : 'merged_without_evaluator_gate',
    prUrl,
  });
  await _closeSpawnEvents(dbPool, initiativeId, 'done');

  out.mergedPr++;

  if (gated) {
    try {
      const { promoteRegressionOnHarnessMerged } = await import('./lib/callback-postprocess.js');
      await promoteRegressionOnHarnessMerged(initiativeId, null, prUrl, dbPool);
    } catch (promoteErr) {
      console.warn(`[relay-watchdog] promoteRegressionOnHarnessMerged 失败 (non-fatal): ${promoteErr.message}`);
    }
    console.log(`[relay-watchdog] PR 已 MERGED（evaluator 已验收）→ 标 completed initiative=${initiativeId} pr=${prUrl}`);
  } else {
    out.mergedWithoutGate++;
    await _raiseUngatedMergeAlert(dbPool, initiativeId, prUrl);
    console.warn(`[relay-watchdog] PR 已 MERGED 但 evaluator 未执行 → 标 done+未验收告警 initiative=${initiativeId} pr=${prUrl}`);
  }
}

/**
 * @param {{pool?: object, execFn?: (cmd:string)=>string, spawnFn?: Function}} deps
 * @returns {Promise<{scanned:number, resumed:number, capped:number, housekept:number}>}
 */
export async function resumeStalledRelayRuns(deps = {}) {
  const dbPool = deps.pool || deps.dbPool || pool;
  const execFn = deps.execFn || ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 10000 }));
  const terminalizeRun = deps.terminalizeRun || _terminalizeRelayRun;
  const out = { scanned: 0, resumed: 0, capped: 0, housekept: 0, mergedPr: 0, mergedWithoutGate: 0 };

  // 每个 task identity 逐行扫描；attempt cap 只统计同一 task 的 v2 run。
  // 已知缺口（Notion Issue 1ea53e09-b088-4d2a-b03a-ad8c976bbc6c）：这个计数只统计
  // initiative_runs 里已成功 INSERT 的行，早期 spawn 失败（例如 spawn 前就挂掉，
  // 从未写入 initiative_runs）不计数，可能导致 attempts 长期低估、MAX_RELAY_ATTEMPTS
  // 封顶判断失效，从而无限重跑不收敛。暂未修，先记录跟踪。
  const runsQ = await dbPool.query(
    `WITH candidate_runs AS (
       SELECT r.id, r.initiative_id, r.current_task_id,
            phase, deadline_at, pr_url, orchestrator_host,
            orchestrator_heartbeat_at, completed_at, tmux_killed_at, started_at,
            (
              SELECT jsonb_build_object(
                'context_request_hop', request.hop,
                'resume_phase', request.detail->>'resume_phase'
              )
                FROM orchestrator_decision_log request
               WHERE request.run_id=r.id
                 AND request.action='effect:context_requested'
                 AND request.hop=(
                   SELECT MAX(latest_request.hop)
                     FROM orchestrator_decision_log latest_request
                    WHERE latest_request.run_id=r.id
                      AND latest_request.action='effect:context_requested'
                 )
                 AND EXISTS (
                   SELECT 1
                     FROM orchestrator_decision_log answer
                    WHERE answer.run_id=request.run_id
                      AND answer.action='verdict:context_answer'
                      AND answer.detail->>'context_request_hop'=request.hop::text
                 )
               ORDER BY request.hop DESC
               LIMIT 1
            ) AS context_resume,
            (SELECT COUNT(*) FROM initiative_runs r2
              WHERE r2.current_task_id = r.current_task_id
                AND r2.orchestrator_version = 'v2') AS attempts
         FROM initiative_runs r
        WHERE r.orchestrator_version = 'v2'
          AND r.current_task_id IS NOT NULL
          AND (
            phase NOT IN ('done', 'failed')
            OR (
              orchestrator_host IN (
                'skill-relay-codex-headed',
                'skill-relay-claude-headed'
              )
              AND phase = 'done'
              AND tmux_killed_at IS NULL
            )
          )
          AND (
            phase <> 'paused'
            OR orchestrator_host IS NULL
            OR orchestrator_host NOT LIKE 'context-resume:%'
            OR orchestrator_heartbeat_at IS NULL
            OR orchestrator_heartbeat_at < NOW() - INTERVAL '5 minutes'
          )
     )
     SELECT *
       FROM candidate_runs
      ORDER BY (context_resume IS NOT NULL) DESC, started_at DESC, id DESC
      LIMIT 20`
  );
  // 护栏:注入的 pool 对未知 SQL 返回 undefined 时(集成测试 fake),按空处理
  const runs = runsQ && Array.isArray(runsQ.rows) ? runsQ.rows : [];
  out.scanned = runs.length;

  for (const run of runs) {
    try {
      const taskQ = await dbPool.query(
        `SELECT id, status, title, description, payload, pr_url FROM tasks WHERE id = $1`,
        [run.current_task_id]
      );
      const task = taskQ.rows[0];

      // house-keeping：task 已终态 → run 行收敛（防巡逻类误报/僵尸行堆积）
      if (!task) {
        console.warn(`[relay-watchdog] parent task missing; fail closed run=${run.id}`);
        continue;
      }
      if (task.status === 'completed') {
        await terminalizeRun(dbPool, run, { outcome: 'done' });
        out.housekept++;
        continue;
      }
      if (['cancelled', 'canceled'].includes(task.status)) {
        await terminalizeRun(dbPool, run, {
          outcome: 'failed',
          reason: 'task_cancelled',
        });
        out.housekept++;
        continue;
      }
      if (task.status === 'failed') {
        // failure_reason 必写 —— 旁边四条同类 UPDATE 都写了，只有这条留空，
        // 界面上这类 run 的失败原因永远是空的（事故 51836fb2 复盘卡在这）。
        // COALESCE：kernel/上游已写过更具体的原因时不覆盖。
        await terminalizeRun(dbPool, run, {
          outcome: 'failed',
          reason: 'task_failed_upstream',
        });
        out.housekept++;
        continue;
      }

      // 只管 in_progress（queued 归 dispatcher，防双 spawn）
      if (task.status !== 'in_progress') continue;
      // 安全护栏：只碰 skill-relay 任务
      if (task.payload?.orchestrator !== 'skill-relay') continue;
      // needs_context 在答案到达前保持 paused；答案到达后由 watchdog 先用
      // context-resume:* lease CAS 领取，再启动新 Controller，最后凭
      // pid/host/heartbeat receipt 发布 resume_phase。没有答案时进程退出
      // 是预期行为，不得当成 stalled run。
      if (run.phase === 'paused') {
        if (task.payload?.harness_runtime === 'kernel-v1' && run.context_resume) {
          await _resumePausedKernelContext(run, task, deps, out);
        }
        continue;
      }
      // 前台点火 run（POST /relay-runs 建档，host='foreground'）没有 cecelia-relay-* 容器，
      // "容器消失=死跑"判据对它恒真——跳过重点火，防 spawn 无头容器与前台会话双跑。
      // 前台崩溃恢复靠人（用户在场是前台模式的定义）；上方 house-keeping 分支仍对其生效。
      if (run.orchestrator_host === 'foreground') continue;
      // deadline 逾期归 scanStuckHarness
      if (run.deadline_at && new Date(run.deadline_at).getTime() < Date.now()) continue;

      // defer_until 未到期 → 跳过（rate_limit 处置）
      if (task.payload?.defer_until && task.payload.defer_until > Date.now()) {
        console.log(`[relay-watchdog] defer_until 未到期，跳过 initiative=${run.initiative_id}`);
        continue;
      }

      if (task.payload?.harness_runtime === 'kernel-v1') {
        await _recoverKernelRun(run, task, deps, out);
        continue;
      }

      const short = shortId(task.id);
      // 收账权收归（Task 4 harness-finalize 降级标记）：generator 已完成但 evaluator 未跑时仍需重点火。
      // 只有 generator_done=true 且 evaluator 也已完成才跳过重点火（防重复 PR）。
      const generatorDone = task.payload?.generator_done === true;

      // ─── headed 分支：ssh+tmux 存活检测 + 收窗幂等 ────────────────────────
      if (HEADED_HOST_VALUES.includes(run.orchestrator_host)) {
        const { needsRefire } = await _handleHeadedRun(run, task, { dbPool, execFn, short });
        let skipRefire = false;
        if (needsRefire && generatorDone) {
          const evaluatorDone = await _hasEvaluatorGate(dbPool, run.initiative_id);
          if (evaluatorDone) {
            console.log(`[relay-watchdog][headed] generator_done=true + evaluator_done → 跳过重点火 initiative=${run.initiative_id}`);
            skipRefire = true;
          } else {
            // generator 完成但 evaluator 未跑 → 重点火让 controller 从 Step 4 恢复
            console.log(`[relay-watchdog][headed] generator_done=true 但 evaluator 未完成 → 允许重点火 initiative=${run.initiative_id}`);
          }
        }
        if (needsRefire && !skipRefire) {
          // session 消失 → 重点火（走 spawnFn，即 headed 路径）
          const spawnFn = deps.spawnFn
            || (await import('./harness-skill-relay.js')).spawnSkillRelaySession;
          const r = await spawnFn(task, { pool: dbPool });
          // r?.ok===true（spawnSkillRelaySession 结果）或 r 非 falsy（直接 mock spawnFn 结果）时计 resumed
          if (r?.ok !== false && r) {
            out.resumed++;
            console.log(`[relay-watchdog][headed] 重点火 initiative=${run.initiative_id}`);
          } else {
            console.warn(`[relay-watchdog][headed] 重点火失败 initiative=${run.initiative_id}: ${r?.error}`);
          }
        }
        continue;
      }
      // ─── end headed ────────────────────────────────────────────────────────

      // 在跑容器存活检查（spawn 命名规约 cecelia-relay-<task8>-*）
      let running = '';
      try {
        running = execFn(`docker ps -q --filter "name=cecelia-relay-${short}"`).trim();
      } catch { running = ''; /* docker 不可用时保守跳过（不盲目重点火） */ continue; }
      if (running) continue;

      // 收账权收归超时兜底：generator 完成后超 GENERATOR_DONE_TIMEOUT_MS 仍无 MERGED → 标 failed 不永挂（e90c0fbb 缓解）。
      // 未到期时不 continue——仍要跑下方 PR 前置检查（发现 MERGED 自然收口），只在 spawn 前拦"落到重点火"。
      if (generatorDone) {
        // 锚点优先 payload.generator_done_at；缺失/不可解析（NaN）时回退 run.started_at，防锚点丢失=永挂。
        let doneAt = task.payload?.generator_done_at ? new Date(task.payload.generator_done_at).getTime() : 0;
        if (!doneAt && run.started_at) doneAt = new Date(run.started_at).getTime();
        if (doneAt && Date.now() - doneAt > GENERATOR_DONE_TIMEOUT_MS) {
          // 到期前最后核一次 PR（有 url 才核；MERGED 走统一收口）
          const rawPr = run.pr_url || task.pr_url || task.payload?.pr_url || null;
          let mergedLate = false;
          if (typeof rawPr === 'string' && rawPr.startsWith('https://github.com/')) {
            try { mergedLate = JSON.parse(execFn(`gh pr view "${rawPr}" --json state`)).state === 'MERGED'; } catch { mergedLate = false; }
          }
          if (mergedLate) {
            await _finalizeMergedRun(dbPool, run, rawPr, out, { terminalizeRun });
            continue;
          }
          await terminalizeRun(dbPool, run, {
            outcome: 'failed',
            reason: 'generator_done_timeout',
          });
          await _closeSpawnEvents(dbPool, run.initiative_id, 'failed');
          out.capped++;
          console.warn(`[relay-watchdog] generator_done 超时 → 标 failed initiative=${run.initiative_id}`);
          continue;
        }
      }

      // PR merge 状态前置检查：容器消失时，先查 PR 是否已 MERGED
      // fallback 链：run.pr_url → tasks.pr_url → task.payload.pr_url
      // 防御：只取经 https://github.com/ 前缀校验的字符串，杜绝 payload JSON blob 注入 shell
      const rawPrUrl = run.pr_url || task.pr_url || task.payload?.pr_url || null;
      const effectivePrUrl = (typeof rawPrUrl === 'string' && rawPrUrl.startsWith('https://github.com/')) ? rawPrUrl : null;
      // MERGED → 直接标 completed/done，不重点火不标 failed
      if (effectivePrUrl) {
        try {
          const ghOut = execFn(`gh pr view "${effectivePrUrl}" --json state`);
          const prState = JSON.parse(ghOut).state;
          if (prState === 'MERGED') {
            await _finalizeMergedRun(dbPool, run, effectivePrUrl, out, { terminalizeRun });
            continue;
          }
          if (prState === 'OPEN') {
            // 死局检测：区分"CI 红/BEHIND/DIRTY（需 agent 介入）"和"CI 跑中/全绿（等待 merge）"
            let isBehind = false;
            let isDirty = false;
            let ciStatus = 'pending';
            try {
              try {
                // 主路径：gh pr checks --json（含 execTolerant 兜底，支持非零退出 + stdout 解析）
                const checksOut = execTolerant(execFn, `gh pr checks "${effectivePrUrl}" --json state`);
                const checkRows = Array.isArray(tryParseJson(checksOut)) ? tryParseJson(checksOut) : [];
                ciStatus = mapCiStatus(checkRows);
                // BEHIND/DIRTY 从 mergeStateStatus 独立查询（best-effort）
                try {
                  const viewDetail = tryParseJson(execFn(`gh pr view "${effectivePrUrl}" --json mergeStateStatus`));
                  isBehind = viewDetail?.mergeStateStatus === 'BEHIND';
                  isDirty = viewDetail?.mergeStateStatus === 'DIRTY';
                } catch { /* best-effort */ }
              } catch (checksErr) {
                // fallback：老版 gh 不支持 --json 标志（err.stdout 为空 + message 含 unknown flag）
                // 其他错误（auth/network）→ 重抛 → 外层 catch 保守跳过
                if (checksErr.message && (checksErr.message.includes('unknown flag') || checksErr.message.includes('flag provided but not defined'))) {
                  // statusCheckRollup 替代（容器内老版 gh 不支持 --json 标志）
                  const prDetail = tryParseJson(execFn(`gh pr view "${effectivePrUrl}" --json statusCheckRollup,mergeStateStatus`));
                  isBehind = prDetail?.mergeStateStatus === 'BEHIND';
                  isDirty = prDetail?.mergeStateStatus === 'DIRTY';
                  const statusCheckRollup = prDetail?.statusCheckRollup ?? [];
                  ciStatus = mapCiStatus(statusCheckRollup);
                } else {
                  throw checksErr;
                }
              }
            } catch (ciErr) {
              // gh 调用失败 → 保守跳过（失败保守策略：不盲目重点火）
              console.warn(`[relay-watchdog] CI 状态查询失败，initiative=${run.initiative_id} 保守跳过: ${ciErr.message}`);
              continue;
            }

            if (isBehind || isDirty || ciStatus === 'fail') {
              // BEHIND、DIRTY 或 CI 红 → 需要 agent 介入，落穿到下方重点火逻辑
              const reason = isDirty ? 'resume_conflict' : (isBehind ? 'BEHIND' : 'CI_FAILURE');
              console.log(`[relay-watchdog] resume_ci_red initiative=${run.initiative_id} pr=${effectivePrUrl} reason=${reason}`);
              // fall through — 不 continue，走下方 cap 检查 → spawn
            } else if (!isDirty && ciStatus === 'pending') {
              // CI 跑中/pending（非 DIRTY）→ 等待，不重点火
              console.log(`[relay-watchdog] wait_ci_running initiative=${run.initiative_id} pr=${effectivePrUrl}`);
              continue;
            } else {
              // CI 全绿 + 非 BEHIND → evaluator 已完成则等待 merge；未完成则重点火（feat(harness): PR 不被 auto-merge）
              const evaluatorDoneGreen = await _hasEvaluatorGate(dbPool, run.initiative_id);
              if (evaluatorDoneGreen) {
                console.log(`[relay-watchdog] skip_green_waiting_merge (evaluator已完成) initiative=${run.initiative_id} pr=${effectivePrUrl}`);
                continue;
              }
              console.log(`[relay-watchdog] ci_green_evaluator_pending → 允许重点火 initiative=${run.initiative_id} pr=${effectivePrUrl}`);
              // fall through — evaluator 未完成，需重点火让 controller 从 Step 4 恢复
            }
          }
          // CLOSED（工作被否决）→ 落穿走原逻辑，允许重跑
        } catch {
          // gh 不可用或 PR 查询失败 → 保守跳过，不盲目重点火
          console.warn(`[relay-watchdog] gh pr view 失败，initiative=${run.initiative_id} 保守跳过`);
          continue;
        }
      }

      // PR 发现护栏（Issue 198ba8db）：relay session 不回写 pr_url，DB 三处全空时
      // 上方 MERGED 护栏失明——先从 GitHub 按分支名含 short 反查，防止
      // "已有 PR 在等 CI/审批" 被误判死跑而重复点火出重复 PR。
      if (!effectivePrUrl) {
        let discovered = null;
        try {
          discovered = _discoverPrFromGithub(task, short, execFn);
        } catch (err) {
          console.warn(`[relay-watchdog] PR 发现失败，initiative=${run.initiative_id} 保守跳过: ${err.message}`);
          continue;
        }
        if (discovered && discovered.state === 'MERGED') {
          if (generatorDone) {
            console.log(`[relay-watchdog] discovered_merged_via_fallback initiative=${run.initiative_id} pr=${discovered.url}`);
          }
          await _finalizeMergedRun(dbPool, run, discovered.url, out, { terminalizeRun });
          continue;
        }
        if (discovered && discovered.state === 'OPEN') {
          await dbPool.query(
            `UPDATE initiative_runs SET pr_url=$2
              WHERE id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
            [run.id, discovered.url]
          );
          await dbPool.query(
            `UPDATE tasks SET pr_url=$2 WHERE id=$1 AND pr_url IS NULL`,
            [task.id, discovered.url]
          );
          console.log(`[relay-watchdog] GitHub 发现在途 OPEN PR → 回写 pr_url 跳过重点火 initiative=${run.initiative_id} pr=${discovered.url}`);
          continue;
        }
        // 仅 CLOSED / 无命中 → 走原逻辑（attempt cap → 重点火）
      }

      // B6: 上限熔断（codex=2，claude=5）
      const attempts = parseInt(run.attempts, 10) || 0;
      const maxAttempts = run.orchestrator_host === 'skill-relay-codex'
        ? MAX_CODEX_RELAY_ATTEMPTS
        : MAX_RELAY_ATTEMPTS;
      if (attempts >= maxAttempts) {
        await terminalizeRun(dbPool, run, {
          outcome: 'failed',
          reason: 'relay_watchdog_attempt_cap',
        });
        await _closeSpawnEvents(dbPool, run.initiative_id, 'failed');
        out.capped++;
        console.warn(`[relay-watchdog] initiative=${run.initiative_id} 达重点火上限(${attempts})，标 failed`);
        continue;
      }

      // generator 已完成 + evaluator 也已完成 → 跳过重点火（防重复 PR）。未到期的超时兜底放行到此，PR 检查已跑过。
      // 修复（刀A2）：pr_url 为空时，先从 GitHub 反查 PR——relay session 不回写 pr_url，
      // generator_done=true 时直接 continue 会导致 _discoverPrFromGithub 永不被调用，
      // MERGED PR 无法自动收口，OPEN PR 无法回写。
      // 修复（evaluator gate）：evaluator 未完成时不能无条件跳过重点火，否则 evaluator stage 永远无法执行。
      if (generatorDone) {
        if (!effectivePrUrl) {
          // pr_url 三处全空 → 先反查 GitHub，再决定是否 continue（不 spawn）
          let discovered = null;
          try {
            discovered = _discoverPrFromGithub(task, short, execFn);
          } catch (err) {
            console.warn(`[relay-watchdog] generator_done 反查失败，initiative=${run.initiative_id} 保守跳过: ${err.message}`);
            continue;
          }
          if (discovered && discovered.state === 'MERGED') {
            console.log(`[relay-watchdog] discovered_merged_via_fallback initiative=${run.initiative_id} pr=${discovered.url}`);
            await _finalizeMergedRun(dbPool, run, discovered.url, out, { terminalizeRun });
            continue;
          }
          if (discovered && discovered.state === 'OPEN') {
            await dbPool.query(
              `UPDATE initiative_runs SET pr_url=$2
                WHERE id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
              [run.id, discovered.url]
            );
            await dbPool.query(
              `UPDATE tasks SET pr_url=$2 WHERE id=$1 AND pr_url IS NULL`,
              [task.id, discovered.url]
            );
            console.log(`[relay-watchdog] generator_done 反查 OPEN → 回写 pr_url 跳过重点火 initiative=${run.initiative_id} pr=${discovered.url}`);
            continue;
          }
          // 无命中 → 落穿到下方 evaluator gate 判断
        }
        const evaluatorDone = await _hasEvaluatorGate(dbPool, run.initiative_id);
        if (evaluatorDone) {
          console.log(`[relay-watchdog] generator_done=true + evaluator_done → 跳过重点火 initiative=${run.initiative_id}`);
          continue;
        }
        console.log(`[relay-watchdog] generator_done=true 但 evaluator 未完成 → 允许重点火 initiative=${run.initiative_id}`);
      }

      // OOM 感知重试（刀A7）
      const lastExitCode = task.payload?.last_container_exit_code;
      const oomUpgraded = task.payload?.oom_upgraded === true;

      // GP2：oom_upgraded=true + exit=137 → 禁止二次升档，直接标 failed/oom_wall
      if (oomUpgraded && lastExitCode === 137) {
        await terminalizeRun(dbPool, run, {
          outcome: 'failed',
          reason: 'oom_wall',
        });
        await _closeSpawnEvents(dbPool, run.initiative_id, 'failed');
        out.capped++;
        console.warn(`[relay-watchdog] oom_wall initiative=${run.initiative_id} exit=137 after oom_upgrade → 标 failed`);
        continue;
      }

      // 重点火（spawnSkillRelaySession 会 INSERT 新 run 行 = attempts+1）
      const spawnFn = deps.spawnFn
        || (await import('./harness-skill-relay.js')).spawnSkillRelaySession;

      // 死因分类器（刀A8-1/A8-2）—— 审计日志 + 路由处置
      {
        const { classifyDeath } = await import('./harness-death-classifier.js');
        const classified = classifyDeath({
          exitCode: lastExitCode ?? null,
          stdoutTail: task.payload?.stdout_tail ?? null,
          tmuxPane: null, // headless 路径无 tmux
        });
        // 审计日志（INV-06）—— 每次收尸必打
        console.log(`[relay-watchdog] cause=${classified.cause} action=${classified.action} initiative=${run.initiative_id}`);

        // A8-2: 按 cause 路由处置器
        if (classified.cause === 'auth') {
          const { handleAuth } = await import('./harness-death-handlers.js');
          const { resolveAccount } = await import('./spawn/middleware/account-rotation.js');
          const { markAuthFailure } = await import('./account-usage.js');
          let barkFn = () => {};
          try { barkFn = (await import('./notifier.js')).sendBark ?? barkFn; } catch { /* notifier 不可用，用默认空函数 */ }
          await handleAuth(task, {
            cause: classified.cause,
            spawnFn,
            markAuthFailedFn: (account) => markAuthFailure(account, null, 'watchdog_auth'),
            resolveAccountFn: resolveAccount,
            pool: dbPool,
            barkFn: async (msg) => barkFn('[Auth Blocked]', msg),
          });
          continue; // auth 处置完毕，不走下面的普通重点火
        } else if (classified.cause === 'rate_limit') {
          // defer_until 未到期时跳过已在外层 defer_until 检查处理；首次写入 defer_until
          const { handleRateLimit } = await import('./harness-death-handlers.js');
          await handleRateLimit(task, { cause: classified.cause, spawnFn, pool: dbPool });
          continue; // rate_limit defer，不烧 attempt
        } else if (classified.cause === 'green_waiting_merge') {
          const { handleGreenWaitingMerge } = await import('./harness-death-handlers.js');
          await handleGreenWaitingMerge(task, { cause: classified.cause, spawnFn, pool: dbPool });
          continue;
        } else if (classified.cause === 'interactive_stuck') {
          const { handleInteractiveStuck } = await import('./harness-death-handlers.js');
          const tmuxSession = run.tmux_session ?? null;
          const { execSync } = await import('child_process');
          await handleInteractiveStuck(task, {
            cause: classified.cause,
            spawnFn,
            execFn: execSync,
            pool: dbPool,
            tmuxSession,
          });
          continue;
        }
        // unknown / ci_red / oom → 下面的现行路径（OOM 升档或普通重点火）
      }

      // GP1：exit=137 首次（oom_upgraded 为 false）→ 升档重点火（4096m）
      const isOomExit = lastExitCode === 137 && !oomUpgraded;
      const spawnOpts = { pool: dbPool };
      if (isOomExit) {
        spawnOpts.memoryTier = 'oom_upgrade';
        spawnOpts.env = { HARNESS_RELAY_MEMORY_OVERRIDE: '4096' };
      }

      const r = await spawnFn(task, spawnOpts);
      if (r?.ok) {
        out.resumed++;
        if (isOomExit) {
          // 升档后回写 oom_upgraded=true，防止第三次触发再次升档
          await dbPool.query(
            `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || '{"oom_upgraded":true}'::jsonb
              WHERE id=$1`,
            [task.id]
          );
          console.log(`[relay-watchdog] resume_oom_upgraded initiative=${run.initiative_id} attempt=${attempts + 1} container=${r.containerId}`);
        } else {
          console.log(`[relay-watchdog] 重点火 initiative=${run.initiative_id} attempt=${attempts + 1} container=${r.containerId}`);
        }
      } else {
        console.warn(`[relay-watchdog] 重点火失败 initiative=${run.initiative_id}: ${r?.error}`);
      }
    } catch (err) {
      console.warn(`[relay-watchdog] initiative=${run.initiative_id} 处理失败（non-fatal）: ${err.message}`);
    }
  }
  return out;
}

// ─── headed 辅助：tmux 存活检测 + 收窗幂等 ───────────────────────────────────

// run done 后多久触发收窗（毫秒）
const HEADED_KILL_AFTER_MS = 30 * 60 * 1000; // 30 分钟

/**
 * 处理 headed run。
 * 返回 { needsRefire: boolean } 告知调用方是否需要重点火。
 *
 * 逻辑：
 * 1. run phase=done + tmux_killed_at 已有 → 幂等跳过
 * 2. run phase=done + completed_at 超 30min + tmux_killed_at 为空 → kill-session + 写 tmux_killed_at
 * 3. run phase=A_planning → ssh tmux has-session 检查（fail-open on ssh 连接失败）
 *    - ssh 本身失败（连接错误/超时）→ fail-open，不重点火
 *    - session 消失（exit 非零，status=1）→ 返回 { needsRefire: true }
 *    - session 存在 → 正常，不重点火
 */
async function _handleHeadedRun(run, task, { dbPool, execFn, short }) {
  const prefix = run.orchestrator_host === HEADED_HOSTS.claude
    ? HEADED_TMUX_PREFIXES.claude : HEADED_TMUX_PREFIXES.codex;
  const tmuxSession = `${prefix}${short}`;
  const sshHost = task.payload?.ssh_host || process.env.HEADED_SSH_HOST || 'localhost';

  // 收窗逻辑：run done
  if (run.phase === 'done') {
    // 幂等：已收窗跳过
    if (run.tmux_killed_at) {
      return { needsRefire: false };
    }
    const completedAt = run.completed_at ? new Date(run.completed_at).getTime() : 0;
    if (completedAt && Date.now() - completedAt > HEADED_KILL_AFTER_MS) {
      // 触发收窗（ssh 失败 fail-open 不阻塞 tmux_killed_at 写入）
      try {
        execFn(`ssh ${sshHost} "tmux kill-session -t ${tmuxSession}"`);
        console.log(`[relay-watchdog][headed] 收窗 kill-session: session=${tmuxSession} initiative=${run.initiative_id}`);
      } catch (err) {
        console.warn(`[relay-watchdog][headed] kill-session ssh 失败（fail-open）: ${err.message}`);
      }
      // 写 tmux_killed_at（幂等标）
      await dbPool.query(
        `UPDATE initiative_runs SET tmux_killed_at=NOW()
          WHERE id=$1 AND orchestrator_version='v2' AND tmux_killed_at IS NULL`,
        [run.id]
      );
      console.log(`[relay-watchdog][headed] tmux_killed_at 已写入 initiative=${run.initiative_id}`);
    }
    return { needsRefire: false };
  }

  // 存活检测：非终态活跃阶段（planning/gan/generate 等）→ ssh tmux has-session（fail-open on ssh 连接错误）
  // 原写死 'A_planning' 是旧 LangGraph 图 phase 命名，relay 真实 phase 是 planning/gan/generate →
  // 判据永不命中=死代码，中途死的 headed session 永远不被重点火。done 已在上方处理、failed 被上游
  // query 过滤，此处剩的都是活跃 phase，故按非终态判定。
  if (run.phase !== 'done' && run.phase !== 'failed') {
    try {
      execFn(`ssh ${sshHost} "tmux has-session -t ${tmuxSession}"`);
      // exit 0 → session 存在，正常
      return { needsRefire: false };
    } catch (err) {
      // 区分 ssh 连接失败（fail-open）vs tmux session 消失（触发重点火）
      const isSshFailure = err.message?.includes('Connection refused')
        || err.message?.includes('connection refused')
        || err.message?.includes('timed out')
        || err.message?.includes('ETIMEDOUT')
        || err.code === 'ETIMEDOUT'
        || err.code === 'ECONNREFUSED';
      if (isSshFailure) {
        // ssh 本身失败：fail-open，跳过（不重点火）
        console.warn(`[relay-watchdog][headed] ssh 失败 fail-open，initiative=${run.initiative_id}: ${err.message}`);
        return { needsRefire: false };
      }
      // session 消失（tmux has-session exit 1）→ 需要重点火
      console.log(`[relay-watchdog][headed] session 消失，触发重点火 initiative=${run.initiative_id}`);
      return { needsRefire: true };
    }
  }

  return { needsRefire: false };
}

// ─── end headed ──────────────────────────────────────────────────────────────

/**
 * B8 — 8h 逾期 scanStuckHarness 收尸（所有 skill-relay* host）。
 * 扫描 deadline_at < NOW() 且 orchestrator_host LIKE 'skill-relay%' 的 initiative_runs，
 * 标 phase='failed', failure_reason='relay_deadline_exceeded' 并更新关联 task status='failed'。
 * 原写死 'skill-relay-codex' → claude-headed/skill-relay-session 等 host 逾期永不收尸，
 * 占死并发槽堵队列（claude-headed-smoke 逾期18h 实证）。
 */
export async function scanStuckHarness(opts = {}) {
  const dbPool = opts.pool || pool;
  const resolvePrHead = opts.resolvePrHead || defaultPrHeadResolver;
  const terminalizeRun = opts.terminalizeRun || _terminalizeRelayRun;

  const overdueQ = await dbPool.query(
    `SELECT id, initiative_id, current_task_id, orchestrator_host, phase, deadline_at, pr_url
       FROM initiative_runs
      WHERE orchestrator_host LIKE 'skill-relay%'
        AND current_task_id IS NOT NULL
        AND deadline_at < NOW()
        AND phase NOT IN ('done', 'failed')
        AND completed_at IS NULL
      LIMIT 50`
  );

  const rows = overdueQ?.rows ?? [];
  for (const row of rows) {
    try {
      const openReviewQ = await dbPool.query(
        `SELECT review_request.hop AS review_request_hop,
                review_request.observed #>> '{pr,head_sha}' AS review_head_sha
           FROM orchestrator_decision_log review_request
          WHERE review_request.run_id = $1
            AND review_request.action = 'effect:human_review_requested'
            AND NOT EXISTS (
              SELECT 1
                FROM orchestrator_decision_log approval
               WHERE approval.run_id = review_request.run_id
                 AND approval.action = 'verdict:human_review'
                 AND approval.detail->>'review_request_hop' = review_request.hop::text
            )
            AND NOT EXISTS (
              SELECT 1
                FROM orchestrator_decision_log later
               WHERE later.run_id = review_request.run_id
                 AND later.hop > review_request.hop
            )
          ORDER BY review_request.hop DESC
          LIMIT 1`,
        [row.id],
      );
      const openReview = openReviewQ.rows?.[0] ?? null;
      if (openReview && row.pr_url) {
        let currentHeadSha;
        try {
          currentHeadSha = await resolvePrHead(row.pr_url);
        } catch (error) {
          console.warn(
            `[relay-watchdog] scanStuckHarness: review head lookup deferred ` +
            `run=${row.id}: ${error.message}`,
          );
          continue;
        }
        if (!currentHeadSha) {
          console.warn(
            `[relay-watchdog] scanStuckHarness: review head unavailable; deferred run=${row.id}`,
          );
          continue;
        }
        if (currentHeadSha === openReview.review_head_sha) continue;
      }

      const failedRun = await terminalizeRun(dbPool, row, {
        outcome: 'failed',
        reason: 'relay_deadline_exceeded',
      });
      if (!failedRun) continue;
      await _closeSpawnEvents(dbPool, row.initiative_id, 'failed');
      console.warn(`[relay-watchdog] scanStuckHarness: overdue codex run id=${row.id} initiative=${row.initiative_id} deadline=${row.deadline_at}`);
    } catch (err) {
      console.error(`[relay-watchdog] scanStuckHarness cleanup failed for run ${row.id}: ${err.message}`);
    }
  }
}
