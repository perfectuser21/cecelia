import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';

function rollbackError(code, cause) {
  const error = new Error(code, cause == null ? undefined : { cause });
  error.code = code;
  return error;
}

export function classifyRollbackRouteState(route, observed) {
  if (
    !route
    || !/^sha256:[0-9a-f]{64}$/.test(route.expected_digest ?? '')
    || !/^sha256:[0-9a-f]{64}$/.test(route.expected_current_digest ?? '')
    || !/^sha256:[0-9a-f]{64}$/.test(observed?.digest ?? '')
  ) {
    throw rollbackError('release_rollback_route_state_invalid');
  }
  if (observed.digest === route.expected_current_digest) {
    if (
      route.readback_kind === 'dashboard-release'
      && (
        observed.version !== route.expected_current_version
        || observed.merge_sha !== route.expected_current_merge_sha
      )
    ) {
      throw rollbackError('release_rollback_current_cas_mismatch');
    }
    return 'pending';
  }
  if (observed.digest === route.expected_digest) {
    if (
      route.readback_kind === 'dashboard-release'
      && (
        observed.version !== route.args?.[1]
        || observed.merge_sha !== route.target_merge_sha
      )
    ) {
      throw rollbackError('release_rollback_current_cas_mismatch');
    }
    return 'completed';
  }
  throw rollbackError('release_rollback_current_cas_mismatch');
}

export function buildIndependentRollbackSettlement({
  claimId,
  generation,
  effectMayHaveStarted,
  errorCode,
}) {
  if (
    !Number.isInteger(Number(claimId))
    || Number(generation) !== 1
    || typeof effectMayHaveStarted !== 'boolean'
    || typeof errorCode !== 'string'
    || errorCode.length === 0
  ) {
    throw rollbackError('release_rollback_independent_terminal_invalid');
  }
  return {
    claim_id: Number(claimId),
    generation: 1,
    status: effectMayHaveStarted
      ? (errorCode === 'release_rollback_aborted' ? 'aborted' : 'unknown')
      : 'failed',
    late_effect_risk: effectMayHaveStarted,
    evidence: {
      source: effectMayHaveStarted
        ? 'release_rollback_worker_independent_terminal'
        : 'release_rollback_worker_pre_effect_terminal',
      error_code: errorCode,
    },
  };
}

export function readWorkflowLinksDigest(manifestPath) {
  const manifest = readFileSync(manifestPath, 'utf8');
  for (const line of manifest.split('\n').filter(Boolean)) {
    const [liveSkill, priorTarget, ...extra] = line.split('\t');
    if (!liveSkill?.startsWith('/') || !priorTarget || extra.length > 0) {
      throw rollbackError('release_rollback_workflow_manifest_invalid');
    }
    if (priorTarget === 'absent') {
      if (existsSync(liveSkill)) {
        throw rollbackError('release_rollback_workflow_live_readback_mismatch');
      }
      continue;
    }
    const stat = lstatSync(liveSkill);
    if (!stat.isSymbolicLink() || readlinkSync(liveSkill) !== priorTarget) {
      throw rollbackError('release_rollback_workflow_live_readback_mismatch');
    }
  }
  return `sha256:${createHash('sha256').update(manifest).digest('hex')}`;
}

export function readWorkflowCurrentLinksDigest(manifestPath) {
  const lines = [];
  const manifest = readFileSync(manifestPath, 'utf8');
  for (const line of manifest.split('\n').filter(Boolean)) {
    const [liveSkill, priorTarget, ...extra] = line.split('\t');
    if (!liveSkill?.startsWith('/') || !priorTarget || extra.length > 0) {
      throw rollbackError('release_rollback_workflow_manifest_invalid');
    }
    let currentTarget = 'absent';
    if (existsSync(liveSkill)) {
      const stat = lstatSync(liveSkill);
      if (!stat.isSymbolicLink()) {
        throw rollbackError('release_rollback_workflow_live_readback_mismatch');
      }
      currentTarget = readlinkSync(liveSkill);
    }
    lines.push(`${liveSkill}\t${currentTarget}\n`);
  }
  return `sha256:${createHash('sha256').update(lines.join('')).digest('hex')}`;
}

export async function runLeasedRollbackRoutes({
  routes,
  rollbackTargets,
  claimId,
  generation,
  renew,
  settle,
  preflightRoutes = async () => {},
  runRoute,
  abortSignal,
  renewalIntervalMs = 60_000,
}) {
  if (
    !Array.isArray(routes)
    || routes.length === 0
    || !Array.isArray(rollbackTargets)
    || rollbackTargets.length !== routes.length
    || !Number.isInteger(Number(claimId))
    || Number(generation) !== 1
    || typeof renew !== 'function'
    || typeof settle !== 'function'
    || typeof preflightRoutes !== 'function'
    || typeof runRoute !== 'function'
  ) {
    throw rollbackError('release_rollback_worker_contract_invalid');
  }

  const abortController = new AbortController();
  const abortFromCaller = () => {
    abortController.abort(rollbackError('release_rollback_aborted'));
  };
  if (abortSignal?.aborted) abortFromCaller();
  else abortSignal?.addEventListener('abort', abortFromCaller, { once: true });
  let renewalFailure = null;
  let renewalChain = Promise.resolve();
  const renewExactClaim = async () => {
    if (renewalFailure) throw renewalFailure;
    try {
      await renew(Number(claimId), Number(generation));
    } catch (error) {
      renewalFailure = rollbackError('release_rollback_lease_lost', error);
      abortController.abort(renewalFailure);
      throw renewalFailure;
    }
  };
  const enqueueRenewal = () => {
    renewalChain = renewalChain.then(renewExactClaim).catch(() => {});
  };

  await renewExactClaim();
  const timer = setInterval(enqueueRenewal, renewalIntervalMs);
  timer.unref?.();
  const readbacks = [];
  let effectStarted = false;
  try {
    if (abortController.signal.aborted) throw abortController.signal.reason;
    await preflightRoutes(routes, { signal: abortController.signal });
    await renewExactClaim();
    if (abortController.signal.aborted) throw abortController.signal.reason;
    for (const route of routes) {
      if (abortController.signal.aborted) throw abortController.signal.reason;
      await renewExactClaim();
      if (abortController.signal.aborted) throw abortController.signal.reason;
      effectStarted = true;
      const readback = await runRoute(route, { signal: abortController.signal });
      await renewalChain;
      if (renewalFailure) throw renewalFailure;
      if (
        readback?.artifact !== route.artifact
        || readback?.observed_digest !== route.expected_digest
      ) {
        throw rollbackError('release_rollback_readback_mismatch');
      }
      readbacks.push(readback);
      await renewExactClaim();
    }
    clearInterval(timer);
    await renewalChain;
    if (renewalFailure) throw renewalFailure;
    if (abortController.signal.aborted) throw abortController.signal.reason;
    await settle({
      claim_id: Number(claimId),
      generation: Number(generation),
      status: 'succeeded',
      late_effect_risk: false,
      observed_targets: rollbackTargets,
      observed_readbacks: readbacks,
      evidence: {
        source: 'release_rollback_worker_terminal',
        readbacks,
      },
    }, { signal: abortController.signal });
  } catch (error) {
    clearInterval(timer);
    const code = renewalFailure?.code
      ?? (abortSignal?.aborted ? 'release_rollback_aborted' : null)
      ?? error?.code
      ?? 'release_rollback_route_failed';
    const recoveryRisk = [
      'release_rollback_recovery_failed',
      'release_rollback_current_cas_mismatch',
    ].includes(code);
    if (!effectStarted && code !== 'release_rollback_aborted'
      && code !== 'release_rollback_lease_lost' && !recoveryRisk) {
      await settle({
        claim_id: Number(claimId),
        generation: Number(generation),
        status: 'failed',
        late_effect_risk: false,
        evidence: {
          source: 'release_rollback_worker_preflight',
          error_code: code,
        },
      }).catch(() => {});
    } else if (
      effectStarted
      || recoveryRisk
      || code === 'release_rollback_aborted'
      || code === 'release_rollback_lease_lost'
    ) {
      await settle({
        claim_id: Number(claimId),
        generation: Number(generation),
        status: code === 'release_rollback_aborted' ? 'aborted' : 'unknown',
        late_effect_risk: true,
        evidence: {
          source: 'release_rollback_worker_terminal',
          error_code: code,
          completed_readbacks: readbacks,
        },
      }).catch(() => {});
    }
    throw rollbackError(code, error);
  } finally {
    clearInterval(timer);
    abortSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export const __test__ = { rollbackError };
