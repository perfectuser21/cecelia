// see packages/brain/src/__tests__/docker-prune.test.js for full test suite
import { describe, it, expect, vi } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn() }));

describe('docker-prune', () => {
  it('exports JOB_ID and run()', async () => {
    const mod = await import('./docker-prune.js');
    expect(mod.JOB_ID).toBe('docker-prune');
    expect(typeof mod.run).toBe('function');
  });
});
