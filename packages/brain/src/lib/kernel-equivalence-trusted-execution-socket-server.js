import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import {
  dirname,
  isAbsolute,
  parse,
  resolve,
} from 'node:path';
import {
  BRAIN_TRUSTED_EXECUTION_SOCKET_PATH,
} from './kernel-equivalence-trusted-execution-client.js';
import {
  assertPathAclFree,
} from './kernel-equivalence-protected-filesystem.js';

const MAXIMUM_REQUEST_BYTES = 65_536;
const MAXIMUM_RESPONSE_BYTES = 262_144;
const MAXIMUM_REQUEST_DEADLINE_MS = 30_000;
const MAXIMUM_TOTAL_DEADLINE_MS = 30_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const READINESS_REQUEST_FIELDS = Object.freeze([
  'brain_identity',
  'expected_plan_digest',
  'nonce',
  'schema_version',
  'service_id',
  'service_schema_version',
]);
const READINESS_SIGNER_FIELDS = Object.freeze([
  'capability_id',
  'key_id',
  'owner_service',
  'signReadiness',
]);

export class KernelTrustedExecutionSocketServerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelTrustedExecutionSocketServerError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelTrustedExecutionSocketServerError(code);
}

function validateConfiguration({
  service,
  readinessSigner,
  now,
  socketPath,
  requestDeadlineMs,
  totalDeadlineMs,
  maximumRequestBytes,
  maximumResponseBytes,
}) {
  if (
    !service
    || service.schema_version
      !== 'kernel-equivalence-trusted-execution-service/v1'
    || service.cell_count !== 99
    || service.adapter_count !== 10
    || !HASH_PATTERN.test(service.plan_digest ?? '')
    || typeof service.execute !== 'function'
  ) {
    fail('trusted_execution_service_invalid');
  }
  if (
    !Object.isFrozen(readinessSigner)
    || !readinessSigner
    || typeof readinessSigner !== 'object'
    || Object.keys(readinessSigner).sort().some(
      (field, index) => field !== READINESS_SIGNER_FIELDS[index],
    )
    || Object.keys(readinessSigner).length
      !== READINESS_SIGNER_FIELDS.length
    || readinessSigner.owner_service
      !== 'brain.kernel_equivalence.readiness_signer'
    || typeof readinessSigner.capability_id !== 'string'
    || typeof readinessSigner.key_id !== 'string'
    || typeof readinessSigner.signReadiness !== 'function'
    || typeof now !== 'function'
  ) {
    fail('trusted_execution_readiness_signer_invalid');
  }
  if (
    typeof socketPath !== 'string'
    || !isAbsolute(socketPath)
    || resolve(socketPath) !== socketPath
    || socketPath === parse(socketPath).root
    || /[\0\r\n]/.test(socketPath)
  ) {
    fail('trusted_execution_socket_path_invalid');
  }
  if (
    !Number.isInteger(requestDeadlineMs)
    || requestDeadlineMs < 1
    || requestDeadlineMs > MAXIMUM_REQUEST_DEADLINE_MS
    || !Number.isInteger(totalDeadlineMs)
    || totalDeadlineMs < 1
    || totalDeadlineMs > MAXIMUM_TOTAL_DEADLINE_MS
    || !Number.isInteger(maximumRequestBytes)
    || maximumRequestBytes < 64
    || maximumRequestBytes > MAXIMUM_REQUEST_BYTES
    || !Number.isInteger(maximumResponseBytes)
    || maximumResponseBytes < 512
    || maximumResponseBytes > MAXIMUM_RESPONSE_BYTES
  ) {
    fail('trusted_execution_socket_configuration_invalid');
  }
}

function protectedParentDirectory(socketPath) {
  const parent = dirname(socketPath);
  let status;
  try {
    status = lstatSync(parent);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      fail('trusted_execution_socket_parent_unsafe');
    }
    try {
      mkdirSync(parent, { mode: 0o700 });
      status = lstatSync(parent);
    } catch {
      fail('trusted_execution_socket_parent_unavailable');
    }
  }
  const uid = typeof process.getuid === 'function'
    ? process.getuid()
    : null;
  if (
    !status.isDirectory()
    || (status.mode & 0o022) !== 0
    || (
      uid != null
      && status.uid !== uid
      && status.uid !== 0
    )
  ) {
    fail('trusted_execution_socket_parent_unsafe');
  }
  assertPathAclFree(
    parent,
    () => fail('trusted_execution_socket_parent_unsafe'),
  );
  return Object.freeze({
    path: parent,
    device: status.dev,
    inode: status.ino,
  });
}

function assertTargetAbsent(socketPath) {
  try {
    lstatSync(socketPath);
    fail('trusted_execution_socket_path_occupied');
  } catch (error) {
    if (
      error instanceof KernelTrustedExecutionSocketServerError
    ) {
      throw error;
    }
    if (error?.code !== 'ENOENT') {
      fail('trusted_execution_socket_path_unavailable');
    }
  }
}

function socketIdentity(socketPath, { secureMode = false } = {}) {
  let status;
  try {
    status = lstatSync(socketPath);
  } catch {
    fail('trusted_execution_socket_listen_failed');
  }
  if (
    !status.isSocket()
    || (secureMode && (status.mode & 0o777) !== 0o600)
  ) {
    fail('trusted_execution_socket_unsafe');
  }
  assertPathAclFree(
    socketPath,
    () => fail('trusted_execution_socket_unsafe'),
  );
  return Object.freeze({
    device: status.dev,
    inode: status.ino,
  });
}

function sameParentDirectory(expected) {
  let actual;
  try {
    actual = lstatSync(expected.path);
  } catch {
    fail('trusted_execution_socket_parent_unsafe');
  }
  assertPathAclFree(
    expected.path,
    () => fail('trusted_execution_socket_parent_unsafe'),
  );
  if (
    !actual.isDirectory()
    || actual.dev !== expected.device
    || actual.ino !== expected.inode
  ) {
    fail('trusted_execution_socket_parent_unsafe');
  }
}

function recoverableSocketIdentity(socketPath) {
  let status;
  try {
    status = lstatSync(socketPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('trusted_execution_socket_path_unavailable');
  }
  const uid = typeof process.getuid === 'function'
    ? process.getuid()
    : null;
  if (
    !status.isSocket()
    || status.isSymbolicLink()
    || status.nlink !== 1
    || (status.mode & 0o777) !== 0o600
    || (uid != null && status.uid !== uid)
  ) {
    fail('trusted_execution_socket_path_occupied');
  }
  assertPathAclFree(
    socketPath,
    () => fail('trusted_execution_socket_path_occupied'),
  );
  return Object.freeze({
    device: status.dev,
    inode: status.ino,
  });
}

function sameRecoverableSocket(socketPath, expected) {
  const actual = recoverableSocketIdentity(socketPath);
  if (
    actual == null
    || actual.device !== expected.device
    || actual.inode !== expected.inode
  ) {
    fail('trusted_execution_socket_path_occupied');
  }
}

function proveSocketInactive(socketPath, timeoutMs = 250) {
  return new Promise((resolveInactive) => {
    let settled = false;
    const socket = createConnection({ path: socketPath });
    const finish = (inactive) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolveInactive(inactive);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => {
      finish(error?.code === 'ECONNREFUSED');
    });
  });
}

function restoreQuarantinedReplacement(
  quarantinePath,
  socketPath,
) {
  try {
    lstatSync(socketPath);
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') return;
  }
  try {
    renameSync(quarantinePath, socketPath);
  } catch {
    // Never unlink an inode that stopped matching the pinned stale socket.
  }
}

async function recoverPinnedStaleSocket(
  socketPath,
  parentIdentity,
  { afterQuarantine = async () => {} } = {},
) {
  if (typeof afterQuarantine !== 'function') {
    fail('trusted_execution_socket_configuration_invalid');
  }
  const stale = recoverableSocketIdentity(socketPath);
  if (stale == null) return;
  if (!await proveSocketInactive(socketPath)) {
    fail('trusted_execution_socket_path_occupied');
  }
  sameParentDirectory(parentIdentity);
  sameRecoverableSocket(socketPath, stale);
  const quarantinePath = resolve(
    dirname(socketPath),
    `.stale-${process.pid.toString(36)}-${randomBytes(6).toString('hex')}`,
  );
  assertTargetAbsent(quarantinePath);
  try {
    renameSync(socketPath, quarantinePath);
  } catch {
    fail('trusted_execution_socket_path_occupied');
  }
  try {
    await afterQuarantine();
    sameRecoverableSocket(quarantinePath, stale);
    sameParentDirectory(parentIdentity);
    assertTargetAbsent(socketPath);
  } catch (error) {
    restoreQuarantinedReplacement(quarantinePath, socketPath);
    throw error;
  }
  try {
    unlinkSync(quarantinePath);
  } catch {
    fail('trusted_execution_socket_path_unavailable');
  }
  try {
    lstatSync(quarantinePath);
    fail('trusted_execution_socket_path_unavailable');
  } catch (error) {
    if (error instanceof KernelTrustedExecutionSocketServerError) {
      throw error;
    }
    if (error?.code !== 'ENOENT') {
      fail('trusted_execution_socket_path_unavailable');
    }
  }
  sameParentDirectory(parentIdentity);
}

export const __trustedExecutionSocketServerTest = Object.freeze({
  recoverPinnedStaleSocket: async ({
    socketPath,
    afterQuarantine,
  } = {}) => {
    const parentIdentity = protectedParentDirectory(socketPath);
    await recoverPinnedStaleSocket(
      socketPath,
      parentIdentity,
      { afterQuarantine },
    );
  },
});

function unlinkOwnedSocket(socketPath, identity) {
  if (!identity) return;
  let status;
  try {
    status = lstatSync(socketPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    return;
  }
  if (
    !status.isSocket()
    || status.dev !== identity.device
    || status.ino !== identity.inode
  ) {
    return;
  }
  try {
    unlinkSync(socketPath);
  } catch {
    // A replacement or permission change must never trigger a broad cleanup.
  }
}

function stableFailure(error) {
  if (
    typeof error?.code === 'string'
    && error.code.startsWith('trusted_execution_')
  ) {
    return error.code;
  }
  return 'trusted_execution_service_failed';
}

function blocked(code, binding = null) {
  return binding == null
    ? {
      schema_version:
        'kernel-equivalence-trusted-execution-response/v1',
      status: 'blocked',
      code,
    }
    : {
      schema_version:
        'kernel-equivalence-trusted-execution-response/v1',
      status: 'blocked',
      cell_id: binding.cell_id,
      grant_ref: binding.grant_ref,
      code,
    };
}

function succeeded(binding, result) {
  return {
    schema_version:
      'kernel-equivalence-trusted-execution-response/v1',
    status: 'ok',
    cell_id: binding.cell_id,
    grant_ref: binding.grant_ref,
    result,
  };
}

function validReadinessChallenge(value, service) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const fields = Object.keys(value).sort();
  return (
    fields.length === READINESS_REQUEST_FIELDS.length
    && fields.every(
      (field, index) => field === READINESS_REQUEST_FIELDS[index],
    )
    && value.schema_version
      === 'kernel-equivalence-trusted-execution-readiness-challenge/v1'
    && /^[a-f0-9]{64}$/.test(value.nonce ?? '')
    && value.expected_plan_digest === service.plan_digest
    && value.brain_identity === 'cecelia.brain'
    && value.service_id
      === 'brain.kernel_equivalence.trusted_execution'
    && value.service_schema_version === service.schema_version
  );
}

function readinessSucceeded(
  request,
  service,
  readinessSigner,
  identity,
  now,
) {
  const issuedAt = now();
  if (!Number.isFinite(issuedAt)) {
    fail('trusted_execution_readiness_signing_failed');
  }
  const unsigned = {
    schema_version:
      'kernel-equivalence-trusted-execution-readiness-response/v1',
    status: 'ready',
    nonce: request.nonce,
    brain_identity: 'cecelia.brain',
    service_id:
      'brain.kernel_equivalence.trusted_execution',
    service_schema_version: service.schema_version,
    plan_digest: service.plan_digest,
    socket_device: String(identity.device),
    socket_inode: String(identity.inode),
    key_id: readinessSigner.key_id,
    issued_at: new Date(issuedAt).toISOString(),
    expires_at: new Date(issuedAt + 2_000).toISOString(),
  };
  let signature;
  try {
    signature = readinessSigner.signReadiness(
      Object.freeze(structuredClone(unsigned)),
    );
  } catch {
    fail('trusted_execution_readiness_signing_failed');
  }
  if (
    typeof signature !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
  ) {
    fail('trusted_execution_readiness_signing_failed');
  }
  return {
    ...unsigned,
    signature,
  };
}

function validBinding(value) {
  return (
    value
    && typeof value === 'object'
    && typeof value.cell_id === 'string'
    && typeof value.grant_ref === 'string'
  );
}

function responseTooLarge(binding) {
  return blocked(
    'trusted_execution_response_too_large',
    validBinding(binding) ? binding : null,
  );
}

function abortReason(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function createBrainTrustedExecutionSocketServer({
  service,
  readinessSigner,
  now = Date.now,
  socketPath = BRAIN_TRUSTED_EXECUTION_SOCKET_PATH,
  requestDeadlineMs = 5_000,
  totalDeadlineMs = MAXIMUM_TOTAL_DEADLINE_MS,
  maximumRequestBytes = MAXIMUM_REQUEST_BYTES,
  maximumResponseBytes = MAXIMUM_RESPONSE_BYTES,
} = {}) {
  validateConfiguration({
    service,
    readinessSigner,
    now,
    socketPath,
    requestDeadlineMs,
    totalDeadlineMs,
    maximumRequestBytes,
    maximumResponseBytes,
  });

  const bindPath = resolve(
    dirname(socketPath),
    `.k${process.pid.toString(36)}${randomBytes(4).toString('hex')}`,
  );
  const connections = new Map();
  let identity = null;
  let state = 'created';
  let closePromise = null;
  const readiness = () => Object.freeze({
    ready: state === 'listening',
    code: state === 'listening'
      ? null
      : state === 'closed'
        ? 'trusted_execution_socket_closed'
        : 'trusted_execution_socket_not_listening',
    socket_path: state === 'listening' ? socketPath : null,
  });

  const listener = createServer({ allowHalfOpen: true }, (socket) => {
    let requestBytes = Buffer.alloc(0);
    let responseStarted = false;
    let framingComplete = false;
    let executionController = null;
    const absoluteDeadlineMs = Date.now() + totalDeadlineMs;
    const totalDeadlineTimer = setTimeout(() => {
      if (executionController) {
        executionController.abort(
          abortReason('trusted_execution_deadline_exceeded'),
        );
        return;
      }
      rejectRequest('trusted_execution_request_timeout');
    }, totalDeadlineMs);
    const framingTimer = setTimeout(() => {
      rejectRequest('trusted_execution_request_timeout');
    }, Math.min(requestDeadlineMs, totalDeadlineMs));
    connections.set(socket, () => {
      executionController?.abort(
        abortReason('trusted_execution_server_shutdown'),
      );
    });
    const writeResponse = (value, binding = null) => {
      if (responseStarted) return;
      responseStarted = true;
      clearTimeout(totalDeadlineTimer);
      connections.delete(socket);
      if (socket.destroyed) return;
      let encoded;
      try {
        encoded = Buffer.from(`${JSON.stringify(value)}\n`);
      } catch {
        encoded = Buffer.from(
          `${JSON.stringify(blocked(
            'trusted_execution_response_invalid',
            binding,
          ))}\n`,
        );
      }
      if (encoded.length > maximumResponseBytes) {
        encoded = Buffer.from(
          `${JSON.stringify(responseTooLarge(binding))}\n`,
        );
      }
      if (encoded.length > maximumResponseBytes) {
        encoded = Buffer.from(
          `${JSON.stringify(responseTooLarge(null))}\n`,
        );
      }
      socket.end(encoded);
    };
    const rejectRequest = (code) => {
      if (responseStarted || framingComplete) return;
      framingComplete = true;
      clearTimeout(framingTimer);
      writeResponse(blocked(code));
    };

    const dispatchRequest = async (request) => {
      executionController = new AbortController();
      const enforceAbsoluteDeadline = () => {
        if (
          Date.now() >= absoluteDeadlineMs
          && !executionController.signal.aborted
        ) {
          executionController.abort(
            abortReason('trusted_execution_deadline_exceeded'),
          );
        }
      };
      enforceAbsoluteDeadline();
      try {
        const result = await service.execute(request, {
          signal: executionController.signal,
          deadlineMs: absoluteDeadlineMs,
        });
        enforceAbsoluteDeadline();
        await new Promise((resolvePendingInput) => {
          setImmediate(resolvePendingInput);
        });
        enforceAbsoluteDeadline();
        if (executionController.signal.aborted) {
          writeResponse(
            blocked(
              stableFailure(executionController.signal.reason),
              request,
            ),
            request,
          );
          return;
        }
        writeResponse(succeeded(request, result), request);
      } catch (error) {
        enforceAbsoluteDeadline();
        await new Promise((resolvePendingInput) => {
          setImmediate(resolvePendingInput);
        });
        enforceAbsoluteDeadline();
        writeResponse(
          blocked(
            executionController.signal.aborted
              ? stableFailure(executionController.signal.reason)
              : stableFailure(error),
            request,
          ),
          request,
        );
      }
    };

    socket.on('data', (chunk) => {
      if (responseStarted || framingComplete) return;
      requestBytes = Buffer.concat([requestBytes, chunk]);
      if (requestBytes.length > maximumRequestBytes) {
        rejectRequest('trusted_execution_request_too_large');
      }
    });
    socket.once('end', () => {
      if (responseStarted || framingComplete) return;
      framingComplete = true;
      clearTimeout(framingTimer);
      if (
        requestBytes.length < 2
        || requestBytes.at(-1) !== 0x0a
        || requestBytes.indexOf(0x0a) !== requestBytes.length - 1
      ) {
        writeResponse(blocked('trusted_execution_request_invalid'));
        return;
      }
      let request;
      try {
        request = JSON.parse(
          requestBytes.subarray(0, requestBytes.length - 1)
            .toString('utf8'),
        );
      } catch {
        writeResponse(blocked('trusted_execution_request_invalid'));
        return;
      }
      if (validReadinessChallenge(request, service)) {
        try {
          writeResponse(readinessSucceeded(
            request,
            service,
            readinessSigner,
            identity,
            now,
          ));
        } catch {
          writeResponse(blocked(
            'trusted_execution_readiness_signing_failed',
          ));
        }
        return;
      }
      if (!validBinding(request)) {
        writeResponse(blocked('trusted_execution_request_invalid'));
        return;
      }
      void dispatchRequest(request);
    });
    socket.once('error', () => {
      socket.destroy();
    });
    socket.once('close', () => {
      clearTimeout(framingTimer);
      if (!framingComplete || responseStarted) {
        clearTimeout(totalDeadlineTimer);
        connections.delete(socket);
      }
      if (!responseStarted && !framingComplete) {
        executionController?.abort(
          abortReason('trusted_execution_client_disconnected'),
        );
      }
    });
  });
  listener.on('error', () => {
    if (state === 'listening') state = 'failed';
  });

  const start = async () => {
    if (state !== 'created') {
      fail('trusted_execution_socket_state_invalid');
    }
    const parentIdentity = protectedParentDirectory(socketPath);
    await recoverPinnedStaleSocket(socketPath, parentIdentity);
    assertTargetAbsent(socketPath);
    assertTargetAbsent(bindPath);
    state = 'starting';
    try {
      await new Promise((resolveStarted, rejectStarted) => {
        const onError = () => {
          listener.off('listening', onListening);
          rejectStarted(
            new KernelTrustedExecutionSocketServerError(
              'trusted_execution_socket_listen_failed',
            ),
          );
        };
        const onListening = () => {
          listener.off('error', onError);
          resolveStarted();
        };
        listener.once('error', onError);
        listener.once('listening', onListening);
        const previousMask = process.umask(0o177);
        try {
          listener.listen(bindPath);
        } finally {
          process.umask(previousMask);
        }
      });
      identity = socketIdentity(bindPath);
      chmodSync(bindPath, 0o600);
      linkSync(bindPath, socketPath);
      const securedIdentity = socketIdentity(socketPath, {
        secureMode: true,
      });
      if (
        securedIdentity.device !== identity.device
        || securedIdentity.inode !== identity.inode
      ) {
        fail('trusted_execution_socket_unsafe');
      }
      unlinkSync(bindPath);
      state = 'listening';
    } catch (error) {
      if (listener.listening) {
        await new Promise((resolveClosed) => {
          listener.close(resolveClosed);
        });
      }
      state = 'closed';
      unlinkOwnedSocket(bindPath, identity);
      unlinkOwnedSocket(socketPath, identity);
      if (
        error instanceof KernelTrustedExecutionSocketServerError
      ) {
        throw error;
      }
      fail('trusted_execution_socket_listen_failed');
    }
  };

  const close = async () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (state === 'created') {
        state = 'closed';
        return;
      }
      state = 'closing';
      for (const [connection, abort] of connections) {
        abort();
        connection.end();
      }
      await new Promise((resolveClosed) => {
        if (!listener.listening) {
          resolveClosed();
          return;
        }
        const timer = setTimeout(() => {
          for (const connection of connections.keys()) {
            connection.destroy();
          }
        }, 100);
        timer.unref?.();
        listener.close(() => {
          clearTimeout(timer);
          resolveClosed();
        });
      });
      unlinkOwnedSocket(bindPath, identity);
      unlinkOwnedSocket(socketPath, identity);
      state = 'closed';
    })();
    return closePromise;
  };

  return Object.freeze({
    schema_version:
      'kernel-equivalence-trusted-execution-socket-server/v1',
    getReadiness: readiness,
    start,
    close,
  });
}

export async function startBrainTrustedExecutionSocketServer(options) {
  const controller = createBrainTrustedExecutionSocketServer(options);
  await controller.start();
  return controller;
}
