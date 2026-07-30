import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { assertionRunnerError } from './gp-assertion-command.js';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ROOT_KEYS = ['kind', 'actual_runner_digest', 'expected_runner_digest', 'files'];
const FILE_KEYS = ['path', 'sha256'];
const trusted = new WeakSet();
function toolchainError(code, message, details = {}) {
  return Object.assign(assertionRunnerError(code, message), details);
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
function validatePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    fail('ASSERTION_TOOLCHAIN_PATHS_REQUIRED', 'Pinned toolchain paths are required');
  }
  const invalid = paths.findIndex(path => typeof path !== 'string' || !isAbsolute(path));
  if (invalid >= 0) {
    fail('ASSERTION_TOOLCHAIN_PATH_INVALID', 'Toolchain paths must be absolute', {
      path: paths[invalid],
    });
  }
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
async function attestFile(path, { realpathFn, readFileFn }) {
  try {
    const canonicalPath = await realpathFn(path);
    if (!isAbsolute(canonicalPath)) {
      fail('ASSERTION_TOOLCHAIN_PATH_INVALID', 'Canonical path must be absolute', { path });
    }
    const bytes = await readFileFn(canonicalPath);
    return Object.freeze({
      path: canonicalPath,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  } catch (error) {
    if (String(error?.code).startsWith('ASSERTION_')) throw error;
    fail('ASSERTION_TOOLCHAIN_UNAVAILABLE', 'Pinned toolchain file is unavailable', { path });
  }
}
function dependencies(overrides = {}) {
  return {
    realpathFn: overrides.realpathFn ?? realpath,
    readFileFn: overrides.readFileFn ?? readFile,
  };
}
function freezeAttestation(actual, expected, files) {
  const value = Object.freeze({
    kind: 'pinned_toolchain',
    actual_runner_digest: actual,
    expected_runner_digest: expected,
    files: Object.freeze(files),
  });
  trusted.add(value);
  return value;
}
export async function createToolchainAttestation(input, overrides = {}) {
  const actual = input?.actual_runner_digest;
  const expected = input?.expected_runner_digest;
  const paths = input?.toolchain_paths;
  validateRunnerDigests(actual, expected);
  validatePaths(paths);
  const deps = dependencies(overrides);
  const files = [];
  for (const path of paths) files.push(await attestFile(path, deps));
  return freezeAttestation(actual, expected, files);
}
export async function verifyToolchainAttestation(attestation, overrides = {}) {
  validateAttestation(attestation);
  if (!trusted.has(attestation)) {
    fail('ASSERTION_TOOLCHAIN_ATTESTATION_UNTRUSTED', 'Attestation baseline is untrusted');
  }
  const deps = dependencies(overrides);
  const files = [];
  for (const expected of attestation.files) {
    let actual;
    try {
      actual = await attestFile(expected.path, deps);
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
  );
}
