import { isPassVerdict } from './gates.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^(?![./])(?!.*(?:\.\.|\/\/|@\{|[~^:?*\\\s]))(?!.*[./]$)[A-Za-z0-9._/-]+$/;

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
    || !Number.isInteger(pr.number)
    || pr.number < 1
    || !exactPrUrl(pr.url, pr.repository, pr.number)
    || !BRANCH_PATTERN.test(pr.head_ref ?? '')
    || !SHA_PATTERN.test(pr.head_sha ?? '')
  ) {
    deny('pr_authority_invalid');
  }
  if (pr.state !== 'OPEN' || pr.merged !== false) deny('pr_not_open');
  if (pr.ci !== 'pass') deny('ci_not_pass');
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

function assertHumanReview(rows, pr) {
  const approval = latest(rows, 'verdict:human_review');
  if (!approval) deny('human_review_missing');
  const detail = asObject(approval.detail);
  if (
    detail.approved !== true
    || detail.review_class !== 'merge_gate'
    || detail.pr_head_sha !== pr.head_sha
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

  if (!UUID_PATTERN.test(run.id ?? '')) deny('run_authority_invalid');
  if (!UUID_PATTERN.test(task.id ?? '') || run.current_task_id !== task.id) {
    deny('run_task_mismatch');
  }
  if (!run.pr_url || run.pr_url !== pr.url) deny('run_pr_mismatch');
  if (typeof policyVersion !== 'string' || policyVersion.length < 1 || policyVersion.length > 128) {
    deny('policy_version_invalid');
  }
  assertCurrentPr(pr);

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
  const reviewRequired = asObject(task.payload).review_required === true;
  const human = reviewRequired ? assertHumanReview(rows, pr) : null;
  const intent = assertMergeIntent(rows, pr);

  return Object.freeze({
    run_id: run.id,
    task_id: task.id,
    repository: pr.repository,
    pr_number: pr.number,
    pr_url: pr.url,
    head_ref: pr.head_ref,
    head_sha: pr.head_sha,
    policy_version: policyVersion,
    review_required: reviewRequired,
    evaluator_hop: Number(evaluator.hop),
    judge_hop: Number(judge.hop),
    human_review_hop: human ? Number(human.hop) : null,
    merge_intent_hop: Number(intent.hop),
  });
}
