import { describe, expect, it, vi } from 'vitest';
import {
  parseProductionTerminalReconcileArgs,
  reconcileTerminalMismatches,
} from '../../scripts/kernel-terminal-mismatch-reconcile.mjs';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function findingRow() {
  return {
    task_id: TASK_ID,
    task_status: 'queued',
    run_id: RUN_ID,
    run_phase: 'failed',
    failure_reason: 'orphan_guard_exhausted',
    terminal_run_count: '1',
    distinct_outcome_count: '1',
  };
}

describe('kernel terminal mismatch production reconciliation guards', () => {
  it('requires reviewed count and exact database confirmation for apply', () => {
    const base = [
      '--apply',
      '--audit-output',
      '/tmp/terminal-audit.jsonl',
      '--expected-plan-sha256',
      'a'.repeat(64),
    ];
    expect(() => parseProductionTerminalReconcileArgs(base))
      .toThrow(/expected-proposed/);
    expect(() => parseProductionTerminalReconcileArgs([
      ...base,
      '--expected-proposed',
      '1',
    ])).toThrow(/confirm-database/);
    expect(() => parseProductionTerminalReconcileArgs([
      ...base,
      '--expected-proposed',
      '1',
      '--confirm-database',
      'cecelia',
    ])).toThrow(/expected-blocked/);
    expect(parseProductionTerminalReconcileArgs([
      ...base,
      '--expected-proposed',
      '1',
      '--expected-blocked',
      '0',
      '--confirm-database',
      'cecelia',
    ])).toMatchObject({
      apply: true,
      expectedProposed: 1,
      expectedBlocked: 0,
      confirmDatabase: 'cecelia',
      productionGuards: true,
    });
  });

  it('fails closed when another production repair holds the advisory lock', async () => {
    const lockClient = {
      query: vi.fn(async sql => (
        /pg_try_advisory_lock/.test(sql)
          ? { rows: [{ locked: false }] }
          : { rows: [] }
      )),
      release: vi.fn(),
    };
    const db = {
      connect: vi.fn(async () => lockClient),
      query: vi.fn(),
    };
    const appendAudit = vi.fn();
    const finalizeRun = vi.fn();

    await expect(reconcileTerminalMismatches({
      db,
      apply: true,
      auditOutput: '/tmp/terminal-single-flight.jsonl',
      expectedPlanSha256: 'a'.repeat(64),
      expectedProposed: 1,
      expectedBlocked: 0,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      appendAudit,
      finalizeRun,
      writeLine: vi.fn(),
    })).rejects.toThrow(/already running/);

    expect(appendAudit).not.toHaveBeenCalled();
    expect(finalizeRun).not.toHaveBeenCalled();
    expect(lockClient.release).toHaveBeenCalledOnce();
  });

  it('rejects database or candidate-count drift before audit and mutation', async () => {
    const db = {
      query: vi.fn(async sql => (
        /current_database/.test(sql)
          ? { rows: [{ database_name: 'cecelia' }] }
          : { rows: [findingRow()] }
      )),
    };
    const dry = await reconcileTerminalMismatches({
      db,
      productionGuards: true,
      writeLine: vi.fn(),
    });
    const appendAudit = vi.fn();
    const finalizeRun = vi.fn();

    await expect(reconcileTerminalMismatches({
      db,
      apply: true,
      auditOutput: '/tmp/terminal-count-drift.jsonl',
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: 2,
      expectedBlocked: 0,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      appendAudit,
      finalizeRun,
      writeLine: vi.fn(),
    })).rejects.toThrow(/proposal count mismatch/);

    expect(appendAudit).not.toHaveBeenCalled();
    expect(finalizeRun).not.toHaveBeenCalled();
  });

  it('applies only reviewed repairs while audit-acknowledging the exact blocked set', async () => {
    const blockedTaskId = '33333333-3333-4333-8333-333333333333';
    const blockedRunId = '44444444-4444-4444-8444-444444444444';
    const rows = [
      findingRow(),
      {
        ...findingRow(),
        task_id: blockedTaskId,
        task_status: 'completed',
        run_id: blockedRunId,
      },
    ];
    const db = {
      query: vi.fn(async (sql) => {
        if (/current_database/.test(sql)) {
          return { rows: [{ database_name: 'cecelia' }] };
        }
        if (/WITH terminal_history/.test(sql)) return { rows };
        if (/SELECT t.status AS task_status/.test(sql)) {
          return {
            rows: [{
              task_status: 'failed',
              run_phase: 'failed',
              current_task_id: TASK_ID,
              no_active_sibling: true,
            }],
          };
        }
        return { rows: [] };
      }),
    };
    const dry = await reconcileTerminalMismatches({
      db,
      productionGuards: true,
      writeLine: vi.fn(),
    });
    const appendAudit = vi.fn();
    const finalizeRun = vi.fn(async () => ({
      changed: true,
      outcome: 'failed',
      runId: RUN_ID,
      taskId: TASK_ID,
    }));

    await expect(reconcileTerminalMismatches({
      db,
      apply: true,
      auditOutput: '/tmp/terminal-blocked-drift.jsonl',
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: 1,
      expectedBlocked: 0,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      appendAudit,
      finalizeRun,
      writeLine: vi.fn(),
    })).rejects.toThrow(/blocked count mismatch/);
    expect(appendAudit).not.toHaveBeenCalled();
    expect(finalizeRun).not.toHaveBeenCalled();

    const applied = await reconcileTerminalMismatches({
      db,
      apply: true,
      auditOutput: '/tmp/terminal-reviewed-blocked.jsonl',
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: 1,
      expectedBlocked: 1,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      appendAudit,
      finalizeRun,
      writeLine: vi.fn(),
    });

    expect(applied).toMatchObject({
      proposed: 1,
      blocked: 1,
      applied: 1,
      verified: 1,
    });
    expect(finalizeRun).toHaveBeenCalledOnce();
    expect(finalizeRun).toHaveBeenCalledWith(db, expect.objectContaining({
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
    }));
    const audit = appendAudit.mock.calls.map(([, content]) => content).join('');
    expect(audit).toContain('"outcome":"blocked_acknowledged"');
    expect(audit).toContain(`"task_id":"${blockedTaskId}"`);
    expect(audit).toContain(`"run_id":"${blockedRunId}"`);
  });
});
