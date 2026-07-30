import { describe, expect, it, vi } from 'vitest';
import {
  parseProductionStaleAttemptReconcileArgs,
  reconcileStaleAttempts,
} from '../../scripts/kernel-stale-attempt-reconcile.mjs';

describe('kernel stale attempt production reconciliation guards', () => {
  it('requires reviewed count and exact database confirmation for apply', () => {
    const base = [
      '--apply',
      '--audit-output',
      '/tmp/stale-attempt-audit.jsonl',
      '--expected-plan-sha256',
      'a'.repeat(64),
    ];
    expect(() => parseProductionStaleAttemptReconcileArgs(base))
      .toThrow(/expected-proposed/);
    expect(() => parseProductionStaleAttemptReconcileArgs([
      ...base,
      '--expected-proposed',
      '10',
    ])).toThrow(/confirm-database/);
    expect(parseProductionStaleAttemptReconcileArgs([
      ...base,
      '--expected-proposed',
      '10',
      '--confirm-database',
      'cecelia',
    ])).toMatchObject({
      apply: true,
      expectedProposed: 10,
      confirmDatabase: 'cecelia',
      productionGuards: true,
    });
  });

  it('fails closed when another production repair holds the session advisory lock', async () => {
    const lockClient = {
      query: vi.fn(async sql => (
        /pg_try_advisory_lock/.test(sql)
          ? { rows: [{ locked: false }] }
          : { rows: [] }
      )),
      release: vi.fn(),
    };
    const db = { connect: vi.fn(async () => lockClient), query: vi.fn() };
    const appendAudit = vi.fn();

    await expect(reconcileStaleAttempts({
      db,
      apply: true,
      auditOutput: '/tmp/stale-attempt-single-flight.jsonl',
      expectedPlanSha256: 'a'.repeat(64),
      expectedProposed: 10,
      confirmDatabase: 'cecelia',
      productionGuards: true,
      appendAudit,
      writeLine: vi.fn(),
    })).rejects.toThrow(/already running/);

    expect(appendAudit).not.toHaveBeenCalled();
    expect(lockClient.release).toHaveBeenCalledOnce();
  });
});
