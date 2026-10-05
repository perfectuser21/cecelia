import { describe, expect, it, vi } from 'vitest';
import { loadCatalog } from './catalog.js';

describe('loadCatalog 完整性', () => {
  it('保留数据库实际返回的三个目录和采集时间', async () => {
    const rows = [[{ id: 'workflow-1' }], [{ id: 'activity-1' }], [{ id: 'skill-1' }]];
    const query = vi.fn();
    for (const result of rows) query.mockResolvedValueOnce({ rows: result });
    const result = await loadCatalog({ query });
    expect(result).toMatchObject({ workflows: rows[0], activities: rows[1], skills: rows[2] });
    expect(Number.isFinite(Date.parse(result.captured_at))).toBe(true);
  });
  it.each(['workflows', 'activities', 'skills'])('%s 超过2000项拒绝整份目录，不能静默截断', async (kind) => {
    const table = { workflows: 'workflows', activities: 'activities', skills: 'skill_registry' }[kind];
    const query = vi.fn(async sql => ({ rows: sql.includes(`FROM ${table} `) ? Array.from({ length: 2001 }, (_, i) => ({ id: String(i) })) : [] }));
    await expect(loadCatalog({ query })).rejects.toMatchObject({ code: 'catalog_too_large' });
  });
  it('2000项边界完整保留', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: String(i) }));
    const result = await loadCatalog({ query: vi.fn().mockResolvedValue({ rows }) });
    expect(result.skills).toHaveLength(2000);
    expect(result.skills.at(-1).id).toBe('1999');
  });
  it('已读出部分目录后数据库失败仍整体报错，不当空目录', async () => {
    const failure = new Error('目录数据库不可用');
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'existing-workflow' }] }).mockRejectedValueOnce(failure);
    await expect(loadCatalog({ query })).rejects.toBe(failure);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
