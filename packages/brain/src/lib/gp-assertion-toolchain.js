import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { assertionRunnerError } from './gp-assertion-command.js';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ATTESTATION_KEYS = [
  'kind', 'actual_runner_digest', 'expected_runner_digest', 'files',
];
const FILE_KEYS = ['path', 'sha256'];
const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024;
const HASH_CHUNK_BYTES = 64 * 1024;

function fail(code, message = code, details = {}) {
  return Object.assign(assertionRunnerError(code, message), details);
}

function validateRunnerDigests(actual, expected) {
  if (!actual || !expected) {
    throw fail(
      'ASSERTION_RUNNER_DIGEST_REQUIRED',
      'Phase 4A actual and expected Runner digests are required',
    );
  }
  if (!DIGEST_PATTERN.test(actual) || !DIGEST_PATTERN.test(expected)) {
    throw fail(
      'ASSERTION_RUNNER_DIGEST_INVALID',
      'Runner digests must be lowercase sha256 values',
    );
  }
  if (actual !== expected) {
    throw fail(
      'ASSERTION_RUNNER_DIGEST_MISMATCH',
      'Actual Runner digest does not match the pinned NodeProfile digest',
    );
  }
}

function validatePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw fail(
      'ASSERTION_TOOLCHAIN_PATHS_REQUIRED',
      'At least one pinned toolchain path is required',
    );
  }
  const invalidIndex = paths.findIndex(path => (
    typeof path !== 'string' || !isAbsolute(path)
  ));
  if (invalidIndex >= 0) {
    throw fail(
      'ASSERTION_TOOLCHAIN_PATH_INVALID',
      'Toolchain paths must be absolute',
      { path: paths[invalidIndex] },
    );
  }
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

export function validateToolchainEvidence(
  evidence,
  { expectedRunnerDigest, expectedPaths } = {},
) {
  validateRunnerDigests(evidence?.actual_runner_digest, expectedRunnerDigest);
  validateRunnerDigests(evidence?.expected_runner_digest, expectedRunnerDigest);
  validatePaths(expectedPaths);
  const files = evidence?.files;
  const paths = Array.isArray(files) ? files.map(file => file?.path) : [];
  if (!hasExactKeys(evidence, ATTESTATION_KEYS)
    || evidence.kind !== 'pinned_toolchain'
    || new Set(expectedPaths).size !== expectedPaths.length
    || !Array.isArray(files)
    || files.length !== expectedPaths.length
    || new Set(paths).size !== paths.length
    || files.some((file, index) => (
      !hasExactKeys(file, FILE_KEYS)
      || file.path !== expectedPaths[index]
      || !DIGEST_PATTERN.test(file.sha256 ?? '')
    ))) {
    throw fail(
      'ASSERTION_TOOLCHAIN_DRIFT',
      'Trusted Runner toolchain evidence does not match the requested paths',
    );
  }
  return Object.freeze({
    kind: evidence.kind,
    actual_runner_digest: evidence.actual_runner_digest,
    expected_runner_digest: evidence.expected_runner_digest,
    files: Object.freeze(files.map(file => Object.freeze({ ...file }))),
  });
}

async function attestFile(path, { realpathFn, openFn, maxFileBytes }) {
  const canonicalPath = await realpathFn(path);
  if (!isAbsolute(canonicalPath)) {
    throw fail(
      'ASSERTION_TOOLCHAIN_PATH_INVALID',
      'Canonical toolchain paths must be absolute',
      { path },
    );
  }
  try {
    let handle;
    try {
      handle = await openFn(canonicalPath, constants.O_RDONLY
        | constants.O_NONBLOCK);
      const stats = await handle.stat();
      if (!stats.isFile()) {
        throw fail(
          'ASSERTION_TOOLCHAIN_FILE_NOT_REGULAR',
          undefined,
          { path: canonicalPath },
        );
      }
      if (stats.size === 0) {
        throw fail(
          'ASSERTION_TOOLCHAIN_FILE_EMPTY',
          undefined,
          { path: canonicalPath },
        );
      }
      if (stats.size > maxFileBytes) {
        throw fail(
          'ASSERTION_TOOLCHAIN_FILE_TOO_LARGE',
          undefined,
          { path: canonicalPath, size: stats.size, max_file_bytes: maxFileBytes },
        );
      }
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
      let total = 0;
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxFileBytes) {
          throw fail(
            'ASSERTION_TOOLCHAIN_FILE_TOO_LARGE',
            undefined,
            { path: canonicalPath, max_file_bytes: maxFileBytes },
          );
        }
        hash.update(buffer.subarray(0, bytesRead));
      }
      if (total === 0) {
        throw fail(
          'ASSERTION_TOOLCHAIN_FILE_EMPTY',
          undefined,
          { path: canonicalPath },
        );
      }
      return { path: canonicalPath, sha256: `sha256:${hash.digest('hex')}` };
    } finally {
      await handle?.close();
    }
  } catch (cause) {
    if (String(cause?.code).startsWith('ASSERTION_')) throw cause;
    throw fail(
      'ASSERTION_TOOLCHAIN_FILE_UNREADABLE',
      undefined,
      { path: canonicalPath, cause },
    );
  }
}

function dependencies(overrides = {}) {
  return {
    realpathFn: overrides.realpathFn ?? realpath,
    openFn: overrides.openFn ?? open,
    maxFileBytes: overrides.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  };
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
  return {
    kind: 'pinned_toolchain',
    actual_runner_digest: actual,
    expected_runner_digest: expected,
    files,
  };
}

export async function verifyToolchainAttestation(
  attestation,
  overrides = {},
) {
  validateRunnerDigests(
    attestation?.actual_runner_digest,
    attestation?.expected_runner_digest,
  );
  const files = attestation?.files;
  validatePaths(files?.map(file => file?.path));
  const deps = dependencies(overrides);
  for (const expected of files) {
    let actual;
    try {
      actual = await attestFile(expected.path, deps);
    } catch (cause) {
      throw fail(
        'ASSERTION_TOOLCHAIN_DRIFT',
        `Toolchain file is unavailable after execution: ${expected.path}`,
        { path: expected.path, cause },
      );
    }
    if (
      !DIGEST_PATTERN.test(expected.sha256)
      || actual.path !== expected.path
      || actual.sha256 !== expected.sha256
    ) {
      throw fail(
        'ASSERTION_TOOLCHAIN_DRIFT',
        `Toolchain file drifted during assertion: ${expected.path}`,
        { path: expected.path },
      );
    }
  }
  return attestation;
}
