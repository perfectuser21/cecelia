import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveGitHubToken } from '../harness-credentials.js';

const execFileAsync = promisify(execFile);

export async function defaultGitBranchHeadResolver({
  repo,
  branch,
  path,
}, {
  execute = execFileAsync,
  fetchFn = globalThis.fetch,
  resolveToken = resolveGitHubToken,
} = {}) {
  const { stdout } = await execute(
    'git',
    [
      'ls-remote',
      '--exit-code',
      `https://github.com/${repo}.git`,
      `refs/heads/${branch}`,
    ],
    { encoding: 'utf8', timeout: 8_000 },
  );
  const [sha, ref, extra] = String(stdout).trim().split(/\s+/);
  if (extra || ref !== `refs/heads/${branch}` || !sha) {
    return { head_sha: null, path_exists: false };
  }
  const encodedPath = String(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const token = await resolveToken();
  const response = await fetchFn(
    `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${sha}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response?.ok && response?.status !== 404) {
    throw new Error(`github_artifact_probe_http_${response?.status ?? 'unknown'}`);
  }
  return {
    head_sha: sha,
    path_exists: response?.ok === true,
  };
}
