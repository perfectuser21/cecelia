import { describe, expect, it, vi } from 'vitest';
import {
  parseStaleAttemptReconcileArgs,
  reconcileStaleAttempts,
} from '../../scripts/kernel-stale-attempt-reconcile.mjs';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';

function evidenceRow(overrides = {}) {
  return {
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    attempt_status: 'running',
    lease_owner: 'worker-1',
    lease_expires_at: '2026-07-25T00:00:00.000Z',
    attempt_updated_at: '2026-07-25T00:00:00.000Z',
    error_code: null,
    error_message: null,
    completed_at: null,
    run_phase: 'failed',
    orchestrator_version: 'v2',
    ...overrides,
  };
}

function makeDb(rows = [evidenceRow()]) {
  return {
    query: vi.fn(async sql => (
      /FROM harness_attempts attempt/.test(sql)
        ? { rows }
        : { rows: [], rowCount: 0 }
    )),
  };
}

describe('kernel stale attempt reconciliation', () => {
  it('defaults to dry-run and requires an absolute audit plus reviewed digest for apply', () => {
    expect(parseStaleAttemptReconcileArgs([])).toEqual({
      apply: false,
      auditOutput: null,
      expectedPlanSha256: null,
    });
    expect(() => parseStaleAttemptReconcileArgs(['--apply']))
      .toThrow(/audit-output/);
    expect(() => parseStaleAttemptReconcileArgs([
      '--apply',
      '--audit-output',
      'relative.jsonl',
      '--expected-plan-sha256',
      'a'.repeat(64),
    ])).toThrow(/absolute/);
    expect(parseStaleAttemptReconcileArgs([
      '--apply',
      '--audit-output',
      '/tmp/stale-attempt-audit.jsonl',
      '--expected-plan-sha256',
      'a'.repeat(64),
    ])).toEqual({
      apply: true,
      auditOutput: '/tmp/stale-attempt-audit.jsonl',
      expectedPlanSha256: 'a'.repeat(64),
    });
  });

  it('dry-run proposes only exact active attempts under terminal v2 parents', async () => {
    const db = makeDb();
    const writeLine = vi.fn();

    const result = await reconcileStaleAttempts({ db, writeLine });

    expect(result).toEqual({
      scanned: 1,
      proposed: 1,
      applied: 0,
      blocked: 0,
      plan_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining(
      `"attempt_id":"${ATTEMPT_ID}"`,
    ));
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/attempt\.status IN \('queued', 'starting', 'running'\)/);
    expect(sql).toMatch(/run\.phase IN \('done', 'failed'\)/);
    expect(sql).toMatch(/lease_expires_at IS NULL[\s\S]*lease_expires_at <= NOW\(\)/);
  });

  it('refuses a changed reviewed plan before opening an audit or mutating', async () => {
    const db = makeDb();
    const appendAudit = vi.fn();

    await expect(reconcileStaleAttempts({
      db,
      apply: true,
      auditOutput: '/tmp/stale-attempt-plan-mismatch.jsonl',
      expectedPlanSha256: 'f'.repeat(64),
      appendAudit,
      writeLine: vi.fn(),
    })).rejects.toThrow(/reviewed plan digest mismatch/);

    expect(appendAudit).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /UPDATE harness_attempts/.test(sql)))
      .toBe(false);
  });

  it('locks task then run then attempt and blocks evidence drift without mutation', async () => {
    const row = evidenceRow();
    const order = [];
    const transactionClient = {
      query: vi.fn(async sql => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          order.push(sql);
          return { rows: [] };
        }
        if (/FROM tasks/.test(sql)) {
          order.push('task-lock');
          return { rows: [{ id: TASK_ID }] };
        }
        if (/FROM initiative_runs/.test(sql)) {
          order.push('run-lock');
          return {
            rows: [{
              id: RUN_ID,
              current_task_id: TASK_ID,
              phase: 'failed',
              orchestrator_version: 'v2',
            }],
          };
        }
        if (/FROM harness_attempts attempt/.test(sql)) {
          order.push('attempt-lock');
          return {
            rows: [{
              id: ATTEMPT_ID,
              run_id: RUN_ID,
              current_task_id: TASK_ID,
              status: 'running',
              lease_owner: 'worker-1',
              lease_expires_at: new Date(row.lease_expires_at),
              updated_at: new Date('2026-07-25T00:00:01.000Z'),
              error_code: null,
              error_message: null,
              completed_at: null,
              run_phase: 'failed',
              orchestrator_version: 'v2',
              lease_is_stale: true,
            }],
          };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
      release: vi.fn(() => order.push('release')),
    };
    const db = {
      query: vi.fn(async () => ({ rows: [row] })),
      connect: vi.fn(async () => transactionClient),
    };
    const dry = await reconcileStaleAttempts({ db, writeLine: vi.fn() });

    const applied = await reconcileStaleAttempts({
      db,
      apply: true,
      auditOutput: '/tmp/stale-attempt-drift.jsonl',
      expectedPlanSha256: dry.plan_sha256,
      appendAudit: vi.fn(),
      randomUUIDFn: () => 'stale-attempt-execution-1',
      writeLine: vi.fn(),
    });

    expect(applied).toMatchObject({ applied: 0, verified: 0, blocked: 1 });
    expect(order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
      'attempt-lock',
      'ROLLBACK',
      'release',
    ]);
    expect(transactionClient.query.mock.calls.some(
      ([sql]) => /UPDATE harness_attempts/.test(sql),
    )).toBe(false);
  });
});
