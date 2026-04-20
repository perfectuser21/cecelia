import { describe, it, expect } from 'vitest';
import { fetchWithRetry, MAX_RETRIES } from '../../../../packages/brain/src/retry.js';

describe('Workstream 1 — fetchWithRetry [BEHAVIOR]', () => {
  it('returns successfully when op succeeds on the 4th attempt after 3 failures', async () => {
    let attempts = 0;
    const op = async () => {
      attempts += 1;
      if (attempts < 4) {
        throw new Error(`transient-${attempts}`);
      }
      return 'ok';
    };

    const result = await fetchWithRetry(op);

    expect(result).toBe('ok');
    expect(attempts).toBe(4);
    expect(MAX_RETRIES).toBe(3);
  });

  it('throws the original error after 3 retries all fail', async () => {
    let attempts = 0;
    const op = async () => {
      attempts += 1;
      throw new Error('always-fails');
    };

    await expect(fetchWithRetry(op)).rejects.toThrow('always-fails');
    expect(attempts).toBe(4);
  });

  it('waits at least 1.5x longer between each consecutive retry', async () => {
    const timestamps: number[] = [];
    const op = async () => {
      timestamps.push(Date.now());
      throw new Error('fail');
    };

    await expect(fetchWithRetry(op)).rejects.toThrow('fail');

    expect(timestamps.length).toBe(4);
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    const gap3 = timestamps[3] - timestamps[2];

    expect(gap1).toBeGreaterThanOrEqual(100);
    expect(gap2).toBeGreaterThanOrEqual(Math.floor(gap1 * 1.5));
    expect(gap3).toBeGreaterThanOrEqual(Math.floor(gap2 * 1.5));
  }, 10000);

  it('calls op exactly once when it succeeds on the first try', async () => {
    let attempts = 0;
    const op = async () => {
      attempts += 1;
      return 42;
    };

    const result = await fetchWithRetry(op);

    expect(result).toBe(42);
    expect(attempts).toBe(1);
  });
});
