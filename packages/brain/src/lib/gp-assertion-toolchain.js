import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  assertionRunnerError, isTrustedAssertionCommand,
} from './gp-assertion-command.js';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const ROOT_KEYS = ['kind', 'actual_runner_digest', 'expected_runner_digest', 'files'];
const FILE_KEYS = ['path', 'sha256'];
const trusted = new WeakSet();
const commandBindings = new WeakMap();
const issuedErrors = new WeakSet();
function toolchainError(code, message, details = {}) {
  const error = Object.assign(assertionRunnerError(code, message), details);
  issuedErrors.add(error);
  return error;
}
function fail(code, message, details) { throw toolchainError(code, message, details); }
function validateRunnerDigests(actual, expected) {
  if (!actual || !expected) {
    fail('ASSERTION_RUNNER_DIGEST_REQUIRED', 'Phase 4A Runner digests are required');
  }
  if (typeof actual !== 'string' || typeof expected !== 'string'
    || !DIGEST.test(actual) || !DIGEST.test(expected)) {
    fail('ASSERTION_RUNNER_DIGEST_INVALID', 'Runner digests must be lowercase sha256');
  }
  if (actual !== expected) {
    fail('ASSERTION_RUNNER_DIGEST_MISMATCH', 'Runner digest does not match NodeProfile');
  }
}
function commandTools(command) {
  if (!isTrustedAssertionCommand(command)) {
    fail('ASSERTION_COMMAND_UNTRUSTED', 'Assertion command is untrusted');
  }
  const tools = command.options.toolchain;
  if (!Array.isArray(tools) || tools.length === 0
    || tools.some(tool => typeof tool?.path !== 'string' || !isAbsolute(tool.path)
      || typeof tool.sha256 !== 'string' || !DIGEST.test(tool.sha256))) {
    fail('ASSERTION_TOOLCHAIN_DIGEST_INVALID', 'Pinned tool digests are required');
  }
  return tools;
}
function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}
function validateAttestation(value) {
  if (!exactObject(value, ROOT_KEYS) || value.kind !== 'pinned_toolchain'
    || !Array.isArray(value.files) || value.files.length === 0
    || value.files.some(file => (
      !exactObject(file, FILE_KEYS) || typeof file.path !== 'string'
      || !isAbsolute(file.path) || typeof file.sha256 !== 'string'
      || !DIGEST.test(file.sha256)
    ))) {
    fail('ASSERTION_TOOLCHAIN_ATTESTATION_INVALID', 'Attestation schema is invalid');
  }
  validateRunnerDigests(value.actual_runner_digest, value.expected_runner_digest);
}
function safeStats(stats, maxFileBytes) {
  if (!stats?.isFile?.()) fail('ASSERTION_TOOLCHAIN_FILE_NOT_REGULAR');
  if (stats.size === 0n) fail('ASSERTION_TOOLCHAIN_FILE_EMPTY');
  if (typeof stats.size !== 'bigint' || stats.size < 0n
    || stats.size > BigInt(maxFileBytes)) {
    fail('ASSERTION_TOOLCHAIN_FILE_TOO_LARGE');
  }
}
function sameFile(before, after) {
  return ['dev', 'ino', 'size', 'ctimeNs', 'mtimeNs']
    .every(key => before[key] === after[key]);
}
function checkedRead(result, requested) {
  const count = result?.bytesRead;
  if (!Number.isInteger(count) || count < 0 || count > requested) {
    fail('ASSERTION_TOOLCHAIN_UNAVAILABLE', 'Pinned toolchain read failed');
  }
  return count;
}
async function readSnapshot(handle, before, maxFileBytes) {
  safeStats(before, maxFileBytes);
  const length = Number(before.size);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let position = 0;
  while (position < length) {
    const requested = Math.min(buffer.length, length - position);
    const count = checkedRead(
      await handle.read(buffer, 0, requested, position), requested,
    );
    if (count === 0) fail('ASSERTION_TOOLCHAIN_UNAVAILABLE', 'Unexpected EOF');
    hash.update(buffer.subarray(0, count));
    position += count;
  }
  const extra = Buffer.allocUnsafe(1);
  if (checkedRead(await handle.read(extra, 0, 1, position), 1) !== 0) {
    fail('ASSERTION_TOOLCHAIN_CHANGED_DURING_READ');
  }
  const after = await handle.stat({ bigint: true });
  if (!after?.isFile?.() || !sameFile(before, after)) {
    fail('ASSERTION_TOOLCHAIN_CHANGED_DURING_READ');
  }
  return `sha256:${hash.digest('hex')}`;
}
function normalizeCreate(error) {
  if (issuedErrors.has(error)) return error;
  return toolchainError(
    'ASSERTION_TOOLCHAIN_UNAVAILABLE', 'Pinned toolchain file is unavailable',
  );
}
async function attestFile(tool, { openFn, maxFileBytes }) {
  let handle;
  let result;
  let primary;
  try {
    handle = await openFn(tool.path,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const sha256 = await readSnapshot(handle, before, maxFileBytes);
    if (sha256 !== tool.sha256) {
      fail('ASSERTION_TOOLCHAIN_DIGEST_MISMATCH', 'Pinned tool digest mismatched');
    }
    result = Object.freeze({ path: tool.path, sha256 });
  } catch (error) {
    primary = normalizeCreate(error);
  }
  try {
    await handle?.close();
  } catch (error) {
    if (!primary) primary = normalizeCreate(error);
  }
  if (primary) throw primary;
  return result;
}
function dependencies(overrides = {}) {
  const maxFileBytes = overrides.maxFileBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    fail('ASSERTION_TOOLCHAIN_LIMIT_INVALID', 'Toolchain byte limit is invalid');
  }
  return {
    openFn: overrides.openFn ?? open,
    maxFileBytes,
  };
}
function freezeAttestation(actual, expected, files, command) {
  const value = Object.freeze({
    kind: 'pinned_toolchain',
    actual_runner_digest: actual,
    expected_runner_digest: expected,
    files: Object.freeze(files),
  });
  trusted.add(value);
  commandBindings.set(value, command);
  return value;
}
export async function createToolchainAttestation(input, overrides = {}) {
  const actual = input?.actual_runner_digest;
  const expected = input?.expected_runner_digest;
  validateRunnerDigests(actual, expected);
  const command = input?.command;
  const tools = commandTools(command);
  const deps = dependencies(overrides);
  const files = [];
  for (const tool of tools) files.push(await attestFile(tool, deps));
  return freezeAttestation(actual, expected, files, command);
}
export async function verifyToolchainAttestation(attestation, overrides = {}) {
  if (attestation === null || (typeof attestation !== 'object'
    && typeof attestation !== 'function') || !trusted.has(attestation)) {
    fail('ASSERTION_TOOLCHAIN_ATTESTATION_UNTRUSTED', 'Attestation baseline is untrusted');
  }
  validateAttestation(attestation);
  const command = commandBindings.get(attestation);
  const tools = commandTools(command);
  if (tools.length !== attestation.files.length) fail('ASSERTION_TOOLCHAIN_DRIFT');
  const deps = dependencies(overrides);
  const files = [];
  for (let index = 0; index < attestation.files.length; index += 1) {
    const expected = attestation.files[index];
    const tool = tools[index];
    if (tool.path !== expected.path || tool.sha256 !== expected.sha256) {
      fail('ASSERTION_TOOLCHAIN_DRIFT', 'Toolchain baseline drifted');
    }
    let actual;
    try {
      actual = await attestFile(tool, deps);
    } catch {
      fail('ASSERTION_TOOLCHAIN_DRIFT', 'Toolchain file is unavailable', {
        path: expected.path,
      });
    }
    if (actual.path !== expected.path || actual.sha256 !== expected.sha256) {
      fail('ASSERTION_TOOLCHAIN_DRIFT', 'Toolchain file drifted', {
        path: expected.path,
      });
    }
    files.push(actual);
  }
  return freezeAttestation(
    attestation.actual_runner_digest,
    attestation.expected_runner_digest,
    files,
    command,
  );
}
