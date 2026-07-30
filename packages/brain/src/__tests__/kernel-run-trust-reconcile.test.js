import { describe, expect, it, vi } from 'vitest';
import {
  parseTrustReconcileArgs,
  reconcileRunTrust,
} from '../../scripts/kernel-run-trust-reconcile.mjs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

function makeDb() {
  return {
    query: vi.fn(async (sql) => {
      if (/WITH evidence/.test(sql)) {
        return {
          rows: [{
            id: RUN_ID,
            current_task_id: TASK_ID,
            record_trust_status: 'untrusted',
            record_trust_reason: null,
            task_reference_count: '1',
            matching_attempt_count: '0',
            batch_collision_count: '1',
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe('kernel-run-trust-reconcile', () => {
  it('defaults to dry-run and rejects --apply without an absolute audit output', () => {
    expect(parseTrustReconcileArgs([])).toEqual({
      apply: false,
      auditOutput: null,
      batchSize: 100,
    });
    expect(() => parseTrustReconcileArgs(['--apply'])).toThrow(/audit-output/);
    expect(() => parseTrustReconcileArgs([
      '--apply',
      '--audit-output',
      'relative.jsonl',
    ])).toThrow(/absolute/);
  });

  it('dry-run emits deterministic proposals and performs no UPDATE', async () => {
    const db = makeDb();
    const writeLine = vi.fn();

    const result = await reconcileRunTrust({
      db,
      apply: false,
      writeLine,
    });

    expect(result).toEqual({
      scanned: 1,
      proposed: 1,
      applied: 0,
    });
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining(
      `"run_id":"${RUN_ID}"`,
    ));
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining(
      '"reason":"direct_task_reference"',
    ));
    expect(db.query.mock.calls.some(([sql]) => /\bUPDATE\b/.test(sql))).toBe(false);
  });

  it('apply uses the scanned before-state as an optimistic guard', async () => {
    const db = makeDb();

    const result = await reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/kernel-run-trust-audit.jsonl',
      writeLine: vi.fn(),
      appendAudit: vi.fn(),
      batchSize: 10,
    });

    expect(result.applied).toBe(1);
    const sqls = db.query.mock.calls.map(([sql]) => sql);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    const update = db.query.mock.calls.find(([sql]) => /UPDATE initiative_runs/.test(sql));
    expect(update[0]).toMatch(/WHERE id = \$1/);
    expect(update[0]).toMatch(/IS DISTINCT FROM/);
    expect(update[0]).toMatch(/record_trust_status IS NOT DISTINCT FROM \$4/);
    expect(update[0]).toMatch(/record_trust_reason IS NOT DISTINCT FROM \$5/);
    expect(update[1][0]).toBe(RUN_ID);
  });
});
