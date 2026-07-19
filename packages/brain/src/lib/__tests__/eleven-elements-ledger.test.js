import { describe, it, expect } from 'vitest';
import { computeLedgerStatus, daysSince } from '../eleven-elements-ledger.js';

const NOW = new Date('2026-07-19T00:00:00Z').getTime();

describe('eleven-elements-ledger — computeLedgerStatus', () => {
  it('全空 feature → 所有要素 missing', () => {
    const result = computeLedgerStatus({}, {}, {}, NOW);
    expect(result.fr).toBe('missing');
    expect(result.nfr).toBe('missing');
    expect(result.invariant).toBe('missing');
    expect(result.checkpoints_status).toBe('missing');
    expect(result.freshness_status).toBe('missing');
    expect(result.death_alert).toBe('missing');
    expect(result.failure_semantics).toBe('missing');
    expect(result.effect_confirmed).toBe('missing');
    expect(result.adversarial).toBe('missing');
    expect(result.ledger_status).toBe('missing');
    expect(result.axis_aligned).toBe('missing');
  });

  it('description 存在 → fr=ok', () => {
    const result = computeLedgerStatus({ description: '功能描述' }, {}, {}, NOW);
    expect(result.fr).toBe('ok');
  });

  it('nfrMap 有计数 → nfr=ok', () => {
    const feature = { id: 'feat-1' };
    const result = computeLedgerStatus(feature, { 'feat-1': 2 }, {}, NOW);
    expect(result.nfr).toBe('ok');
  });

  it('nfrMap 无计数但有 smoke_cmd → nfr=partial', () => {
    const feature = { id: 'feat-1', smoke_cmd: 'bash smoke.sh' };
    const result = computeLedgerStatus(feature, {}, {}, NOW);
    expect(result.nfr).toBe('partial');
  });

  it('三测试全 true → checkpoints_status=ok', () => {
    const feature = { has_unit_test: true, has_integration_test: true, has_e2e: true };
    const result = computeLedgerStatus(feature, {}, {}, NOW);
    expect(result.checkpoints).toBe(3);
    expect(result.checkpoints_status).toBe('ok');
  });

  it('last_verified 25天前 → freshness_status=ok', () => {
    const d = new Date(NOW - 25 * 86400000).toISOString();
    const result = computeLedgerStatus({ last_verified: d }, {}, {}, NOW);
    expect(result.freshness_status).toBe('ok');
  });

  it('last_verified 60天前 → freshness_status=partial', () => {
    const d = new Date(NOW - 60 * 86400000).toISOString();
    const result = computeLedgerStatus({ last_verified: d }, {}, {}, NOW);
    expect(result.freshness_status).toBe('partial');
  });

  it('last_verified 100天前 → freshness_status=stale', () => {
    const d = new Date(NOW - 100 * 86400000).toISOString();
    const result = computeLedgerStatus({ last_verified: d }, {}, {}, NOW);
    expect(result.freshness_status).toBe('stale');
  });

  it('smoke_status=failing → death_alert=alert', () => {
    const result = computeLedgerStatus({ smoke_status: 'failing' }, {}, {}, NOW);
    expect(result.death_alert).toBe('alert');
  });

  it('smoke_status=passing → death_alert=ok, effect_confirmed=ok', () => {
    const result = computeLedgerStatus({ smoke_status: 'passing', smoke_cmd: 'x' }, {}, {}, NOW);
    expect(result.death_alert).toBe('ok');
    expect(result.effect_confirmed).toBe('ok');
  });

  it('notes 含"对抗" → adversarial=ok', () => {
    const result = computeLedgerStatus({ notes: '输入对抗面已覆盖' }, {}, {}, NOW);
    expect(result.adversarial).toBe('ok');
  });

  it('priority 设置 + status=active → axis_aligned=ok', () => {
    const result = computeLedgerStatus({ priority: 'P0', status: 'active' }, {}, {}, NOW);
    expect(result.axis_aligned).toBe('ok');
  });

  it('journey_features 行（无 smoke/test 列）不报错，返回合理 missing 值', () => {
    // journey_features 只有 id/name/thickness/status/updated_at 等，无 smoke_cmd 等字段
    const journeyFeature = {
      id: '00000000-0000-0000-0000-000000000001',
      name: '用户登录',
      status: 'done',
      updated_at: new Date(NOW - 3 * 86400000).toISOString(),
    };
    expect(() => computeLedgerStatus(journeyFeature, {}, {}, NOW)).not.toThrow();
    const result = computeLedgerStatus(journeyFeature, {}, {}, NOW);
    expect(result.ledger_status).toBe('ok'); // updated 3天前
    expect(result.fr).toBe('missing');       // 无 description
    expect(result.death_alert).toBe('missing'); // 无 smoke_cmd
  });
});

describe('eleven-elements-ledger — daysSince', () => {
  it('null 输入 → null', () => {
    expect(daysSince(null, NOW)).toBeNull();
  });

  it('7天前 → 7', () => {
    const d = new Date(NOW - 7 * 86400000).toISOString();
    expect(daysSince(d, NOW)).toBe(7);
  });
});
