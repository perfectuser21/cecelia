import {
  MergeAuthorizationError,
  validateMergeAuthorizationEvidence,
} from './merge-authority.js';

const POLICY_VERSION = 'kernel-merge/v1';

function deny(code) {
  throw new MergeAuthorizationError(code);
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
        if (existing.confirmed_receipt) {
          return { status: 'DONE', detail: 'merge already confirmed' };
        }
        if (current.merged === true || current.state === 'MERGED') {
          await store.appendReceipt(
            client,
            confirmedReceipt(existing.intent_id, current, 'recovery_observation'),
          );
          return { status: 'DONE', detail: 'merge confirmed by recovery' };
        }
      }

      const reviewPolicy = await store.assessReviewPolicy(client, {
        runId,
        taskId,
        currentPr: current,
        policyVersion,
        payload: authority.task.payload,
      });
      const proof = validateMergeAuthorizationEvidence({
        ...authority,
        pr: current,
        policyVersion,
        reviewPolicy,
      });
      const effect = existing ?? await store.createAuthorizationIntent(
        client,
        { proof, currentPr: current },
      );

      let commandFailed = false;
      try {
        await mergePullRequest({
          pr_url: current.url,
          expected_head_sha: current.head_sha,
          method: 'squash',
        });
      } catch {
        // The durable intent already exists. Never trust the command exit as
        // effect truth: GitHub may have merged before the transport failed.
        commandFailed = true;
      }

      const observed = await observePullRequest(current.url);
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
};
