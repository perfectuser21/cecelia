import { createHash } from 'node:crypto';

export const POST_DIFF_RISK_POLICY_VERSION = 'kernel-post-diff-risk/v1';
export const PRODUCTION_RECEIPT_ISSUER = 'kernel-release-controller/v1';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_PATTERN = /^(?![./])(?!.*(?:\.\.|\/\/|@\{|[~^:?*\\\s]))(?!.*[./]$)[A-Za-z0-9._/-]+$/;
const FILE_STATUS = new Set(['added', 'changed', 'copied', 'modified', 'removed', 'renamed', 'unchanged']);
const RISK_SCORE = Object.freeze({ low: 0, medium: 1, high: 2 });
const MAX_SMALL_FILES = 5;
const MAX_SMALL_CHANGED_LINES = 200;
const ASSESSMENT_TTL_MS = 15 * 60_000;
const MAX_PRODUCTION_RECEIPT_TTL_MS = 30 * 24 * 60 * 60_000;

function immutable(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function digestValue(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(stableValue(value)), 'utf8')
    .digest('hex')}`;
}

export function canonicalContractDigest(value) {
  const canonical = typeof value === 'string'
    ? value
    : JSON.stringify(stableValue(value));
  if (typeof canonical !== 'string' || canonical.length === 0) {
    throw new Error('post_diff_contract_invalid');
  }
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function validPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    && !value.startsWith('/')
    && !/[\r\n\\\0]/.test(value)
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function normalizedFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 1_000) {
    throw new Error('post_diff_files_invalid');
  }
  const normalized = files.map((file) => {
    const previousPath = file?.previous_path ?? null;
    const status = file?.status ?? 'modified';
    const blobSha = file?.blob_sha ?? null;
    const patchDigest = file?.patch_digest ?? null;
    if (
      !file
      || typeof file !== 'object'
      || Array.isArray(file)
      || !validPath(file.path)
      || (previousPath != null && !validPath(previousPath))
      || !FILE_STATUS.has(status)
      || (blobSha != null && !SHA_PATTERN.test(blobSha))
      || (patchDigest != null && !DIGEST_PATTERN.test(patchDigest))
      || !Number.isInteger(file.additions)
      || file.additions < 0
      || !Number.isInteger(file.deletions)
      || file.deletions < 0
      || (status === 'renamed' && previousPath == null)
    ) {
      throw new Error('post_diff_file_invalid');
    }
    return {
      path: file.path,
      previous_path: previousPath,
      status,
      blob_sha: blobSha,
      patch_digest: patchDigest,
      additions: file.additions,
      deletions: file.deletions,
    };
  }).sort((left, right) => (
    left.path.localeCompare(right.path)
    || String(left.previous_path).localeCompare(String(right.previous_path))
  ));
  if (new Set(normalized.map(({ path }) => path)).size !== normalized.length) {
    throw new Error('post_diff_file_duplicate');
  }
  return normalized;
}

/**
 * Compatibility digest for callers that do not yet carry GitHub blob/patch
 * authority. It is never sufficient for automatic eligibility; the caller
 * must separately supply the adapter-produced diffDigest and base identity.
 */
export function canonicalDiffHash(files) {
  const compact = normalizedFiles(files).map((file) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
  }));
  return digestValue(compact);
}

function classForPath(path) {
  const lower = path.toLowerCase();
  if (/^(?:packages\/brain\/)?migrations\//.test(lower)) return 'migration';
  if (
    lower.startsWith('.github/workflows/')
    || lower.startsWith('packages/engine/ci/')
    || lower.startsWith('scripts/devgate/')
    || /(?:^|\/)ci(?:\.|\/|-)/.test(lower)
  ) return 'ci_workflow';
  if (
    /(?:credential|secret|security|oauth|auth(?:entication|orization)?|token|permission|rbac|acl)/.test(lower)
    || /(?:^|[-_/])(?:guard|policy|branch-protect|stop-hook|controller)(?:\/|[-_.])/.test(lower)
  ) return 'security_credential';
  if (
    /(?:^|[-_/])(?:deploy|deployment|release|rollout|promote)(?:\/|[-_.])/.test(lower)
    || /(?:^|\/)dockerfile$/.test(lower)
  ) return 'deploy_release';
  if (
    lower.startsWith('packages/brain/src/orchestrator/')
    || lower.startsWith('packages/brain/src/routes/harness')
    || lower.startsWith('packages/brain/scripts/fleet-worker/')
  ) return 'core_orchestration';
  if (
    lower.startsWith('apps/')
    || lower.startsWith('packages/brain/src/')
    || lower.startsWith('packages/engine/src/')
  ) return 'application';
  if (lower.startsWith('docs/') || lower.endsWith('.md')) return 'docs';
  if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|[-_.])/.test(lower)) return 'test';
  return 'unknown';
}

export function classifyChangedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => !validPath(path))) {
    return Object.freeze({
      path_class: 'unknown',
      protected: true,
      classes: Object.freeze(['unknown']),
    });
  }
  const classes = [...new Set(paths.map(classForPath))].sort();
  const pathClass = classes.length === 1 ? classes[0] : 'mixed';
  const protectedClass = !['application', 'docs', 'test'].includes(pathClass);
  return Object.freeze({
    path_class: pathClass,
    protected: protectedClass,
    classes: Object.freeze(classes),
  });
}

export function deriveBehaviorAuthority({
  repository,
  contract,
  files,
}) {
  if (
    !REPOSITORY_PATTERN.test(repository ?? '')
    || !Number.isInteger(contract?.version)
    || contract.version < 1
    || !DIGEST_PATTERN.test(contract?.digest ?? '')
  ) {
    throw new Error('post_diff_behavior_authority_invalid');
  }
  const normalized = normalizedFiles(files);
  const pathSurface = normalized.map(({ path, previous_path: previousPath }) => ({
    path,
    previous_path: previousPath,
  }));
  const pathSurfaceDigest = digestValue(pathSurface);
  const contentSurfaceDigest = digestValue(normalized.map((file) => ({
    path: file.path,
    previous_path: file.previous_path,
    status: file.status,
    blob_sha: file.blob_sha,
    patch_digest: file.patch_digest,
    additions: file.additions,
    deletions: file.deletions,
  })));
  const capabilityFingerprint = digestValue({
    repository,
    contract_version: contract.version,
    contract_digest: contract.digest,
  });
  return Object.freeze({
    capability_fingerprint: capabilityFingerprint,
    behavior_fingerprint: digestValue({
      capability_fingerprint: capabilityFingerprint,
      path_surface_digest: pathSurfaceDigest,
      content_surface_digest: contentSurfaceDigest,
    }),
    path_surface_digest: pathSurfaceDigest,
  });
}

function receiptAuthority(receipt) {
  return {
    receipt_status: receipt?.receipt_status ?? null,
    repository: receipt?.repository ?? null,
    behavior_fingerprint: receipt?.behavior_fingerprint ?? null,
    capability_fingerprint: receipt?.capability_fingerprint ?? null,
    path_surface_digest: receipt?.path_surface_digest ?? null,
    path_class: receipt?.path_class ?? null,
    contract_version: receipt?.contract_version ?? null,
    contract_digest: receipt?.contract_digest ?? null,
    artifact_digest: receipt?.artifact_digest ?? null,
    release_run_id: receipt?.release_run_id ?? null,
    release_effect_receipt_id: receipt?.release_effect_receipt_id ?? null,
    issuer: receipt?.issuer ?? null,
    production_head_sha: receipt?.production_head_sha ?? null,
    deployed_at: receipt?.deployed_at ?? null,
    expires_at: receipt?.expires_at ?? null,
  };
}

export function canonicalProductionReceiptDigest(receipt) {
  return digestValue(receiptAuthority(receipt));
}

export function canonicalRequiredChecksDigest(checks, headSha) {
  if (!Array.isArray(checks) || checks.length === 0 || !SHA_PATTERN.test(headSha ?? '')) {
    throw new Error('post_diff_required_checks_invalid');
  }
  const normalized = checks.map((check) => {
    const checkRun = check?.source === 'github-actions'
      && check.app_slug === 'github-actions'
      && /^[1-9][0-9]*$/.test(check.run_id ?? '')
      && /^[1-9][0-9]*$/.test(check.job_id ?? '');
    const commitStatus = check?.source === 'github-status'
      && check.app_slug == null
      && /^[1-9][0-9]*$/.test(check.status_id ?? '');
    if (
      typeof check?.context !== 'string'
      || check.context.length === 0
      || (!checkRun && !commitStatus)
      || check.head_sha !== headSha
      || check.conclusion !== 'SUCCESS'
    ) {
      throw new Error('post_diff_required_checks_invalid');
    }
    return {
      context: check.context,
      app_slug: check.app_slug,
      source: check.source,
      ...(checkRun ? { run_id: check.run_id, job_id: check.job_id } : {}),
      ...(commitStatus ? { status_id: check.status_id } : {}),
      head_sha: check.head_sha,
      conclusion: check.conclusion,
    };
  }).sort((left, right) => left.context.localeCompare(right.context));
  if (new Set(normalized.map(({ context }) => context)).size !== normalized.length) {
    throw new Error('post_diff_required_checks_invalid');
  }
  return digestValue(normalized);
}

function validReceipt(receipt, {
  repository,
  contract,
  behavior,
  pathClass,
  nowMs,
}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  const deployedAt = Date.parse(receipt.deployed_at);
  const expiresAt = Date.parse(receipt.expires_at);
  return receipt.receipt_status === 'confirmed'
    // This flag is server-owned output from an authoritative ReleaseRun join.
    // Migration 373 deliberately creates no release writer/table, so current
    // queries return false and therefore remain fail-closed until that SSOT exists.
    && receipt.release_authority_valid === true
    && receipt.repository === repository
    && receipt.behavior_fingerprint === behavior.behavior_fingerprint
    && receipt.capability_fingerprint === behavior.capability_fingerprint
    && receipt.path_surface_digest === behavior.path_surface_digest
    && receipt.path_class === pathClass
    && receipt.contract_version === contract.version
    && receipt.contract_digest === contract.digest
    && DIGEST_PATTERN.test(receipt.artifact_digest ?? '')
    && UUID_PATTERN.test(receipt.release_run_id ?? '')
    && UUID_PATTERN.test(receipt.release_effect_receipt_id ?? '')
    && receipt.issuer === PRODUCTION_RECEIPT_ISSUER
    && SHA_PATTERN.test(receipt.production_head_sha ?? '')
    && Number.isFinite(deployedAt)
    && deployedAt <= nowMs
    && Number.isFinite(expiresAt)
    && expiresAt > nowMs
    && expiresAt > deployedAt
    && expiresAt - deployedAt <= MAX_PRODUCTION_RECEIPT_TTL_MS
    && receipt.receipt_digest === canonicalProductionReceiptDigest(receipt);
}

function elevate(current, requested) {
  if (!Object.hasOwn(RISK_SCORE, requested)) return 'high';
  return RISK_SCORE[requested] > RISK_SCORE[current] ? requested : current;
}

function addReason(state, reason, risk) {
  if (!state.reasons.includes(reason)) state.reasons.push(reason);
  state.risk = elevate(state.risk, risk);
}

export function assessPostDiffRisk(input = {}) {
  const state = { risk: 'low', reasons: [] };
  const nowMs = typeof input.now === 'function' ? input.now() : Date.now();
  const policyVersion = input.policyVersion ?? POST_DIFF_RISK_POLICY_VERSION;
  let files = null;
  let diffHash = null;
  let requiredChecksDigest = null;
  let behavior = null;
  let classification = {
    path_class: 'unknown',
    protected: true,
    classes: ['unknown'],
  };
  const contract = input.contract ?? {};
  const contractApprovedAtMs = Date.parse(contract.approved_at);
  const contractApprovedAt = Number.isFinite(contractApprovedAtMs)
    ? new Date(contractApprovedAtMs).toISOString()
    : null;
  const repository = input.repository ?? null;

  try {
    files = normalizedFiles(input.files);
    const allPaths = files.flatMap(({ path, previous_path: previousPath }) => (
      previousPath == null ? [path] : [path, previousPath]
    ));
    classification = classifyChangedPaths(allPaths);
    behavior = deriveBehaviorAuthority({ repository, contract, files });
    diffHash = input.diffDigest;
    requiredChecksDigest = canonicalRequiredChecksDigest(
      input.requiredChecks,
      input.headSha,
    );
  } catch {
    addReason(state, 'ground_truth_unknown', 'high');
  }

  const exactPrAuthority = REPOSITORY_PATTERN.test(repository ?? '')
    && REPOSITORY_PATTERN.test(input.headRepository ?? '')
    && REF_PATTERN.test(input.headRef ?? '')
    && SHA_PATTERN.test(input.headSha ?? '')
    && REPOSITORY_PATTERN.test(input.baseRepository ?? '')
    && REF_PATTERN.test(input.baseRef ?? '')
    && SHA_PATTERN.test(input.baseSha ?? '')
    && DIGEST_PATTERN.test(diffHash ?? '')
    && DIGEST_PATTERN.test(requiredChecksDigest ?? '');
  const bindingsKnown = UUID_PATTERN.test(input.taskId ?? '')
    && UUID_PATTERN.test(input.runId ?? '')
    && Number.isInteger(input.hop)
    && input.hop > 0
    && exactPrAuthority
    && Number.isInteger(contract.version)
    && contract.version > 0
    && DIGEST_PATTERN.test(contract.digest ?? '')
    && UUID_PATTERN.test(contract.id ?? '')
    && contract.status === 'approved'
    && contractApprovedAt != null
    && contractApprovedAtMs <= nowMs
    && behavior != null
    && VERSION_PATTERN.test(policyVersion)
    && Number.isFinite(nowMs);
  if (!bindingsKnown) addReason(state, 'ground_truth_unknown', 'high');

  if (classification.protected) {
    addReason(state, `protected:${classification.path_class}`, 'high');
  }

  if (files) {
    const changedLines = files.reduce(
      (total, file) => total + file.additions + file.deletions,
      0,
    );
    if (files.length > MAX_SMALL_FILES || changedLines > MAX_SMALL_CHANGED_LINES) {
      addReason(state, 'diff_not_small', 'medium');
    }
  }

  const receipt = input.productionReceipt;
  if (receipt == null) {
    addReason(state, 'first_behavior', 'medium');
  } else if (!behavior || !validReceipt(receipt, {
    repository,
    contract,
    behavior,
    pathClass: classification.path_class,
    nowMs,
  })) {
    addReason(state, 'production_proof_unknown', 'high');
  }

  if (input.evidence?.ci !== 'pass') addReason(state, 'ci_not_green', 'medium');
  if (input.evidence?.evaluator !== 'PASS') {
    addReason(state, 'evaluator_not_green', 'medium');
  }
  if (input.evidence?.judge !== 'PASS') addReason(state, 'judge_not_green', 'medium');

  // Caller metadata is never capability evidence. It may only elevate risk.
  if (input.changeSignals?.newCapability === true) {
    addReason(state, 'caller_new_capability', 'high');
  }
  const callerRisk = input.callerRisk ?? 'low';
  if (!Object.hasOwn(RISK_SCORE, callerRisk)) {
    addReason(state, 'caller_risk_unknown', 'high');
  } else if (RISK_SCORE[callerRisk] > RISK_SCORE[state.risk]) {
    state.risk = callerRisk;
    state.reasons.push('caller_risk_elevated');
  }

  const autoEligible = bindingsKnown
    && state.risk === 'low'
    && state.reasons.length === 0;
  const proof = {
    schema_version: POST_DIFF_RISK_POLICY_VERSION,
    policy_version: policyVersion,
    risk_level: state.risk,
    human_review_required: !autoEligible,
    auto_eligible: autoEligible,
    reasons: state.reasons,
    bindings: {
      task_id: input.taskId ?? null,
      run_id: input.runId ?? null,
      hop: Number.isInteger(input.hop) ? input.hop : null,
      repository,
      head_repository: input.headRepository ?? null,
      head_ref: input.headRef ?? null,
      head_sha: input.headSha ?? null,
      base_repository: input.baseRepository ?? null,
      base_ref: input.baseRef ?? null,
      base_sha: input.baseSha ?? null,
      diff_hash: diffHash,
      required_checks_digest: requiredChecksDigest,
      contract_id: contract.id ?? null,
      contract_version: Number.isInteger(contract.version) ? contract.version : null,
      contract_digest: contract.digest ?? null,
      contract_approved_at: contractApprovedAt,
      behavior_fingerprint: behavior?.behavior_fingerprint ?? null,
      capability_fingerprint: behavior?.capability_fingerprint ?? null,
      path_surface_digest: behavior?.path_surface_digest ?? null,
      path_class: classification.path_class,
    },
    expires_at: Number.isFinite(nowMs)
      ? new Date(nowMs + ASSESSMENT_TTL_MS).toISOString()
      : null,
  };
  return immutable(proof);
}

export const __test__ = {
  classForPath,
  normalizedFiles,
  validReceipt,
};
