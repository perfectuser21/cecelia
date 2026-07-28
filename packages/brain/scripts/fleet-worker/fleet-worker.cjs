#!/usr/bin/env node
'use strict';

const { Buffer } = require('node:buffer');
const {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const process = require('node:process');
const { TextDecoder } = require('node:util');
const {
  createAttemptRunner,
  createDockerAdapter,
  createFileAttemptStateStore,
} = require('./attempt-runner.cjs');
const {
  createCredentialEnvelopeConsumer,
} = require('./credential-envelope.cjs');
const {
  createFileGithubMutationAuditStore,
  createGithubMutationBroker,
} = require('./github-mutation-broker.cjs');
const {
  createFileGithubReadAuditStore,
  createGithubReadBroker,
} = require('./github-read-broker.cjs');
const {
  buildFleetHeartbeat,
  buildFleetResultDelivery,
  verifyFleetHeartbeatAck,
  verifyFleetResultReceiptAck,
} = require('./callback-auth.cjs');
const { probeFleetWorkerHealth } = require('./node-probe.cjs');
const { createWorkspaceManager } = require('./workspace-manager.cjs');
let finalizeRoleResult;
try {
  ({ finalizeRoleResult } = require('./result-channel-finalizer.cjs'));
} catch {
  ({ finalizeRoleResult } = require(
    '../../../../docker/cecelia-runner/result-channel-finalizer.cjs'
  ));
}

const MAX_STRING_LENGTH = 1_024;
const MAX_RESPONSE_BYTES = 65_536;
const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
const DEFAULT_HEALTH_CACHE_TTL_MS = 30_000;
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
const MAX_RECEIPT_RESPONSE_BYTES = 65_536;

async function readBoundedUtf8Response(response, errorCode) {
  const declaredLength = response?.headers?.get?.('content-length');
  if (
    declaredLength !== null
    && declaredLength !== undefined
    && (
      !/^(?:0|[1-9][0-9]*)$/.test(declaredLength)
      || Number(declaredLength) > MAX_RECEIPT_RESPONSE_BYTES
    )
  ) {
    throw new Error(errorCode);
  }
  const reader = response?.body?.getReader?.();
  if (!reader) throw new Error(errorCode);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > MAX_RECEIPT_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(errorCode);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error?.message === errorCode) throw error;
    throw new Error(errorCode);
  }
  if (size === 0) throw new Error(errorCode);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks, size),
    );
  } catch {
    throw new Error(errorCode);
  }
}

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
  let descriptor;
  try {
    descriptor = fs.openSync(
      tokenFile,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    if (error?.code === 'ELOOP') {
      throw new Error('fleet_worker_token_file_permissions');
    }
    throw new Error('fleet_worker_token_file_unreadable');
  }
  let token;
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile()
      || (stat.mode & 0o077) !== 0
      || stat.size < 32
      || stat.size > 8_192
    ) {
      throw new Error('fleet_worker_token_file_permissions');
    }
    token = fs.readFileSync(descriptor, 'utf8').trim();
  } finally {
    fs.closeSync(descriptor);
  }
  if (
    Buffer.byteLength(token, 'utf8') < 32
    || Buffer.byteLength(token, 'utf8') > 8_192
    || /[\r\n\0]/.test(token)
  ) {
    throw new Error('fleet_worker_token_invalid');
  }
  return token;
}

function createResultDeliveryClient({
  secret,
  fetchFn = globalThis.fetch,
  randomUuid = randomUUID,
} = {}) {
  if (typeof secret !== 'string' || secret.length < 32 || /[\r\n\0]/.test(secret)) {
    throw new Error('fleet_result_delivery_secret_invalid');
  }
  if (typeof fetchFn !== 'function' || typeof randomUuid !== 'function') {
    throw new Error('fleet_result_delivery_dependency_invalid');
  }
  return Object.freeze({
    async prepare({ resultBytes, terminalStatus } = {}) {
      if (!Buffer.isBuffer(resultBytes) || resultBytes.length < 1) {
        throw new Error('fleet_result_delivery_bytes_invalid');
      }
      return Object.freeze({
        delivery_id: randomUuid(),
        result_nonce: randomUuid(),
        result_sha256: createHash('sha256').update(resultBytes).digest('hex'),
        result_bytes: resultBytes.length,
        terminal_status: terminalStatus,
      });
    },

    async deliver({
      state,
      resultBytes,
      terminalStatus,
      delivery,
    } = {}) {
      const wire = buildFleetResultDelivery({
        secret,
        attemptId: state?.attempt_id,
        runId: state?.run_id,
        workerId: state?.worker_id,
        jobId: state?.container_id,
        leaseOwner: state?.lease_owner,
        leaseGeneration: state?.lease_generation,
        deliveryId: delivery?.delivery_id,
        resultNonce: delivery?.result_nonce,
        resultBytes,
        terminalStatus,
      });
      const base = new URL(state.brain_url);
      const target = new URL(
        `/api/brain/harness/attempts/${state.attempt_id}/callback`,
        base,
      );
      const response = await fetchFn(target, {
        method: 'POST',
        headers: wire.headers,
        body: JSON.stringify(wire.body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response?.ok) {
        throw new Error(`fleet_result_delivery_http_${response?.status ?? 'invalid'}`);
      }
      const receiptText = await readBoundedUtf8Response(
        response,
        'fleet_result_receipt_response_invalid',
      );
      let receipt;
      try {
        receipt = JSON.parse(receiptText);
      } catch {
        throw new Error('fleet_result_receipt_response_invalid');
      }
      return verifyFleetResultReceiptAck({
        receipt,
        secret,
        expected: {
          attemptId: state.attempt_id,
          runId: state.run_id,
          workerId: state.worker_id,
          jobId: state.container_id,
          leaseOwner: state.lease_owner,
          leaseGeneration: state.lease_generation,
          deliveryId: delivery.delivery_id,
          resultNonce: delivery.result_nonce,
          resultSha256: delivery.result_sha256,
          resultBytes: delivery.result_bytes,
          terminalStatus: delivery.terminal_status,
        },
      });
    },
  });
}

function createFleetHeartbeatClient({
  secret,
  fetchFn = globalThis.fetch,
  randomUuid = randomUUID,
  now = () => new Date(),
} = {}) {
  if (typeof secret !== 'string' || secret.length < 32 || /[\r\n\0]/.test(secret)) {
    throw new Error('fleet_heartbeat_secret_invalid');
  }
  if (
    typeof fetchFn !== 'function'
    || typeof randomUuid !== 'function'
    || typeof now !== 'function'
  ) {
    throw new Error('fleet_heartbeat_dependency_invalid');
  }
  const pendingByAttempt = new Map();

  function authorityKey(state, providerSessionId) {
    return JSON.stringify([
      state?.attempt_id,
      state?.run_id,
      state?.worker_id,
      state?.container_id,
      state?.lease_owner,
      state?.lease_generation,
      providerSessionId,
    ]);
  }

  function preparePending(state, providerSessionId) {
    const heartbeatNonce = randomUuid();
    const observedAt = now();
    if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) {
      throw new Error('fleet_heartbeat_clock_invalid');
    }
    const wire = buildFleetHeartbeat({
      secret,
      attemptId: state?.attempt_id,
      runId: state?.run_id,
      workerId: state?.worker_id,
      jobId: state?.container_id,
      leaseOwner: state?.lease_owner,
      leaseGeneration: state?.lease_generation,
      heartbeatNonce,
      observedAt: observedAt.toISOString(),
      leaseSeconds: 180,
      providerSessionId,
    });
    return Object.freeze({
      authority: authorityKey(state, providerSessionId),
      heartbeatNonce,
      providerSessionId,
      target: new URL(
        `/api/brain/harness/attempts/${state.attempt_id}/heartbeat`,
        new URL(state.brain_url),
      ),
      wire,
    });
  }

  return Object.freeze({
    async deliver({ state, session = null } = {}) {
      const providerSessionId = session?.session_id ?? null;
      const expectedAuthority = authorityKey(state, providerSessionId);
      let pending = pendingByAttempt.get(state?.attempt_id);
      if (!pending || pending.authority !== expectedAuthority) {
        pending = preparePending(state, providerSessionId);
        pendingByAttempt.set(state.attempt_id, pending);
      }
      const response = await fetchFn(pending.target, {
        method: 'POST',
        headers: pending.wire.headers,
        body: JSON.stringify(pending.wire.body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response?.ok) {
        throw new Error(`fleet_heartbeat_http_${response?.status ?? 'invalid'}`);
      }
      const responseText = await readBoundedUtf8Response(
        response,
        'fleet_heartbeat_ack_response_invalid',
      );
      let ack;
      try {
        ack = JSON.parse(responseText);
      } catch {
        throw new Error('fleet_heartbeat_ack_response_invalid');
      }
      const verified = verifyFleetHeartbeatAck({
        ack,
        secret,
        expected: {
          attemptId: state.attempt_id,
          runId: state.run_id,
          workerId: state.worker_id,
          jobId: state.container_id,
          leaseOwner: state.lease_owner,
          leaseGeneration: state.lease_generation,
          heartbeatNonce: pending.heartbeatNonce,
          providerSessionId,
        },
      });
      if (pendingByAttempt.get(state.attempt_id) === pending) {
        pendingByAttempt.delete(state.attempt_id);
      }
      return verified;
    },
  });
}

function createFleetMaintenance({
  workerId,
  stateStore,
  docker,
  heartbeatClient,
} = {}) {
  if (
    !CANONICAL_MACHINE_IDS.has(workerId)
    || typeof stateStore?.list !== 'function'
    || typeof docker?.readSession !== 'function'
    || typeof heartbeatClient?.deliver !== 'function'
  ) {
    throw new Error('fleet_maintenance_dependency_invalid');
  }
  return Object.freeze({
    async heartbeatAll() {
      const states = await stateStore.list();
      const live = states.filter((state) => (
        state.worker_id === workerId
        && ['running', 'cancel_pending', 'callback_pending'].includes(state.status)
      ));
      let accepted = 0;
      let failed = 0;
      for (const state of live) {
        try {
          const session = await docker.readSession({
            attemptId: state.attempt_id,
          });
          await heartbeatClient.deliver({ state, session });
          accepted += 1;
        } catch {
          failed += 1;
        }
      }
      return Object.freeze({
        attempted: live.length,
        accepted,
        failed,
      });
    },
  });
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
    credentials: path.join(dataRoot, 'credential-consumption'),
    githubAudit: path.join(dataRoot, 'github-mutation-audit'),
    githubReadAudit: path.join(dataRoot, 'github-read-audit'),
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
  const credentialConsumer = createCredentialEnvelopeConsumer({
    consumptionRoot: roots.credentials,
    signingSecret: attemptToken,
  });
  const runnerImageDigest = env.CECELIA_RUNNER_IMAGE
    ?? `cecelia/runner@${digest}`;
  const attemptRunner = createAttemptRunner({
    workspaceManager,
    docker,
    stateStore,
    workerId,
    runnerImageDigest,
    credentialConsumer,
    githubMutationBroker: createGithubMutationBroker({
      auditStore: createFileGithubMutationAuditStore({
        auditRoot: roots.githubAudit,
      }),
      finalizeRoleResult,
    }),
    githubReadBroker: createGithubReadBroker({
      auditStore: createFileGithubReadAuditStore({
        auditRoot: roots.githubReadAudit,
      }),
    }),
    resultDelivery: createResultDeliveryClient({ secret: attemptToken }),
  });
  const maintenance = createFleetMaintenance({
    workerId,
    stateStore,
    docker,
    heartbeatClient: createFleetHeartbeatClient({ secret: attemptToken }),
  });
  return Object.freeze({
    attemptRunner,
    attemptToken,
    maintenance,
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
  if (error?.message === 'attempt_callback_pending') return 409;
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
  const maintenance = typeof options.maintenance?.heartbeatAll === 'function'
    ? options.maintenance
    : null;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
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
  let reconciliationInFlight = false;
  let heartbeatInFlight = false;
  const timers = [];

  async function reconcile({ startup = false } = {}) {
    if (!attemptRunner || reconciliationInFlight) return;
    reconciliationInFlight = true;
    try {
      await attemptRunner.reconcile();
      if (startup || !attemptReady) {
        attemptReady = true;
        reconciliationFailed = false;
      }
    } catch {
      if (startup || !attemptReady) reconciliationFailed = true;
    } finally {
      reconciliationInFlight = false;
    }
  }

  if (attemptRunner) {
    void Promise.resolve().then(() => reconcile({ startup: true }));
    const retryTimer = setIntervalFn(() => {
      void reconcile({ startup: !attemptReady });
    }, 30_000);
    retryTimer?.unref?.();
    timers.push(retryTimer);
    if (maintenance) {
      const heartbeatTimer = setIntervalFn(() => {
        if (
          !attemptReady
          || reconciliationFailed
          || heartbeatInFlight
        ) {
          return;
        }
        heartbeatInFlight = true;
        void Promise.resolve()
          .then(() => maintenance.heartbeatAll())
          .catch(() => {})
          .finally(() => {
            heartbeatInFlight = false;
          });
      }, 60_000);
      heartbeatTimer?.unref?.();
      timers.push(heartbeatTimer);
    }
  }

  const server = http.createServer(async (request, response) => {
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
          healthCache = { report: health, expiresAt: nowFn() + healthCacheTtlMs };
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
  server.once('close', () => {
    for (const timer of timers) {
      if (timer != null) clearIntervalFn(timer);
    }
  });
  return server;
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
    maintenance: runtime.maintenance,
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
  createFleetHeartbeatClient,
  createFleetMaintenance,
  createFleetWorkerRuntime,
  createFleetWorkerServer,
  createResultDeliveryClient,
};
