import { describe, expect, it, vi } from 'vitest';
import { importCompanyKrs } from '../company-kr-import.js';
import { COMPANY_KR_CATALOG, COMPANY_GOALS } from '../company-kr-metrics.js';

const snapshot = () => ({ records: COMPANY_KR_CATALOG.map(r => ({ ...r, start: 0, current: 0, target: 8, area_ids: [], status: 'Open', updated_at: '2026-09-14T15:05:00Z' })), goals: COMPANY_GOALS.map(g => ({ ...g, area_ids: [], status: 'Not Started' })) });
describe('公司source ID导入', () => {
  it('相同pageID但其它源库归属的Goal不得被认领', async () => {
    const query = vi.fn(async sql => sql.includes('FROM objectives') ? { rows: [{ id: 'foreign', metadata: { source_system: 'notion-company-okr' }, custom_props: { company_notion: { database_id: 'wrong-database' } } }] } : sql.includes('FROM tasks') ? { rows: [{ id: 'task', result: {} }] } : sql.includes('INSERT INTO key_results') ? { rows: [{ id: 'new' }] } : { rows: [], rowCount: 1 });
    await expect(importCompanyKrs({ connect: async () => ({ query, release() {} }) }, snapshot(), { actor: 'codex', task_id: 'task' })).rejects.toThrow('归属');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO key_results'))).toBe(false);
  });
  it('重复来源必须在BEGIN前拒绝', async () => {
    const pool = { connect: vi.fn() };
    const data = snapshot(); data.records.push(data.records[0]);
    await expect(importCompanyKrs(pool, data, { actor: 'codex', task_id: 'task' })).rejects.toThrow('重复');
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

  it('公司KR可增长到9条并使用明确Unit和新Goal，不按标题认领', async () => {
    const data = snapshot();
    data.goals.push({ page_id: 'new-goal', title: '新目标', area_ids: ['area'], status: 'Open' });
    data.records.push({ page_id: 'new-page', goal_id: 'new-goal', title: data.records[0].title, unit: '客户数', area_ids: ['area'], start: 0, current: 1, target: 9, status: 'Open' });
    let seq = 0;
    const query = vi.fn(async sql => /INSERT INTO (?:objectives|key_results)/.test(sql) ? { rows: [{ id: `id-${++seq}` }] } : sql.includes('FROM tasks') ? { rows: [{ id: 'task', result: {} }] } : { rows: [] });
    const result = await importCompanyKrs({ connect: async () => ({ query, release() {} }) }, data, { task_id: 'task', actor: 'test' });
    expect(result).toMatchObject({ created: 9, company_kr_count: 9 });
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO key_results'))).toHaveLength(9);
  });
