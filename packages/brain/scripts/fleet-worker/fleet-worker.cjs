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
const { probeFleetWorkerHealth } = require('./node-probe.cjs');
const { createWorkspaceManager } = require('./workspace-manager.cjs');

const MAX_STRING_LENGTH = 1_024;
const MAX_RESPONSE_BYTES = 65_536;
const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5_231;
const ATTEMPT_PATH = /^\/harness\/attempts\/([a-f0-9-]+)$/;
const ATTEMPT_ACTION_PATH = /^\/harness\/attempts\/([a-f0-9-]+)\/(cancel|terminal)$/;
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
  return ['launch', 'inspect', 'cancel', 'terminal', 'reconcile']
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
  const roots = Object.freeze({
    mirrors: path.join(dataRoot, 'mirrors'),
    worktrees: path.join(dataRoot, 'worktrees'),
    quarantine: path.join(dataRoot, 'quarantine'),
    state: path.join(dataRoot, 'state'),
    runtime: path.join(dataRoot, 'runtime'),
  });
  const workspaceManager = createWorkspaceManager({
    mirrorRoot: roots.mirrors,
    worktreeRoot: roots.worktrees,
    quarantineRoot: roots.quarantine,
    repoAllowlist: {
      'perfectuser21/cecelia': env.CECELIA_FLEET_REPO_SOURCE
        ?? 'https://github.com/perfectuser21/cecelia.git',
    },
    ...(runCommand ? { runCommand } : {}),
  });
  const docker = createDockerAdapter({
    runtimeRoot: roots.runtime,
    ...(runCommand ? { runCommand } : {}),
  });
  const stateStore = createFileAttemptStateStore({ stateRoot: roots.state });
  const runnerImageDigest = env.CECELIA_RUNNER_IMAGE
    ?? `cecelia/runner@${digest}`;
  const attemptRunner = createAttemptRunner({
    workspaceManager,
    docker,
    stateStore,
    workerId,
    runnerImageDigest,
  });
  return Object.freeze({
    attemptRunner,
    attemptToken,
    roots,
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

function createFleetWorkerServer(options = {}) {
  const probeHealth = typeof options.probeHealth === 'function'
    ? options.probeHealth
    : () => probeFleetWorkerHealth(options);
  const attemptRunner = validAttemptRunner(options.attemptRunner)
    ? options.attemptRunner
    : null;
  const attemptToken = options.attemptToken;
  const maximumRequestBytes = Number.isInteger(options.maxRequestBytes)
    && options.maxRequestBytes > 0
    ? options.maxRequestBytes
    : DEFAULT_MAX_REQUEST_BYTES;
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
      if (probeInFlight) {
        writeJson(response, 503, { error: 'health_probe_busy' });
        return;
      }

      probeInFlight = true;
      try {
        const health = await probeHealth();
        writeJson(response, 200, projectHealth(health));
      } catch {
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
      if (request.method === 'POST' && request.url === '/harness/attempts') {
        const body = await readJson(request, maximumRequestBytes);
        const untrustedField = findUntrustedWorkspaceField(body);
        if (untrustedField) {
          const error = new Error(`untrusted_workspace_field:${untrustedField}`);
          error.statusCode = 400;
          throw error;
        }
        const receipt = await attemptRunner.launch(body);
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
        writeJson(response, 200, result);
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
  createFleetWorkerRuntime,
  createFleetWorkerServer,
};
