import { describe, expect, it, vi } from 'vitest';
const flow = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../linux-pool/onboarding-flow.js', () => ({ createLinuxOnboardingFlow: () => flow }));
import { runNodeOnboardingJob } from '../service.js';

describe('observer与Linux执行phase分离', () => {
  it('observer收账不会调用可能长期等待SSH的execution.run', async () => {
    let release;
    flow.run.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    let finished = false;
    const work = runNodeOnboardingJob(pool).then(() => { finished = true; });
    for (let i = 0; i < 15; i++) await Promise.resolve();
    const observed = finished;
    release?.({});
    await work;
    expect(observed).toBe(true);
    expect(flow.run).not.toHaveBeenCalled();
  });
});
