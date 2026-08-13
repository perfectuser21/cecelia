#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { promisify } = require('node:util');

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

function runtimeFor(attemptId, postgresImageDigest) {
  const { containerName, networkName } = namesFor(attemptId);
  return Object.freeze({
    postgres: Object.freeze({
      container_name: containerName,
      network_name: networkName,
      image_digest: postgresImageDigest,
    }),
  });
}

function parseOwnedRows(stdout, expectedName) {
  const rows = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line) continue;
    const [name, attemptId] = line.split('\t');
    if (!UUID_PATTERN.test(attemptId ?? '') || name !== expectedName(attemptId)) {
      continue;
    }
    rows.push(Object.freeze({ name, attemptId }));
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

async function removePostgresContainer(runCommand, attemptId) {
  const { containerName } = namesFor(attemptId);
  try {
    await runCommand('docker', ['rm', '-f', '--', containerName]);
  } catch (error) {
    if (!isExplicitlyMissing(error)) {
      throw new Error('attempt_resource_service_release_failed', { cause: error });
    }
  }
}

async function removeOwned(runCommand, attemptId) {
  const { networkName } = namesFor(attemptId);
  const failures = [];
  try {
    await removePostgresContainer(runCommand, attemptId);
  } catch (error) {
    failures.push(error);
  }
  try {
    await runCommand('docker', ['network', 'rm', '--', networkName]);
  } catch (error) {
    if (!isExplicitlyMissing(error)) failures.push(error);
  }
  if (failures.length > 0) {
    throw new Error('attempt_resource_release_failed', {
      cause: new AggregateError(failures),
    });
  }
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
  runCommand = defaultRunCommand,
  postgresImageDigest,
  randomBytesFn = randomBytes,
  waitFn = defaultWait,
  healthAttempts = DEFAULT_HEALTH_ATTEMPTS,
  healthIntervalMs = DEFAULT_HEALTH_INTERVAL_MS,
} = {}) {
  if (typeof runCommand !== 'function') {
    throw new Error('attempt_resource_invalid_command_runner');
  }
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

  return Object.freeze({
    async provision({ attemptId, requirements } = {}) {
      assertAttemptId(attemptId);
      const validated = validateRequirements(requirements);
      if (!validated.postgres) {
        return Object.freeze({
          runtime: Object.freeze({}),
          environment: Object.freeze({}),
          networkName: undefined,
        });
      }

      const { containerName, networkName } = namesFor(attemptId);
      const suffix = randomBytesFn(32).toString('hex');
      if (!/^[a-f0-9]{64}$/.test(suffix)) {
        throw new Error('attempt_resource_entropy_invalid');
      }
      const username = `attempt_${suffix.slice(0, 16)}`;
      const password = suffix.slice(16, 48);
      const database = `acceptance_${suffix.slice(48)}_scratch`;
      let networkCreated = false;
      let containerCreated = false;
      try {
        await runCommand('docker', [
          'network',
          'create',
          '--label',
          `cecelia.fleet.attempt_id=${attemptId}`,
          '--label',
          'cecelia.fleet.resource=postgres',
          '--',
          networkName,
        ]);
        networkCreated = true;
        await runCommand('docker', [
          'run',
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
        containerCreated = true;

        let healthy = false;
        for (let attempt = 0; attempt < healthAttempts; attempt += 1) {
          const readiness = await runCommand('docker', [
            'exec',
            '--',
            containerName,
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
          runtime: runtimeFor(attemptId, postgresImageDigest),
          environment: Object.freeze({
            DB_URL: dbUrl,
            DATABASE_URL: dbUrl,
          }),
          networkName,
        });
      } catch (error) {
        const cleanupFailures = [];
        if (containerCreated) {
          try {
            await runCommand('docker', ['rm', '-f', '--', containerName]);
          } catch (cleanupError) {
            if (!isExplicitlyMissing(cleanupError)) cleanupFailures.push(cleanupError);
          }
        }
        if (networkCreated) {
          try {
            await runCommand('docker', ['network', 'rm', '--', networkName]);
          } catch (cleanupError) {
            if (!isExplicitlyMissing(cleanupError)) cleanupFailures.push(cleanupError);
          }
        }
        if (cleanupFailures.length > 0) {
          throw new Error(`attempt_resource_rollback_failed:${error.message}`, {
            cause: new AggregateError([error, ...cleanupFailures]),
          });
        }
        throw error;
      }
    },

    async release({ attemptId, runtime } = {}) {
      assertAttemptId(attemptId);
      if (!runtime || Object.keys(runtime).length === 0) {
        return Object.freeze({ status: 'released' });
      }
      // Ownership is bound to deterministic Attempt names plus an immutable
      // digest recorded in state. It must not depend on the Worker's current
      // baseline digest, otherwise an image upgrade makes old attempts leak.
      assertExactRuntime(attemptId, runtime);
      await removeOwned(runCommand, attemptId);
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
      await removePostgresContainer(runCommand, attemptId);
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
          '{{.Names}}\t{{.Label "cecelia.fleet.attempt_id"}}',
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
          '{{.Name}}\t{{.Label "cecelia.fleet.attempt_id"}}',
        ])).stdout,
        (attemptId) => namesFor(attemptId).networkName,
      );
      const removableAttemptIds = new Set([
        ...containers.map(({ attemptId }) => attemptId),
        ...networks.map(({ attemptId }) => attemptId),
      ].filter((attemptId) => !retained.has(attemptId)));
      for (const attemptId of [...removableAttemptIds].sort()) {
        await removeOwned(runCommand, attemptId);
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
