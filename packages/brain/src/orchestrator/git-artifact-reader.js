import { execFileSync } from 'node:child_process';
import path from 'node:path';

const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const GIT_OPTIONS = Object.freeze({
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  timeout: 60_000,
});

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

  try {
    execFileSync('git', ['cat-file', '-e', `${commitSha}^{commit}`], {
      cwd,
      ...GIT_OPTIONS,
      stdio: 'ignore',
    });
  } catch {
    execFileSync(
      'git',
      ['fetch', '--no-tags', '--no-write-fetch-head', 'origin', commitSha],
      { cwd, ...GIT_OPTIONS },
    );
  }

  return execFileSync('git', ['show', `${commitSha}:${filePath}`], {
    cwd,
    ...GIT_OPTIONS,
  });
}

export const __test__ = { COMMIT_SHA, assertRepositoryRelative };
