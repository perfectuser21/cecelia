import {
  RELEASE_POLICY_VERSION,
  ReleaseRunError,
  validateReleaseIdentity,
  validateProductionObservation,
  validateStagingObservation,
} from './release-run-contract.js';
import { validateRequiredE2EManifest } from './release-run-e2e.js';

function blocked(release, detail) {
  return {
    status: 'BLOCKED',
    release_state: release?.state ?? null,
    release_run_id: release?.id ?? null,
    merge_sha: release?.merge_sha ?? null,
    detail,
  };
}

function done(release) {
  return {
    status: 'DONE',
    release_state: 'production_verified',
    release_run_id: release.id,
    merge_sha: release.merge_sha,
  };
}

function publicStatus(value) {
  return [
    'pass',
    'not_applied',
    'skipped',
    'idle',
    'unknown',
    'unavailable',
    'fail',
  ].includes(value)
    ? value
    : 'unknown';
}

function receiptFor(intent, status, observation, evidence, e2eManifest) {
  const verification = observation?.status === 'pass'
    ? {
        status: 'pass',
        ...(observation.health == null ? {} : { health: observation.health }),
        ...(observation.required_e2e == null ? {} : { required_e2e: observation.required_e2e }),
        ...(observation.e2e_manifest_digest == null
          ? {}
          : { e2e_manifest_digest: observation.e2e_manifest_digest }),
        ...(observation.e2e_environment == null
          ? {}
          : { e2e_environment: observation.e2e_environment }),
        ...(observation.e2e_scenarios_total == null
          ? {}
          : { e2e_scenarios_total: observation.e2e_scenarios_total }),
        ...(observation.e2e_scenarios_passed == null
          ? {}
          : { e2e_scenarios_passed: observation.e2e_scenarios_passed }),
        ...(observation.e2e_scenario_results == null
          ? {}
          : { e2e_scenario_results: observation.e2e_scenario_results }),
        ...(observation.e2e_started_at == null
          ? {}
          : { e2e_started_at: observation.e2e_started_at }),
        ...(observation.e2e_finished_at == null
          ? {}
          : { e2e_finished_at: observation.e2e_finished_at }),
        ...(observation.e2e_artifact_readback == null
          ? {}
          : { e2e_artifact_readback: observation.e2e_artifact_readback }),
        ...(observation.rollback_metadata == null
          ? {}
          : { rollback_metadata: observation.rollback_metadata }),
      }
    : null;
  return {
    intent_id: intent.id,
    receipt_status: status,
    dispatch_claim_id: observation?.dispatch_claim_id ?? null,
    dispatch_generation: observation?.dispatch_generation ?? null,
    observed_merge_sha: observation?.merge_sha ?? null,
    observed_artifact_versions:
      observation?.artifact_versions
      ?? observation?.deployed_versions
      ?? null,
    e2e_manifest_id: e2eManifest.id,
    e2e_manifest_digest: e2eManifest.manifest_digest,
    e2e_environment: observation?.e2e_environment ?? null,
    e2e_scenarios_total: observation?.e2e_scenarios_total ?? null,
    e2e_scenarios_passed: observation?.e2e_scenarios_passed ?? null,
    e2e_scenario_results: observation?.e2e_scenario_results ?? null,
    e2e_started_at: observation?.e2e_started_at ?? null,
    e2e_finished_at: observation?.e2e_finished_at ?? null,
    evidence: {
      ...evidence,
      ...(verification == null ? {} : { verification }),
    },
  };
}

function identityMatchesMerge(release, merge) {
  return release.run_id === merge.run_id
    && release.task_id === merge.task_id
    && release.merge_sha === merge.merge_sha
    && release.source_head_sha === merge.source_head_sha;
}

function requiredManifest(release) {
  if (!release?.e2e_manifest?.id) {
    throw new ReleaseRunError('release_e2e_manifest_missing');
  }
  const { id, ...value } = release.e2e_manifest;
  return {
    id,
    ...validateRequiredE2EManifest(value, {
      release_run_id: release.id,
      run_id: release.run_id,
      repository: release.repository,
      merge_sha: release.merge_sha,
      artifact_versions: release.artifact_versions,
    }),
  };
}

async function transition(store, client, release, state, evidence = {}) {
  await store.appendTransition(client, {
    releaseRunId: release.id,
    currentState: release.state,
    state,
    evidence,
  });
  return { ...release, state, transition_evidence: evidence };
}

async function reconcileEffect({
  client,
  release,
  store,
  effectKind,
  observe,
  runEffect,
  validate,
  e2eManifest,
}) {
  const intent = await store.findOrCreateIntent(client, {
    releaseRun: release,
    effectKind,
  });
  const expected = {
    merge_sha: release.merge_sha,
    artifact_versions: release.artifact_versions,
    e2e_manifest_digest: e2eManifest.manifest_digest,
    e2e_scenarios_total: e2eManifest.scenarios_total,
    e2e_environment: effectKind,
    e2e_scenario_names: e2eManifest.e2e_acceptance.scenarios
      .map((scenario) => scenario.name),
  };
  const effectRequest = {
    release_run_id: release.id,
    merge_sha: release.merge_sha,
    artifact_versions: release.artifact_versions,
    idempotency_key: intent.idempotency_key,
    e2e_manifest: e2eManifest,
  };
  let observation;
  try {
    observation = await observe(effectRequest);
  } catch {
    observation = { status: 'unavailable' };
  }

  try {
    const verified = validate(observation, expected);
    const receipt = await store.appendReceipt(
      client,
      receiptFor(intent, 'confirmed', verified, {
        source: 'recovery_observation',
        status: 'pass',
      }, e2eManifest),
    );
    return { confirmed: true, observation: verified, receipt };
  } catch (error) {
    if (observation?.status !== 'not_applied') {
      const status = publicStatus(observation?.status);
      await store.appendReceipt(
        client,
        receiptFor(
          intent,
          status === 'fail' ? 'failed' : 'observed_unconfirmed',
          observation,
          {
            source: 'recovery_observation',
            status,
            error_code: error?.code ?? `${effectKind}_observation_invalid`,
          },
          e2eManifest,
        ),
      );
      return {
        confirmed: false,
        detail: error?.code ?? `release_${effectKind}_observation_invalid`,
      };
    }
  }

  let commandFailed = false;
  try {
    await runEffect(effectRequest);
  } catch {
    commandFailed = true;
  }

  try {
    observation = await observe(effectRequest);
  } catch {
    observation = { status: 'unavailable' };
  }

  try {
    const verified = validate(observation, expected);
    const receipt = await store.appendReceipt(
      client,
      receiptFor(intent, 'confirmed', verified, {
        source: 'post_effect_observation',
        status: 'pass',
        command_status: commandFailed ? 'error_but_confirmed' : 'ok',
      }, e2eManifest),
    );
    return { confirmed: true, observation: verified, receipt };
  } catch (error) {
    const status = publicStatus(observation?.status);
    await store.appendReceipt(
      client,
      receiptFor(
        intent,
        commandFailed || status === 'fail' ? 'failed' : 'observed_unconfirmed',
        observation,
        {
          source: 'post_effect_observation',
          status,
          error_code: commandFailed
            ? `release_${effectKind}_command_failed`
            : error?.code ?? `release_${effectKind}_observation_invalid`,
          },
          e2eManifest,
        ),
    );
    return {
      confirmed: false,
      detail: error?.code
        ?? (commandFailed
          ? `release_${effectKind}_command_failed`
          : `release_${effectKind}_observation_invalid`),
    };
  }
}

export function createReleaseRunExecutor({
  store,
  resolveArtifactVersions,
  observeStaging,
  runStaging,
  observeProduction,
  runProduction,
}) {
  return async function executeRelease({ runId, taskId }) {
    return store.withReleaseLease(async (client) => {
      let release = null;
      try {
        const merge = await store.loadMergeAuthority(client, { runId, taskId });
        release = await store.loadRelease(client, { runId });

        if (release && !identityMatchesMerge(release, merge)) {
          return blocked(release, 'release_merge_authority_conflict');
        }

        if (!release) {
          if (typeof resolveArtifactVersions !== 'function') {
            return blocked(null, 'release_artifact_resolver_unavailable');
          }
          const artifactVersions = await resolveArtifactVersions({
            run_id: runId,
            task_id: taskId,
            repository: merge.repository,
            merge_sha: merge.merge_sha,
          });
          const identity = validateReleaseIdentity({
            ...merge,
            artifact_versions: artifactVersions,
            policy_version: RELEASE_POLICY_VERSION,
          });
          release = await store.createRelease(client, identity);
        }
        const e2eManifest = requiredManifest(release);
        if (release.state === 'production_verified') return done(release);

        if (release.state === 'merged') {
          release = await transition(store, client, release, 'staging_queued', {
            merge_sha: release.merge_sha,
          });
        }

        if (['staging_queued', 'staging_running'].includes(release.state)) {
          if (
            typeof observeStaging !== 'function'
            || typeof runStaging !== 'function'
          ) {
            return blocked(release, 'release_staging_adapter_unavailable');
          }
          if (release.state === 'staging_queued') {
            release = await transition(store, client, release, 'staging_running', {
              merge_sha: release.merge_sha,
            });
          }
          const staging = await reconcileEffect({
            client,
            release,
            store,
            effectKind: 'staging',
            observe: observeStaging,
            runEffect: runStaging,
            validate: validateStagingObservation,
            e2eManifest,
          });
          if (!staging.confirmed) return blocked(release, staging.detail);
          release = await transition(store, client, release, 'staging_passed', {
            merge_sha: release.merge_sha,
            artifact_versions: release.artifact_versions,
            effect_receipt_id: staging.receipt.id,
            e2e_manifest_digest: e2eManifest.manifest_digest,
            verification: staging.observation,
          });
        }

        if (['staging_passed', 'production_deploying'].includes(release.state)) {
          if (
            typeof observeProduction !== 'function'
            || typeof runProduction !== 'function'
          ) {
            return blocked(release, 'release_production_adapter_unavailable');
          }
          if (
            typeof store.findOrCreateRollbackIntent !== 'function'
            || typeof store.appendRollbackReceipt !== 'function'
          ) {
            return blocked(release, 'release_rollback_ledger_unavailable');
          }
          const rollbackIntent = await store.findOrCreateRollbackIntent(
            client,
            { releaseRun: release },
          );
          if (release.state === 'staging_passed') {
            release = await transition(
              store,
              client,
              release,
              'production_deploying',
              { merge_sha: release.merge_sha },
            );
          }
          const production = await reconcileEffect({
            client,
            release,
            store,
            effectKind: 'production',
            observe: observeProduction,
            runEffect: runProduction,
            validate: validateProductionObservation,
            e2eManifest,
          });
          if (!production.confirmed) return blocked(release, production.detail);
          const rollbackReceipt = await store.appendRollbackReceipt(client, {
            rollback_intent_id: rollbackIntent.id,
            effect_receipt_id: production.receipt.id,
            anchor: production.observation.rollback_metadata.anchor,
            previous_version:
              production.observation.rollback_metadata.previous_version,
            rollback_metadata: production.observation.rollback_metadata,
          });
          release = await transition(
            store,
            client,
            release,
            'production_verified',
            {
              merge_sha: release.merge_sha,
              deployed_versions: release.artifact_versions,
              effect_receipt_id: production.receipt.id,
              rollback_receipt_id: rollbackReceipt.id,
              e2e_manifest_digest: e2eManifest.manifest_digest,
              verification: production.observation,
            },
          );
        }

        if (release.state !== 'production_verified') {
          return blocked(release, 'release_state_not_verified');
        }
        return done(release);
      } catch (error) {
        if (error instanceof ReleaseRunError || error?.code?.startsWith?.('release_')) {
          return blocked(release, error.code ?? error.message);
        }
        throw error;
      }
    });
  };
}

export const __test__ = {
  blocked,
  done,
  identityMatchesMerge,
  publicStatus,
  requiredManifest,
  receiptFor,
};
