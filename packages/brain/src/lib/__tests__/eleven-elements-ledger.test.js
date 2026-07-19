import { describe, it, expect } from 'vitest';
import { computeLedgerStatus, daysSince } from '../eleven-elements-ledger.js';

const NOW = new Date('2026-01-31T00:00:00Z').getTime();

const baseFeature = {
  id: 'f1',
  description: '测试模块描述',
  smoke_cmd: 'bash smoke.sh',
  smoke_status: 'passing',
  has_unit_test: true,
  has_integration_test: true,
  has_e2e: true,
  last_verified: '2026-01-15T00:00:00Z', // 16天前
  updated_at: '2026-01-25T00:00:00Z',    // 6天前
  notes: '对抗输入已覆盖',
  priority: 'P0',
  status: 'active',
};

describe('daysSince', () => {
  it('returns null when isoStr is null/undefined', () => {
    expect(daysSince(null, NOW)).toBe(null);
    expect(daysSince(undefined, NOW)).toBe(null);
  });

  it('计算正确天数', () => {
    const sixteenDaysAgo = new Date(NOW - 16 * 86400000).toISOString();
    expect(daysSince(sixteenDaysAgo, NOW)).toBe(16);
  });
});

describe('computeLedgerStatus — 11要素纯函数', () => {
  it('全齐的模块返回全 ok', () => {
    const result = computeLedgerStatus(baseFeature, { f1: 2 }, { f1: 1 }, NOW);
    expect(result.fr).toBe('ok');
    expect(result.nfr).toBe('ok');
    expect(result.invariant).toBe('ok');
    expect(result.checkpoints_status).toBe('ok');
    expect(result.freshness_status).toBe('ok');
    expect(result.death_alert).toBe('ok');
    expect(result.failure_semantics).toBe('ok');
    expect(result.effect_confirmed).toBe('ok');
    expect(result.adversarial).toBe('ok');
    expect(result.ledger_status).toBe('ok');
    expect(result.axis_aligned).toBe('ok');
  });

  it('无描述 → fr: missing', () => {
    const result = computeLedgerStatus({ ...baseFeature, description: null }, {}, {}, NOW);
    expect(result.fr).toBe('missing');
  });

  it('无 NFR 决策且无 smoke_cmd → nfr: missing', () => {
    const result = computeLedgerStatus({ ...baseFeature, smoke_cmd: null }, {}, {}, NOW);
    expect(result.nfr).toBe('missing');
  });

  it('无 NFR 决策但有 smoke_cmd → nfr: partial', () => {
    const result = computeLedgerStatus(baseFeature, {}, {}, NOW);
    expect(result.nfr).toBe('partial');
  });

  it('保质期 > 90 天 → freshness_status: stale', () => {
    const old = { ...baseFeature, last_verified: '2025-10-01T00:00:00Z' };
    const result = computeLedgerStatus(old, {}, {}, NOW);
    expect(result.freshness_status).toBe('stale');
  });

  it('smoke_status=failing → death_alert: alert', () => {
    const result = computeLedgerStatus({ ...baseFeature, smoke_status: 'failing' }, {}, {}, NOW);
    expect(result.death_alert).toBe('alert');
  });

  it('无 last_verified → freshness_status: missing', () => {
    const result = computeLedgerStatus({ ...baseFeature, last_verified: null }, {}, {}, NOW);
    expect(result.freshness_status).toBe('missing');
  });

  it('priority 未设 → axis_aligned: missing', () => {
    const result = computeLedgerStatus({ ...baseFeature, priority: null }, {}, {}, NOW);
    expect(result.axis_aligned).toBe('missing');
  });

  it('priority 设了但 status 非 active → axis_aligned: partial', () => {
    const result = computeLedgerStatus({ ...baseFeature, status: 'planned' }, {}, {}, NOW);
    expect(result.axis_aligned).toBe('partial');
  });

  it('只有 unit test → checkpoints_status: partial', () => {
    const result = computeLedgerStatus(
      { ...baseFeature, has_integration_test: false, has_e2e: false },
      {}, {}, NOW
    );
    expect(result.checkpoints).toBe(1);
    expect(result.checkpoints_status).toBe('partial');
  });

  it('notes 含"对抗" → adversarial: ok', () => {
    const result = computeLedgerStatus({ ...baseFeature, notes: '对抗输入' }, {}, {}, NOW);
    expect(result.adversarial).toBe('ok');
  });

  it('notes 不含"对抗"或"adversar" → adversarial: missing', () => {
    const result = computeLedgerStatus({ ...baseFeature, notes: '普通备注' }, {}, {}, NOW);
    expect(result.adversarial).toBe('missing');
  });
});
