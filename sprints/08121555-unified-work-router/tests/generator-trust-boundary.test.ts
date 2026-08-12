import { describe, it, expect } from 'vitest';

describe('Generator trust boundary [BEHAVIOR]', () => {
  it('Generator 不持有 push callback lease 凭据', async () => {
    const runner = await import('../../../packages/brain/src/orchestrator/generator-trust-boundary.js');
    expect(runner.GENERATOR_DENIED_ENV).toEqual(expect.arrayContaining(['HARNESS_CALLBACK_TOKEN', 'HARNESS_LEASE_OWNER', 'HARNESS_LEASE_GENERATION']));
    expect(runner.GENERATOR_CAN_PUSH).toBe(false);
  });
});

