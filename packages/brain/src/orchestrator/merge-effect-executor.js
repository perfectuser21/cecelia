import {
  MergeAuthorizationError,
  validateMergeAuthorizationEvidence,
} from './merge-authority.js';
import {
  assessPostDiffRisk,
  canonicalContractDigest,
} from './post-diff-risk-policy.js';

const POLICY_VERSION = 'kernel-merge/v1';

function deny(code) {
  throw new MergeAuthorizationError(code);
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function latestRow(rows, action) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.action === action)
    .sort((left, right) => Number(right.hop) - Number(left.hop))[0] ?? null;
}

function recomputePostDiffRisk(authority, current, now) {
  const intent = (Array.isArray(authority.decisionLog) ? authority.decisionLog : [])
    .filter((row) => row?.action === 'merge_pr' && row.gate_verdict === 'allow')
    .sort((left, right) => Number(right.hop) - Number(left.hop))[0];
  if (!intent) deny('merge_intent_missing');
  const original = asObject(asObject(intent.observed).post_diff_risk);
  if (!original.schema_version) deny('post_diff_risk_missing');
  const evaluator = latestRow(authority.decisionLog, 'verdict:evaluate');
  const judge = latestRow(authority.decisionLog, 'verdict:judge');
  const payload = asObject(authority.task?.payload);
  let contractDigest = null;
  try {
    contractDigest = canonicalContractDigest(authority.contract?.contract_content);
  } catch {
    contractDigest = null;
  }
  const revalidated = assessPostDiffRisk({
    taskId: authority.task?.id,
    runId: authority.run?.id,
    hop: Number(intent.hop),
    repository: current.repository,
    headRepository: current.head_repository,
    headRef: current.head_ref,
    headSha: current.head_sha,
    baseRepository: current.base_repository,
    baseRef: current.base_ref,
    baseSha: current.base_sha,
    diffDigest: current.diff_digest,
    requiredChecks: current.required_checks,
    files: current.files,
    contract: {
      id: authority.contract?.id ?? null,
      version: authority.contract?.version ?? null,
      status: authority.contract?.status ?? null,
      approved_at: authority.contract?.approved_at ?? null,
      digest: contractDigest,
    },
    productionReceipt: authority.productionReceipt ?? null,
    callerRisk: payload.review_required === true
      ? 'high'
      : payload.risk_level ?? 'low',
    changeSignals: {
      newCapability: payload.new_capability === true,
    },
    evidence: {
      ci: current.ci,
      evaluator: asObject(evaluator?.detail).pr_head_sha === current.head_sha
        ? asObject(evaluator.detail).verdict
        : null,
      judge: asObject(judge?.detail).pr_head_sha === current.head_sha
        ? asObject(judge.detail).verdict
        : null,
    },
    now,
  });
  return { original, revalidated };
}

function confirmedReceipt(intentId, pr, source) {
  return {
    intent_id: intentId,
    receipt_status: 'confirmed',
    observed_head_sha: pr.head_sha,
    merged: true,
    evidence: {
      source,
      pr_url: pr.url,
      state: pr.state,
      merge_commit_sha: pr.merge_commit_sha ?? null,
    },
  };
}

function unconfirmedReceipt(intentId, pr) {
  return {
    intent_id: intentId,
    receipt_status: 'observed_not_merged',
    observed_head_sha: pr.head_sha,
    merged: false,
    evidence: {
      source: 'post_effect_observation',
      pr_url: pr.url,
      state: pr.state,
    },
  };
}

function failedReceipt(intentId, pr) {
  return {
    intent_id: intentId,
    receipt_status: 'failed',
    observed_head_sha: pr.head_sha,
    merged: false,
    evidence: {
      source: 'post_effect_observation',
      error_code: 'github_merge_command_failed',
      pr_url: pr.url,
      state: pr.state,
    },
  };
}

/**
 * Runs the only authorized merge side effect.
 *
 * The PostgreSQL store owns the per-run advisory lock. The durable intent is
 * committed before GitHub is called; recovery first observes GitHub and can
 * therefore receipt a merge that succeeded immediately before a process crash.
 */
export function createMergeEffectExecutor({
  store,
  observePullRequest,
  mergePullRequest,
  policyVersion = POLICY_VERSION,
  now = Date.now,
}) {
  return async function executeMerge({ runId, taskId }) {
    return store.withRunLock(runId, async (client) => {
      const authority = await store.loadEvidence(client, { runId, taskId });
      const existing = await store.findIntent(client, { runId });
      const current = await observePullRequest(authority.run.pr_url);

      if (existing) {
        if (existing.requested_head_sha !== current.head_sha) {
          deny('stale_effect_intent');
        }
        if (existing.confirmed_receipt && (current.merged === true || current.state === 'MERGED')) {
          return { status: 'DONE', detail: 'merge already confirmed' };
        }
        if (existing.confirmed_receipt) deny('confirmed_receipt_conflicts_with_github');
        if (current.merged === true || current.state === 'MERGED') {
          await store.appendReceipt(
            client,
            confirmedReceipt(existing.intent_id, current, 'recovery_observation'),
          );
          return { status: 'DONE', detail: 'merge confirmed by recovery' };
        }
      }

      const risk = recomputePostDiffRisk(authority, current, now);
      const proof = validateMergeAuthorizationEvidence({
        ...authority,
        pr: current,
        policyVersion,
        postDiffRisk: risk.original,
        revalidatedPostDiffRisk: risk.revalidated,
        now,
      });
      const effect = existing ?? await store.createAuthorizationIntent(
        client,
        { proof, currentPr: current },
      );

      // The durable intent is not external authority. Re-read both DB contract
      // authority and GitHub required-check/base authority immediately before
      // the effect. GitHub rulesets remain the atomic remote-side backstop;
      // this controller never uses --admin or another bypass mode.
      const freshAuthority = await store.loadEvidence(client, { runId, taskId });
      const freshCurrent = await observePullRequest(current.url);
      const freshRisk = recomputePostDiffRisk(freshAuthority, freshCurrent, now);
      validateMergeAuthorizationEvidence({
        ...freshAuthority,
        pr: freshCurrent,
        policyVersion,
        postDiffRisk: freshRisk.original,
        revalidatedPostDiffRisk: freshRisk.revalidated,
        now,
      });
      if (effect.requested_head_sha !== freshCurrent.head_sha) {
        deny('stale_effect_intent');
      }

      let commandFailed = false;
      try {
        await mergePullRequest({
          pr_url: freshCurrent.url,
          expected_head_sha: freshCurrent.head_sha,
          method: 'squash',
        });
      } catch {
        // The durable intent already exists. Never trust the command exit as
        // effect truth: GitHub may have merged before the transport failed.
        commandFailed = true;
      }

      const observed = await observePullRequest(freshCurrent.url);
      if (
        observed.head_sha === effect.requested_head_sha
        && (observed.merged === true || observed.state === 'MERGED')
      ) {
        await store.appendReceipt(
          client,
          confirmedReceipt(effect.intent_id, observed, 'post_effect_observation'),
        );
        return commandFailed
          ? { status: 'DONE_WITH_CONCERNS', detail: 'merge confirmed after command error' }
          : { status: 'DONE', detail: 'merge confirmed' };
      }

      if (commandFailed) {
        await store.appendReceipt(client, failedReceipt(effect.intent_id, observed));
        return { status: 'BLOCKED', detail: 'merge effect failed and was not confirmed' };
      }

      await store.appendReceipt(client, unconfirmedReceipt(effect.intent_id, observed));
      return { status: 'BLOCKED', detail: 'merge effect not confirmed' };
    });
  };
}

export const __test__ = {
  confirmedReceipt,
  failedReceipt,
  unconfirmedReceipt,
  recomputePostDiffRisk,
};
