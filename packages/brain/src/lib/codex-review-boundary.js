import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BRANCH_PATTERN =
  /^(?!-)(?!.*(?:^|\/)\.\.?($|\/))(?!.*(?:\.\.|@\{))[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REVIEW_IMAGE_TAG = 'cecelia-brain:latest';
const CONTAINER_WORKTREE = '/workspace';
const CONTAINER_AUTH_SOURCE = '/run/codex-auth';
const CONTAINER_HOME = '/home/cecelia';
const CONTAINER_CODEX_HOME = `${CONTAINER_HOME}/.codex`;
const CODEX_BOOTSTRAP = [
  'umask 077',
  `mkdir -p ${CONTAINER_CODEX_HOME}`,
  `cp ${CONTAINER_AUTH_SOURCE} ${CONTAINER_CODEX_HOME}/auth.json`,
  `chmod 600 ${CONTAINER_CODEX_HOME}/auth.json`,
  'exec /usr/local/bin/codex "$@"',
].join('; ');

export class CodexReviewBoundaryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CodexReviewBoundaryError';
    this.code = code;
  }
}

function fail(code) {
  throw new CodexReviewBoundaryError(code);
}

function bounded(value, maximum = 4_096) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\0\r\n]/.test(value)
  );
}

function inside(candidate, root) {
  return candidate.startsWith(`${root}${path.sep}`);
}

function assertMountSource(candidate, code) {
  if (
    !bounded(candidate)
    || !path.isAbsolute(candidate)
    || /[,\0\r\n]/.test(candidate)
  ) {
    fail(code);
  }
}

export function extractCodexReviewBranch(task = {}) {
  const candidates = [
    task.metadata?.branch,
    task.payload?.branch,
    task.payload?.head_branch,
    task.custom_props?.branch,
    task.branch,
    typeof task.title === 'string'
      ? task.title.replace(
        /^(?:Spec|Code|PRD|Initiative|Architecture|Arch|Decomp)?\s*Review:\s*/i,
        '',
      ).trim()
      : null,
  ];
  const branch = candidates.find((candidate) => bounded(candidate, 255));
  if (!branch || !BRANCH_PATTERN.test(branch)) {
    fail('review_branch_invalid');
  }
  return branch;
}

function defaultAllowedRoots(repoRoot) {
  return [
    path.join(repoRoot, '.claude', 'worktrees'),
    path.join(repoRoot, '.worktrees'),
    path.join(os.homedir(), 'worktrees'),
  ];
}

export function resolveCodexReviewWorktree({
  branch,
  repoRoot,
  allowedRoots = null,
  execute = execFileSync,
  resolveRealPath = realpathSync,
} = {}) {
  if (
    !bounded(branch, 255)
    || !BRANCH_PATTERN.test(branch)
    || !bounded(repoRoot)
    || !path.isAbsolute(repoRoot)
    || typeof execute !== 'function'
    || typeof resolveRealPath !== 'function'
  ) {
    fail('review_worktree_request_invalid');
  }

  let trustedRepoRoot;
  let output;
  try {
    trustedRepoRoot = resolveRealPath(repoRoot);
    output = execute(
      'git',
      ['-C', trustedRepoRoot, 'worktree', 'list', '--porcelain'],
      {
        encoding: 'utf8',
        maxBuffer: 512 * 1024,
        timeout: 10_000,
      },
    );
  } catch {
    fail('review_worktree_unavailable');
  }

  let candidate = null;
  let currentPath = null;
  for (const line of String(output).split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
    } else if (line === `branch refs/heads/${branch}`) {
      candidate = currentPath;
      break;
    }
  }
  if (!bounded(candidate) || !path.isAbsolute(candidate)) {
    fail('review_worktree_unavailable');
  }

  let trustedCandidate;
  let gitTopLevel;
  try {
    trustedCandidate = resolveRealPath(candidate);
    gitTopLevel = String(execute(
      'git',
      ['-C', trustedCandidate, 'rev-parse', '--show-toplevel'],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
      },
    )).trim();
    gitTopLevel = resolveRealPath(gitTopLevel);
  } catch {
    fail('review_worktree_unavailable');
  }

  const roots = (allowedRoots ?? defaultAllowedRoots(trustedRepoRoot))
    .map((root) => {
      try {
        return resolveRealPath(root);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (
    trustedCandidate === trustedRepoRoot
    || trustedCandidate !== gitTopLevel
    || roots.length === 0
    || !roots.some((root) => inside(trustedCandidate, root))
  ) {
    fail('review_worktree_outside_boundary');
  }
  assertMountSource(trustedCandidate, 'review_worktree_path_unsafe');
  return trustedCandidate;
}

export function resolveCodexReviewAuthFile({
  codexHome,
  resolveRealPath = realpathSync,
  inspect = lstatSync,
} = {}) {
  if (
    !bounded(codexHome)
    || !path.isAbsolute(codexHome)
    || typeof resolveRealPath !== 'function'
    || typeof inspect !== 'function'
  ) {
    fail('review_auth_home_invalid');
  }
  try {
    const trustedHome = resolveRealPath(codexHome);
    if (!/^\.codex-team[1-5]$/.test(path.basename(trustedHome))) {
      fail('review_auth_home_outside_boundary');
    }
    const candidate = path.join(trustedHome, 'auth.json');
    const metadata = inspect(candidate);
    if (
      metadata.isSymbolicLink()
      || !metadata.isFile()
      || metadata.nlink !== 1
      || (metadata.mode & 0o077) !== 0
    ) {
      fail('review_auth_file_unsafe');
    }
    const trustedAuth = resolveRealPath(candidate);
    if (path.dirname(trustedAuth) !== trustedHome) {
      fail('review_auth_file_unsafe');
    }
    assertMountSource(trustedAuth, 'review_auth_file_unsafe');
    return trustedAuth;
  } catch (error) {
    if (error instanceof CodexReviewBoundaryError) throw error;
    fail('review_auth_file_unavailable');
  }
}

export function resolveCodexReviewImage({
  dockerBin,
  execute = execFileSync,
} = {}) {
  if (
    !bounded(dockerBin)
    || !path.isAbsolute(dockerBin)
    || typeof execute !== 'function'
  ) {
    fail('review_container_runtime_invalid');
  }
  try {
    const imageId = String(execute(
      dockerBin,
      ['image', 'inspect', '--format', '{{.Id}}', REVIEW_IMAGE_TAG],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
        env: buildCodexReviewDockerEnvironment(process.env),
      },
    )).trim();
    if (!IMAGE_ID_PATTERN.test(imageId)) {
      fail('review_container_image_untrusted');
    }
    return imageId;
  } catch (error) {
    if (error instanceof CodexReviewBoundaryError) throw error;
    fail('review_container_image_unavailable');
  }
}

export function buildCodexReviewArguments() {
  return Object.freeze([
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '-c',
    'approval_policy="never"',
    '-',
  ]);
}

export function buildCodexReviewDockerEnvironment(source = {}) {
  const result = Object.create(null);
  result.PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  if (
    bounded(source.DOCKER_HOST)
    && /^(?:unix:\/\/\/|npipe:\/\/\/)[^\0\r\n]{1,1000}$/.test(source.DOCKER_HOST)
  ) {
    result.DOCKER_HOST = source.DOCKER_HOST;
  }
  result.HOME = '/nonexistent';
  result.TMPDIR = '/tmp';
  return Object.freeze(result);
}

export function buildCodexReviewDockerArguments({
  worktreePath,
  authFilePath,
  imageId,
} = {}) {
  assertMountSource(worktreePath, 'review_worktree_path_unsafe');
  assertMountSource(authFilePath, 'review_auth_file_unsafe');
  if (!IMAGE_ID_PATTERN.test(imageId ?? '')) {
    fail('review_container_image_untrusted');
  }
  return Object.freeze([
    'run',
    '--rm',
    '--init',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit', '128',
    '--memory', '1g',
    '--cpus', '1',
    '--user', '1001:1001',
    '--network', 'bridge',
    '--workdir', CONTAINER_WORKTREE,
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
    '--tmpfs', `${CONTAINER_HOME}:rw,noexec,nosuid,nodev,size=64m,mode=700,uid=1001,gid=1001`,
    '--mount', `type=bind,src=${worktreePath},dst=${CONTAINER_WORKTREE},readonly`,
    '--mount', `type=bind,src=${authFilePath},dst=${CONTAINER_AUTH_SOURCE},readonly`,
    '--env', `HOME=${CONTAINER_HOME}`,
    '--env', `CODEX_HOME=${CONTAINER_CODEX_HOME}`,
    '--entrypoint', '/bin/sh',
    imageId,
    '-ceu',
    CODEX_BOOTSTRAP,
    'codex-review',
    ...buildCodexReviewArguments(),
  ]);
}
