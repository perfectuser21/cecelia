const SAFE_BASE_ENV = Object.freeze([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TZ',
  'ENV_REGION',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
  'BRAIN_URL',
  'BRAIN_STAGING_URL',
  'DASHBOARD_URL',
  'DASHBOARD_STAGING_URL',
  'CECELIA_SKILLS_DEPLOY_ROOTS',
  'DEPLOY_STATUS_FILE',
  'REPO_ROOT',
  'NODE_ENV',
]);

const SAFE_RELEASE_ENV = new Set([
  'KERNEL_RELEASE_RUN_ID',
  'KERNEL_RELEASE_MERGE_SHA',
  'KERNEL_RELEASE_ARTIFACT_VERSIONS',
  'KERNEL_RELEASE_EFFECT_KIND',
  'KERNEL_RELEASE_DEPLOY_ROOT',
  'KERNEL_RELEASE_STARTED_AT',
  'KERNEL_RELEASE_DISPATCH_CLAIM_ID',
  'KERNEL_RELEASE_DISPATCH_GENERATION',
  'KERNEL_RELEASE_PRIVATE_CONFIG_FILE',
  'KERNEL_RELEASE_ARTIFACT_STORE',
  'KERNEL_RELEASE_ARTIFACT_ROOT',
  'KERNEL_RELEASE_ARTIFACT_NAME',
  'KERNEL_RELEASE_ARTIFACT_VERSION',
  'KERNEL_RELEASE_ARTIFACT_DIGEST',
  'KERNEL_RELEASE_SKILLS_STAGING_ROOT',
  'CECELIA_SKIP_BRAIN_PROMOTE',
  'CECELIA_PROD_GIT_SHA',
  'CECELIA_PROD_DASHBOARD_SHA',
]);

export function buildReleaseWorkerEnvironment(source = {}, additions = {}) {
  const result = {};
  for (const key of SAFE_BASE_ENV) {
    if (source[key] != null) result[key] = String(source[key]);
  }
  for (const key of SAFE_RELEASE_ENV) {
    if (source[key] != null) result[key] = String(source[key]);
  }
  for (const [key, value] of Object.entries(additions)) {
    if (!SAFE_RELEASE_ENV.has(key) || value == null) continue;
    result[key] = String(value);
  }
  return result;
}

function workerError(code, cause) {
  const error = new Error(code, cause == null ? undefined : { cause });
  error.code = code;
  return error;
}

export async function runLeasedReleaseRoutes({
  routes,
  claimId,
  generation,
  renew,
  appendOutcome,
  runRoute,
  beforeTerminal = async () => {},
  renewalIntervalMs = 60_000,
}) {
  if (
    !Array.isArray(routes)
    || routes.length === 0
    || !Number.isInteger(Number(claimId))
    || !Number.isInteger(Number(generation))
    || typeof renew !== 'function'
    || typeof appendOutcome !== 'function'
    || typeof runRoute !== 'function'
    || typeof beforeTerminal !== 'function'
  ) {
    throw workerError('release_worker_contract_invalid');
  }

  const abortController = new AbortController();
  let renewalFailure = null;
  let renewalChain = Promise.resolve();
  const renewExactClaim = async () => {
    if (renewalFailure) throw renewalFailure;
    try {
      await renew(Number(claimId), Number(generation));
    } catch (error) {
      renewalFailure = workerError('release_worker_lease_lost', error);
      abortController.abort(renewalFailure);
      throw renewalFailure;
    }
  };
  const enqueueRenewal = () => {
    renewalChain = renewalChain
      .then(renewExactClaim)
      .catch(() => {});
  };

  await renewExactClaim();
  const renewalTimer = setInterval(enqueueRenewal, renewalIntervalMs);
  renewalTimer.unref?.();
  try {
    for (const route of routes) {
      if (renewalFailure) throw renewalFailure;
      await renewExactClaim();
      await runRoute(route, { signal: abortController.signal });
      await renewalChain;
      if (renewalFailure) throw renewalFailure;
      await renewExactClaim();
    }
    await beforeTerminal();
    await renewExactClaim();
    clearInterval(renewalTimer);
    await renewalChain;
    if (renewalFailure) throw renewalFailure;
    try {
      await appendOutcome(
        Number(claimId),
        Number(generation),
        'dispatched',
        { source: 'release_effect_worker_terminal' },
      );
    } catch (error) {
      throw workerError('release_worker_terminal_fenced', error);
    }
  } catch (error) {
    clearInterval(renewalTimer);
    const code = renewalFailure?.code
      ?? error?.code
      ?? 'release_worker_route_failed';
    await appendOutcome(
      Number(claimId),
      Number(generation),
      'failed',
      { error_code: code },
    ).catch(() => {});
    throw workerError(code, error);
  } finally {
    clearInterval(renewalTimer);
  }
}

export const __test__ = { SAFE_BASE_ENV, SAFE_RELEASE_ENV };
