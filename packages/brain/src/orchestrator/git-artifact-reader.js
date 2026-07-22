import { execFileSync } from 'node:child_process';
import path from 'node:path';

const COMMIT_SHA = /^[a-f0-9]{40}$/i;

function assertRepositoryRelative(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')
      || filePath.includes('\\') || path.posix.isAbsolute(filePath)
      || filePath.split('/').includes('..')) {
    throw new Error(`git artifact path must be repository-relative: ${String(filePath)}`);
  }
}

/** Read an immutable blob from Git without invoking a shell. */
export function readGitArtifact(commitSha, filePath, { cwd = process.cwd() } = {}) {
  if (typeof commitSha !== 'string' || !COMMIT_SHA.test(commitSha)) {
    throw new Error(`git artifact ref must be a full commit SHA: ${String(commitSha)}`);
  }
  assertRepositoryRelative(filePath);
  return execFileSync('git', ['show', `${commitSha}:${filePath}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
}

export const __test__ = { COMMIT_SHA, assertRepositoryRelative };
