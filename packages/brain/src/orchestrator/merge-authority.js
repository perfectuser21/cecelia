import { isPassVerdict } from './gates.js';
import {
  canonicalContractDigest,
  canonicalRequiredChecksDigest,
} from './post-diff-risk-policy.js';
import { sha256Canonical } from '../lib/kernel-equivalence-receipts.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^(?![./])(?!.*(?:\.\.|\/\/|@\{|[~^:?*\\\s]))(?!.*[./]$)[A-Za-z0-9._/-]+$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HUMAN_REVIEW_EQUIVALENCE_SEAM_ID = 'kernel.merge.human_review_authority';
const HUMAN_REVIEW_EQUIVALENCE_EFFECTS = Object.freeze({
  normal: Object.freeze({
    observed_outcome: 'confirmed',
    effect_code: 'exact_sha_human_approval_accepted',
  }),
  violation: Object.freeze({
    observed_outcome: 'denied',
    effect_code: 'stale_human_approval_denied',
  }),
  recovery: Object.freeze({
    observed_outcome: 'recovered',
    effect_code: 'renewed_human_approval_accepted',
  }),
});
const RISK_TIERS = new Set(['low', 'high', 'unknown']);
const HIGH_RISK_PATH_PATTERNS = [
  /^\.github\/workflows\//,
  /^packages\/brain\/migrations\//,
  /^packages\/brain\/src\/(?:orchestrator|routes\/harness-kernel-approvals)(?:\/|\.js$)/,
  /^packages\/workflows\/skills\//,
  /^scripts\/(?:brain-|deploy|promote-|release-run-|rollback)/,
];

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

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function classifyMergeReviewRisk(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    return Object.freeze({
      risk_tier: 'unknown',
      risk_reasons: Object.freeze(['changed_paths_missing']),
    });
  }
  const highRiskPaths = changedPaths.filter((path) => (
    typeof path === 'string'
    && HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(path))
  ));
  if (highRiskPaths.length > 0) {
    return Object.freeze({
      risk_tier: 'high',
      risk_reasons: Object.freeze(
        highRiskPaths.map((path) => `high_risk_path:${path}`),
      ),
    });
  }
  return Object.freeze({
    risk_tier: 'low',
    risk_reasons: Object.freeze(['low_risk_paths']),
  });
}

function assertReviewPolicy(input, task, pr, policyVersion) {
  const policy = asObject(input);
  const changedPaths = Array.isArray(pr.changed_paths) ? pr.changed_paths : [];
  const classified = classifyMergeReviewRisk(changedPaths);
  const payloadRequired = asObject(task.payload).review_required === true;
  const firstRelease = policy.first_kernel_release;
  const expectedRequired = payloadRequired
    || firstRelease === true
    || classified.risk_tier !== 'low';
  const expectedReasons = [
    ...classified.risk_reasons,
    ...(firstRelease === true ? ['first_kernel_release'] : []),
  ];

  if (
    !UUID_PATTERN.test(policy.assessment_id ?? '')
    || policy.policy_version !== policyVersion
    || !RISK_TIERS.has(policy.risk_tier)
    || policy.risk_tier !== classified.risk_tier
    || typeof firstRelease !== 'boolean'
    || policy.payload_review_required !== payloadRequired
    || policy.review_required !== expectedRequired
    || !sameJson(policy.changed_paths, changedPaths)
    || !sameJson(policy.risk_reasons, expectedReasons)
  ) {
    deny('review_policy_invalid');
  }
  return policy;
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
  const reviewPolicy = assertReviewPolicy(input?.reviewPolicy, task, pr, policyVersion);

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
  const reviewRequired = reviewPolicy.review_required === true
    || asObject(task.payload).review_required === true
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
    review_assessment_id: reviewPolicy.assessment_id,
    risk_tier: reviewPolicy.risk_tier,
    first_kernel_release: reviewPolicy.first_kernel_release,
    review_required: reviewRequired,
    evaluator_hop: Number(evaluator.hop),
    judge_hop: Number(judge.hop),
    human_review_hop: human ? Number(human.hop) : null,
    merge_intent_hop: Number(intent.hop),
    post_diff_risk: postDiffRisk,
  });
}

function reviewEquivalenceFail(code) {
  const error = new MergeAuthorizationError(code);
  throw error;
}

/**
 * Proves the human-review behavior by running the same full merge authority
 * validator used at the effect boundary. Evidence and observations are loaded
 * only through the review-owner service; caller-provided resource metadata is
 * reduced to the verified isolated identity.
 */
export function createHumanReviewEquivalenceSeam({
  reviewAuthority,
  effectSigner,
} = {}) {
  if (typeof effectSigner?.signEffectResult !== 'function') {
    reviewEquivalenceFail('seam_effect_signer_unavailable');
  }
  if (
    reviewAuthority?.owner_service !== HUMAN_REVIEW_EQUIVALENCE_SEAM_ID
    || typeof reviewAuthority?.loadEvidence !== 'function'
    || typeof reviewAuthority?.snapshot !== 'function'
    || typeof reviewAuthority?.confirmDenial !== 'function'
    || typeof reviewAuthority?.confirmRenewal !== 'function'
    || typeof reviewAuthority?.cancel !== 'function'
    || typeof reviewAuthority?.cleanup !== 'function'
  ) {
    reviewEquivalenceFail('human_review_equivalence_authority_unavailable');
  }

  return Object.freeze({
    owner_service: HUMAN_REVIEW_EQUIVALENCE_SEAM_ID,

    async invoke({
      cell,
      grant,
      resource,
      predecessor = null,
      signal,
    } = {}) {
      signal?.throwIfAborted();
      const effect = HUMAN_REVIEW_EQUIVALENCE_EFFECTS[cell?.scenario];
      if (
        cell?.seam_id !== HUMAN_REVIEW_EQUIVALENCE_SEAM_ID
        || grant?.seam_id !== HUMAN_REVIEW_EQUIVALENCE_SEAM_ID
        || grant?.adapter_id !== cell?.adapter_id
        || resource?.resource_id !== grant?.resource_id
        || resource?.resource_ref !== grant?.resource_ref
      ) {
        reviewEquivalenceFail('human_review_equivalence_resource_invalid');
      }
      if (!effect) {
        reviewEquivalenceFail('human_review_equivalence_scenario_invalid');
      }
      if (
        (cell.scenario === 'recovery' && predecessor == null)
        || (cell.scenario !== 'recovery' && predecessor != null)
      ) {
        reviewEquivalenceFail('human_review_equivalence_predecessor_invalid');
      }

      const authorityResource = Object.freeze({
        resource_id: resource.resource_id,
        resource_ref: resource.resource_ref,
      });
      const evidence = await reviewAuthority.loadEvidence({
        cell,
        grant,
        resource: authorityResource,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();
      const before = await reviewAuthority.snapshot({
        phase: 'before',
        cell,
        grant,
        resource: authorityResource,
        evidence,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();

      let proof = null;
      let denial = null;
      try {
        proof = validateMergeAuthorizationEvidence(evidence);
      } catch (error) {
        denial = error;
      }

      if (cell.scenario === 'violation') {
        const confirmed = await reviewAuthority.confirmDenial({
          cell,
          grant,
          resource: authorityResource,
          evidence,
          error: denial,
          predecessor,
          signal,
        });
        signal?.throwIfAborted();
        if (proof != null || denial == null || confirmed !== true) {
          reviewEquivalenceFail('human_review_denial_unconfirmed');
        }
      } else {
        if (denial != null || proof == null || proof.review_required !== true) {
          reviewEquivalenceFail('human_review_approval_unconfirmed');
        }
        if (cell.scenario === 'recovery') {
          const renewed = await reviewAuthority.confirmRenewal({
            cell,
            grant,
            resource: authorityResource,
            evidence,
            proof,
            predecessor,
            signal,
          });
          signal?.throwIfAborted();
          if (renewed !== true) {
            reviewEquivalenceFail('human_review_renewal_unconfirmed');
          }
        }
      }

      const after = await reviewAuthority.snapshot({
        phase: 'after',
        cell,
        grant,
        resource: authorityResource,
        evidence,
        proof,
        denial_code: denial?.code ?? null,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();
      if (
        !before
        || typeof before !== 'object'
        || Array.isArray(before)
        || !after
        || typeof after !== 'object'
        || Array.isArray(after)
      ) {
        reviewEquivalenceFail('human_review_equivalence_snapshot_invalid');
      }

      return effectSigner.signEffectResult({
        cell,
        grant,
        observation: {
          observed_outcome: effect.observed_outcome,
          effect_code: effect.effect_code,
          before_hash: sha256Canonical(before),
          after_hash: sha256Canonical(after),
        },
        predecessor,
      });
    },

    async cancel(context = {}) {
      return reviewAuthority.cancel({
        ...context,
        resource: context?.resource == null
          ? null
          : {
            resource_id: context.resource.resource_id,
            resource_ref: context.resource.resource_ref,
          },
      });
    },

    async cleanup(context = {}) {
      return reviewAuthority.cleanup({
        ...context,
        resource: context?.resource == null
          ? null
          : {
            resource_id: context.resource.resource_id,
            resource_ref: context.resource.resource_ref,
          },
      });
    },
  });
}
