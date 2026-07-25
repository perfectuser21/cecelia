import { describe, expect, it, vi } from 'vitest';

import { recoverDurableRun } from './durable-resume.js';

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';

function requiredInput(pool, overrides = {}) {
  return {
    pool,
    taskId: '33333333-3333-4333-8333-333333333333',
    runId: RUN_ID,
    leaseOwner: 'watchdog-1',
    leaseSeconds: 180,
    providerRegistry: { resolve: vi.fn() },
    launchResume: vi.fn(),
    execCmd: vi.fn(),
    fileExists: vi.fn(),
    readFile: vi.fn(),
    readAuthCircuit: vi.fn(),
    ...overrides,
  };
}

describe('recoverDurableRun', () => {
  it('reclaim 过期 attempt 后用原 provider session 原地 resume', async () => {
    const expired = {
      id: ATTEMPT_ID,
      run_id: RUN_ID,
      provider: 'codex',
      provider_session_id: 'session-1',
      lease_expired: true,
    };
    const reclaimed = {
      ...expired,
      status: 'starting',
      lease_owner: 'watchdog-1',
    };
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [expired] })
        .mockResolvedValueOnce({ rows: [reclaimed] }),
    };
    const resume = vi.fn().mockReturnValue({ command: 'codex resume session-1' });
    const launchResume = vi.fn().mockResolvedValue({ pid: 1234 });
    const input = requiredInput(pool, {
      providerRegistry: {
        resolve: vi.fn().mockReturnValue({ resume }),
      },
      launchResume,
    });

    const result = await recoverDurableRun(input);

    expect(result).toEqual({
      outcome: 'resumed',
      attempt_id: ATTEMPT_ID,
      provider_session_id: 'session-1',
      launch_result: { pid: 1234 },
    });
    expect(pool.query.mock.calls[0][0]).toMatch(/lease_expired/i);
    expect(pool.query.mock.calls[1][0]).toMatch(/lease_expires_at < NOW\(\)/i);
    expect(input.providerRegistry.resolve).toHaveBeenCalledWith({
      provider: 'codex',
      requires: ['resume'],
    });
    expect(resume).toHaveBeenCalledWith({
      attempt: reclaimed,
      input: {
        reason: 'durable_resume',
        run_id: RUN_ID,
      },
      execution: {},
    });
    expect(launchResume).toHaveBeenCalledWith({
      attempt: reclaimed,
      spec: { command: 'codex resume session-1' },
    });
  });
});
