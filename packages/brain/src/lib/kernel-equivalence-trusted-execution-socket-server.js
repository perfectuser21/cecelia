import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import {
  dirname,
  isAbsolute,
  parse,
  resolve,
} from 'node:path';
import {
  BRAIN_TRUSTED_EXECUTION_SOCKET_PATH,
} from './kernel-equivalence-trusted-execution-client.js';

const MAXIMUM_REQUEST_BYTES = 65_536;
const MAXIMUM_RESPONSE_BYTES = 262_144;

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
  socketPath,
  requestTimeoutMs,
  maximumRequestBytes,
  maximumResponseBytes,
}) {
  if (
    !service
    || service.schema_version
      !== 'kernel-equivalence-trusted-execution-service/v1'
    || service.cell_count !== 99
    || service.adapter_count !== 10
    || typeof service.execute !== 'function'
  ) {
    fail('trusted_execution_service_invalid');
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
    !Number.isInteger(requestTimeoutMs)
    || requestTimeoutMs < 1
    || requestTimeoutMs > 30_000
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
  return Object.freeze({
    device: status.dev,
    inode: status.ino,
  });
}

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

function blocked(code) {
  return {
    status: 'blocked',
    code,
    execution_ready: false,
    audit: null,
  };
}

export function createBrainTrustedExecutionSocketServer({
  service,
  socketPath = BRAIN_TRUSTED_EXECUTION_SOCKET_PATH,
  requestTimeoutMs = 5_000,
  maximumRequestBytes = MAXIMUM_REQUEST_BYTES,
  maximumResponseBytes = MAXIMUM_RESPONSE_BYTES,
} = {}) {
  validateConfiguration({
    service,
    socketPath,
    requestTimeoutMs,
    maximumRequestBytes,
    maximumResponseBytes,
  });

  const bindPath = resolve(
    dirname(socketPath),
    `.k${process.pid.toString(36)}${randomBytes(4).toString('hex')}`,
  );
  const connections = new Set();
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

  const listener = createServer((socket) => {
    connections.add(socket);
    let requestBytes = Buffer.alloc(0);
    let dispatched = false;
    const writeResponse = (value) => {
      if (socket.destroyed) return;
      let encoded;
      try {
        encoded = Buffer.from(`${JSON.stringify(value)}\n`);
      } catch {
        encoded = Buffer.from(
          `${JSON.stringify(blocked(
            'trusted_execution_response_invalid',
          ))}\n`,
        );
      }
      if (encoded.length > maximumResponseBytes) {
        encoded = Buffer.from(
          `${JSON.stringify(blocked(
            'trusted_execution_response_too_large',
          ))}\n`,
        );
      }
      socket.end(encoded);
    };
    const rejectRequest = (code) => {
      if (dispatched) return;
      dispatched = true;
      socket.pause();
      writeResponse(blocked(code));
    };

    socket.setTimeout(requestTimeoutMs);
    socket.once('timeout', () => {
      rejectRequest('trusted_execution_request_timeout');
    });
    socket.on('data', async (chunk) => {
      if (dispatched) return;
      requestBytes = Buffer.concat([requestBytes, chunk]);
      if (requestBytes.length > maximumRequestBytes) {
        rejectRequest('trusted_execution_request_too_large');
        return;
      }
      const newline = requestBytes.indexOf(0x0a);
      if (newline === -1) return;
      dispatched = true;
      socket.pause();
      const trailing = requestBytes.subarray(newline + 1)
        .toString('utf8')
        .trim();
      if (trailing.length > 0) {
        writeResponse(blocked('trusted_execution_request_invalid'));
        return;
      }
      let request;
      try {
        request = JSON.parse(
          requestBytes.subarray(0, newline).toString('utf8'),
        );
      } catch {
        writeResponse(blocked('trusted_execution_request_invalid'));
        return;
      }
      try {
        const result = await service.execute(request);
        writeResponse(result);
      } catch (error) {
        writeResponse(blocked(stableFailure(error)));
      }
    });
    socket.once('error', () => {
      socket.destroy();
    });
    socket.once('close', () => {
      connections.delete(socket);
    });
  });
  listener.on('error', () => {
    if (state === 'listening') state = 'failed';
  });

  const start = async () => {
    if (state !== 'created') {
      fail('trusted_execution_socket_state_invalid');
    }
    protectedParentDirectory(socketPath);
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
      for (const connection of connections) connection.end();
      await new Promise((resolveClosed) => {
        if (!listener.listening) {
          resolveClosed();
          return;
        }
        const timer = setTimeout(() => {
          for (const connection of connections) connection.destroy();
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
