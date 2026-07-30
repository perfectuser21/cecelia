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

async function reviewedPlanSha(db) {
  const result = await reconcileRunTrust({
    db,
    apply: false,
    writeLine: vi.fn(),
  });
  return result.plan_sha256;
}

describe('kernel-run-trust-reconcile', () => {
  it('defaults to dry-run and rejects --apply without an absolute audit output', () => {
    expect(parseTrustReconcileArgs([])).toEqual({
      apply: false,
      auditOutput: null,
      batchSize: 100,
      expectedPlanSha256: null,
    });
    expect(() => parseTrustReconcileArgs(['--apply'])).toThrow(/audit-output/);
    expect(() => parseTrustReconcileArgs([
      '--apply',
      '--audit-output',
      'relative.jsonl',
    ])).toThrow(/absolute/);
    expect(() => parseTrustReconcileArgs([
      '--apply',
      '--audit-output',
      '/tmp/audit.jsonl',
    ])).toThrow(/expected-plan-sha256/);
    expect(parseTrustReconcileArgs([
      '--apply',
      '--audit-output',
      '/tmp/audit.jsonl',
      '--expected-plan-sha256',
      'a'.repeat(64),
    ])).toEqual({
      apply: true,
      auditOutput: '/tmp/audit.jsonl',
      batchSize: 100,
      expectedPlanSha256: 'a'.repeat(64),
    });
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
      plan_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining(
      `"run_id":"${RUN_ID}"`,
    ));
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining(
      '"reason":"direct_task_reference"',
    ));
    expect(db.query.mock.calls.some(([sql]) => /\bUPDATE\b/.test(sql))).toBe(false);
  });

  it('refuses apply when the reviewed plan digest does not match the live evidence', async () => {
    const db = makeDb();
    const appendAudit = vi.fn();

    await expect(reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/kernel-run-trust-plan-mismatch.jsonl',
      expectedPlanSha256: 'f'.repeat(64),
      appendAudit,
      writeLine: vi.fn(),
    })).rejects.toThrow(/reviewed plan digest mismatch/);

    expect(appendAudit).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /\bUPDATE\b/.test(sql))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false);
  });

  it('never proposes a historical rewrite for a native trusted run', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{
        id: RUN_ID,
        current_task_id: TASK_ID,
        record_trust_status: 'trusted',
        record_trust_reason: null,
        task_reference_count: '1',
        matching_attempt_count: '1',
        batch_collision_count: '1',
      }],
    });
    const writeLine = vi.fn();

    const result = await reconcileRunTrust({ db, writeLine });

    expect(result).toMatchObject({ scanned: 1, proposed: 0, applied: 0 });
    expect(writeLine).not.toHaveBeenCalled();
  });

  it('apply uses the scanned before-state as an optimistic guard', async () => {
    const db = makeDb();
    const expectedPlanSha256 = await reviewedPlanSha(db);

    const result = await reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/kernel-run-trust-audit.jsonl',
      expectedPlanSha256,
      writeLine: vi.fn(),
      appendAudit: vi.fn(),
      batchSize: 10,
    });

    expect(result.applied).toBe(1);
    expect(result.unchanged).toBe(0);
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
    const expectedPlanSha256 = await reviewedPlanSha(db);

    const result = await reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/kernel-run-trust-conflict.jsonl',
      expectedPlanSha256,
      appendAudit,
      writeLine: vi.fn(),
      randomUUIDFn: () => 'execution-1',
    });

    expect(result).toMatchObject({
      applied: 0,
      unchanged: 0,
      conflicts: 1,
      execution_id: 'execution-1',
    });
    expect(appendAudit.mock.calls.map(([, content]) => content).join(''))
      .toContain('"outcome":"conflict"');
  });

  it('is repeatable: a second apply records unchanged, never conflict', async () => {
    let status = 'untrusted';
    let reason = null;
    const db = {
      query: vi.fn(async (sql, params) => {
        if (/WITH evidence/.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              current_task_id: TASK_ID,
              record_trust_status: status,
              record_trust_reason: reason,
              task_reference_count: '1',
              matching_attempt_count: '0',
              batch_collision_count: '1',
            }],
          };
        }
        if (/UPDATE initiative_runs/.test(sql)) {
          if (
            status === params[3]
            && reason === params[4]
            && (status !== params[1] || reason !== params[2])
          ) {
            status = params[1];
            reason = params[2];
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT record_trust_status/.test(sql)) {
          return {
            rows: [{
              record_trust_status: status,
              record_trust_reason: reason,
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const firstPlanSha256 = await reviewedPlanSha(db);
    const first = await reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/kernel-run-trust-first.jsonl',
      expectedPlanSha256: firstPlanSha256,
      appendAudit: vi.fn(),
      writeLine: vi.fn(),
      randomUUIDFn: () => 'execution-first',
    });
    const secondAudit = vi.fn();
    const secondPlanSha256 = await reviewedPlanSha(db);
    const second = await reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/kernel-run-trust-second.jsonl',
      expectedPlanSha256: secondPlanSha256,
      appendAudit: secondAudit,
      writeLine: vi.fn(),
      randomUUIDFn: () => 'execution-second',
    });

    expect(first).toMatchObject({ applied: 1, unchanged: 0, conflicts: 0 });
    expect(second).toMatchObject({ applied: 0, unchanged: 1, conflicts: 0 });
    expect(secondAudit.mock.calls.map(([, content]) => content).join(''))
      .toContain('"outcome":"unchanged"');
  });

  it('writes row outcomes before COMMIT and rolls back if durable audit fails', async () => {
    const db = makeDb();
    const expectedPlanSha256 = await reviewedPlanSha(db);
    const appendAudit = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('audit disk full'));

    await expect(reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/kernel-run-trust-audit-failure.jsonl',
      expectedPlanSha256,
      appendAudit,
      writeLine: vi.fn(),
    })).rejects.toThrow('audit disk full');

    const sqls = db.query.mock.calls.map(([sql]) => sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });

  it('creates the production audit exclusively and seals it read-only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kernel-trust-audit-'));
    const auditOutput = join(directory, 'audit.jsonl');
    try {
      const firstDb = makeDb();
      const expectedPlanSha256 = await reviewedPlanSha(firstDb);
      const result = await reconcileRunTrust({
        db: firstDb,
        apply: true,
        auditOutput,
        expectedPlanSha256,
        writeLine: vi.fn(),
        randomUUIDFn: () => 'execution-2',
      });
      expect(result.applied).toBe(1);
      expect((await stat(auditOutput)).mode & 0o777).toBe(0o400);

      const secondDb = makeDb();
      const secondPlanSha256 = await reviewedPlanSha(secondDb);
      await expect(reconcileRunTrust({
        db: secondDb,
        apply: true,
        auditOutput,
        expectedPlanSha256: secondPlanSha256,
        writeLine: vi.fn(),
      })).rejects.toMatchObject({ code: 'EEXIST' });
      await expect(writeFile(auditOutput, 'overwrite', { flag: 'wx' }))
        .rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
