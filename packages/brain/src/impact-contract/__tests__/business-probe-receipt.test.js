/**
 * [BEHAVIOR] persistBusinessProbeReceipt：业务探针判定写进 journey_assertion_receipts（棒3a，任务 33aa2bc4）。
 * 占位约定：executor_kind=business_probe_runner / source_repo=zenithjoy-workspace / command_argv=["probe",key]
 * / source_sha、machine_id NULL / assertion_ref_snapshot=probe:<key> / assertion_digest=spec_hash。
 * 不动 persistTrustedEvaluatorReceipts（有独立测试）。
 */
import { describe, expect, it, vi } from 'vitest';
import { persistBusinessProbeReceipt, persistTrustedEvaluatorReceipts } from '../assertion-receipts.js';

const LINK_ID = '33333333-3333-4333-8333-333333333333';
const SPEC_HASH = 'f'.repeat(64);

function input(overrides = {}) {
  return {
    journeyStepLinkId: LINK_ID,
    assertionRevision: 3,
    probeKey: 'preflight.slots_ready',
    specHash: SPEC_HASH,
    runId: 'run-abc',
    verdict: 'PASS',
    evidence: { observed: 3, expected: 2, op: '>=', severity: 'error' },
    probedAt: '2026-09-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('persistBusinessProbeReceipt', () => {
  it('PASS 回执：exit_code 0、argv ["probe",key]、executor_kind business_probe_runner、sha/machine 为 NULL', async () => {
    const row = { id: 'r1', verdict: 'PASS' };
    const db = { query: vi.fn().mockResolvedValue({ rows: [row] }) };
    const out = await persistBusinessProbeReceipt(db, input());
    expect(out).toEqual(row);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO journey_assertion_receipts/);
    expect(sql).toMatch(/'business_probe_runner'/);
    expect(sql).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
    expect(params).toEqual([
      LINK_ID, 'run-abc', 3, 'probe:preflight.slots_ready', SPEC_HASH,
      'zenithjoy-workspace', null,
      JSON.stringify(['probe', 'preflight.slots_ready']),
      JSON.stringify({ observed: 3, expected: 2, op: '>=', severity: 'error' }),
      'PASS', 0,
      '2026-09-26T12:00:00.000Z', '2026-09-26T12:00:00.000Z',
      null,
    ]);
  });

  it('FAIL 回执：exit_code 1，evidence 带 reason', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const out = await persistBusinessProbeReceipt(db, input({
      verdict: 'FAIL', evidence: { observed: null, expected: 2, op: '>=', severity: 'warn', reason: 'probe_missing' },
    }));
    expect(out).toBeNull();
    const params = db.query.mock.calls[0][1];
    expect(params[9]).toBe('FAIL');
    expect(params[10]).toBe(1);
    expect(JSON.parse(params[8]).reason).toBe('probe_missing');
  });

  it('probedAt 缺失 → started/completed 取同一个 now（ISO）', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await persistBusinessProbeReceipt(db, input({ probedAt: undefined }));
    const params = db.query.mock.calls[0][1];
    expect(params[11]).toBe(params[12]);
    expect(new Date(params[11]).toISOString()).toBe(params[11]);
  });

  it('spec_hash 非 64 hex / verdict 非 PASS|FAIL / 缺 run → 抛错，不写库', async () => {
    const db = { query: vi.fn() };
    await expect(persistBusinessProbeReceipt(db, input({ specHash: 'zz' }))).rejects.toThrow(/spec_hash/);
    await expect(persistBusinessProbeReceipt(db, input({ verdict: 'MAYBE' }))).rejects.toThrow(/verdict/);
    await expect(persistBusinessProbeReceipt(db, input({ runId: '' }))).rejects.toThrow(/run_id/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('persistTrustedEvaluatorReceipts 仍在且签名不变（本棒不动它）', () => {
    expect(typeof persistTrustedEvaluatorReceipts).toBe('function');
    expect(persistTrustedEvaluatorReceipts.length).toBe(2);
  });
});
