import {
  RELEASE_POLICY_VERSION,
  ReleaseRunError,
  validateReleaseIdentity,
  validateProductionObservation,
  validateStagingObservation,
} from './release-run-contract.js';

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

function receiptFor(intent, status, observation, evidence) {
  return {
    intent_id: intent.id,
    receipt_status: status,
    observed_merge_sha: observation?.merge_sha ?? null,
    observed_artifact_versions:
      observation?.artifact_versions
      ?? observation?.deployed_versions
      ?? null,
    evidence,
  };
}

function identityMatchesMerge(release, merge) {
  return release.run_id === merge.run_id
    && release.task_id === merge.task_id
    && release.merge_sha === merge.merge_sha
    && release.source_head_sha === merge.source_head_sha;
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
}) {
  const intent = await store.findOrCreateIntent(client, {
    releaseRun: release,
    effectKind,
  });
  if (intent.confirmed_receipt) return { confirmed: true };

  const expected = {
    merge_sha: release.merge_sha,
    artifact_versions: release.artifact_versions,
  };
  let observation;
  try {
    observation = await observe({
      release_run_id: release.id,
      merge_sha: release.merge_sha,
      artifact_versions: release.artifact_versions,
      idempotency_key: intent.idempotency_key,
    });
  } catch {
    observation = { status: 'unavailable' };
  }

  try {
    const verified = validate(observation, expected);
    await store.appendReceipt(
      client,
      receiptFor(intent, 'confirmed', verified, {
        source: 'recovery_observation',
        status: 'pass',
      }),
    );
    return { confirmed: true };
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
    await runEffect({
      release_run_id: release.id,
      merge_sha: release.merge_sha,
      artifact_versions: release.artifact_versions,
      idempotency_key: intent.idempotency_key,
    });
  } catch {
    commandFailed = true;
  }

  try {
    observation = await observe({
      release_run_id: release.id,
      merge_sha: release.merge_sha,
      artifact_versions: release.artifact_versions,
      idempotency_key: intent.idempotency_key,
    });
  } catch {
    observation = { status: 'unavailable' };
  }

  try {
    const verified = validate(observation, expected);
    await store.appendReceipt(
      client,
      receiptFor(intent, 'confirmed', verified, {
        source: 'post_effect_observation',
        status: 'pass',
        command_status: commandFailed ? 'error_but_confirmed' : 'ok',
      }),
    );
    return { confirmed: true };
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
        if (release?.state === 'production_verified') return done(release);

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
          });
          if (!staging.confirmed) return blocked(release, staging.detail);
          release = await transition(store, client, release, 'staging_passed', {
            merge_sha: release.merge_sha,
            artifact_versions: release.artifact_versions,
          });
        }

        if (['staging_passed', 'production_deploying'].includes(release.state)) {
          if (
            typeof observeProduction !== 'function'
            || typeof runProduction !== 'function'
          ) {
            return blocked(release, 'release_production_adapter_unavailable');
          }
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
          });
          if (!production.confirmed) return blocked(release, production.detail);
          release = await transition(
            store,
            client,
            release,
            'production_verified',
            {
              merge_sha: release.merge_sha,
              deployed_versions: release.artifact_versions,
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
  receiptFor,
};
