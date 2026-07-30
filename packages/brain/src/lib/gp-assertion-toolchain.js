import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { assertionRunnerError } from './gp-assertion-command.js';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function toolchainError(code, message, details = {}) {
  return Object.assign(assertionRunnerError(code, message), details);
}

function validateRunnerDigests(actual, expected) {
  if (!actual || !expected) {
    throw toolchainError(
      'ASSERTION_RUNNER_DIGEST_REQUIRED',
      'Phase 4A actual and expected Runner digests are required',
    );
  }
  if (!DIGEST_PATTERN.test(actual) || !DIGEST_PATTERN.test(expected)) {
    throw toolchainError(
      'ASSERTION_RUNNER_DIGEST_INVALID',
      'Runner digests must be lowercase sha256 values',
    );
  }
  if (actual !== expected) {
    throw toolchainError(
      'ASSERTION_RUNNER_DIGEST_MISMATCH',
      'Actual Runner digest does not match the pinned NodeProfile digest',
    );
  }
}

function validatePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw toolchainError(
      'ASSERTION_TOOLCHAIN_PATHS_REQUIRED',
      'At least one pinned toolchain path is required',
    );
  }
  const invalidIndex = paths.findIndex(path => (
    typeof path !== 'string' || !isAbsolute(path)
  ));
  if (invalidIndex >= 0) {
    throw toolchainError(
      'ASSERTION_TOOLCHAIN_PATH_INVALID',
      'Toolchain paths must be absolute',
      { path: paths[invalidIndex] },
    );
  }
}

async function attestFile(path, { realpathFn, readFileFn }) {
  const canonicalPath = await realpathFn(path);
  if (!isAbsolute(canonicalPath)) {
    throw toolchainError(
      'ASSERTION_TOOLCHAIN_PATH_INVALID',
      'Canonical toolchain paths must be absolute',
      { path },
    );
  }
  const bytes = await readFileFn(canonicalPath);
  return {
    path: canonicalPath,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function dependencies(overrides = {}) {
  return {
    realpathFn: overrides.realpathFn ?? realpath,
    readFileFn: overrides.readFileFn ?? readFile,
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
      throw toolchainError(
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
      throw toolchainError(
        'ASSERTION_TOOLCHAIN_DRIFT',
        `Toolchain file drifted during assertion: ${expected.path}`,
        { path: expected.path },
      );
    }
  }
  return attestation;
}
