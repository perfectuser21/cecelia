#!/usr/bin/env node
'use strict';

const { Buffer } = require('node:buffer');
const { createHmac, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const process = require('node:process');
const {
  createAttemptRunner,
  createDockerAdapter,
  createFileAttemptStateStore,
} = require('./attempt-runner.cjs');
const { createAttemptResourceManager } = require('./attempt-resources.cjs');
const {
  createCredentialEnvelopeConsumer,
} = require('./credential-envelope.cjs');
const {
  createGitHubCredentialEnvelopeConsumer,
} = require('./github-credential-envelope.cjs');
const { probeFleetWorkerHealth } = require('./node-probe.cjs');
const { createWorkspaceManager } = require('./workspace-manager.cjs');

const MAX_STRING_LENGTH = 1_024;
const MAX_RESPONSE_BYTES = 65_536;
const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
const DEFAULT_HEALTH_CACHE_TTL_MS = 30_000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5_231;
const ATTEMPT_PATH = /^\/harness\/attempts\/([a-f0-9-]+)$/;
const ATTEMPT_ACTION_PATH = /^\/harness\/attempts\/([a-f0-9-]+)\/(start|cancel|terminal)$/;
const UNTRUSTED_WORKSPACE_FIELDS = new Set([
  'cwd',
  'worktree_path',
  'workspace_path',
]);
const CANONICAL_MACHINE_IDS = new Set([
  'us-mac-m4',
  'xian-mac-m4',
  'xian-mac-m1',
]);
const RUNNER_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const POSTGRES_IMAGE = 'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';

function safeString(value, fallback = 'unavailable') {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  let output = value.slice(0, MAX_STRING_LENGTH);
  if (/account|allowlist|authori[sz]ation|auth|token|prompt|credential/i.test(output)) {
    output = 'redacted';
  }
  output = output.replace(
    /\/(?:Users|private|tmp|var\/folders)\/[^\s"',}]*/g,
    '[redacted-path]',
  );
  return output || fallback;
}

function safeBoolean(value) {
  return value === true;
}

function safeNumber(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && value >= 0
    ? Math.min(value, maximum)
    : fallback;
}

function projectHealth(report) {
  const source = report && typeof report === 'object' && !Array.isArray(report)
    ? report
    : {};
  return {
    schema_version: safeString(source.schema_version, 'fleet-node-health/v1'),
    machine_id: safeString(source.machine_id, 'unconfigured'),
    observed_at: safeString(source.observed_at, '1970-01-01T00:00:00.000Z'),
    worker: {
      protocol_version: safeString(source.worker?.protocol_version),
      contract_version: safeString(source.worker?.contract_version),
      version: safeString(source.worker?.version),
    },
    runner: {
      version: safeString(source.runner?.version),
      image_digest: safeString(source.runner?.image_digest, 'unconfigured'),
    },
    os: {
      version: safeString(source.os?.version),
    },
    orbstack: {
      version: safeString(source.orbstack?.version),
    },
    docker: {
      available: safeBoolean(source.docker?.available),
      observed_at: safeString(
        source.docker?.observed_at,
        '1970-01-01T00:00:00.000Z',
      ),
    },
    resources: {
      cpu_cores: safeNumber(source.resources?.cpu_cores),
      memory_bytes: safeNumber(source.resources?.memory_bytes),
      disk_free_bytes: safeNumber(source.resources?.disk_free_bytes),
      disk_used_percent: safeNumber(source.resources?.disk_used_percent, 100, 100),
      cpu_pressure_percent: safeNumber(
        source.resources?.cpu_pressure_percent,
        100,
        100,
      ),
      memory_pressure_percent: safeNumber(
        source.resources?.memory_pressure_percent,
        100,
        100,
      ),
    },
    git: {
      available: safeBoolean(source.git?.available),
      version: safeString(source.git?.version),
    },
    node: {
      available: safeBoolean(source.node?.available),
      version: safeString(source.node?.version),
    },
    codex: {
      available: safeBoolean(source.codex?.available),
      version: safeString(source.codex?.version),
    },
    tailscale: {
      connected: safeBoolean(source.tailscale?.connected),
    },
    callback: {
      reachable: safeBoolean(source.callback?.reachable),
    },
    time_sync: {
      synchronized: safeBoolean(source.time_sync?.synchronized),
    },
    power: {
      sleep_disabled: safeBoolean(source.power?.sleep_disabled),
      auto_power_on: safeBoolean(source.power?.auto_power_on),
    },
    launchd: {
      loaded: safeBoolean(source.launchd?.loaded),
      domain: safeString(source.launchd?.domain, 'system'),
      kind: safeString(source.launchd?.kind, 'LaunchDaemon'),
    },
    worktree: {
      root_ready: safeBoolean(source.worktree?.root_ready),
    },
    container: {
      probe_succeeded: safeBoolean(source.container?.probe_succeeded),
    },
    runtime_resources: {
      postgres: {
        available: safeBoolean(source.runtime_resources?.postgres?.available),
        image_digest: safeString(
          source.runtime_resources?.postgres?.image_digest,
          'unconfigured',
        ),
      },
    },
    drain: {
      active: source.drain?.active !== false,
    },
  };
}

function serializeBounded(value) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, 'utf8') <= MAX_RESPONSE_BYTES) return body;
  return '{"error":"health_response_too_large"}';
}

function writeJson(response, statusCode, value) {
  const body = serializeBounded(value);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body, 'utf8'),
  });
  response.end(body);
}

function validAttemptRunner(value) {
  return ['prepare', 'start', 'inspect', 'cancel', 'terminal', 'reconcile']
    .every((method) => typeof value?.[method] === 'function');
}

function validBearer(request, token) {
  if (typeof token !== 'string' || token.length < 32) return false;
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  const actual = Buffer.from(String(request.headers?.authorization ?? ''), 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signAttestation(secret, attemptId, machineId, jobId) {
  return createHmac('sha256', secret)
    .update(`${attemptId}\n${machineId}\n${jobId}`, 'utf8')
    .digest('hex');
}

function acceptedReceipt(receipt, secret) {
  const attemptId = receipt?.attempt_id;
  const machineId = receipt?.actual_machine_id;
  const jobId = receipt?.remote_job_id ?? receipt?.container_id;
  if (
    typeof attemptId !== 'string'
    || typeof machineId !== 'string'
    || typeof jobId !== 'string'
    || jobId.length === 0
  ) {
    throw new Error('attempt_launch_receipt_invalid');
  }
  return Object.freeze({
    status: 'accepted',
    job_id: jobId,
    actual_machine_id: machineId,
    attestation: signAttestation(secret, attemptId, machineId, jobId),
  });
}

function startReceipt(receipt) {
  const attemptId = receipt?.attempt_id;
  const status = receipt?.status;
  const terminalStatus = receipt?.terminal_status;
  if (
    typeof attemptId !== 'string'
    || !['starting', 'running', 'terminal'].includes(status)
    || (
      status === 'terminal'
      && ![
        'cleaned',
        'missing',
        'exited',
        'dead',
        'removed',
        'quarantined',
        'credential_delivery_unconfirmed',
      ].includes(terminalStatus)
    )
  ) {
    throw new Error('attempt_start_receipt_invalid');
  }
  return Object.freeze({
    status,
    attempt_id: attemptId,
    ...(status === 'terminal' ? { terminal_status: terminalStatus } : {}),
    ...(receipt.deduped === true ? { deduped: true } : {}),
  });
}

function terminalReceipt(receipt, secret, configuredMachineId) {
  const attemptId = receipt?.attempt_id;
  const status = receipt?.status;
  const machineId = safeString(configuredMachineId, 'us-mac-m4');
  if (
    typeof attemptId !== 'string'
    || !['cleaned', 'already_clean', 'quarantined'].includes(status)
    || typeof machineId !== 'string'
    || machineId.length === 0
  ) {
    throw new Error('attempt_terminal_receipt_invalid');
  }
  return Object.freeze({
    status,
    attempt_id: attemptId,
    actual_machine_id: machineId,
    attestation: signAttestation(
      secret,
      attemptId,
      machineId,
      `resource-cleanup:${status}`,
    ),
  });
}

function protectedTokenFromFile(tokenFile) {
  if (typeof tokenFile !== 'string' || !path.isAbsolute(tokenFile)) {
    throw new Error('fleet_worker_token_file_required');
  }
  let stat;
  try {
    stat = fs.lstatSync(tokenFile);
  } catch {
    throw new Error('fleet_worker_token_file_unreadable');
  }
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error('fleet_worker_token_file_permissions');
  }
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  if (token.length < 32 || /[\r\n]/.test(token)) {
    throw new Error('fleet_worker_token_invalid');
  }
  return token;
}

function mountAccessPrincipal(orbstackHome) {
  if (orbstackHome === undefined) return undefined;
  const match = /^\/Users\/([A-Za-z_][A-Za-z0-9._-]{0,63})$/.exec(
    orbstackHome,
  );
  if (!match) {
    throw new Error('fleet_worker_orbstack_home_invalid');
  }
  return match[1];
}

function prepareMountRoot(sharedTmp) {
  if (
    typeof sharedTmp !== 'string'
    || !path.isAbsolute(sharedTmp)
    || sharedTmp === path.parse(sharedTmp).root
  ) {
    throw new Error('fleet_worker_shared_tmp_invalid');
  }
  let sharedStat;
  try {
    sharedStat = fs.lstatSync(sharedTmp);
  } catch {
    throw new Error('fleet_worker_shared_tmp_unavailable');
  }
  if (!sharedStat.isDirectory() || sharedStat.isSymbolicLink()) {
    throw new Error('fleet_worker_shared_tmp_invalid');
  }
  const mountRoot = path.join(path.resolve(sharedTmp), 'fleet-mounts');
  const worktrees = path.join(mountRoot, 'worktrees');
  const runtime = path.join(mountRoot, 'runtime');
  for (const directory of [mountRoot, worktrees, runtime]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
    fs.chmodSync(directory, 0o755);
  }
  const adminRoot = path.join(worktrees, '.admin');
  fs.mkdirSync(adminRoot, { recursive: true, mode: 0o711 });
  fs.chmodSync(adminRoot, 0o711);
  return Object.freeze({ worktrees, runtime });
}

function createFleetWorkerRuntime({
  env = {},
  runCommand,
} = {}) {
  const workerId = env.CECELIA_MACHINE_ID;
  if (!CANONICAL_MACHINE_IDS.has(workerId)) {
    throw new Error('fleet_worker_machine_id_invalid');
  }
  const digest = env.CECELIA_RUNNER_DIGEST;
  if (!RUNNER_DIGEST_PATTERN.test(digest ?? '')) {
    throw new Error('fleet_worker_runner_digest_invalid');
  }
  const dataRoot = path.resolve(
    env.CECELIA_FLEET_DATA_ROOT ?? '/var/lib/cecelia/fleet-worker',
  );
  if (!path.isAbsolute(dataRoot) || dataRoot === path.parse(dataRoot).root) {
    throw new Error('fleet_worker_data_root_invalid');
  }
  const attemptToken = protectedTokenFromFile(
    env.CECELIA_FLEET_WORKER_TOKEN_FILE,
  );
  const accessPrincipal = mountAccessPrincipal(env.CECELIA_ORBSTACK_HOME);
  const mountRoots = accessPrincipal === undefined
    ? Object.freeze({
        worktrees: path.join(dataRoot, 'worktrees'),
        runtime: path.join(dataRoot, 'runtime'),
      })
    : prepareMountRoot(env.TMPDIR);
  const roots = Object.freeze({
    mirrors: path.join(dataRoot, 'mirrors'),
    worktrees: mountRoots.worktrees,
    quarantine: path.join(dataRoot, 'quarantine'),
    state: path.join(dataRoot, 'state'),
    runtime: mountRoots.runtime,
    credentials: path.join(dataRoot, 'credential-consumption'),
  });
  const workspaceManager = createWorkspaceManager({
    mirrorRoot: roots.mirrors,
    worktreeRoot: roots.worktrees,
    quarantineRoot: roots.quarantine,
    repoAllowlist: createFleetRepoAllowlist(env),
    ...(runCommand ? { runCommand } : {}),
  });
  const docker = createDockerAdapter({
    runtimeRoot: roots.runtime,
    ...(accessPrincipal === undefined
      ? {}
      : {
          mountAccessPrincipal: accessPrincipal,
          cleanupAccessPrincipal: '_cecelia',
        }),
    ...(runCommand ? { runCommand } : {}),
  });
  const stateStore = createFileAttemptStateStore({ stateRoot: roots.state });
  const credentialConsumer = createCredentialEnvelopeConsumer({
    consumptionRoot: roots.credentials,
  });
  const githubCredentialConsumer = createGitHubCredentialEnvelopeConsumer({
    consumptionRoot: roots.credentials,
  });
  const runnerImageDigest = env.CECELIA_RUNNER_IMAGE
    ?? digest;
  const postgresImageDigest = env.CECELIA_POSTGRES_IMAGE ?? POSTGRES_IMAGE;
  const resourceManager = createAttemptResourceManager({
    postgresImageDigest,
    ...(runCommand ? { runCommand } : {}),
  });
  const attemptRunner = createAttemptRunner({
    workspaceManager,
    docker,
    stateStore,
    workerId,
    runnerImageDigest,
    credentialConsumer,
    githubCredentialConsumer,
    resourceManager,
  });
  return Object.freeze({
    attemptRunner,
    attemptToken,
    roots,
    runnerImageDigest,
  });
}

function createFleetRepoAllowlist(env = {}) {
  return Object.freeze({
    'perfectuser21/cecelia': env.CECELIA_FLEET_REPO_SOURCE
      ?? 'https://github.com/perfectuser21/cecelia.git',
    'perfectuser21/zenithjoy-workspace':
      env.CECELIA_FLEET_ZENITHJOY_REPO_SOURCE
      ?? 'https://github.com/perfectuser21/zenithjoy-workspace.git',
  });
}

function findUntrustedWorkspaceField(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findUntrustedWorkspaceField(entry);
      if (nested) return nested;
    }
    return null;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (UNTRUSTED_WORKSPACE_FIELDS.has(key)) return key;
    const nested = findUntrustedWorkspaceField(nestedValue);
    if (nested) return nested;
  }
  return null;
}

async function readJson(request, maximumBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      const error = new Error('request_too_large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('request_json_object_required');
    }
    return parsed;
  } catch (error) {
    if (error.statusCode) throw error;
    const invalid = new Error('invalid_json');
    invalid.statusCode = 400;
    throw invalid;
  }
}

function requestErrorStatus(error) {
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  if (error?.message === 'attempt_already_exists') return 409;
  if (error?.message === 'attempt_lease_conflict') return 409;
  if (
    /(?:invalid|required|mismatch|unknown_field|not_allowed|untrusted)/i
      .test(String(error?.message ?? ''))
  ) {
    return 400;
  }
  return 500;
}

function healthSelfChecksReady(report) {
  return typeof report?.orbstack?.version === 'string'
    && report.orbstack.version !== 'unavailable'
    && report?.docker?.available === true
    && report?.tailscale?.connected === true
    && report?.callback?.reachable === true
    && report?.worktree?.root_ready === true
    && report?.container?.probe_succeeded === true
    && report?.runtime_resources?.postgres?.available === true;
}

function createFleetWorkerServer(options = {}) {
  const probeHealth = typeof options.probeHealth === 'function'
    ? options.probeHealth
    : () => probeFleetWorkerHealth(options);
  const attemptRunner = validAttemptRunner(options.attemptRunner)
    ? options.attemptRunner
    : null;
  const attemptToken = options.attemptToken;
  const machineId = safeString(options.machineId, 'us-mac-m4');
  const maximumRequestBytes = Number.isInteger(options.maxRequestBytes)
    && options.maxRequestBytes > 0
    ? options.maxRequestBytes
    : DEFAULT_MAX_REQUEST_BYTES;
  // 完整探测（git worktree + docker 容器）单发 4-6s，超过 admission client 5s 超时；
  // 新鲜期内直接复用上次成功报告。0 = 关缓存。admission 侧证据 TTL 上限 90s，30s 缓存安全。
  const configuredHealthTtl = Number(
    options.healthCacheTtlMs ?? options.env?.CECELIA_FLEET_HEALTH_CACHE_TTL_MS,
  );
  const healthCacheTtlMs = Number.isFinite(configuredHealthTtl)
    ? Math.min(60_000, Math.max(0, Math.trunc(configuredHealthTtl)))
    : DEFAULT_HEALTH_CACHE_TTL_MS;
  const nowFn = typeof options.now === 'function' ? options.now : Date.now;
  let healthCache = null;
  let probeInFlight = false;
  let attemptReady = attemptRunner === null;
  let reconciliationFailed = false;

  if (attemptRunner) {
    Promise.resolve()
      .then(() => attemptRunner.reconcile())
      .then(() => {
        attemptReady = true;
      })
      .catch(() => {
        reconciliationFailed = true;
      });
  }

  return http.createServer(async (request, response) => {
    if (request.url === '/health') {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      if (healthCache && nowFn() < healthCache.expiresAt) {
        writeJson(response, 200, projectHealth(healthCache.report));
        return;
      }
      if (probeInFlight) {
        writeJson(response, 503, { error: 'health_probe_busy' });
        return;
      }

      probeInFlight = true;
      try {
        const health = await probeHealth();
        if (healthCacheTtlMs > 0) {
          const effectiveTtl = healthSelfChecksReady(health)
            ? healthCacheTtlMs
            : Math.min(healthCacheTtlMs, 1_000);
          healthCache = { report: health, expiresAt: nowFn() + effectiveTtl };
        }
        writeJson(response, 200, projectHealth(health));
      } catch {
        healthCache = null;
        writeJson(response, 503, { error: 'health_probe_failed' });
      } finally {
        probeInFlight = false;
      }
      return;
    }

    if (!attemptRunner || !request.url?.startsWith('/harness/attempts')) {
      writeJson(response, 404, { error: 'not_found' });
      return;
    }
    // Let an already-resolved startup reconciliation publish readiness before
    // judging the first Attempt request. A still-running reconciliation remains
    // fail-closed after this single event-loop turn.
    if (!attemptReady && !reconciliationFailed) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (!validBearer(request, attemptToken)) {
      writeJson(response, 401, { error: 'unauthorized' });
      return;
    }
    if (reconciliationFailed) {
      writeJson(response, 503, { error: 'worker_reconciliation_failed' });
      return;
    }
    if (!attemptReady) {
      writeJson(response, 503, { error: 'worker_reconciling' });
      return;
    }

    try {
      if (
        request.method === 'POST'
        && request.url === '/harness/attempts/prepare'
      ) {
        const body = await readJson(request, maximumRequestBytes);
        const untrustedField = findUntrustedWorkspaceField(body);
        if (untrustedField) {
          const error = new Error(`untrusted_workspace_field:${untrustedField}`);
          error.statusCode = 400;
          throw error;
        }
        const receipt = await attemptRunner.prepare(body);
        writeJson(response, 202, acceptedReceipt(receipt, attemptToken));
        return;
      }

      const attemptMatch = request.url.match(ATTEMPT_PATH);
      if (request.method === 'GET' && attemptMatch) {
        const inspected = await attemptRunner.inspect(attemptMatch[1]);
        writeJson(response, 200, inspected);
        return;
      }

      const actionMatch = request.url.match(ATTEMPT_ACTION_PATH);
      if (request.method === 'POST' && actionMatch) {
        const [, attemptId, action] = actionMatch;
        const body = await readJson(request, maximumRequestBytes);
        const result = await attemptRunner[action](attemptId, {
          owner: body.lease_owner,
          generation: body.lease_generation,
        });
        writeJson(
          response,
          200,
          action === 'terminal'
            ? terminalReceipt(result, attemptToken, machineId)
            : action === 'start'
              ? startReceipt(result)
              : result,
        );
        return;
      }

      writeJson(response, 404, { error: 'not_found' });
    } catch (error) {
      const statusCode = requestErrorStatus(error);
      const errorCode = statusCode >= 500
        ? 'attempt_operation_failed'
        : safeString(error.message, 'invalid_request');
      writeJson(response, statusCode, { error: errorCode });
    }
  });
}

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535
    ? port
    : DEFAULT_PORT;
}

function main(env = process.env) {
  const host = safeString(env.CECELIA_FLEET_WORKER_HOST, DEFAULT_HOST);
  const port = parsePort(env.CECELIA_FLEET_WORKER_PORT);
  const runtime = createFleetWorkerRuntime({ env });
  const server = createFleetWorkerServer({
    env,
    attemptRunner: runtime.attemptRunner,
    attemptToken: runtime.attemptToken,
    machineId: env.CECELIA_MACHINE_ID,
    runnerImageDigest: env.CECELIA_RUNNER_DIGEST,
    repoRoot: env.CECELIA_REPO_ROOT,
    drainMarkerPath: env.CECELIA_DRAIN_MARKER,
    callbackUrl: env.CECELIA_CALLBACK_URL,
  });
  server.listen(port, host);
  return server;
}

if (require.main === module) {
  main();
}

module.exports = {
  createFleetRepoAllowlist,
  createFleetWorkerRuntime,
  createFleetWorkerServer,
};
