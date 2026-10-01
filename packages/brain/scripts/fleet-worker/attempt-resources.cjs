#!/usr/bin/env node
'use strict';
const { CONTAINER_ID, verifyContainerIdentity } = require('./attempt-container-identity.cjs');
const { resolveAttemptResourcePlan, dockerLimitArgs } = require('./attempt-resource-policy.cjs');

const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { promisify } = require('node:util');
const {guardLaunchCommand}=require('./local-resource-admission.cjs');

const execFileAsync = promisify(execFile);
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const IMAGE_DIGEST_PATTERN = /^(?:[a-z0-9][a-z0-9._/:~-]*@)?sha256:[a-f0-9]{64}$/;
const DEFAULT_HEALTH_ATTEMPTS = 30;
const DEFAULT_HEALTH_INTERVAL_MS = 1_000;

async function defaultRunCommand(command, args, options) {
  const { stdout = '' } = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    ...options,
  });
  return { stdout: stdout.trim() };
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertAttemptId(attemptId) {
  if (!UUID_PATTERN.test(attemptId ?? '')) {
    throw new Error('attempt_resource_invalid_attempt_id');
  }
}

function namesFor(attemptId) {
  assertAttemptId(attemptId);
  return Object.freeze({
    containerName: `cecelia-pg-${attemptId}`,
    networkName: `cecelia-attempt-${attemptId}`,
  });
}

function validateRequirements(value) {
  if (value == null) return Object.freeze({ postgres: false });
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('attempt_runtime_requirements_invalid');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'postgres') {
      throw new Error(`attempt_runtime_resource_unsupported:${key}`);
    }
  }
  if (value.postgres != null && typeof value.postgres !== 'boolean') {
    throw new Error('attempt_runtime_postgres_requirement_invalid');
  }
  return Object.freeze({ postgres: value.postgres === true });
}

function runtimeFor(attemptId, postgresImageDigest, containerId, networkId) {
  const { containerName, networkName } = namesFor(attemptId);
  return Object.freeze({
    postgres: Object.freeze({
      container_name: containerName,
      network_name: networkName,
      image_digest: postgresImageDigest,
      container_id: containerId,
      network_id: networkId,
    }),
  });
}

function parseOwnedRows(stdout, expectedName) {
  const rows = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line) continue;
    const [id, name, attemptId] = line.split('\t');
    if (!CONTAINER_ID.test(id ?? '') || !UUID_PATTERN.test(attemptId ?? '') || name !== expectedName(attemptId)) {
      continue;
    }
    rows.push(Object.freeze({ id, name, attemptId }));
  }
  return rows;
}

function isExplicitlyMissing(error) {
  const detail = [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join('\n');
  return /no such (?:container|network)|(?:container|network).*not found/i
    .test(detail);
}

function assertExactRuntime(attemptId, runtime) {
  const expectedNames = namesFor(attemptId);
  const actual = runtime?.postgres;
  if (
    !actual
    || actual.container_name !== expectedNames.containerName
    || actual.network_name !== expectedNames.networkName
    || !IMAGE_DIGEST_PATTERN.test(actual.image_digest ?? '')
  ) {
    throw new Error('attempt_runtime_resource_owner_mismatch');
  }
}

function createAttemptResourceManager({
  workerId,
  runCommand = defaultRunCommand,
  postgresImageDigest,
  randomBytesFn = randomBytes,
  waitFn = defaultWait,
  healthAttempts = DEFAULT_HEALTH_ATTEMPTS,
  healthIntervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  assertCanLaunch=()=>{},
} = {}) {
  if (typeof runCommand !== 'function') {
    throw new Error('attempt_resource_invalid_command_runner');
  }
  runCommand=guardLaunchCommand(runCommand,assertCanLaunch);
  if (!IMAGE_DIGEST_PATTERN.test(postgresImageDigest ?? '')) {
    throw new Error('attempt_resource_invalid_postgres_digest');
  }
  if (typeof randomBytesFn !== 'function' || typeof waitFn !== 'function') {
    throw new Error('attempt_resource_invalid_dependency');
  }
  if (!Number.isInteger(healthAttempts) || healthAttempts < 1 || healthAttempts > 300) {
    throw new Error('attempt_resource_invalid_health_attempts');
  }
  if (!Number.isInteger(healthIntervalMs) || healthIntervalMs < 0 || healthIntervalMs > 60_000) {
    throw new Error('attempt_resource_invalid_health_interval');
  }

  async function resolveIdentity({ attemptId, runtime, allowMissing = false } = {}) {
    assertAttemptId(attemptId); assertExactRuntime(attemptId, runtime);
    const previous = runtime.postgres;
    // Absence is an observation, never permission to bind a different container.
    if (previous.container_missing === true && previous.container_id == null) {
      if (!allowMissing) throw new Error('attempt_runtime_resource_owner_mismatch');
      return runtime;
    }
    const id = await verifyContainerIdentity({ runCommand, containerId: previous.container_id,
      containerName: previous.container_name, image: previous.image_digest, allowName: true, allowMissing,
      labels: { 'cecelia.fleet.attempt_id': attemptId, 'cecelia.fleet.resource': 'postgres' },
      errorCode: 'attempt_runtime_resource_owner_mismatch' });
    return Object.freeze({ postgres: Object.freeze({ ...previous, container_id: id ?? previous.container_id ?? null, container_missing: id === null }) });
  }

  async function removeExactContainer(containerId) {
    try { await runCommand('docker', ['rm', '-f', '--', containerId]); }
    catch (error) { if (!isExplicitlyMissing(error)) throw new Error('attempt_resource_service_release_failed'); }
  }
  async function removeExactNetwork(networkId) {
    try { await runCommand('docker', ['network', 'rm', '--', networkId]); }
    catch (error) { if (!isExplicitlyMissing(error)) throw new Error('attempt_resource_release_failed'); }
  }
  async function resolveNetworkIdentity(attemptId, networkId) {
    const { networkName } = namesFor(attemptId);
    let observed;
    if (networkId != null && !CONTAINER_ID.test(networkId)) throw new Error('attempt_runtime_resource_owner_mismatch');
    try { observed = await runCommand('docker', ['network', 'inspect', networkId ?? networkName]); }
    catch (error) { if (isExplicitlyMissing(error)) return null; throw new Error('attempt_runtime_resource_owner_mismatch'); }
    let value;
    try { value = JSON.parse(observed.stdout)?.[0]; } catch { throw new Error('attempt_runtime_resource_owner_mismatch'); }
    if (!CONTAINER_ID.test(value?.Id ?? '') || (networkId && value.Id !== networkId) || value.Name !== networkName
        || value.Labels?.['cecelia.fleet.attempt_id'] !== attemptId
        || value.Labels?.['cecelia.fleet.resource'] !== 'postgres') throw new Error('attempt_runtime_resource_owner_mismatch');
    return value.Id;
  }
  return Object.freeze({
    resolveIdentity,
    async provision({ attemptId, requirements, role } = {}) {
      assertAttemptId(attemptId);
      const validated = validateRequirements(requirements);
      if (!validated.postgres) {
        return Object.freeze({
          runtime: Object.freeze({}),
          environment: Object.freeze({}),
          networkName: undefined,
        });
      }

      const plan = resolveAttemptResourcePlan({ workerId, role, postgres: true });
      const { containerName, networkName } = namesFor(attemptId);
      const suffix = randomBytesFn(32).toString('hex');
      if (!/^[a-f0-9]{64}$/.test(suffix)) {
        throw new Error('attempt_resource_entropy_invalid');
      }
      const username = `attempt_${suffix.slice(0, 16)}`;
      const password = suffix.slice(16, 48);
      const database = `acceptance_${suffix.slice(48)}_scratch`;
      let networkAttempted = false, containerAttempted = false;
      let networkId, containerId;
      try {
        networkAttempted = true;
        const networkCreated = await runCommand('docker', [
          'network',
          'create',
          '--label',
          `cecelia.fleet.attempt_id=${attemptId}`,
          '--label',
          'cecelia.fleet.resource=postgres',
          '--',
          networkName,
        ]);
        networkId = String(networkCreated.stdout ?? '').trim();
        if (!CONTAINER_ID.test(networkId)) throw new Error('attempt_resource_identity_required');
        containerAttempted = true;
        const created = await runCommand('docker', [
          'run',
          ...dockerLimitArgs(plan.postgres),
          '--detach',
          '--name',
          containerName,
          '--label',
          `cecelia.fleet.attempt_id=${attemptId}`,
          '--label',
          'cecelia.fleet.resource=postgres',
          '--network',
          networkName,
          '--network-alias',
          'postgres',
          '--env',
          `POSTGRES_USER=${username}`,
          '--env',
          `POSTGRES_PASSWORD=${password}`,
          '--env',
          `POSTGRES_DB=${database}`,
          postgresImageDigest,
        ]);
        containerId = String(created.stdout ?? '').trim();
        if (!CONTAINER_ID.test(containerId)) throw new Error('attempt_resource_identity_required');

        let healthy = false;
        for (let attempt = 0; attempt < healthAttempts; attempt += 1) {
          const readiness = await runCommand('docker', [
            'exec',
            '--',
            containerId,
            'pg_isready',
            '-U',
            username,
            '-d',
            database,
          ]).catch(() => ({ stdout: '' }));
          if (/accepting connections/i.test(String(readiness?.stdout ?? ''))) {
            healthy = true;
            break;
          }
          if (attempt + 1 < healthAttempts) await waitFn(healthIntervalMs);
        }
        if (!healthy) throw new Error('attempt_postgres_not_ready');

        const dbUrl = `postgresql://${username}:${password}@postgres:5432/${database}`;
        return Object.freeze({
          runtime: runtimeFor(attemptId, postgresImageDigest, containerId, networkId),
          environment: Object.freeze({
            DB_URL: dbUrl,
            DATABASE_URL: dbUrl,
            DB_HOST: 'postgres',
            DB_PORT: '5432',
            DB_USER: username,
            DB_PASSWORD: password,
            DB_NAME: database,
          }),
          networkName,
        });
      } catch (error) {
        const cleanupFailures = [];
        if (containerAttempted) {
          try {
            if (!CONTAINER_ID.test(containerId ?? '')) throw new Error('attempt_resource_identity_required');
            const verified = await resolveIdentity({ attemptId, runtime: runtimeFor(attemptId, postgresImageDigest, containerId, networkId), allowMissing: true });
            if (!verified.postgres.container_missing) await removeExactContainer(verified.postgres.container_id);
          } catch (cleanupError) { cleanupFailures.push(cleanupError); }
        }
        if (networkAttempted) {
          try {
            if (!CONTAINER_ID.test(networkId ?? '')) throw new Error('attempt_resource_identity_required');
            const verifiedId = await resolveNetworkIdentity(attemptId, networkId);
            if (verifiedId) await removeExactNetwork(verifiedId);
          } catch (cleanupError) { cleanupFailures.push(cleanupError); }
        }
        if (cleanupFailures.length > 0) {
          const rollbackError = new Error(`attempt_resource_rollback_failed:${error.message}`, {
            cause: new AggregateError([error, ...cleanupFailures]),
          });
          rollbackError.cleanupUnconfirmed = true;
          throw rollbackError;
        }
        throw error;
      }
    },

    async enforceLimits({ attemptId, role, runtime } = {}) {
      assertAttemptId(attemptId); assertExactRuntime(attemptId, runtime);
      if (!CONTAINER_ID.test(runtime.postgres.container_id ?? '')) throw new Error('attempt_resource_identity_required');
      const verified = await resolveIdentity({ attemptId, runtime });
      const plan = resolveAttemptResourcePlan({ workerId, role, postgres: true });
      await runCommand('docker', ['update', ...dockerLimitArgs(plan.postgres), '--', verified.postgres.container_id]);
    },
    async release({ attemptId, runtime } = {}) {
      assertAttemptId(attemptId);
      if (!runtime || Object.keys(runtime).length === 0) {
        return Object.freeze({ status: 'released' });
      }
      assertExactRuntime(attemptId, runtime);
      const verified = await resolveIdentity({ attemptId, runtime, allowMissing: true });
      const networkId = await resolveNetworkIdentity(attemptId, runtime.postgres.network_id);
      if (!verified.postgres.container_missing) await removeExactContainer(verified.postgres.container_id);
      if (networkId) await removeExactNetwork(networkId);
      return Object.freeze({ status: 'released' });
    },

    async releaseService({ attemptId, runtime } = {}) {
      assertAttemptId(attemptId);
      if (!runtime || Object.keys(runtime).length === 0) {
        return Object.freeze({ status: 'released' });
      }
      assertExactRuntime(attemptId, runtime);
      // The callback-sending Runner is still attached to the attempt network.
      // Only PostgreSQL can be removed before Brain durably accepts the claim;
      // finalize() removes the network after the Runner exits.
      const verified = await resolveIdentity({ attemptId, runtime, allowMissing: true });
      if (!verified.postgres.container_missing) await removeExactContainer(verified.postgres.container_id);
      return Object.freeze({ status: 'released' });
    },

    async reconcile({ retainedAttemptIds = [] } = {}) {
      if (!Array.isArray(retainedAttemptIds)) {
        throw new Error('attempt_resource_retained_ids_invalid');
      }
      for (const attemptId of retainedAttemptIds) assertAttemptId(attemptId);
      const retained = new Set(retainedAttemptIds);
      const containers = parseOwnedRows(
        (await runCommand('docker', [
          'ps',
          '-a',
          '--filter',
          'label=cecelia.fleet.resource=postgres',
          '--format',
          '{{.ID}}\t{{.Names}}\t{{.Label "cecelia.fleet.attempt_id"}}',
          '--no-trunc',
        ])).stdout,
        (attemptId) => namesFor(attemptId).containerName,
      );
      const networks = parseOwnedRows(
        (await runCommand('docker', [
          'network',
          'ls',
          '--filter',
          'label=cecelia.fleet.resource=postgres',
          '--format',
          '{{.ID}}\t{{.Name}}\t{{.Label "cecelia.fleet.attempt_id"}}',
          '--no-trunc',
        ])).stdout,
        (attemptId) => namesFor(attemptId).networkName,
      );
      const removableAttemptIds = new Set();
      for (const { id, attemptId } of containers) {
        if (retained.has(attemptId)) continue;
        const verifiedId = await verifyContainerIdentity({ runCommand, containerId: id,
          containerName: namesFor(attemptId).containerName, allowMissing: true,
          labels: { 'cecelia.fleet.attempt_id': attemptId, 'cecelia.fleet.resource': 'postgres' },
          errorCode: 'attempt_runtime_resource_owner_mismatch' });
        if (verifiedId) await removeExactContainer(verifiedId);
        removableAttemptIds.add(attemptId);
      }
      for (const { id, attemptId } of networks) {
        if (retained.has(attemptId)) continue;
        const verifiedId = await resolveNetworkIdentity(attemptId, id);
        if (verifiedId) await removeExactNetwork(verifiedId);
        removableAttemptIds.add(attemptId);
      }
      return Object.freeze({
        removed_attempts: Object.freeze([...removableAttemptIds].sort()),
      });
    },
  });
}

module.exports = {
  createAttemptResourceManager,
};
