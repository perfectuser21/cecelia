import { describe, expect, it, vi } from 'vitest';
import { importCompanyKrs } from '../company-kr-import.js';
import { COMPANY_KR_CATALOG, COMPANY_GOALS } from '../company-kr-metrics.js';

const snapshot = () => ({ records: COMPANY_KR_CATALOG.map(r => ({ ...r, start: 0, current: 0, target: 8, area_ids: [], status: 'Open', updated_at: '2026-09-14T15:05:00Z' })), goals: COMPANY_GOALS.map(g => ({ ...g, area_ids: [], status: 'Not Started' })) });
describe('公司source ID导入', () => {
  it('缺页或错Goal必须在BEGIN前拒绝', async () => {
    const pool = { connect: vi.fn() };
    const data = snapshot(); data.records.pop();
    await expect(importCompanyKrs(pool, data, { actor: 'codex', task_id: 'task' })).rejects.toThrow('8');
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('按sourcepage而非同名编号认领，6人工历史0标未验证；空Area保持空', async () => {
    let seq = 0;
    const query = vi.fn(async (sql) => /INSERT INTO (?:objectives|key_results)/.test(sql) ? { rows: [{ id: `id-${++seq}` }], rowCount: 1 } : /SELECT.*FROM tasks/s.test(sql) ? { rows: [{ id: 'task', result: {} }] } : { rows: [], rowCount: 1 });
    const release = vi.fn();
    await importCompanyKrs({ connect: async () => ({ query, release }) }, snapshot(), { actor: 'codex', task_id: 'task' });
    const inserts = query.mock.calls.filter(([sql]) => /INSERT INTO key_results/.test(sql));
    expect(inserts).toHaveLength(8);
    const metas = inserts.map(([, params]) => params.map(p => { try { return JSON.parse(p); } catch { return null; } }).find(p => p?.metric_mode));
    expect(metas.filter(m => m.validation_state === 'unverified')).toHaveLength(8);
    expect(metas.every(m => m.company_metric.current === '0')).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
});
