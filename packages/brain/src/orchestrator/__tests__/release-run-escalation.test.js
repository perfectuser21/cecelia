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
  it('atomically persists escalation and outbox before recording delivery', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            escalation_id: 'alert-row',
            outbox_id: 'outbox-row',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            outbox_id: 'outbox-row',
            severity: 'P0',
            alert_key: 'kernel_release_blocked_33333333-3333-4333-8333-333333333333',
            alert_message: 'Kernel ReleaseRun BLOCKED: release_production_e2e_not_passed',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };
    const raiseAlert = vi.fn(async () => {});
    const escalate = createReleaseBlockedEscalator({ pool, raiseAlert });

    await escalate(context);
    await escalate(context);

    expect(pool.query.mock.calls[0][0]).toMatch(
      /INSERT INTO kernel_release_blocked_escalations[\s\S]+?INSERT INTO kernel_release_alert_outbox/,
    );
    expect(pool.query.mock.calls[2][0]).toMatch(
      /INSERT INTO kernel_release_alert_delivery_attempts/,
    );
    expect(raiseAlert).toHaveBeenCalledOnce();
    expect(raiseAlert).toHaveBeenCalledWith(
      'P0',
      'kernel_release_blocked_33333333-3333-4333-8333-333333333333',
      expect.stringContaining('release_production_e2e_not_passed'),
    );
  });

  it('records a failed attempt and retries the durable pending alert', async () => {
    const pending = {
      outbox_id: 'outbox-row',
      severity: 'P0',
      alert_key: 'kernel_release_blocked_33333333-3333-4333-8333-333333333333',
      alert_message: 'Kernel ReleaseRun BLOCKED',
    };
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{ escalation_id: 'alert-row', outbox_id: 'outbox-row' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [pending], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [pending], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 }),
    };
    const raiseAlert = vi.fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce();
    const escalate = createReleaseBlockedEscalator({
      pool,
      raiseAlert,
    });

    await expect(escalate(context)).resolves.toMatchObject({
      deduped: false,
      delivery: 'pending',
    });
    await expect(escalate(context)).resolves.toMatchObject({
      deduped: true,
      delivery: 'delivered',
    });
    expect(raiseAlert).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[2][1]).toEqual([
      'outbox-row',
      'failed',
      'alert_delivery_failed',
    ]);
    expect(pool.query.mock.calls[5][1]).toEqual([
      'outbox-row',
      'delivered',
      null,
    ]);
  });
});
