import { execFileSync } from 'node:child_process';

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export function normalizeGitSha(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return FULL_GIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

export async function defaultPrHeadResolver(prUrl, execFile = execFileSync) {
  const output = execFile(
    'gh',
    ['pr', 'view', prUrl, '--json', 'headRefOid'],
    { encoding: 'utf8', timeout: 15_000 },
  );
  return JSON.parse(output).headRefOid ?? null;
}
