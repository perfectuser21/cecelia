import { describe, expect, it, vi } from 'vitest';
import {
  _terminalizeRelayRun,
  resumeStalledRelayRuns,
} from '../harness-relay-watchdog.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

describe('relay watchdog exact run identity', () => {
  it('selects runs per task identity and excludes identity-less rows', async () => {
    const query = vi.fn(async () => ({ rows: [] }));

    await resumeStalledRelayRuns({ pool: { query } });

    const [sql] = query.mock.calls[0];
    expect(sql).not.toMatch(/DISTINCT ON\s*\(initiative_id\)/);
    expect(sql).toMatch(/r\.current_task_id IS NOT NULL/);
    expect(sql).toMatch(/r2\.current_task_id = r\.current_task_id/);
    expect(sql).toMatch(/ORDER BY r\.started_at DESC,\s*r\.id DESC/);
  });

  it('holds paused runs after terminal house-keeping and never probes or refires them', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: RUN_ID,
          initiative_id: TASK_ID,
          current_task_id: TASK_ID,
          phase: 'paused',
          orchestrator_host: 'kernel-worker',
          attempts: '1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: { orchestrator: 'skill-relay' },
        }],
      });
    const execFn = vi.fn(() => '');
    const spawnFn = vi.fn();

    const result = await resumeStalledRelayRuns({
      pool: { query },
      execFn,
      spawnFn,
    });

    expect(result).toMatchObject({ scanned: 1, resumed: 0 });
    expect(execFn).not.toHaveBeenCalled();
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('terminalizes through the exact transactional run store', async () => {
    const patchRun = vi.fn(async (_pool, input) => ({
      id: input.runId,
      current_task_id: TASK_ID,
      phase: input.phase,
    }));

    const result = await _terminalizeRelayRun(
      { query: vi.fn() },
      { id: RUN_ID, current_task_id: TASK_ID },
      {
        outcome: 'failed',
        reason: 'relay_watchdog_attempt_cap',
        patchRun,
      },
    );

    expect(patchRun).toHaveBeenCalledWith(expect.anything(), {
      runId: RUN_ID,
      phase: 'failed',
      failureReason: 'relay_watchdog_attempt_cap',
      prUrl: null,
    });
    expect(result.phase).toBe('failed');
  });

  it('fails closed when a legacy run has no task identity', async () => {
    await expect(_terminalizeRelayRun(
      { query: vi.fn() },
      { id: RUN_ID, current_task_id: null },
      { outcome: 'failed', reason: 'deadline' },
    )).rejects.toThrow(/task identity missing/);
  });
});
