import { isPassVerdict } from './gates.js';
import {
  canonicalContractDigest,
  canonicalRequiredChecksDigest,
} from './post-diff-risk-policy.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^(?![./])(?!.*(?:\.\.|\/\/|@\{|[~^:?*\\\s]))(?!.*[./]$)[A-Za-z0-9._/-]+$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export class MergeAuthorizationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MergeAuthorizationError';
    this.code = code;
  }
}

function deny(code) {
  throw new MergeAuthorizationError(code);
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function latest(rows, action) {
  let selected = null;
  for (const row of rows) {
    if (row?.action !== action) continue;
    if (selected == null || Number(row.hop) > Number(selected.hop)) selected = row;
  }
  return selected;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function riskAuthorityWithoutHop(proof) {
  const value = asObject(proof);
  const bindings = asObject(value.bindings);
  return {
    ...value,
    bindings: {
      ...bindings,
      hop: null,
    },
  };
}

function sameRiskAuthority(left, right, { ignoreHop = false } = {}) {
  return stableJson(ignoreHop ? riskAuthorityWithoutHop(left) : left)
    === stableJson(ignoreHop ? riskAuthorityWithoutHop(right) : right);
}

function sameRiskDecision(left, right) {
  const withoutExpiry = (proof) => {
    const value = asObject(proof);
    const { expires_at: _expiresAt, ...decision } = value;
    return decision;
  };
  return stableJson(withoutExpiry(left)) === stableJson(withoutExpiry(right));
}

function assertPostDiffRisk(proof, {
  runId,
  taskId,
  pr,
  contract,
  mergeIntentHop,
  nowMs,
}) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    deny('post_diff_risk_missing');
  }
  const bindings = asObject(proof.bindings);
  if (
    proof.schema_version !== 'kernel-post-diff-risk/v1'
    || proof.policy_version !== 'kernel-post-diff-risk/v1'
    || typeof proof.human_review_required !== 'boolean'
    || typeof proof.auto_eligible !== 'boolean'
    || proof.human_review_required === proof.auto_eligible
    || !['low', 'medium', 'high'].includes(proof.risk_level)
    || bindings.run_id !== runId
    || bindings.task_id !== taskId
    || bindings.hop !== mergeIntentHop
    || bindings.repository !== pr.repository
    || bindings.head_repository !== pr.head_repository
    || bindings.head_ref !== pr.head_ref
    || bindings.head_sha !== pr.head_sha
    || bindings.base_repository !== pr.base_repository
    || bindings.base_ref !== pr.base_ref
    || bindings.base_sha !== pr.base_sha
    || bindings.diff_hash !== pr.diff_digest
    || bindings.required_checks_digest
      !== canonicalRequiredChecksDigest(pr.required_checks, pr.head_sha)
    || bindings.contract_id !== contract.id
    || !SHA256_PATTERN.test(bindings.diff_hash ?? '')
    || !SHA_PATTERN.test(bindings.base_sha ?? '')
    || !Number.isInteger(bindings.contract_version)
    || bindings.contract_version < 1
    || bindings.contract_version !== contract.version
    || !SHA256_PATTERN.test(bindings.contract_digest ?? '')
    || bindings.contract_digest !== contract.digest
    || bindings.contract_approved_at !== contract.approved_at
    || !SHA256_PATTERN.test(bindings.behavior_fingerprint ?? '')
    || !SHA256_PATTERN.test(bindings.capability_fingerprint ?? '')
    || !SHA256_PATTERN.test(bindings.path_surface_digest ?? '')
    || typeof bindings.path_class !== 'string'
    || bindings.path_class.length === 0
  ) {
    deny('stale_post_diff_risk');
  }
  const expiresAt = Date.parse(proof.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    deny('post_diff_risk_expired');
  }
  if (
    proof.auto_eligible
    && (proof.risk_level !== 'low' || asObject(proof).reasons?.length > 0)
  ) {
    deny('stale_post_diff_risk');
  }
  return proof;
}

function exactPrUrl(value, repository, number) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'github.com'
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.pathname === `/${repository}/pull/${number}`;
  } catch {
    return false;
  }
}

function assertCurrentPr(pr) {
  if (
    !REPOSITORY_PATTERN.test(pr.repository ?? '')
    || !REPOSITORY_PATTERN.test(pr.head_repository ?? '')
    || !Number.isInteger(pr.number)
    || pr.number < 1
    || !exactPrUrl(pr.url, pr.repository, pr.number)
    || !BRANCH_PATTERN.test(pr.head_ref ?? '')
    || !SHA_PATTERN.test(pr.head_sha ?? '')
    || !REPOSITORY_PATTERN.test(pr.base_repository ?? '')
    || !BRANCH_PATTERN.test(pr.base_ref ?? '')
    || !SHA_PATTERN.test(pr.base_sha ?? '')
    || !SHA256_PATTERN.test(pr.diff_digest ?? '')
  ) {
    deny('pr_authority_invalid');
  }
  if (pr.state !== 'OPEN' || pr.merged !== false) deny('pr_not_open');
  if (pr.is_draft !== false) deny('pr_not_ready');
  if (pr.merge_state_status !== 'CLEAN') deny('pr_not_clean');
  if (pr.ci !== 'pass') deny('ci_not_pass');
  try {
    canonicalRequiredChecksDigest(pr.required_checks, pr.head_sha);
  } catch {
    deny('ci_authority_invalid');
  }
}

function assertApprovedContract(contract, nowMs) {
  const value = asObject(contract);
  let digest = value.contract_digest ?? null;
  if (!digest) {
    try {
      digest = canonicalContractDigest(value.contract_content);
    } catch {
      digest = null;
    }
  }
  const approvedAt = Date.parse(value.approved_at);
  if (
    !UUID_PATTERN.test(value.id ?? '')
    || value.status !== 'approved'
    || !Number.isInteger(value.version)
    || value.version < 1
    || !SHA256_PATTERN.test(digest ?? '')
    || !Number.isFinite(approvedAt)
    || approvedAt > nowMs
  ) {
    deny('contract_not_approved');
  }
  return {
    id: value.id,
    version: value.version,
    status: value.status,
    approved_at: value.approved_at,
    digest,
  };
}

function assertVerdict(rows, action, headSha, {
  missingCode,
  staleCode,
  notPassCode,
  allowFixed = false,
}) {
  const row = latest(rows, action);
  if (!row) deny(missingCode);
  const detail = asObject(row.detail);
  if (detail.pr_head_sha !== headSha) deny(staleCode);
  if (allowFixed ? !isPassVerdict(detail.verdict) : detail.verdict !== 'PASS') {
    deny(notPassCode);
  }
  return row;
}

function assertHumanReview(rows, pr, postDiffRisk, nowMs) {
  const approval = latest(rows, 'verdict:human_review');
  if (!approval) deny('human_review_missing');
  const detail = asObject(approval.detail);
  if (
    detail.approved !== true
    || detail.review_class !== 'merge_gate'
    || detail.pr_head_sha !== pr.head_sha
    || !sameRiskAuthority(detail.post_diff_risk, postDiffRisk, { ignoreHop: true })
  ) {
    deny('stale_human_review');
  }
  const request = rows.find((row) => (
    row?.action === 'effect:human_review_requested'
    && String(row.hop) === String(detail.review_request_hop)
  ));
  if (!request) deny('human_review_request_missing');
  const requestPr = asObject(asObject(request.observed).pr);
  const requestDetail = asObject(request.detail);
  if (
    requestPr.url !== pr.url
    || requestPr.head_sha !== pr.head_sha
    || requestDetail.review_reason !== 'awaiting_human_review'
    || !sameRiskAuthority(requestDetail.post_diff_risk, detail.post_diff_risk)
    || !sameRiskAuthority(
      asObject(request.observed).post_diff_risk,
      detail.post_diff_risk,
    )
    || asObject(detail.post_diff_risk).bindings?.hop !== Number(request.hop)
    || Date.parse(asObject(detail.post_diff_risk).expires_at) <= nowMs
  ) {
    deny('stale_human_review');
  }
  return approval;
}

function assertMergeIntent(rows, pr) {
  const candidates = rows
    .filter((row) => row?.action === 'merge_pr' && row.gate_verdict === 'allow')
    .sort((left, right) => Number(right.hop) - Number(left.hop));
  const intent = candidates[0];
  if (!intent) deny('merge_intent_missing');
  const observedPr = asObject(asObject(intent.observed).pr);
  if (
    observedPr.url !== pr.url
    || observedPr.head_sha !== pr.head_sha
    || observedPr.base_repository !== pr.base_repository
    || observedPr.base_ref !== pr.base_ref
    || observedPr.base_sha !== pr.base_sha
    || observedPr.diff_digest !== pr.diff_digest
    || observedPr.state !== 'OPEN'
    || observedPr.merged !== false
    || observedPr.ci !== 'pass'
  ) {
    deny('stale_merge_intent');
  }
  return intent;
}

/**
 * Re-validates the complete merge proof at the effect boundary.
 *
 * This intentionally duplicates the pure merge gate: a decision-log intent is
 * necessary audit evidence, but cannot by itself authorize an external effect
 * after the PR head or policy has changed.
 */
export function validateMergeAuthorizationEvidence(input) {
  const run = asObject(input?.run);
  const task = asObject(input?.task);
  const pr = asObject(input?.pr);
  const rows = Array.isArray(input?.decisionLog) ? input.decisionLog : [];
  const policyVersion = input?.policyVersion;
  const nowMs = typeof input?.now === 'function' ? input.now() : Date.now();

  if (!UUID_PATTERN.test(run.id ?? '')) deny('run_authority_invalid');
  if (!UUID_PATTERN.test(task.id ?? '') || run.current_task_id !== task.id) {
    deny('run_task_mismatch');
  }
  if (!run.pr_url || run.pr_url !== pr.url) deny('run_pr_mismatch');
  if (typeof policyVersion !== 'string' || policyVersion.length < 1 || policyVersion.length > 128) {
    deny('policy_version_invalid');
  }
  assertCurrentPr(pr);
  const contract = assertApprovedContract(input?.contract, nowMs);

  const evaluator = assertVerdict(rows, 'verdict:evaluate', pr.head_sha, {
    missingCode: 'evaluator_missing',
    staleCode: 'stale_evaluator',
    notPassCode: 'evaluator_not_pass',
    allowFixed: true,
  });
  const judge = assertVerdict(rows, 'verdict:judge', pr.head_sha, {
    missingCode: 'judge_missing',
    staleCode: 'stale_judge',
    notPassCode: 'judge_not_pass',
  });
  const intent = assertMergeIntent(rows, pr);
  const intentRisk = asObject(asObject(intent.observed).post_diff_risk);
  const postDiffRisk = assertPostDiffRisk(input?.postDiffRisk, {
    runId: run.id,
    taskId: task.id,
    pr,
    contract,
    mergeIntentHop: Number(intent.hop),
    nowMs,
  });
  if (!sameRiskAuthority(intentRisk, postDiffRisk)) deny('stale_post_diff_risk');
  const revalidatedPostDiffRisk = assertPostDiffRisk(
    input?.revalidatedPostDiffRisk,
    {
      runId: run.id,
      taskId: task.id,
      pr,
      contract,
      mergeIntentHop: Number(intent.hop),
      nowMs,
    },
  );
  if (!sameRiskDecision(postDiffRisk, revalidatedPostDiffRisk)) {
    deny('post_diff_risk_revalidation_failed');
  }
  const reviewRequired = asObject(task.payload).review_required === true
    || postDiffRisk.human_review_required === true;
  if (asObject(task.payload).review_required === true && !postDiffRisk.human_review_required) {
    deny('caller_risk_downgraded');
  }
  const human = reviewRequired
    ? assertHumanReview(rows, pr, postDiffRisk, nowMs)
    : null;

  return Object.freeze({
    run_id: run.id,
    task_id: task.id,
    repository: pr.repository,
    pr_number: pr.number,
    pr_url: pr.url,
    head_ref: pr.head_ref,
    head_sha: pr.head_sha,
    base_repository: pr.base_repository,
    base_ref: pr.base_ref,
    base_sha: pr.base_sha,
    diff_digest: pr.diff_digest,
    contract_id: contract.id,
    contract_version: contract.version,
    contract_digest: contract.digest,
    contract_approved_at: contract.approved_at,
    policy_version: policyVersion,
    review_required: reviewRequired,
    evaluator_hop: Number(evaluator.hop),
    judge_hop: Number(judge.hop),
    human_review_hop: human ? Number(human.hop) : null,
    merge_intent_hop: Number(intent.hop),
    post_diff_risk: postDiffRisk,
  });
}
