import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeLedgerStatus } from '../../lib/eleven-elements-ledger.js';

// 注：buildWhereClause 测试不需要 DB mock，单独 import
// GET /ledger 测试需要 DB mock，放在独立 describe 块内动态 import

describe('features route — buildWhereClause', () => {
  it('returns empty clause when no filters', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({});
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('filters by priority', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ priority: 'P0' });
    expect(where).toBe('WHERE priority = $1');
    expect(params).toEqual(['P0']);
  });

  it('handles smoke_cmd null filter', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ smoke_cmd: 'null' });
    expect(where).toBe('WHERE smoke_cmd IS NULL');
    expect(params).toEqual([]);
  });

  it('combines domain and area filters', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ domain: 'brain', area: 'health' });
    expect(where).toContain('domain = $1');
    expect(where).toContain('area = $2');
    expect(params).toEqual(['brain', 'health']);
  });
});

// 验证 GET /ledger 端点查询的是 brain_modules 表，而非旧的 features 表
// 通过读源码确认（避免 vi.mock hoisting 复杂性，且更直接）
describe('features route — SQL 表名验证', () => {
  it('features.js 源码所有 SQL 使用 brain_modules 而非 features', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../features.js'), 'utf8');

    // 所有 SQL 关键字后应该跟 brain_modules，不能有 FROM features / INTO features 等
    expect(src).toMatch(/FROM brain_modules/);
    expect(src).toMatch(/INTO brain_modules/);
    expect(src).toMatch(/UPDATE brain_modules/);
    expect(src).not.toMatch(/FROM features\b/);
    expect(src).not.toMatch(/INTO features\b/);
    expect(src).not.toMatch(/UPDATE features\b/);
  });

  it('features.js 导入了 computeLedgerStatus 共享函数', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../features.js'), 'utf8');
    expect(src).toContain("import { computeLedgerStatus }");
    expect(src).toContain("eleven-elements-ledger");
  });
});

// 验证 computeLedgerStatus 被 features.js 和 journeys.js 共享使用（不是各写一份）
describe('eleven-elements-ledger — 共享纯函数', () => {
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

  it('全齐的模块返回 ok', () => {
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
    const old = { ...baseFeature, last_verified: '2025-10-01T00:00:00Z' }; // >90天
    const result = computeLedgerStatus(old, {}, {}, NOW);
    expect(result.freshness_status).toBe('stale');
  });

  it('smoke_status=failing → death_alert: alert', () => {
    const result = computeLedgerStatus({ ...baseFeature, smoke_status: 'failing' }, {}, {}, NOW);
    expect(result.death_alert).toBe('alert');
  });
});
