import {
  MergeAuthorizationError,
  validateMergeAuthorizationEvidence,
} from './merge-authority.js';
import { sha256Canonical } from '../lib/kernel-equivalence-receipts.js';

const POLICY_VERSION = 'kernel-merge/v1';
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CI_MERGE_EQUIVALENCE_SEAM_ID = 'kernel.merge.effect_executor';
const CI_MERGE_EQUIVALENCE_EFFECTS = Object.freeze({
  normal: Object.freeze({
    observed_outcome: 'confirmed',
    effect_code: 'exact_sha_merge_confirmed',
  }),
  violation: Object.freeze({
    observed_outcome: 'denied',
    effect_code: 'stale_sha_merge_denied',
  }),
  recovery: Object.freeze({
    observed_outcome: 'recovered',
    effect_code: 'renewed_authority_merge_confirmed',
  }),
});

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

      const proof = validateMergeAuthorizationEvidence({
        ...authority,
        pr: current,
        policyVersion,
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

function mergeEquivalenceFail(code) {
  const error = new MergeAuthorizationError(code);
  throw error;
}

/**
 * Executes the durable exact-SHA merge executor against an isolated PR
 * authority. Run/task inputs and effect observations are server-owned; the
 * drill caller can only name the already verified isolated resource.
 */
export function createCiMergeAuthorityEquivalenceSeam({
  mergeEffectExecutor,
  mergeDrillAuthority,
  effectSigner,
} = {}) {
  if (typeof mergeEffectExecutor !== 'function') {
    mergeEquivalenceFail('ci_merge_executor_unavailable');
  }
  if (typeof effectSigner?.signEffectResult !== 'function') {
    mergeEquivalenceFail('seam_effect_signer_unavailable');
  }
  if (
    mergeDrillAuthority?.owner_service !== CI_MERGE_EQUIVALENCE_SEAM_ID
    || typeof mergeDrillAuthority?.loadExecution !== 'function'
    || typeof mergeDrillAuthority?.snapshot !== 'function'
    || typeof mergeDrillAuthority?.confirmDenial !== 'function'
    || typeof mergeDrillAuthority?.confirmSuccess !== 'function'
    || typeof mergeDrillAuthority?.confirmRecovery !== 'function'
    || typeof mergeDrillAuthority?.cancel !== 'function'
    || typeof mergeDrillAuthority?.cleanup !== 'function'
  ) {
    mergeEquivalenceFail('ci_merge_equivalence_authority_unavailable');
  }

  return Object.freeze({
    owner_service: CI_MERGE_EQUIVALENCE_SEAM_ID,

    async invoke({
      cell,
      grant,
      resource,
      predecessor = null,
      signal,
    } = {}) {
      signal?.throwIfAborted();
      const effect = CI_MERGE_EQUIVALENCE_EFFECTS[cell?.scenario];
      if (
        cell?.seam_id !== CI_MERGE_EQUIVALENCE_SEAM_ID
        || grant?.seam_id !== CI_MERGE_EQUIVALENCE_SEAM_ID
        || grant?.adapter_id !== cell?.adapter_id
        || resource?.resource_id !== grant?.resource_id
        || resource?.resource_ref !== grant?.resource_ref
      ) {
        mergeEquivalenceFail('ci_merge_equivalence_resource_invalid');
      }
      if (!effect) mergeEquivalenceFail('ci_merge_equivalence_scenario_invalid');
      if (
        (cell.scenario === 'recovery' && predecessor == null)
        || (cell.scenario !== 'recovery' && predecessor != null)
      ) {
        mergeEquivalenceFail('ci_merge_equivalence_predecessor_invalid');
      }

      const authorityResource = Object.freeze({
        resource_id: resource.resource_id,
        resource_ref: resource.resource_ref,
      });
      const execution = await mergeDrillAuthority.loadExecution({
        cell,
        grant,
        resource: authorityResource,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();
      if (
        execution?.runId !== grant.run_id
        || !UUID_PATTERN.test(execution?.taskId ?? '')
        || Object.keys(execution ?? {}).sort().join(',') !== 'runId,taskId'
      ) {
        mergeEquivalenceFail('ci_merge_execution_identity_invalid');
      }

      const before = await mergeDrillAuthority.snapshot({
        phase: 'before',
        cell,
        grant,
        resource: authorityResource,
        execution,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();
      let result = null;
      let executionError = null;
      try {
        result = await mergeEffectExecutor(execution);
      } catch (error) {
        executionError = error;
      }
      signal?.throwIfAborted();
      const after = await mergeDrillAuthority.snapshot({
        phase: 'after',
        cell,
        grant,
        resource: authorityResource,
        execution,
        result,
        execution_error_code: executionError?.code ?? null,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();

      if (cell.scenario === 'violation') {
        const denied = await mergeDrillAuthority.confirmDenial({
          cell,
          grant,
          resource: authorityResource,
          execution,
          result,
          error: executionError,
          before,
          after,
          signal,
        });
        signal?.throwIfAborted();
        if (
          (executionError == null && result?.status !== 'BLOCKED')
          || denied !== true
        ) {
          mergeEquivalenceFail('ci_merge_denial_unconfirmed');
        }
      } else {
        const confirmed = await mergeDrillAuthority.confirmSuccess({
          cell,
          grant,
          resource: authorityResource,
          execution,
          result,
          error: executionError,
          before,
          after,
          predecessor,
          signal,
        });
        signal?.throwIfAborted();
        if (
          executionError != null
          ||
          !['DONE', 'DONE_WITH_CONCERNS'].includes(result?.status)
          || confirmed !== true
        ) {
          mergeEquivalenceFail('ci_merge_effect_unconfirmed');
        }
        if (cell.scenario === 'recovery') {
          const recovered = await mergeDrillAuthority.confirmRecovery({
            cell,
            grant,
            resource: authorityResource,
            execution,
            result,
            before,
            after,
            predecessor,
            signal,
          });
          signal?.throwIfAborted();
          if (recovered !== true) {
            mergeEquivalenceFail('ci_merge_recovery_unconfirmed');
          }
        }
      }
      if (
        !before
        || typeof before !== 'object'
        || Array.isArray(before)
        || !after
        || typeof after !== 'object'
        || Array.isArray(after)
      ) {
        mergeEquivalenceFail('ci_merge_equivalence_snapshot_invalid');
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
      return mergeDrillAuthority.cancel({
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
      return mergeDrillAuthority.cleanup({
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

export const __test__ = {
  confirmedReceipt,
  failedReceipt,
  unconfirmedReceipt,
};
