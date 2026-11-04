import { describe, it, expect } from 'vitest';
import { makeCpBranchName, shanghaiMMDDHHMM } from '../harness-utils.js';

describe('makeCpBranchName', () => {
  it('returns cp-MMDDHHMM-ws-<shortid> format', () => {
    // 2026-04-24 00:14 UTC → Shanghai 08:14 → MMDDHHMM=04240814
    const now = new Date(Date.UTC(2026, 3, 24, 0, 14, 0));
    const branch = makeCpBranchName('abcdef1234567890-xxxx', { now });
    expect(branch).toBe('cp-04240814-ws-abcdef12');
    expect(branch).toMatch(/^cp-\d{8}-ws-[a-f0-9]{8}$/);
  });

  it('matches branch-protect.sh regex ^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$', () => {
    const now = new Date(Date.UTC(2026, 11, 31, 15, 59, 0));
    const branch = makeCpBranchName('deadbeefcafe0000', { now });
    expect(branch).toMatch(/^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$/);
  });

  it('applies Shanghai timezone (UTC+8) even on UTC host', () => {
    // UTC 23:30 on 04-23 → Shanghai 07:30 on 04-24 → MMDDHHMM=04240730
    const now = new Date(Date.UTC(2026, 3, 23, 23, 30, 0));
    expect(shanghaiMMDDHHMM(now)).toBe('04240730');
    expect(makeCpBranchName('abcdef1200000000', { now })).toBe('cp-04240730-ws-abcdef12');
  });

  it('does not contain harness-v2/ prefix', () => {
    const now = new Date(Date.UTC(2026, 3, 24, 0, 14, 0));
    const branch = makeCpBranchName('abcdef1234567890', { now });
    expect(branch).not.toContain('harness-v2/');
    expect(branch.startsWith('cp-')).toBe(true);
  });

  it('throws when taskId too short', () => {
    expect(() => makeCpBranchName('abc', { now: new Date() })).toThrow(/taskId/);
  });
});
