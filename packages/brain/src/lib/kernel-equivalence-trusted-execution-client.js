import {
  lstatSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import {
  dirname,
  isAbsolute,
  parse,
  resolve,
} from 'node:path';
import {
  assertPathAclFree,
} from './kernel-equivalence-protected-filesystem.js';

const DEFAULT_SOCKET_PATH =
  '/var/run/cecelia/kernel-equivalence.sock';
const REQUEST_FIELDS = Object.freeze(['cell_id', 'grant_ref']);
const GRANT_REF_PATTERN =
  /^kernel-equivalence-grant:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAXIMUM_RESPONSE_BYTES = 262_144;
const MAXIMUM_READINESS_RESPONSE_BYTES = 1_024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const READINESS_RESPONSE_FIELDS = Object.freeze([
  'brain_identity',
  'challenge',
  'plan_digest',
  'schema_version',
  'service_identity',
  'service_schema_version',
  'status',
]);
// Server execution may consume its 30s budget, then use bounded cancellation,
// settlement, cleanup verification, and denial-audit windows before replying.
const DEFAULT_CLIENT_DEADLINE_MS = 185_000;
const MAXIMUM_CLIENT_DEADLINE_MS = 300_000;
const SUCCESS_RESPONSE_FIELDS = Object.freeze([
  'cell_id',
  'grant_ref',
  'result',
  'schema_version',
  'status',
]);
const BLOCKED_RESPONSE_FIELDS = Object.freeze([
  'cell_id',
  'code',
  'grant_ref',
  'schema_version',
  'status',
]);

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

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length
    && actual.every((field, index) => field === expected[index])
  );
}

function unwrapResponseEnvelope(response, request) {
  const bindingMatches = (
    response?.cell_id === request.cell_id
    && response?.grant_ref === request.grant_ref
  );
  if (
    exactKeys(response, SUCCESS_RESPONSE_FIELDS)
    && response.schema_version
      === 'kernel-equivalence-trusted-execution-response/v1'
    && response.status === 'ok'
    && bindingMatches
    && response.result
    && typeof response.result === 'object'
    && !Array.isArray(response.result)
  ) {
    return Object.freeze(structuredClone(response.result));
  }
  if (
    exactKeys(response, BLOCKED_RESPONSE_FIELDS)
    && response.schema_version
      === 'kernel-equivalence-trusted-execution-response/v1'
    && response.status === 'blocked'
    && bindingMatches
    && typeof response.code === 'string'
    && response.code.startsWith('trusted_execution_')
  ) {
    fail(response.code);
  }
  fail('trusted_execution_response_invalid');
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
  assertPathAclFree(
    socketPath,
    () => fail('trusted_execution_socket_unsafe'),
  );
  assertPathAclFree(
    dirname(socketPath),
    () => fail('trusted_execution_socket_unsafe'),
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
  assertPathAclFree(
    socketPath,
    () => fail('trusted_execution_socket_unsafe'),
  );
}

export function inspectBrainTrustedExecutionSocketReadiness({
  socketPath = DEFAULT_SOCKET_PATH,
} = {}) {
  try {
    validateSocketPath(socketPath);
    inspectSocket(socketPath);
    return Object.freeze({
      ready: true,
      code: null,
      socket_path: socketPath,
    });
  } catch (error) {
    const code = (
      error instanceof KernelTrustedExecutionClientError
      && typeof error.code === 'string'
    )
      ? error.code
      : 'trusted_execution_socket_unavailable';
    return Object.freeze({
      ready: false,
      code,
      socket_path: null,
    });
  }
}

export async function probeBrainTrustedExecutionSocketReadiness({
  socketPath = DEFAULT_SOCKET_PATH,
  expectedPlanDigest,
  timeoutMs = 1_000,
} = {}) {
  let identity;
  try {
    validateSocketPath(socketPath);
    if (
      !Number.isInteger(timeoutMs)
      || timeoutMs < 1
      || timeoutMs > 5_000
    ) {
      fail('trusted_execution_transport_configuration_invalid');
    }
    identity = inspectSocket(socketPath);
    if (!HASH_PATTERN.test(expectedPlanDigest ?? '')) {
      fail('trusted_execution_plan_digest_unconfigured');
    }
  } catch (error) {
    const code = (
      error instanceof KernelTrustedExecutionClientError
      && typeof error.code === 'string'
    )
      ? error.code
      : 'trusted_execution_socket_unavailable';
    return Object.freeze({
      ready: false,
      code,
      socket_path: null,
    });
  }

  return new Promise((resolveReadiness) => {
    let settled = false;
    let ended = false;
    let response = Buffer.alloc(0);
    const challenge = randomBytes(32).toString('hex');
    const request = Object.freeze({
      schema_version:
        'kernel-equivalence-trusted-execution-readiness-challenge/v1',
      challenge,
      expected_plan_digest: expectedPlanDigest,
      brain_identity: 'cecelia.brain',
      service_identity:
        'brain.kernel_equivalence.trusted_execution',
      service_schema_version:
        'kernel-equivalence-trusted-execution-service/v1',
    });
    const socket = createConnection({ path: socketPath });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolveReadiness(Object.freeze(value));
    };
    const unavailable = () => finish({
      ready: false,
      code: 'trusted_execution_socket_unavailable',
      socket_path: null,
    });
    const timer = setTimeout(unavailable, timeoutMs);
    socket.once('error', unavailable);
    socket.once('connect', () => {
      try {
        sameSocket(socketPath, identity);
        socket.end(`${JSON.stringify(request)}\n`);
      } catch {
        unavailable();
      }
    });
    socket.on('data', (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > MAXIMUM_READINESS_RESPONSE_BYTES) {
        unavailable();
      }
    });
    socket.once('end', () => {
      ended = true;
      if (
        response.length < 2
        || response.at(-1) !== 0x0a
        || response.indexOf(0x0a) !== response.length - 1
      ) {
        unavailable();
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(
          response.subarray(0, response.length - 1).toString('utf8'),
        );
      } catch {
        unavailable();
        return;
      }
      if (
        !exactKeys(parsed, READINESS_RESPONSE_FIELDS)
        || parsed.schema_version
          !== 'kernel-equivalence-trusted-execution-readiness-response/v1'
        || parsed.status !== 'ready'
        || parsed.challenge !== challenge
        || parsed.brain_identity !== 'cecelia.brain'
        || parsed.service_identity
          !== 'brain.kernel_equivalence.trusted_execution'
        || parsed.service_schema_version
          !== 'kernel-equivalence-trusted-execution-service/v1'
        || parsed.plan_digest !== expectedPlanDigest
      ) {
        unavailable();
        return;
      }
      try {
        sameSocket(socketPath, identity);
        finish({
          ready: true,
          code: null,
          socket_path: socketPath,
        });
      } catch {
        unavailable();
      }
    });
    socket.once('close', () => {
      if (!settled && !ended) unavailable();
    });
  });
}

export function createUnixSocketTrustedExecutionTransport({
  socketPath = DEFAULT_SOCKET_PATH,
  timeoutMs = DEFAULT_CLIENT_DEADLINE_MS,
  maximumResponseBytes = MAXIMUM_RESPONSE_BYTES,
} = {}) {
  validateSocketPath(socketPath);
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAXIMUM_CLIENT_DEADLINE_MS
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
      let ended = false;
      let response = Buffer.alloc(0);
      const socket = createConnection({ path: socketPath });
      const totalTimer = setTimeout(() => {
        rejectCode('trusted_execution_socket_timeout');
      }, timeoutMs);
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        socket.destroy();
        callback(value);
      };
      const rejectCode = (code) => {
        settle(
          rejectResult,
          new KernelTrustedExecutionClientError(code),
        );
      };
      socket.once('error', () => {
        rejectCode('trusted_execution_socket_unavailable');
      });
      socket.once('connect', () => {
        try {
          sameSocket(socketPath, identity);
          socket.end(`${JSON.stringify(request)}\n`);
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
      });
      socket.once('end', () => {
        ended = true;
        if (
          response.length < 2
          || response.at(-1) !== 0x0a
          || response.indexOf(0x0a) !== response.length - 1
        ) {
          rejectCode('trusted_execution_response_invalid');
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(
            response.subarray(0, response.length - 1).toString('utf8'),
          );
        } catch {
          rejectCode('trusted_execution_response_invalid');
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          rejectCode('trusted_execution_response_invalid');
          return;
        }
        settle(resolveResult, Object.freeze(structuredClone(parsed)));
      });
      socket.once('close', () => {
        if (!settled && !ended) {
          rejectCode('trusted_execution_response_invalid');
        }
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
        const envelope = await transport(
          Object.freeze(structuredClone(request)),
        );
        return unwrapResponseEnvelope(envelope, request);
      } catch (error) {
        if (error instanceof KernelTrustedExecutionClientError) throw error;
        fail('trusted_execution_transport_failed');
      }
    },
  });
}

export const BRAIN_TRUSTED_EXECUTION_SOCKET_PATH = DEFAULT_SOCKET_PATH;
