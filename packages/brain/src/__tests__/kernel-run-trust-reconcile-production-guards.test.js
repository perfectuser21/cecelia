import { describe, expect, it, vi } from 'vitest';
import {
  parseProductionTrustReconcileArgs,
  reconcileRunTrust,
} from '../../scripts/kernel-run-trust-reconcile.mjs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const CUTOFF = '2026-07-30T18:28:51.733Z';

function candidate(overrides = {}) {
  return {
    id: RUN_ID,
    current_task_id: TASK_ID,
    record_trust_status: 'untrusted',
    record_trust_reason: null,
    task_reference_count: '1',
    matching_attempt_count: '0',
    batch_collision_count: '1',
    database_name: 'cecelia',
    historical_cutoff: CUTOFF,
    ...overrides,
  };
}

describe('kernel trust production reconciliation guards', () => {
  it('requires reviewed count and exact database confirmation in production apply args', () => {
    const base = [
      '--apply',
      '--audit-output',
      '/tmp/trust-audit.jsonl',
      '--expected-plan-sha256',
      'a'.repeat(64),
    ];
    expect(() => parseProductionTrustReconcileArgs(base))
      .toThrow(/expected-proposed/);
    expect(() => parseProductionTrustReconcileArgs([
      ...base,
      '--expected-proposed',
      '1',
    ])).toThrow(/confirm-database/);
    expect(parseProductionTrustReconcileArgs([
      ...base,
      '--expected-proposed',
      '1',
      '--confirm-database',
      'cecelia',
    ])).toMatchObject({
      apply: true,
      expectedProposed: 1,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      failOnConflict: true,
    });
  });

  it('scans only pre-cutover completed historical v2 rows and excludes native trusted rows', async () => {
    const db = {
      query: vi.fn(async () => ({ rows: [candidate()] })),
    };

    await reconcileRunTrust({ db, writeLine: vi.fn() });

    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/phase IN \('done', 'failed'\)/);
    expect(sql).toMatch(/completed_at IS NOT NULL/);
    expect(sql).toMatch(/record_trust_status <> 'trusted'/);
    expect(sql).toMatch(/schema_version[\s\S]*version = '376'/);
    expect(sql).toMatch(/started_at <[\s\S]*historical_cutoff/);
  });

  it('rejects database or candidate-count drift before audit and mutation', async () => {
    const db = {
      query: vi.fn(async sql => {
        if (/current_database/.test(sql) && !/WITH evidence/.test(sql)) {
          return { rows: [{ database_name: 'cecelia', historical_cutoff: CUTOFF }] };
        }
        return { rows: [candidate()] };
      }),
    };
    const dry = await reconcileRunTrust({ db, writeLine: vi.fn() });
    const appendAudit = vi.fn();

    await expect(reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/trust-count-drift.jsonl',
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: 2,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      failOnConflict: true,
      appendAudit,
      writeLine: vi.fn(),
    })).rejects.toThrow(/proposal count mismatch/);

    expect(appendAudit).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /\bUPDATE\b/.test(sql))).toBe(false);
  });

  it('fails closed when another production reconcile holds the advisory lock', async () => {
    const lockClient = {
      query: vi.fn(async sql => {
        if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: false }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const db = {
      connect: vi.fn(async () => lockClient),
      query: vi.fn(),
    };
    const appendAudit = vi.fn();

    await expect(reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/trust-single-flight.jsonl',
      expectedPlanSha256: 'a'.repeat(64),
      expectedProposed: 1,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      failOnConflict: true,
      appendAudit,
      writeLine: vi.fn(),
    })).rejects.toThrow(/already running/);

    expect(appendAudit).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(lockClient.release).toHaveBeenCalledOnce();
  });

  it('rolls back and stops when an optimistic row conflict survives plan validation', async () => {
    const lockClient = {
      query: vi.fn(async sql => {
        if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
        if (/current_database/.test(sql) && !/WITH evidence/.test(sql)) {
          return { rows: [{ database_name: 'cecelia', historical_cutoff: CUTOFF }] };
        }
        if (/WITH evidence/.test(sql)) return { rows: [candidate()] };
        if (/pg_advisory_unlock/.test(sql)) return { rows: [{ unlocked: true }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const batchClient = {
      query: vi.fn(async sql => {
        if (/UPDATE initiative_runs/.test(sql)) return { rows: [], rowCount: 0 };
        if (/SELECT record_trust_status/.test(sql)) {
          return {
            rows: [{
              record_trust_status: 'untrusted',
              record_trust_reason: 'changed_after_review',
            }],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const db = {
      connect: vi.fn()
        .mockResolvedValueOnce(lockClient)
        .mockResolvedValueOnce(batchClient),
      query: vi.fn(),
    };
    const dryDb = { query: vi.fn(async () => ({ rows: [candidate()] })) };
    const plan = await reconcileRunTrust({ db: dryDb, writeLine: vi.fn() });
    const appendAudit = vi.fn();

    await expect(reconcileRunTrust({
      db,
      apply: true,
      auditOutput: '/tmp/trust-conflict-stop.jsonl',
      expectedPlanSha256: plan.plan_sha256,
      expectedProposed: 1,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      failOnConflict: true,
      appendAudit,
      writeLine: vi.fn(),
    })).rejects.toThrow(/optimistic conflict/);

    expect(batchClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(batchClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(appendAudit.mock.calls.map(([, content]) => content).join(''))
      .toContain('"outcome":"conflict"');
    expect(lockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/pg_advisory_unlock/),
      expect.any(Array),
    );
  });
});
