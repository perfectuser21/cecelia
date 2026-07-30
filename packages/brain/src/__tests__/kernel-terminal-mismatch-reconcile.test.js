import { describe, expect, it, vi } from 'vitest';
import {
  parseTerminalReconcileArgs,
  reconcileTerminalMismatches,
} from '../../scripts/kernel-terminal-mismatch-reconcile.mjs';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function evidenceRow(overrides = {}) {
  return {
    task_id: TASK_ID,
    task_status: 'queued',
    run_id: RUN_ID,
    run_phase: 'failed',
    failure_reason: 'orphan_guard_exhausted',
    terminal_run_count: '2',
    distinct_outcome_count: '1',
    ...overrides,
  };
}

function makeDb(rows = [evidenceRow()]) {
  return {
    query: vi.fn(async sql => (
      /WITH terminal_history/.test(sql)
        ? { rows }
        : { rows: [], rowCount: 0 }
    )),
  };
}

async function reviewedPlanSha(db) {
  return (await reconcileTerminalMismatches({
    db,
    writeLine: vi.fn(),
  })).plan_sha256;
}

describe('kernel-terminal-mismatch-reconcile', () => {
  it('defaults to dry-run and requires an absolute audit plus reviewed digest for apply', () => {
    expect(parseTerminalReconcileArgs([])).toEqual({
      apply: false,
      auditOutput: null,
      expectedPlanSha256: null,
    });
    expect(() => parseTerminalReconcileArgs(['--apply']))
      .toThrow(/audit-output/);
    expect(() => parseTerminalReconcileArgs([
      '--apply',
      '--audit-output',
      '/tmp/terminal-audit.jsonl',
    ])).toThrow(/expected-plan-sha256/);
    expect(parseTerminalReconcileArgs([
      '--apply',
      '--audit-output',
      '/tmp/terminal-audit.jsonl',
      '--expected-plan-sha256',
      'a'.repeat(64),
    ])).toEqual({
      apply: true,
      auditOutput: '/tmp/terminal-audit.jsonl',
      expectedPlanSha256: 'a'.repeat(64),
    });
  });

  it('dry-run emits one exact repair without changing the database', async () => {
    const db = makeDb();
    const writeLine = vi.fn();

    const result = await reconcileTerminalMismatches({ db, writeLine });

    expect(result).toEqual({
      scanned: 1,
      proposed: 1,
      blocked: 0,
      applied: 0,
      plan_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining(
      `"task_id":"${TASK_ID}"`,
    ));
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining(
      '"after_task_status":"failed"',
    ));
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('blocks mixed terminal outcomes instead of guessing from timestamp order', async () => {
    const db = makeDb([evidenceRow({
      terminal_run_count: '3',
      distinct_outcome_count: '2',
    })]);
    const writeLine = vi.fn();

    const dryRun = await reconcileTerminalMismatches({ db, writeLine });

    expect(dryRun).toMatchObject({ scanned: 1, proposed: 0, blocked: 1 });
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining(
      '"reason":"ambiguous_terminal_outcomes"',
    ));

    await expect(reconcileTerminalMismatches({
      db,
      apply: true,
      auditOutput: '/tmp/terminal-blocked.jsonl',
      expectedPlanSha256: dryRun.plan_sha256,
      appendAudit: vi.fn(),
      finalizeRun: vi.fn(),
      writeLine: vi.fn(),
    })).rejects.toThrow(/blocked terminal mismatch/);
  });

  it('refuses a changed plan before audit or task mutation', async () => {
    const db = makeDb();
    const appendAudit = vi.fn();
    const finalizeRun = vi.fn();

    await expect(reconcileTerminalMismatches({
      db,
      apply: true,
      auditOutput: '/tmp/terminal-plan-mismatch.jsonl',
      expectedPlanSha256: 'f'.repeat(64),
      appendAudit,
      finalizeRun,
      writeLine: vi.fn(),
    })).rejects.toThrow(/reviewed plan digest mismatch/);

    expect(appendAudit).not.toHaveBeenCalled();
    expect(finalizeRun).not.toHaveBeenCalled();
  });

  it('applies the exact run with an optimistic task-status fence and durable audit', async () => {
    const db = makeDb();
    const expectedPlanSha256 = await reviewedPlanSha(db);
    const appendAudit = vi.fn();
    const finalizeRun = vi.fn(async () => ({
      changed: false,
      outcome: 'failed',
      runId: RUN_ID,
      taskId: TASK_ID,
    }));

    const result = await reconcileTerminalMismatches({
      db,
      apply: true,
      auditOutput: '/tmp/terminal-apply.jsonl',
      expectedPlanSha256,
      appendAudit,
      finalizeRun,
      randomUUIDFn: () => 'terminal-execution-1',
      writeLine: vi.fn(),
    });

    expect(result).toMatchObject({
      scanned: 1,
      proposed: 1,
      blocked: 0,
      applied: 1,
      execution_id: 'terminal-execution-1',
      plan_sha256: expectedPlanSha256,
    });
    expect(finalizeRun).toHaveBeenCalledWith(db, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      expectedTaskStatus: 'queued',
      requireNoActiveSibling: true,
      outcome: 'failed',
      reason: 'orphan_guard_exhausted',
    });
    const audit = appendAudit.mock.calls.map(([, content]) => content).join('');
    expect(audit).toContain('"commit_state":"pending"');
    expect(audit).toContain('"commit_state":"committed"');
    expect(audit).toContain('"outcome":"completed"');
  });
});
