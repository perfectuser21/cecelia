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
    const execFile = vi.fn(async () => ({
      stdout: JSON.stringify({ headRefOid: LOWER_SHA }),
      stderr: '',
    }));
    const prUrl = 'https://github.com/acme/repo/pull/42';

    await expect(defaultPrHeadResolver(prUrl, execFile)).resolves.toBe(LOWER_SHA);
    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', prUrl, '--json', 'headRefOid'],
      { encoding: 'utf8', timeout: 8_000 },
    );
  });

  it('returns null when GitHub omits the head field', async () => {
    const execFile = vi.fn(async () => ({ stdout: '{}', stderr: '' }));

    await expect(defaultPrHeadResolver('https://example.test/pr/1', execFile))
      .resolves.toBeNull();
  });

  it('does not block the event loop while awaiting a slow gh executor', async () => {
    let resolverFinished = false;
    let eventLoopTimerRan = false;
    const execFile = vi.fn(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        stdout: JSON.stringify({ headRefOid: LOWER_SHA }),
        stderr: '',
      }), 20);
    }));
    const resolution = defaultPrHeadResolver('https://example.test/pr/slow', execFile)
      .then((sha) => {
        resolverFinished = true;
        return sha;
      });
    void resolution.catch(() => {});

    await new Promise((resolve) => setTimeout(() => {
      eventLoopTimerRan = true;
      resolve();
    }, 1));
    expect(eventLoopTimerRan).toBe(true);
    expect(resolverFinished).toBe(false);
    await expect(resolution).resolves.toBe(LOWER_SHA);
  });
});
