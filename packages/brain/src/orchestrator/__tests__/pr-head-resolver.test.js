import { describe, expect, it, vi } from 'vitest';
import {
  defaultPrHeadResolver,
  normalizeGitSha,
} from '../pr-head-resolver.js';

const LOWER_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const UPPER_SHA = LOWER_SHA.toUpperCase();

describe('pr-head-resolver', () => {
  it('normalizes full uppercase SHA values and rejects malformed values', () => {
    expect(normalizeGitSha(` ${UPPER_SHA}\n`)).toBe(LOWER_SHA);
    expect(normalizeGitSha(LOWER_SHA.slice(0, 12))).toBeNull();
    expect(normalizeGitSha('z'.repeat(40))).toBeNull();
    expect(normalizeGitSha(null)).toBeNull();
  });

  it('resolves the authoritative head through a bounded gh invocation', async () => {
    const execFile = vi.fn(() => JSON.stringify({ headRefOid: LOWER_SHA }));
    const prUrl = 'https://github.com/acme/repo/pull/42';

    await expect(defaultPrHeadResolver(prUrl, execFile)).resolves.toBe(LOWER_SHA);
    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', prUrl, '--json', 'headRefOid'],
      { encoding: 'utf8', timeout: 15_000 },
    );
  });

  it('returns null when GitHub omits the head field', async () => {
    const execFile = vi.fn(() => '{}');

    await expect(defaultPrHeadResolver('https://example.test/pr/1', execFile))
      .resolves.toBeNull();
  });
});
