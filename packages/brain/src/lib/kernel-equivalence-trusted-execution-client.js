import {
  lstatSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import {
  dirname,
  isAbsolute,
  parse,
  resolve,
} from 'node:path';

const DEFAULT_SOCKET_PATH =
  '/var/run/cecelia/kernel-equivalence.sock';
const REQUEST_FIELDS = Object.freeze(['cell_id', 'grant_ref']);
const GRANT_REF_PATTERN =
  /^kernel-equivalence-grant:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAXIMUM_RESPONSE_BYTES = 262_144;

export class KernelTrustedExecutionClientError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelTrustedExecutionClientError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelTrustedExecutionClientError(code);
}

function exactRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const fields = Object.keys(value).sort();
  return (
    fields.length === REQUEST_FIELDS.length
    && fields.every((field, index) => field === REQUEST_FIELDS[index])
    && typeof value.cell_id === 'string'
    && value.cell_id.length > 0
    && value.cell_id.length <= 1_024
    && !/[\0\r\n]/.test(value.cell_id)
    && typeof value.grant_ref === 'string'
    && GRANT_REF_PATTERN.test(value.grant_ref)
  );
}

function validateSocketPath(socketPath) {
  if (
    typeof socketPath !== 'string'
    || !isAbsolute(socketPath)
    || resolve(socketPath) !== socketPath
    || socketPath === parse(socketPath).root
    || /[\0\r\n]/.test(socketPath)
  ) {
    fail('trusted_execution_socket_path_invalid');
  }
}

function inspectSocket(socketPath) {
  let socketStatus;
  let directoryStatus;
  try {
    socketStatus = lstatSync(socketPath);
    directoryStatus = lstatSync(dirname(socketPath));
  } catch {
    fail('trusted_execution_socket_unavailable');
  }
  const currentUid = typeof process.getuid === 'function'
    ? process.getuid()
    : null;
  const socketOwnerAllowed = (
    currentUid == null
    || socketStatus.uid === currentUid
  );
  const directoryOwnerAllowed = (
    currentUid == null
    || directoryStatus.uid === currentUid
    || directoryStatus.uid === 0
  );
  if (
    !socketStatus.isSocket()
    || socketStatus.nlink !== 1
    || (socketStatus.mode & 0o777) !== 0o600
    || !socketOwnerAllowed
    || !directoryStatus.isDirectory()
    || !directoryOwnerAllowed
    || (directoryStatus.mode & 0o022) !== 0
  ) {
    fail('trusted_execution_socket_unsafe');
  }
  return Object.freeze({
    device: socketStatus.dev,
    inode: socketStatus.ino,
  });
}

function sameSocket(socketPath, expected) {
  let actual;
  try {
    actual = lstatSync(socketPath);
  } catch {
    fail('trusted_execution_socket_unavailable');
  }
  if (
    !actual.isSocket()
    || actual.dev !== expected.device
    || actual.ino !== expected.inode
    || (actual.mode & 0o777) !== 0o600
  ) {
    fail('trusted_execution_socket_unsafe');
  }
}

export function createUnixSocketTrustedExecutionTransport({
  socketPath = DEFAULT_SOCKET_PATH,
  timeoutMs = 5_000,
  maximumResponseBytes = MAXIMUM_RESPONSE_BYTES,
} = {}) {
  validateSocketPath(socketPath);
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 30_000
    || !Number.isInteger(maximumResponseBytes)
    || maximumResponseBytes < 1
    || maximumResponseBytes > MAXIMUM_RESPONSE_BYTES
  ) {
    fail('trusted_execution_transport_configuration_invalid');
  }

  return async (request) => {
    if (!exactRequest(request)) {
      fail('trusted_execution_request_invalid');
    }
    const identity = inspectSocket(socketPath);
    return new Promise((resolveResult, rejectResult) => {
      let settled = false;
      let response = Buffer.alloc(0);
      const socket = createConnection({ path: socketPath });
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        callback(value);
      };
      const rejectCode = (code) => {
        settle(
          rejectResult,
          new KernelTrustedExecutionClientError(code),
        );
      };
      socket.setTimeout(timeoutMs);
      socket.once('timeout', () => {
        rejectCode('trusted_execution_socket_timeout');
      });
      socket.once('error', () => {
        rejectCode('trusted_execution_socket_unavailable');
      });
      socket.once('connect', () => {
        try {
          sameSocket(socketPath, identity);
          socket.write(`${JSON.stringify(request)}\n`);
        } catch (error) {
          settle(rejectResult, error);
        }
      });
      socket.on('data', (chunk) => {
        response = Buffer.concat([response, chunk]);
        if (response.length > maximumResponseBytes) {
          rejectCode('trusted_execution_response_invalid');
          return;
        }
        const newline = response.indexOf(0x0a);
        if (newline === -1) return;
        let parsed;
        try {
          parsed = JSON.parse(response.subarray(0, newline).toString('utf8'));
        } catch {
          rejectCode('trusted_execution_response_invalid');
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          rejectCode('trusted_execution_response_invalid');
          return;
        }
        if (
          parsed.status === 'blocked'
          && typeof parsed.code === 'string'
          && parsed.code.startsWith('trusted_execution_')
        ) {
          rejectCode(parsed.code);
          return;
        }
        settle(resolveResult, Object.freeze(structuredClone(parsed)));
      });
      socket.once('end', () => {
        if (!settled) rejectCode('trusted_execution_response_invalid');
      });
    });
  };
}

export function createBrainTrustedExecutionClient({
  transport = createUnixSocketTrustedExecutionTransport(),
} = {}) {
  if (typeof transport !== 'function') {
    fail('trusted_execution_transport_invalid');
  }
  return Object.freeze({
    schema_version: 'kernel-equivalence-trusted-execution-client/v1',
    execute: async (request) => {
      if (!exactRequest(request)) {
        fail('trusted_execution_request_invalid');
      }
      try {
        const response = await transport(
          Object.freeze(structuredClone(request)),
        );
        if (
          response?.cell_id != null
          && response.cell_id !== request.cell_id
        ) {
          fail('trusted_execution_response_cell_mismatch');
        }
        return response;
      } catch (error) {
        if (error instanceof KernelTrustedExecutionClientError) throw error;
        fail('trusted_execution_transport_failed');
      }
    },
  });
}

export const BRAIN_TRUSTED_EXECUTION_SOCKET_PATH = DEFAULT_SOCKET_PATH;
