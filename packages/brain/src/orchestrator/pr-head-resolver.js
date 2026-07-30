import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const execFileAsync = promisify(execFile);

export function normalizeGitSha(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return FULL_GIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

export async function defaultPrHeadResolver(prUrl, execute = execFileAsync) {
  const { stdout } = await execute(
    'gh',
    ['pr', 'view', prUrl, '--json', 'headRefOid'],
    { encoding: 'utf8', timeout: 8_000 },
  );
  return JSON.parse(stdout).headRefOid ?? null;
}

export async function defaultPrIdentityResolver(prUrl, execute = execFileAsync) {
  const { stdout } = await execute(
    'gh',
    ['pr', 'view', prUrl, '--json', 'headRefOid,headRefName,url'],
    { encoding: 'utf8', timeout: 8_000 },
  );
  const parsed = JSON.parse(stdout);
  return {
    head_sha: parsed.headRefOid ?? null,
    head_ref: parsed.headRefName ?? null,
    url: parsed.url ?? prUrl,
  };
}
