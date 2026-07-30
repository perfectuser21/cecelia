import { access, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execPath } from 'node:process';
import { defaultAssertionExecute } from './gp-assertion-process.js';

const SHELL_META_PATTERN = /[;&|`$<>()"'\\]/;
const VITEST_PATH_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PYTEST_PATH_PATTERN = /(^|\/)test_[^/]+\.py$/;
const SMOKE_PATH_PATTERN = /\/smoke\/[^/]+\.sh$/;
const PYTHON_EXECUTABLE = '/usr/bin/python3';
const BASH_EXECUTABLE = '/bin/bash';

export function assertionRunnerError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isWithin(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== ''
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith('../')
    && !isAbsolute(pathFromRoot);
}

async function defaultPathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveOwnedPath(repoRoot, pathRef, realpathFn) {
  if (!pathRef || isAbsolute(pathRef) || pathRef.includes('\0')) {
    throw assertionRunnerError(
      'ASSERTION_PATH_ESCAPE',
      'Assertion path must be repository-relative',
    );
  }
  const root = await realpathFn(repoRoot);
  const candidate = resolve(root, pathRef);
  if (!isWithin(root, candidate)) {
    throw assertionRunnerError(
      'ASSERTION_PATH_ESCAPE',
      'Assertion path escapes repository root',
    );
  }
  let resolvedTarget;
  try {
    resolvedTarget = await realpathFn(candidate);
  } catch (error) {
    throw assertionRunnerError(
      'ASSERTION_PATH_UNAVAILABLE',
      `Assertion path cannot be resolved: ${error.message}`,
    );
  }
  if (!isWithin(root, resolvedTarget)) {
    throw assertionRunnerError(
      'ASSERTION_PATH_ESCAPE',
      'Assertion symlink escapes repository root',
    );
  }
  return { root, resolvedTarget };
}

async function findPackageRoot(target, repoRoot, pathExistsFn) {
  let current = dirname(target);
  while (current === repoRoot || isWithin(repoRoot, current)) {
    if (await pathExistsFn(join(current, 'package.json'))) return current;
    if (current === repoRoot) break;
    current = dirname(current);
  }
  throw assertionRunnerError(
    'ASSERTION_PACKAGE_NOT_FOUND',
    'Vitest assertion is not owned by a repository package',
  );
}

function classifyCommandShape(assertionRef) {
  const manual = assertionRef.startsWith('manual:');
  const command = manual ? assertionRef.slice('manual:'.length).trim() : '';
  if (manual && (!command || SHELL_META_PATTERN.test(command))) {
    throw assertionRunnerError(
      'UNSAFE_ASSERTION_COMMAND',
      'Manual assertion contains shell syntax',
    );
  }
  if (manual) {
    const parts = command.split(/\s+/);
    if (
      parts.length === 4
      && parts[0] === 'npx'
      && parts[1] === 'vitest'
      && parts[2] === 'run'
      && VITEST_PATH_PATTERN.test(parts[3])
    ) return { kind: 'vitest', pathRef: parts[3] };
    if (
      parts.length === 2
      && parts[0] === 'bash'
      && SMOKE_PATH_PATTERN.test(parts[1])
    ) return { kind: 'bash', pathRef: parts[1] };
    if (
      parts.length === 4
      && parts[0] === 'python3'
      && parts[1] === '-m'
      && parts[2] === 'pytest'
      && PYTEST_PATH_PATTERN.test(parts[3])
    ) return { kind: 'pytest', pathRef: parts[3] };
    throw assertionRunnerError(
      'UNSAFE_ASSERTION_COMMAND',
      'Manual assertion does not match the fixed command allowlist',
    );
  }
  if (VITEST_PATH_PATTERN.test(assertionRef)) {
    return { kind: 'vitest', pathRef: assertionRef };
  }
  if (PYTEST_PATH_PATTERN.test(assertionRef)) {
    return { kind: 'pytest', pathRef: assertionRef };
  }
  if (SMOKE_PATH_PATTERN.test(assertionRef)) {
    return { kind: 'bash', pathRef: assertionRef };
  }
  throw assertionRunnerError(
    'ASSERTION_NOT_RUNNABLE',
    'Assertion has no trusted executor',
  );
}

async function executeGit(repoRoot, argv) {
  return defaultAssertionExecute('git', argv, { cwd: repoRoot, shell: false });
}

function commandOptions(cwd, evidenceKind, toolchainPaths) {
  if (!toolchainPaths.every(isAbsolute)) {
    throw assertionRunnerError(
      'ASSERTION_TOOLCHAIN_INVALID',
      'Assertion toolchain paths must be absolute',
    );
  }
  return {
    cwd,
    shell: false,
    evidenceKind,
    toolchain_paths: toolchainPaths,
  };
}

export async function defaultTrackedPath(repoRoot, resolvedTarget) {
  const result = await executeGit(repoRoot, [
    'ls-files',
    '--error-unmatch',
    '--',
    relative(repoRoot, resolvedTarget),
  ]);
  return result.exitCode === 0;
}

export async function assertionCommand(
  assertionRef,
  repoRoot,
  {
    realpathFn = realpath,
    pathExistsFn = defaultPathExists,
    isTrackedPathFn = defaultTrackedPath,
    nodeExecutable = execPath,
  } = {},
) {
  const shape = classifyCommandShape(assertionRef);
  const { root, resolvedTarget } = await resolveOwnedPath(
    repoRoot,
    shape.pathRef,
    realpathFn,
  );
  if (!await isTrackedPathFn(root, resolvedTarget)) {
    throw assertionRunnerError(
      'ASSERTION_PATH_UNTRACKED',
      'Canonical assertion target must be tracked by git',
    );
  }
  if (shape.kind === 'vitest') {
    const executable = resolve(root, 'node_modules/.bin/vitest');
    const executableTarget = await realpathFn(executable);
    if (!isWithin(root, executableTarget)) {
      throw assertionRunnerError(
        'ASSERTION_PATH_ESCAPE',
        'Vitest executable escapes repository root',
      );
    }
    const nodeTarget = await realpathFn(nodeExecutable);
    const packageRoot = await findPackageRoot(resolvedTarget, root, pathExistsFn);
    const positionalTarget = `./${relative(packageRoot, resolvedTarget)}`;
    return {
      executable: nodeTarget,
      argv: [executableTarget, 'run', positionalTarget, '--'],
      options: commandOptions(
        packageRoot,
        'vitest',
        [nodeTarget, executableTarget],
      ),
    };
  }
  if (shape.kind === 'pytest') {
    const executable = await realpathFn(PYTHON_EXECUTABLE);
    return {
      executable,
      argv: ['-m', 'pytest', '--', relative(root, resolvedTarget)],
      options: commandOptions(root, 'pytest', [executable]),
    };
  }
  return {
    executable: BASH_EXECUTABLE,
    argv: [resolvedTarget],
    options: commandOptions(root, 'bash', [BASH_EXECUTABLE]),
  };
}

function stripGitSuffix(value) {
  return value.replace(/\/+$/, '').replace(/\.git$/i, '');
}

export function canonicalRepoIdentity(origin) {
  const value = String(origin ?? '').trim();
  if (!value) {
    throw assertionRunnerError(
      'SOURCE_REPO_UNAVAILABLE',
      'Git origin identity is required',
    );
  }
  if (value.includes('://')) {
    try {
      const parsed = new URL(value);
      if (!parsed.hostname || !parsed.pathname) throw new Error('missing origin');
      return `${parsed.hostname.toLowerCase()}/${stripGitSuffix(
        parsed.pathname.replace(/^\/+/, ''),
      )}`;
    } catch {
      throw assertionRunnerError(
        'SOURCE_REPO_UNAVAILABLE',
        'Git origin cannot be canonicalized',
      );
    }
  }
  const scp = value.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
  if (scp) return `${scp[1].toLowerCase()}/${stripGitSuffix(scp[2])}`;
  if (/^[^:/\s]+\.[^/\s]+\/.+/.test(value)) {
    const [host, ...path] = value.split('/');
    return `${host.toLowerCase()}/${stripGitSuffix(path.join('/'))}`;
  }
  throw assertionRunnerError(
    'SOURCE_REPO_UNAVAILABLE',
    'Git origin cannot be canonicalized',
  );
}

function requireGitResult(result, code, fallback) {
  if (result.exitCode !== 0) {
    throw assertionRunnerError(code, result.stderr || fallback);
  }
  return result.stdout.trim();
}

export async function defaultSourceSha(repoRoot) {
  return requireGitResult(
    await executeGit(repoRoot, ['rev-parse', 'HEAD']),
    'SOURCE_SHA_UNAVAILABLE',
    'git rev-parse failed',
  );
}

export async function defaultSourceRepo(repoRoot) {
  const origin = requireGitResult(
    await executeGit(repoRoot, ['remote', 'get-url', 'origin']),
    'SOURCE_REPO_UNAVAILABLE',
    'git remote get-url origin failed',
  );
  return canonicalRepoIdentity(origin);
}

export async function defaultRepoClean(repoRoot) {
  const status = requireGitResult(
    await executeGit(repoRoot, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ]),
    'SOURCE_STATE_UNAVAILABLE',
    'git status failed',
  );
  return status === '';
}
