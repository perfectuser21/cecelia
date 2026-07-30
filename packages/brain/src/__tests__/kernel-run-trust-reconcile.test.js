import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(result.conflicts).toBe(0);
    expect(result.execution_id).toBeTruthy();
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

  it('records the actual conflict outcome instead of claiming a stale proposal applied', async () => {
    const db = makeDb();
    db.query.mockImplementation(async (sql) => {
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
      if (/UPDATE initiative_runs/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [] };
    });
    const appendAudit = vi.fn();

    const result = await reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/kernel-run-trust-conflict.jsonl',
      appendAudit,
      writeLine: vi.fn(),
      randomUUIDFn: () => 'execution-1',
    });

    expect(result).toMatchObject({
      applied: 0,
      conflicts: 1,
      execution_id: 'execution-1',
    });
    expect(appendAudit.mock.calls.map(([, content]) => content).join(''))
      .toContain('"outcome":"conflict"');
  });

  it('creates the production audit exclusively and seals it read-only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kernel-trust-audit-'));
    const auditOutput = join(directory, 'audit.jsonl');
    try {
      const result = await reconcileRunTrust({
        db: makeDb(),
        apply: true,
        auditOutput,
        writeLine: vi.fn(),
        randomUUIDFn: () => 'execution-2',
      });
      expect(result.applied).toBe(1);
      expect((await stat(auditOutput)).mode & 0o777).toBe(0o400);

      await expect(reconcileRunTrust({
        db: makeDb(),
        apply: true,
        auditOutput,
        writeLine: vi.fn(),
      })).rejects.toMatchObject({ code: 'EEXIST' });
      await expect(writeFile(auditOutput, 'overwrite', { flag: 'wx' }))
        .rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
