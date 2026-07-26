'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  createHmac,
  randomUUID: nodeRandomUUID,
  timingSafeEqual,
} = require('crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HARNESS_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
]);

class KernelAttemptError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'KernelAttemptError';
    this.statusCode = statusCode;
  }
}

function claimPath(stateDir, attemptId) {
  if (!UUID_PATTERN.test(String(attemptId ?? ''))) {
    throw new KernelAttemptError('invalid_attempt_id', 422);
  }
  return path.join(stateDir, `${attemptId}.json`);
}

function readClaim(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function createDurableTemporaryClaim(filePath, claim) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${nodeRandomUUID()}.tmp`;
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(fileDescriptor, `${JSON.stringify(claim)}\n`);
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    return temporaryPath;
  } catch (error) {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
    try {
      fs.unlinkSync(temporaryPath);
    } catch (unlinkError) {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    }
    throw error;
  }
}

function fsyncDirectory(directoryPath) {
  const directoryDescriptor = fs.openSync(directoryPath, 'r');
  try {
    fs.fsyncSync(directoryDescriptor);
  } finally {
    fs.closeSync(directoryDescriptor);
  }
}

function writeClaimAtomic(filePath, claim) {
  const temporaryPath = createDurableTemporaryClaim(filePath, claim);
  try {
    fs.renameSync(temporaryPath, filePath);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function publishClaimExclusive(filePath, claim) {
  const temporaryPath = createDurableTemporaryClaim(filePath, claim);
  try {
    try {
      fs.linkSync(temporaryPath, filePath);
      fsyncDirectory(path.dirname(filePath));
      return { published: true, claim };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const winner = readClaim(filePath);
      if (!winner) throw new Error('attempt_claim_winner_missing');
      return { published: false, claim: winner };
    }
  } finally {
    fs.unlinkSync(temporaryPath);
  }
}

function readProcessIdentityDefault(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return null;
    if (error.code !== 'EPERM') return undefined;
  }
  try {
    const startedAt = execFileSync(
      'ps',
      ['-p', String(pid), '-o', 'lstart='],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return startedAt || null;
  } catch {
    return undefined;
  }
}

function ownerProcessState(claim, readProcessIdentity) {
  if (
    !UUID_PATTERN.test(String(claim?.bridge_instance_id ?? ''))
    || !Number.isInteger(claim?.owner_pid)
    || claim.owner_pid <= 0
    || typeof claim?.owner_process_identity !== 'string'
    || claim.owner_process_identity.length === 0
  ) {
    return 'unrecoverable';
  }
  let observedIdentity;
  try {
    observedIdentity = readProcessIdentity(claim.owner_pid);
  } catch {
    return 'unknown';
  }
  if (observedIdentity === undefined) return 'unknown';
  if (observedIdentity === claim.owner_process_identity) return 'alive';
  return 'dead';
}

function callbackOwnerProcessState(claim, readProcessIdentity) {
  return ownerProcessState({
    bridge_instance_id: claim?.callback_owner_instance_id,
    owner_pid: claim?.callback_owner_pid,
    owner_process_identity: claim?.callback_owner_process_identity,
  }, readProcessIdentity);
}

function callbackOwnerPath(stateDir, attemptId) {
  return `${claimPath(stateDir, attemptId)}.callback-owner`;
}

function sameCallbackOwner(left, right) {
  return (
    left?.callback_delivery_id === right?.callback_delivery_id
    && left?.bridge_instance_id === right?.bridge_instance_id
  );
}

function sameCallbackDeliveryGeneration(left, right) {
  return (
    left?.callback_delivery === right?.callback_delivery
    && left?.callback_delivery_id === right?.callback_delivery_id
    && left?.callback_owner_instance_id === right?.callback_owner_instance_id
    && left?.callback_owner_pid === right?.callback_owner_pid
    && left?.callback_owner_process_identity === right?.callback_owner_process_identity
  );
}

function releaseCallbackOwner(filePath, owner) {
  const current = readClaim(filePath);
  if (!sameCallbackOwner(current, owner)) return false;
  try {
    fs.unlinkSync(filePath);
    fsyncDirectory(path.dirname(filePath));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function reconcileRestartOrphans(stateDir, readProcessIdentity, acquireCallbackOwner) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(stateDir)) {
    if (!UUID_PATTERN.test(entry.replace(/\.json$/, '')) || !entry.endsWith('.json')) continue;
    const filePath = path.join(stateDir, entry);
    const claim = readClaim(filePath);
    if (
      claim?.status === 'accepted'
      && ['dead', 'unrecoverable'].includes(ownerProcessState(claim, readProcessIdentity))
    ) {
      writeClaimAtomic(filePath, {
        ...claim,
        status: 'failed',
        failure_reason: 'bridge_restart_orphaned',
      });
    } else if (
      claim?.callback_delivery === 'pending'
      && claim.callback_result
      && ['dead', 'unrecoverable'].includes(
        callbackOwnerProcessState(claim, readProcessIdentity),
      )
    ) {
      const reconciliationOwner = acquireCallbackOwner(claim.attempt_id);
      if (!reconciliationOwner) continue;
      try {
        const current = readClaim(filePath);
        if (
          !current
          || current.callback_delivery === 'delivered'
          || !sameCallbackDeliveryGeneration(current, claim)
          || !['dead', 'unrecoverable'].includes(
            callbackOwnerProcessState(current, readProcessIdentity),
          )
        ) continue;
        const reconciled = {
          ...current,
          status: 'callback_pending',
          provider_status: current.provider_status ?? current.status,
          callback_delivery: 'failed',
        };
        delete reconciled.callback_delivery_id;
        delete reconciled.callback_owner_instance_id;
        delete reconciled.callback_owner_pid;
        delete reconciled.callback_owner_process_identity;
        writeClaimAtomic(filePath, reconciled);
      } finally {
        releaseCallbackOwner(
          callbackOwnerPath(stateDir, claim.attempt_id),
          reconciliationOwner,
        );
      }
    }
  }
}

function assertMatchingClaim(claim, request) {
  if (
    claim.lease_owner !== request.lease_owner
    || claim.lease_generation !== request.lease_generation
  ) {
    throw new KernelAttemptError('attempt_claim_conflict', 409);
  }
}

function secureTokenEqual(expected, authorization) {
  const supplied = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function machineAttestation(secret, attemptId, machineId, jobId) {
  return createHmac('sha256', secret)
    .update(`${attemptId}\n${machineId}\n${jobId}`, 'utf8')
    .digest('hex');
}

function requireString(value, errorCode) {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
    throw new KernelAttemptError(errorCode, 422);
  }
}

function validateCallbackUrl(callbackUrl, brainUrl, attemptId) {
  let callback;
  let brain;
  try {
    callback = new URL(callbackUrl);
    brain = new URL(brainUrl);
  } catch {
    throw new KernelAttemptError('callback_url_not_allowed', 422);
  }
  const expectedPath = `/api/brain/harness/attempts/${encodeURIComponent(attemptId)}/callback`;
  if (
    callback.origin !== brain.origin
    || callback.pathname !== expectedPath
    || callback.username
    || callback.password
    || callback.search
    || callback.hash
  ) {
    throw new KernelAttemptError('callback_url_not_allowed', 422);
  }
}

function expectedProviderPaths(attemptId) {
  return {
    schemaPath: `/tmp/harness-${attemptId}.schema.json`,
    resultPath: `/tmp/harness-${attemptId}.result.json`,
  };
}

function validateRequest(request, configuration) {
  claimPath(configuration.stateDir, request?.attempt_id);
  requireString(request?.run_id, 'invalid_run_id');
  requireString(request?.lease_owner, 'invalid_lease_owner');
  if (!Number.isInteger(request?.lease_generation) || request.lease_generation < 0) {
    throw new KernelAttemptError('invalid_lease_generation', 422);
  }
  if (request?.target?.machine !== configuration.machineId) {
    throw new KernelAttemptError('target_machine_mismatch', 409);
  }
  if (request?.target?.provider !== 'codex' || request?.provider_spec?.provider !== 'codex') {
    throw new KernelAttemptError('provider_not_allowed', 422);
  }
  if (!configuration.allowedAccounts.has(request?.target?.account)) {
    throw new KernelAttemptError('codex_account_not_allowed', 422);
  }
  if (!['codex', '/opt/homebrew/bin/codex'].includes(request?.provider_spec?.command)) {
    throw new KernelAttemptError('codex_command_not_allowed', 422);
  }

  const { schemaPath, resultPath } = expectedProviderPaths(request.attempt_id);
  const output = request.provider_spec.output;
  if (output?.schema_path !== schemaPath || output?.result_path !== resultPath) {
    throw new KernelAttemptError('codex_output_path_not_allowed', 422);
  }
  const commonArgs = [
    '--json',
    '--output-schema', schemaPath,
    '--output-last-message', resultPath,
    '--skip-git-repo-check',
    '-',
  ];
  const suppliedArgs = request.provider_spec.args;
  let resumeSessionId = null;
  let expectedArgs = ['exec', ...commonArgs];
  if (Array.isArray(suppliedArgs) && suppliedArgs[0] === 'exec' && suppliedArgs[1] === 'resume') {
    resumeSessionId = suppliedArgs[2];
    if (!UUID_PATTERN.test(String(resumeSessionId ?? ''))) {
      throw new KernelAttemptError('codex_resume_session_not_allowed', 422);
    }
    expectedArgs = ['exec', 'resume', resumeSessionId, ...commonArgs];
  }
  if (
    !Array.isArray(suppliedArgs)
    || suppliedArgs.length !== expectedArgs.length
    || suppliedArgs.some((value, index) => value !== expectedArgs[index])
  ) {
    throw new KernelAttemptError('codex_args_not_allowed', 422);
  }
  requireString(request.provider_spec.stdin, 'codex_stdin_required');
  requireString(request.callback_token, 'callback_token_required');
  validateCallbackUrl(request.callback_url, configuration.brainUrl, request.attempt_id);
  return { resumeSessionId };
}

const HARNESS_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: true,
  required: [
    'contract_version',
    'attempt_id',
    'status',
    'summary',
    'artifacts',
    'checks',
    'decision',
    'error',
    'provider_metadata',
  ],
  properties: {
    contract_version: { const: '1.0' },
    attempt_id: { type: 'string', format: 'uuid' },
    status: {
      enum: [...HARNESS_STATUSES],
    },
    summary: { type: 'string' },
    artifacts: { type: 'array' },
    checks: { type: 'array' },
    decision: {},
    error: {},
    provider_metadata: { type: 'object' },
  },
});

function parseHarnessResult(resultPath) {
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (
    !result
    || typeof result !== 'object'
    || result.contract_version !== '1.0'
    || !UUID_PATTERN.test(String(result.attempt_id ?? ''))
    || !HARNESS_STATUSES.has(result.status)
    || typeof result.summary !== 'string'
    || !Array.isArray(result.artifacts)
    || !Array.isArray(result.checks)
    || !Object.hasOwn(result, 'decision')
    || !Object.hasOwn(result, 'error')
    || !result.provider_metadata
    || typeof result.provider_metadata !== 'object'
  ) {
    throw new Error('invalid_harness_result');
  }
  return result;
}

function failedHarnessResult(attemptId, message) {
  return {
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'failed',
    summary: 'Codex execution failed',
    artifacts: [],
    checks: [],
    decision: null,
    error: { code: message },
    provider_metadata: {},
  };
}

function cancelledHarnessResult(attemptId) {
  return {
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'cancelled',
    summary: 'Codex execution cancelled',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: {},
  };
}

async function deliverCallback({
  fetchFn,
  sleep,
  logger,
  request,
  result,
  callbackTimeoutMs,
}) {
  const delays = [250, 500];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchFn(request.callback_url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(callbackTimeoutMs),
        headers: {
          Authorization: `Bearer ${request.callback_token}`,
          'Content-Type': 'application/json',
          'X-Harness-Lease-Owner': request.lease_owner,
        },
        body: JSON.stringify(result),
      });
      if (response?.ok) return true;
      logger.warn?.(`kernel attempt callback HTTP ${String(response?.status)}`);
    } catch {
      logger.warn?.('kernel attempt callback request failed');
    }
    if (attempt < delays.length) await sleep(delays[attempt]);
  }
  logger.error?.('kernel attempt callback delivery exhausted');
  return false;
}

function startProvider({
  configuration,
  request,
  claim,
  execution,
}) {
  const runtimeDir = fs.mkdtempSync(path.join(
    configuration.runtimeRoot,
    `kernel-bridge-${claim.job_id}-`,
  ));
  let child;
  let resultPath;
  try {
    fs.chmodSync(runtimeDir, 0o700);
    const codexHome = path.join(runtimeDir, 'codex-home');
    fs.mkdirSync(codexHome, { mode: 0o700 });
    const authPath = path.join(codexHome, 'auth.json');
    fs.writeFileSync(
      authPath,
      `${JSON.stringify(configuration.loadAccountAuth(request.target.account))}\n`,
      { mode: 0o600 },
    );
    const schemaPath = path.join(runtimeDir, `${claim.attempt_id}.schema.json`);
    resultPath = path.join(runtimeDir, `${claim.attempt_id}.result.json`);
    fs.writeFileSync(
      schemaPath,
      `${JSON.stringify(HARNESS_RESULT_SCHEMA)}\n`,
      { mode: 0o600 },
    );

    const args = execution.resumeSessionId
      ? ['exec', 'resume', execution.resumeSessionId]
      : ['exec'];
    args.push(
      '--json',
      '--output-schema', schemaPath,
      '--output-last-message', resultPath,
      '--skip-git-repo-check',
      '-',
    );
    child = configuration.spawnFn(configuration.codexBin, args, {
      cwd: configuration.workDir,
      env: { ...process.env, CODEX_HOME: codexHome },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    throw error;
  }

  let settled = false;
  const complete = async (result) => {
    if (settled) return;
    settled = true;
    if (configuration.isCancelled?.(claim.attempt_id, child)) {
      result = cancelledHarnessResult(request.attempt_id);
    }
    result.attempt_id = request.attempt_id;
    result.provider_metadata = {
      ...(result.provider_metadata ?? {}),
      provider: 'codex',
      machine_id: configuration.machineId,
      remote_job_id: claim.job_id,
      machine_attestation: machineAttestation(
        configuration.bridgeToken,
        request.attempt_id,
        configuration.machineId,
        claim.job_id,
      ),
    };
    const persistedStatus = result.status === 'failed' ? 'failed'
      : result.status === 'cancelled' ? 'cancelled'
        : 'completed';
    try {
      const callbackOwner = configuration.onProviderSettled?.(
        claim.attempt_id,
        child,
        persistedStatus,
        result,
        request.callback_url,
      );
      if (!callbackOwner) return;
      const delivered = await deliverCallback({
        fetchFn: configuration.fetchFn,
        sleep: configuration.sleep,
        logger: configuration.logger,
        request,
        result,
        callbackTimeoutMs: configuration.callbackTimeoutMs,
      });
      configuration.onCallbackDelivery?.(
        claim.attempt_id,
        persistedStatus,
        delivered,
        callbackOwner,
      );
    } finally {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  };

  child.once('error', () => {
    void complete(failedHarnessResult(request.attempt_id, 'provider_spawn_failed'));
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  child.once('close', (code) => {
    let result;
    try {
      result = code === 0
        ? parseHarnessResult(resultPath)
        : failedHarnessResult(request.attempt_id, `provider_exit_${String(code)}`);
    } catch {
      result = failedHarnessResult(request.attempt_id, 'provider_result_invalid');
    }
    void complete(result);
  });
  child.stdin.end(request.provider_spec.stdin);
  return child;
}

function createKernelAttemptHandler({
  stateDir,
  machineId,
  spawnFn,
  randomUUID = nodeRandomUUID,
  bridgeInstanceId = nodeRandomUUID(),
  ownerPid = process.pid,
  ownerProcessIdentity,
  readProcessIdentity = readProcessIdentityDefault,
  bridgeToken,
  brainUrl,
  allowedAccounts = [],
  codexBin = '/opt/homebrew/bin/codex',
  workDir,
  loadAccountAuth,
  fetchFn = globalThis.fetch,
  sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)),
  cancelSleep,
  callbackTimeoutMs = 10000,
  logger = console,
  runtimeRoot = os.tmpdir(),
}) {
  const resolvedOwnerProcessIdentity = ownerProcessIdentity
    ?? readProcessIdentity(ownerPid);
  if (
    !stateDir
    || !machineId
    || typeof spawnFn !== 'function'
    || !UUID_PATTERN.test(String(bridgeInstanceId ?? ''))
    || !Number.isInteger(ownerPid)
    || ownerPid <= 0
    || typeof resolvedOwnerProcessIdentity !== 'string'
    || resolvedOwnerProcessIdentity.length === 0
    || typeof readProcessIdentity !== 'function'
    || typeof bridgeToken !== 'string'
    || bridgeToken.length < 32
    || typeof brainUrl !== 'string'
    || typeof loadAccountAuth !== 'function'
    || typeof fetchFn !== 'function'
    || !Number.isFinite(callbackTimeoutMs)
    || callbackTimeoutMs <= 0
  ) {
    throw new Error('kernel_attempt_handler_invalid_dependencies');
  }
  const configuration = {
    stateDir,
    machineId,
    spawnFn,
    bridgeInstanceId,
    ownerPid,
    ownerProcessIdentity: resolvedOwnerProcessIdentity,
    readProcessIdentity,
    bridgeToken,
    brainUrl,
    allowedAccounts: new Set(allowedAccounts),
    codexBin,
    workDir,
    loadAccountAuth,
    fetchFn,
    sleep,
    cancelSleep: cancelSleep ?? sleep,
    callbackTimeoutMs,
    logger,
    runtimeRoot,
  };
  const liveChildren = new Map();
  const callbackDeliveries = new Map();

  function authenticate(headers) {
    if (!secureTokenEqual(bridgeToken, headers?.authorization)) {
      throw new KernelAttemptError('unauthorized', 401);
    }
  }

  configuration.isCancelled = (attemptId, child) => {
    const live = liveChildren.get(attemptId);
    return live?.child === child && live.cancelRequested === true;
  };

  function acquireCallbackOwner(attemptId) {
    const filePath = callbackOwnerPath(stateDir, attemptId);
    const candidate = {
      attempt_id: attemptId,
      callback_delivery_id: nodeRandomUUID(),
      bridge_instance_id: configuration.bridgeInstanceId,
      owner_pid: configuration.ownerPid,
      owner_process_identity: configuration.ownerProcessIdentity,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const publication = publishClaimExclusive(filePath, candidate);
      if (publication.published) return candidate;
      const winnerState = ownerProcessState(
        publication.claim,
        configuration.readProcessIdentity,
      );
      if (['alive', 'unknown'].includes(winnerState)) return null;
      if (!releaseCallbackOwner(filePath, publication.claim)) return null;
    }
    return null;
  }

  reconcileRestartOrphans(stateDir, readProcessIdentity, acquireCallbackOwner);

  configuration.onProviderSettled = (
    attemptId,
    child,
    status,
    result,
    callbackUrl,
  ) => {
    const filePath = claimPath(stateDir, attemptId);
    const claim = readClaim(filePath);
    const ownedByCurrentInstance = (
      claim?.bridge_instance_id === configuration.bridgeInstanceId
    );
    const transitionAllowed = claim?.status === 'accepted'
      || (claim?.status === 'cancelled' && status === 'cancelled');
    if (!ownedByCurrentInstance || !transitionAllowed) return false;
    const callbackOwner = acquireCallbackOwner(attemptId);
    if (!callbackOwner) return false;
    writeClaimAtomic(filePath, {
      ...claim,
      status,
      provider_status: status,
      callback_delivery: 'pending',
      callback_url: callbackUrl,
      callback_result: result,
      callback_delivery_id: callbackOwner.callback_delivery_id,
      callback_owner_instance_id: callbackOwner.bridge_instance_id,
      callback_owner_pid: callbackOwner.owner_pid,
      callback_owner_process_identity: callbackOwner.owner_process_identity,
    });
    const live = liveChildren.get(attemptId);
    if (live?.child === child) {
      live.exited = true;
      liveChildren.delete(attemptId);
    }
    return callbackOwner;
  };
  configuration.onCallbackDelivery = (
    attemptId,
    providerStatus,
    delivered,
    callbackOwner,
  ) => {
    const filePath = claimPath(stateDir, attemptId);
    const claim = readClaim(filePath);
    if (!claim) return;
    if (claim.callback_delivery === 'delivered') return;
    if (
      claim.callback_delivery_id !== callbackOwner.callback_delivery_id
      || claim.callback_owner_instance_id !== callbackOwner.bridge_instance_id
    ) return;
    const ownerFilePath = callbackOwnerPath(stateDir, attemptId);
    if (!sameCallbackOwner(readClaim(ownerFilePath), callbackOwner)) return;
    if (!delivered) {
      const pending = {
        ...claim,
        status: 'callback_pending',
        provider_status: providerStatus,
        callback_delivery: 'failed',
      };
      delete pending.callback_delivery_id;
      delete pending.callback_owner_instance_id;
      delete pending.callback_owner_pid;
      delete pending.callback_owner_process_identity;
      writeClaimAtomic(filePath, pending);
      releaseCallbackOwner(ownerFilePath, callbackOwner);
      return;
    }

    const finalized = {
      ...claim,
      status: providerStatus,
      callback_delivery: 'delivered',
    };
    delete finalized.provider_status;
    delete finalized.callback_url;
    delete finalized.callback_result;
    delete finalized.callback_delivery_id;
    delete finalized.callback_owner_instance_id;
    delete finalized.callback_owner_pid;
    delete finalized.callback_owner_process_identity;
    writeClaimAtomic(filePath, finalized);
    releaseCallbackOwner(ownerFilePath, callbackOwner);
  };

  function redeliverPendingClaim(claim, request) {
    if (callbackDeliveries.has(claim.attempt_id)) return;
    const callbackOwner = acquireCallbackOwner(claim.attempt_id);
    if (!callbackOwner) return;
    const filePath = claimPath(stateDir, claim.attempt_id);
    const current = readClaim(filePath);
    if (
      current?.status !== 'callback_pending'
      || current.callback_delivery === 'delivered'
      || current.callback_url !== request.callback_url
      || !current.callback_result
      || !['completed', 'failed', 'cancelled'].includes(current.provider_status)
    ) {
      releaseCallbackOwner(callbackOwnerPath(stateDir, claim.attempt_id), callbackOwner);
      return;
    }
    const owned = {
      ...current,
      callback_delivery: 'pending',
      callback_delivery_id: callbackOwner.callback_delivery_id,
      callback_owner_instance_id: callbackOwner.bridge_instance_id,
      callback_owner_pid: callbackOwner.owner_pid,
      callback_owner_process_identity: callbackOwner.owner_process_identity,
    };
    writeClaimAtomic(filePath, owned);
    const delivery = (async () => {
      const delivered = await deliverCallback({
        fetchFn: configuration.fetchFn,
        sleep: configuration.sleep,
        logger: configuration.logger,
        request: {
          ...request,
          callback_url: current.callback_url,
        },
        result: current.callback_result,
        callbackTimeoutMs: configuration.callbackTimeoutMs,
      });
      configuration.onCallbackDelivery(
        current.attempt_id,
        current.provider_status,
        delivered,
        callbackOwner,
      );
    })().finally(() => {
      callbackDeliveries.delete(claim.attempt_id);
    });
    callbackDeliveries.set(claim.attempt_id, delivery);
  }

  return {
    authorize(headers = {}) {
      authenticate(headers);
      return true;
    },

    async accept(request, headers = {}) {
      authenticate(headers);
      const execution = validateRequest(request, configuration);
      const filePath = claimPath(stateDir, request?.attempt_id);
      const existing = readClaim(filePath);
      if (existing) {
        assertMatchingClaim(existing, request);
        if (existing.status === 'callback_pending') {
          if (
            existing.callback_url !== request.callback_url
            || !existing.callback_result
            || !['completed', 'failed', 'cancelled'].includes(existing.provider_status)
          ) {
            throw new KernelAttemptError('callback_redelivery_state_invalid', 500);
          }
          redeliverPendingClaim(existing, request);
          return {
            actual_machine_id: existing.machine_id,
            job_id: existing.job_id,
            status: 'accepted',
            attestation: machineAttestation(
              bridgeToken,
              existing.attempt_id,
              existing.machine_id,
              existing.job_id,
            ),
          };
        }
        return {
          actual_machine_id: existing.machine_id,
          job_id: existing.job_id,
          status: existing.status,
          attestation: machineAttestation(
            bridgeToken,
            existing.attempt_id,
            existing.machine_id,
            existing.job_id,
          ),
        };
      }

      const claim = {
        attempt_id: request.attempt_id,
        lease_owner: request.lease_owner,
        lease_generation: request.lease_generation,
        job_id: randomUUID(),
        machine_id: machineId,
        status: 'accepted',
        bridge_instance_id: configuration.bridgeInstanceId,
        owner_pid: configuration.ownerPid,
        owner_process_identity: configuration.ownerProcessIdentity,
      };
      const publication = publishClaimExclusive(filePath, claim);
      if (!publication.published) {
        assertMatchingClaim(publication.claim, request);
        return {
          actual_machine_id: publication.claim.machine_id,
          job_id: publication.claim.job_id,
          status: publication.claim.status,
          attestation: machineAttestation(
            bridgeToken,
            publication.claim.attempt_id,
            publication.claim.machine_id,
            publication.claim.job_id,
          ),
        };
      }
      let child;
      try {
        child = startProvider({ configuration, request, claim, execution });
      } catch {
        writeClaimAtomic(filePath, { ...claim, status: 'failed' });
        logger.error?.('kernel attempt provider start failed');
        throw new KernelAttemptError('provider_start_failed', 503);
      }
      liveChildren.set(request.attempt_id, {
        child,
        cancelRequested: false,
        exited: false,
      });
      return {
        actual_machine_id: claim.machine_id,
        job_id: claim.job_id,
        status: claim.status,
        attestation: machineAttestation(
          bridgeToken,
          claim.attempt_id,
          claim.machine_id,
          claim.job_id,
        ),
      };
    },

    async inspect(attemptId, headers = {}) {
      authenticate(headers);
      const claim = readClaim(claimPath(stateDir, attemptId));
      if (!claim) throw new KernelAttemptError('attempt_not_found', 404);
      return { ...claim };
    },

    async cancel(attemptId, lease, headers = {}) {
      authenticate(headers);
      const filePath = claimPath(stateDir, attemptId);
      const claim = readClaim(filePath);
      if (!claim) throw new KernelAttemptError('attempt_not_found', 404);
      assertMatchingClaim(claim, lease);
      if (
        ['cancelled', 'completed', 'failed', 'callback_pending'].includes(claim.status)
      ) return { ...claim };

      const live = liveChildren.get(attemptId);
      if (
        claim.bridge_instance_id !== configuration.bridgeInstanceId
        || !live
      ) {
        throw new KernelAttemptError('owner_process_mismatch', 409);
      }
      const cancelled = { ...claim, status: 'cancelled' };
      writeClaimAtomic(filePath, cancelled);

      live.cancelRequested = true;
      live.child.kill('SIGTERM');
      await configuration.cancelSleep(5000);
      if (liveChildren.get(attemptId) === live && !live.exited) {
        live.child.kill('SIGKILL');
      }
      return cancelled;
    },
  };
}

module.exports = {
  KernelAttemptError,
  createKernelAttemptHandler,
};
