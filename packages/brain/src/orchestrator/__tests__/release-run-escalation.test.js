import { describe, expect, it, vi } from 'vitest';
import { createReleaseBlockedEscalator } from '../release-run-escalation.js';

const context = {
  run_id: '11111111-1111-4111-8111-111111111111',
  task_id: '22222222-2222-4222-8222-222222222222',
  release_run_id: '33333333-3333-4333-8333-333333333333',
  merge_sha: 'a'.repeat(40),
  release_state: 'production_deploying',
  detail: 'release_production_e2e_not_passed',
};

describe('durable ReleaseRun BLOCKED P0 escalation', () => {
  it('persists the dedupe row before dispatching one P0 alert', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'alert-row' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };
    const raiseAlert = vi.fn(async () => {});
    const escalate = createReleaseBlockedEscalator({ pool, raiseAlert });

    await escalate(context);
    await escalate(context);

    expect(pool.query.mock.calls[0][0]).toMatch(
      /INSERT INTO kernel_release_blocked_escalations[\s\S]+?ON CONFLICT \(dedup_key\) DO NOTHING/,
    );
    expect(raiseAlert).toHaveBeenCalledOnce();
    expect(raiseAlert).toHaveBeenCalledWith(
      'P0',
      'kernel_release_blocked_33333333-3333-4333-8333-333333333333',
      expect.stringContaining('release_production_e2e_not_passed'),
    );
  });

  it('does not notify when another process already persisted the dedupe key', async () => {
    const raiseAlert = vi.fn(async () => {});
    const escalate = createReleaseBlockedEscalator({
      pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
      raiseAlert,
    });
    await expect(escalate(context)).resolves.toMatchObject({ deduped: true });
    expect(raiseAlert).not.toHaveBeenCalled();
  });
});
