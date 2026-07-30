import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
const runFile = promisify(execFile);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SHELL_META = /[;&|`$<>()"'\\]/;
const VITEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PYTEST = /(^|\/)test_[^/]+\.py$/;
const SMOKE = /\/smoke\/[^/]+\.sh$/;
const TOOL_NAMES = new Set(['node', 'vitest', 'python', 'bash']);
const TOOL_BASENAME = {
  node: /^node(?:[-.].*)?$/,
  vitest: /^vitest(?:\.mjs)?$/,
  python: /^python3(?:\.\d+)*$/,
  bash: /^bash$/,
};
export function assertionRunnerError(code, message = code) {
  return Object.assign(new Error(message), { code });
}
function fail(code, message) { throw assertionRunnerError(code, message); }
function isWithin(root, target) {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith('../')
    && !isAbsolute(path);
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function ownedPath(repoRoot, pathRef, realpathFn) {
  if (!pathRef || isAbsolute(pathRef) || pathRef.includes('\0')) {
    fail('ASSERTION_PATH_ESCAPE', 'Assertion path must be repository-relative');
  }
  const root = await realpathFn(repoRoot);
  const candidate = resolve(root, pathRef);
  if (!isWithin(root, candidate)) fail('ASSERTION_PATH_ESCAPE');
  let target;
  try {
    target = await realpathFn(candidate);
  } catch (error) {
    fail('ASSERTION_PATH_UNAVAILABLE', `Cannot resolve assertion: ${error.message}`);
  }
  if (!isWithin(root, target)) fail('ASSERTION_PATH_ESCAPE');
  return { root, target };
}
async function packageRoot(target, root, pathExistsFn) {
  for (let current = dirname(target); isWithin(root, current) || current === root;
    current = dirname(current)) {
    if (await pathExistsFn(join(current, 'package.json'))) return current;
    if (current === root) break;
  }
  fail('ASSERTION_PACKAGE_NOT_FOUND');
}
function classify(ref) {
  if (typeof ref !== 'string') fail('ASSERTION_NOT_RUNNABLE');
  if (ref.startsWith('manual:')) {
    const command = ref.slice(7).trim();
    if (!command || SHELL_META.test(command)) fail('UNSAFE_ASSERTION_COMMAND');
    const parts = command.split(/\s+/);
    if (parts.length === 4 && parts.slice(0, 3).join(' ') === 'npx vitest run'
      && VITEST.test(parts[3])) return { kind: 'vitest', path: parts[3] };
    if (parts.length === 4 && parts.slice(0, 3).join(' ') === 'python3 -m pytest'
      && PYTEST.test(parts[3])) return { kind: 'pytest', path: parts[3] };
    if (parts.length === 2 && parts[0] === 'bash' && SMOKE.test(parts[1])) {
      return { kind: 'bash', path: parts[1] };
    }
    fail('UNSAFE_ASSERTION_COMMAND');
  }
  if (VITEST.test(ref)) return { kind: 'vitest', path: ref };
  if (PYTEST.test(ref)) return { kind: 'pytest', path: ref };
  if (SMOKE.test(ref)) return { kind: 'bash', path: ref };
  fail('ASSERTION_NOT_RUNNABLE');
}
async function pinnedTools(toolchains, names, realpathFn) {
  if (!toolchains || typeof toolchains !== 'object' || Array.isArray(toolchains)) {
    fail('ASSERTION_TOOLCHAIN_REQUIRED');
  }
  const canonical = {};
  for (const [name, descriptor] of Object.entries(toolchains)) {
    if (!TOOL_NAMES.has(name) || !descriptor || typeof descriptor !== 'object'
      || Array.isArray(descriptor)) fail('ASSERTION_TOOLCHAIN_INVALID');
    const keys = Object.keys(descriptor);
    if (!keys.includes('path') || keys.some(key => !['path', 'sha256'].includes(key))) {
      fail('ASSERTION_TOOLCHAIN_INVALID');
    }
    if (!isAbsolute(descriptor.path)) fail('ASSERTION_TOOLCHAIN_PATH_INVALID');
    if (descriptor.sha256 !== undefined && !SHA256.test(descriptor.sha256)) {
      fail('ASSERTION_TOOLCHAIN_DIGEST_INVALID');
    }
    const path = await realpathFn(descriptor.path);
    if (!isAbsolute(path) || !TOOL_BASENAME[name].test(basename(path))) {
      fail('ASSERTION_TOOLCHAIN_PATH_INVALID');
    }
    canonical[name] = Object.freeze({
      name, path, ...(descriptor.sha256 ? { sha256: descriptor.sha256 } : {}),
    });
  }
  if (names.some(name => !canonical[name])) fail('ASSERTION_TOOLCHAIN_REQUIRED');
  const selected = names.map(name => canonical[name]);
  if (new Set(selected.map(tool => tool.path)).size !== selected.length) {
    fail('ASSERTION_TOOLCHAIN_PATH_INVALID');
  }
  return Object.freeze(selected);
}
function command(executable, argv, cwd, kind, toolchain) {
  return Object.freeze({
    executable,
    argv: Object.freeze(argv),
    options: Object.freeze({
      cwd,
      shell: false,
      evidenceKind: kind,
      toolchain,
      env: Object.freeze({ inherit: false, allowlist: Object.freeze([]) }),
    }),
  });
}
async function git(repoRoot, argv) {
  try {
    return await runFile('/usr/bin/git', argv, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C' },
    });
  } catch (error) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? error.message,
      exitCode: Number.isInteger(error.code) ? error.code : 1 };
  }
}
export async function defaultTrackedPath(repoRoot, target) {
  const result = await git(repoRoot, [
    'ls-files', '--error-unmatch', '--', relative(repoRoot, target),
  ]);
  return result.exitCode === undefined;
}
export async function assertionCommand(assertionRef, repoRoot, {
  realpathFn = realpath,
  pathExistsFn = exists,
  isTrackedPathFn = defaultTrackedPath,
  toolchains,
} = {}) {
  const shape = classify(assertionRef);
  const { root, target } = await ownedPath(repoRoot, shape.path, realpathFn);
  if (!await isTrackedPathFn(root, target)) fail('ASSERTION_PATH_UNTRACKED');
  if (shape.kind === 'vitest') {
    const tools = await pinnedTools(toolchains, ['node', 'vitest'], realpathFn);
    const cwd = await packageRoot(target, root, pathExistsFn);
    return command(tools[0].path, [
      tools[1].path, 'run', `./${relative(cwd, target)}`, '--',
    ], cwd, 'vitest', tools);
  }
  if (shape.kind === 'pytest') {
    const tools = await pinnedTools(toolchains, ['python'], realpathFn);
    return command(tools[0].path, [
      '-m', 'pytest', '--', relative(root, target),
    ], root, 'pytest', tools);
  }
  const tools = await pinnedTools(toolchains, ['bash'], realpathFn);
  return command(tools[0].path, [target], root, 'bash', tools);
}
function cleanRepo(value) {
  return value.replace(/\/+$/, '').replace(/\.git$/i, '');
}
export function canonicalRepoIdentity(origin) {
  const value = String(origin ?? '').trim();
  if (!value) fail('SOURCE_REPO_UNAVAILABLE');
  if (value.includes('://')) {
    try {
      const url = new URL(value);
      if (!url.hostname || !url.pathname) throw new Error();
      return `${url.hostname.toLowerCase()}/${cleanRepo(
        url.pathname.replace(/^\/+/, ''),
      )}`;
    } catch {
      fail('SOURCE_REPO_UNAVAILABLE');
    }
  }
  const scp = value.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
  if (scp) return `${scp[1].toLowerCase()}/${cleanRepo(scp[2])}`;
  if (/^[^:/\s]+\.[^/\s]+\/.+/.test(value)) {
    const [host, ...path] = value.split('/');
    return `${host.toLowerCase()}/${cleanRepo(path.join('/'))}`;
  }
  fail('SOURCE_REPO_UNAVAILABLE');
}
async function gitValue(repoRoot, argv, code) {
  const result = await git(repoRoot, argv);
  if (result.exitCode !== undefined) fail(code, result.stderr);
  return result.stdout.trim();
}
export const defaultSourceSha = repoRoot => (
  gitValue(repoRoot, ['rev-parse', 'HEAD'], 'SOURCE_SHA_UNAVAILABLE')
);
export async function defaultSourceRepo(repoRoot) {
  return canonicalRepoIdentity(await gitValue(
    repoRoot, ['remote', 'get-url', 'origin'], 'SOURCE_REPO_UNAVAILABLE',
  ));
}
export async function defaultRepoClean(repoRoot) {
  return (await gitValue(
    repoRoot,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'SOURCE_STATE_UNAVAILABLE',
  )) === '';
}
