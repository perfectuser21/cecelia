import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { WORKSPACE_REPOSITORIES } from './workspace-spec.js';

const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/;
const GIT_OPTIONS = Object.freeze({
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  timeout: 60_000,
});

/** 权威仓库 → 只读远端 URL（跨 repo 批准产物按精确 SHA 取，不落任何可变引用）。 */
function defaultRemoteUrlForRepo(repo) {
  return `https://github.com/${repo}.git`;
}

/**
 * 权威仓库 = Kernel workspace 边界同一张 allow-list（workspace-spec.js
 * WORKSPACE_REPOSITORIES）。只校验 owner/repo 形状不够——形状合法的第三方仓库
 * 同样会被当成合同产物来源；此处与 workspace_repo_not_supported 用同一信任边界。
 */
function assertSupportedRepo(repo) {
  if (!GITHUB_REPO.test(String(repo)) || !WORKSPACE_REPOSITORIES.includes(repo)) {
    throw new Error(`git artifact repo must be a supported authoritative repository: ${String(repo)}`);
  }
}

function originRepo(cwd) {
  let url;
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, ...GIT_OPTIONS });
  } catch {
    return null;
  }
  const match = String(url).trim()
    .match(/^(?:https:\/\/[^/]+\/|git@[^:]+:|ssh:\/\/[^/]+\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * 决定从哪个远端取批准 SHA：
 * - 无 repo（本仓 legacy 流）→ origin，行为不变
 * - repo 就是本仓 origin → 仍走 origin（保留本仓凭据/配置语义）
 * - 跨仓库 repo → 该仓库权威 URL（生产实弹 run 4925488b：批准 SHA 只在 zenithjoy-workspace）
 */
function resolveFetchRemote(cwd, repo, remoteUrlForRepo) {
  if (repo == null) return 'origin';
  assertSupportedRepo(repo);
  return originRepo(cwd) === repo.toLowerCase() ? 'origin' : remoteUrlForRepo(repo);
}

function assertRepositoryRelative(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')
      || filePath.includes('\\') || path.posix.isAbsolute(filePath)
      || filePath.split('/').includes('..')) {
    throw new Error(`git artifact path must be repository-relative: ${String(filePath)}`);
  }
}

/** Ensure an immutable commit exists locally, fetching the exact SHA when needed. */
export function ensureGitCommit(commitSha, {
  cwd = process.cwd(),
  repo = null,
  remoteUrlForRepo = defaultRemoteUrlForRepo,
} = {}) {
  if (typeof commitSha !== 'string' || !COMMIT_SHA.test(commitSha)) {
    throw new Error(`git artifact ref must be a full commit SHA: ${String(commitSha)}`);
  }
  const remote = resolveFetchRemote(cwd, repo, remoteUrlForRepo);
  try {
    execFileSync('git', ['cat-file', '-e', `${commitSha}^{commit}`], {
      cwd,
      ...GIT_OPTIONS,
      stdio: 'ignore',
    });
  } catch {
    execFileSync(
      'git',
      ['fetch', '--no-tags', '--no-write-fetch-head', remote, commitSha],
      { cwd, ...GIT_OPTIONS },
    );
  }
  return commitSha;
}

/** Read an immutable blob from Git without invoking a shell. */
export function readGitArtifact(commitSha, filePath, {
  cwd = process.cwd(),
  repo = null,
  remoteUrlForRepo = defaultRemoteUrlForRepo,
} = {}) {
  assertRepositoryRelative(filePath);
  ensureGitCommit(commitSha, { cwd, repo, remoteUrlForRepo });

  return execFileSync('git', ['show', `${commitSha}:${filePath}`], {
    cwd,
    ...GIT_OPTIONS,
  });
}

/** List immutable paths below a repository-relative prefix at an exact commit. */
export function listGitArtifacts(commitSha, prefix, {
  cwd = process.cwd(),
  repo = null,
  remoteUrlForRepo = defaultRemoteUrlForRepo,
} = {}) {
  assertRepositoryRelative(prefix);
  ensureGitCommit(commitSha, { cwd, repo, remoteUrlForRepo });
  return execFileSync('git', ['ls-tree', '-r', '--name-only', commitSha, '--', prefix], {
    cwd,
    ...GIT_OPTIONS,
  }).split('\n').map((line) => line.trim()).filter(Boolean);
}

export const __test__ = { COMMIT_SHA, assertRepositoryRelative };
