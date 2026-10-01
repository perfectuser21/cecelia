/**
 * A6 新口径（Skill 台账投影 PR1a）：
 *  ① ops_skills(openclaw) 名字 ⊆ skill_registry presence=present
 *  ② 带 task_types 的派发绑定行不得 gone/broken
 *  扫描从未成功 → ok+degraded；红时始终 upsert 一条 __skill_ledger_count__ 汇总行
 */
import { describe, it, expect, vi } from 'vitest';
import { buildSkillLedgerAssertion, SCAN_STALE_HOURS } from '../skill-ledger-assertion.js';

function pool({ state = { last_ok_at: '2026-09-30T00:00:00Z' }, unregistered = [], deadBound = [] } = {}) {
  const writes = [];
  return {
    writes,
    query: vi.fn(async (sql, params) => {
      if (sql.includes("key = 'skill_inventory_state'")) return { rows: state ? [{ value_json: state }] : [] };
      if (sql.includes('FROM ops_skills')) return { rows: unregistered.map((name) => ({ name })) };
      if (sql.includes('task_types')) return { rows: deadBound };
      if (sql.includes('INSERT INTO skill_drift_alerts')) { writes.push(params); return { rows: [] }; }
      return { rows: [] };
    }),
  };
}

describe('buildSkillLedgerAssertion', () => {
  it('扫描从未成功 → ok + degraded，不查账不落账', async () => {
    const p = pool({ state: null });
    const a = await buildSkillLedgerAssertion(p);
    expect(a).toMatchObject({ key: 'skill_ledger_consistency', ok: true, degraded: true });
    expect(p.writes).toEqual([]);
  });

  it('两项都干净 → ok', async () => {
    // 固定时钟与扫描样本同日，避免该正常样本随着真实日期过期。
    const a = await buildSkillLedgerAssertion(pool(), { now: Date.parse('2026-09-30T03:00:00Z') });
    expect(a.ok).toBe(true);
    expect(a.degraded).toBeFalsy();
  });

  it('① ops_skills 引用了账本里不在的 skill → 红，点名，落汇总行', async () => {
    const p = pool({ unregistered: ['ghost-skill'] });
    const a = await buildSkillLedgerAssertion(p);
    expect(a.ok).toBe(false);
    expect(a.detail).toMatch(/账实分叉/);
    expect(a.detail).toContain('ghost-skill');
    expect(p.writes).toHaveLength(1);
    expect(p.writes[0][0]).toBe('__skill_ledger_count__');
  });

  it('② 派发绑定行指向已下线/断链 skill → 红，点名带状态', async () => {
    const p = pool({ deadBound: [{ name: 'prd-review', presence: 'broken' }] });
    const a = await buildSkillLedgerAssertion(p);
    expect(a.ok).toBe(false);
    expect(a.detail).toContain('prd-review(broken)');
  });

  it('skill_drift_alerts 落账失败 → 仍 ok:false，detail 改为「落账失败」且不向外抛错', async () => {
    const p = pool({ unregistered: ['ghost-skill'] });
    // mock INSERT 抛错
    p.query = vi.fn(async (sql, params) => {
      if (sql.includes("key = 'skill_inventory_state'")) return { rows: [{ value_json: { last_ok_at: '2026-09-30T00:00:00Z' } }] };
      if (sql.includes('FROM ops_skills')) return { rows: [{ name: 'ghost-skill' }] };
      if (sql.includes('task_types')) return { rows: [] };
      if (sql.includes('INSERT INTO skill_drift_alerts')) throw new Error('db down');
      return { rows: [] };
    });
    const a = await buildSkillLedgerAssertion(p);
    expect(a.ok).toBe(false);
    expect(a.detail).not.toContain('已记入');
    expect(a.detail).toContain('落账失败');
  });

  it('扫描停更超 SCAN_STALE_HOURS（27h 前成功）→ 红，detail 含「扫描停更」与小时数', async () => {
    const now = Date.parse('2026-09-30T03:00:00Z');
    const p = pool({ state: { last_ok_at: '2026-09-29T00:00:00Z', last_error: 'ssh timeout' } });
    const a = await buildSkillLedgerAssertion(p, { now });
    expect(a.ok).toBe(false);
    expect(a.detail).toContain('扫描停更');
    expect(a.detail).toContain('27');
    expect(p.writes).toHaveLength(1);
    expect(p.writes[0][0]).toBe('__skill_ledger_count__');
    expect(p.writes[0][1]).toContain('扫描停更=27h');
    expect(p.writes[0][2]).toContain('last_error=ssh timeout');
  });

  it('扫描 25h 前成功（未超阈值）→ 不因停更而红', async () => {
    const now = Date.parse('2026-09-30T01:00:00Z');
    const p = pool({ state: { last_ok_at: '2026-09-29T00:00:00Z' } });
    const a = await buildSkillLedgerAssertion(p, { now });
    expect(a.ok).toBe(true);
    expect(a.detail).not.toContain('扫描停更');
  });

  it('SCAN_STALE_HOURS 导出为 26', () => {
    expect(SCAN_STALE_HOURS).toBe(26);
  });
});
