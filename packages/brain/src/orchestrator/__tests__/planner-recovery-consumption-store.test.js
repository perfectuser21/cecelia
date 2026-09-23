import { describe, expect, it, vi } from 'vitest';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const SUCCESSOR_ID = '44444444-4444-4444-8444-444444444444';
const ROUTING_ID = '55555555-5555-4555-8555-555555555555';
const INITIATIVE_ID = '66666666-6666-4666-8666-666666666666';

// receiptGenerations：模拟链式接班后同 task_id 的多代路由收据（迁移 465，
// supersedes_receipt_id + anchor_generation）。给了就按 SQL 是否只取最新代来决定返回几行，
// 等价于真库行为：JOIN 全表 = 每代一行，JOIN LATERAL(... ORDER BY anchor_generation DESC LIMIT 1) = 一行。
function authorityRows({ consumed = false, receiptGenerations = null } = {}) {
  const calls = [];
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql) => {
      const text = String(sql);
      calls.push(text);
      if (/SELECT current_task_id[\s\S]*FROM initiative_runs/.test(text)) {
        return { rows: [{ current_task_id: TASK_ID }] };
      }
      if (/FROM tasks[\s\S]*FOR UPDATE/.test(text)) {
        return { rows: [{
          id: TASK_ID,
          status: 'failed',
          okr_initiative_id: null,
        }] };
      }
      if (/FROM initiative_runs[\s\S]*FOR UPDATE/.test(text)) {
        return { rows: [{
          id: RUN_ID,
          initiative_id: INITIATIVE_ID,
          okr_initiative_id: null,
          current_task_id: TASK_ID,
          phase: 'failed',
          orchestrator_version: 'v2',
          record_trust_status: 'trusted',
        }] };
      }
      if (/FROM planner_recovery_receipts recovery[\s\S]*FOR UPDATE OF recovery/.test(text)) {
        const base = {
          id: RECEIPT_ID,
          predecessor_run_id: RUN_ID,
          source_task_id: TASK_ID,
          repo: 'perfectuser21/cecelia',
          head_sha: 'b'.repeat(40),
          verification_method: 'remote_exact_commit_blob',
          execution_profile_override: null,
        };
        if (!receiptGenerations) {
          return { rows: [{ ...base, change_kind: 'new_capability', map_scope: ['F1'] }] };
        }
        const latestOnly = /anchor_generation\s+DESC/i.test(text) && /LIMIT\s+1/i.test(text);
        const sorted = [...receiptGenerations].sort(
          (a, b) => b.anchor_generation - a.anchor_generation,
        );
        return { rows: (latestOnly ? [sorted[0]] : sorted).map(gen => ({ ...base, ...gen })) };
      }
      if (/FROM planner_recovery_consumptions/.test(text)) {
        return consumed
          ? { rows: [{
              receipt_id: RECEIPT_ID,
              successor_task_id: SUCCESSOR_ID,
              routing_receipt_id: ROUTING_ID,
              idempotency_key: 'retry-1',
            }] }
          : { rows: [] };
      }
      if (/INSERT INTO planner_recovery_consumptions/.test(text)) {
        return { rows: [{
          receipt_id: RECEIPT_ID,
          successor_task_id: SUCCESSOR_ID,
          routing_receipt_id: ROUTING_ID,
          idempotency_key: 'retry-1',
        }] };
      }
      return { rows: [] };
    }),
  };
  return { calls, client, pool: { connect: vi.fn(async () => client) } };
}

describe('planner recovery consumption store', () => {
  it('locks task then run then exact receipt and creates a clean routed successor', async () => {
    const { consumePlannerRecoveryReceipt } = await import(
      '../planner-recovery-consumption-store.js'
    );
    const harness = authorityRows();
    const createRoutedTaskFn = vi.fn(async () => ({
      task_id: SUCCESSOR_ID,
      routing_receipt_id: ROUTING_ID,
    }));

    const result = await consumePlannerRecoveryReceipt(harness.pool, {
      predecessorRunId: RUN_ID,
      idempotencyKey: 'retry-1',
    }, { createRoutedTaskFn });

    expect(result).toMatchObject({
      receipt_id: RECEIPT_ID,
      successor_task_id: SUCCESSOR_ID,
      routing_receipt_id: ROUTING_ID,
      deduplicated: false,
    });
    const taskLock = harness.calls.findIndex((sql) => /FROM tasks[\s\S]*FOR UPDATE/.test(sql));
    const runLock = harness.calls.findIndex((sql) => /FROM initiative_runs[\s\S]*FOR UPDATE/.test(sql));
    const receiptLock = harness.calls.findIndex((sql) => /FOR UPDATE OF recovery/.test(sql));
    const consumptionLock = harness.calls.findIndex((sql) => (
      /FROM planner_recovery_consumptions/.test(sql) && /FOR UPDATE/.test(sql)
    ));
    expect(taskLock).toBeGreaterThan(-1);
    expect(taskLock).toBeLessThan(runLock);
    expect(runLock).toBeLessThan(receiptLock);
    expect(receiptLock).toBeLessThan(consumptionLock);
    expect(createRoutedTaskFn).toHaveBeenCalledWith(
      harness.client,
      {
        source: 'child',
        source_id: `planner-recovery:${RECEIPT_ID}`,
        title: `Recover Planner receipt ${RECEIPT_ID}`,
        description: `Resume initiative ${INITIATIVE_ID} from immutable Planner receipt ${RECEIPT_ID}.`,
        mutation_intent: 'write',
        declared_change_kind: 'new_capability',
        execution_profile_override_request: null,
        repo_hint: 'perfectuser21/cecelia',
        map_scope_hint: ['F1'],
        branch: 'cp-planner-recovery-333333333333',
        base_sha: 'b'.repeat(40),
        metadata: {
          planner_recovery_receipt_id: RECEIPT_ID,
          predecessor_run_id: RUN_ID,
          initiative_id: INITIATIVE_ID,
        },
        task: {
          status: 'queued',
          okr_initiative_id: null,
          trigger_source: 'planner_recovery',
        },
      },
      null,
      { transaction: 'existing' },
    );
    expect(harness.calls.some((sql) => /UPDATE tasks[\s\S]*WHERE id.*source/i.test(sql))).toBe(false);
    expect(harness.calls.some((sql) => /task_dependencies/i.test(sql))).toBe(false);
  });

  it('同一任务有多代接班收据时只认最新代，不再判 receipt_ambiguous', async () => {
    const { consumePlannerRecoveryReceipt } = await import(
      '../planner-recovery-consumption-store.js'
    );
    const harness = authorityRows({
      receiptGenerations: [
        { anchor_generation: 1, change_kind: 'new_capability', map_scope: ['F1'] },
        { anchor_generation: 2, change_kind: 'bugfix', map_scope: ['G1'] },
      ],
    });
    const createRoutedTaskFn = vi.fn(async () => ({
      task_id: SUCCESSOR_ID,
      routing_receipt_id: ROUTING_ID,
    }));

    const result = await consumePlannerRecoveryReceipt(harness.pool, {
      predecessorRunId: RUN_ID,
      idempotencyKey: 'retry-generation-2',
    }, { createRoutedTaskFn });

    expect(result).toMatchObject({
      receipt_id: RECEIPT_ID,
      successor_task_id: SUCCESSOR_ID,
      deduplicated: false,
    });
    // 取的必须是 anchor_generation 高的那代（gen2 = bugfix / G1），不是 gen1
    expect(createRoutedTaskFn).toHaveBeenCalledWith(
      harness.client,
      expect.objectContaining({
        declared_change_kind: 'bugfix',
        map_scope_hint: ['G1'],
      }),
      null,
      { transaction: 'existing' },
    );
    expect(harness.calls).toContain('COMMIT');
  });

  it('returns the sealed winner on replay without creating another route', async () => {
    const { consumePlannerRecoveryReceipt } = await import(
      '../planner-recovery-consumption-store.js'
    );
    const harness = authorityRows({ consumed: true });
    const createRoutedTaskFn = vi.fn();

    await expect(consumePlannerRecoveryReceipt(harness.pool, {
      predecessorRunId: RUN_ID,
      idempotencyKey: 'different-key',
    }, { createRoutedTaskFn })).resolves.toMatchObject({
      receipt_id: RECEIPT_ID,
      successor_task_id: SUCCESSOR_ID,
      routing_receipt_id: ROUTING_ID,
      deduplicated: true,
    });
    expect(createRoutedTaskFn).not.toHaveBeenCalled();
  });

  it('rolls back task, route, and consumption when routed creation fails', async () => {
    const { consumePlannerRecoveryReceipt } = await import(
      '../planner-recovery-consumption-store.js'
    );
    const harness = authorityRows();
    const failure = new Error('injected route failure');

    await expect(consumePlannerRecoveryReceipt(harness.pool, {
      predecessorRunId: RUN_ID,
    }, {
      createRoutedTaskFn: vi.fn(async () => { throw failure; }),
    })).rejects.toBe(failure);
    expect(harness.calls).toContain('ROLLBACK');
    expect(harness.calls).not.toContain('COMMIT');
  });
});
