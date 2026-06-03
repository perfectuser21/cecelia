import { describe, it, expect, beforeEach, vi } from 'vitest';

// 注入假 db pool（load-machines 用 default import 的 pool.query）
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query } }));

import { loadActiveMachines, clearMachineCache } from './load-machines.js';

describe('loadActiveMachines', () => {
  beforeEach(() => {
    query.mockReset();
    clearMachineCache();
  });

  it('查 system_registry type=machine status=active 且 ORDER BY name，返回 rows', async () => {
    query.mockResolvedValue({ rows: [{ name: 'mac-mini-m4-us', status: 'active', metadata: {} }] });
    const r = await loadActiveMachines();
    expect(r).toEqual([{ name: 'mac-mini-m4-us', status: 'active', metadata: {} }]);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/type = 'machine'/);
    expect(sql).toMatch(/status = 'active'/);
    expect(sql).toMatch(/ORDER BY name/);
  });

  it('5s 内命中缓存，不二次查 DB', async () => {
    query.mockResolvedValue({ rows: [{ name: 'a' }] });
    await loadActiveMachines();
    await loadActiveMachines();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('clearMachineCache 后重新查 DB（注册/改机器立即可见）', async () => {
    query.mockResolvedValue({ rows: [{ name: 'a' }] });
    await loadActiveMachines();
    clearMachineCache();
    await loadActiveMachines();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('DB 查询抛错向上传播（由 resolveExecutor 决定降级/抛错）', async () => {
    query.mockRejectedValue(new Error('db down'));
    await expect(loadActiveMachines()).rejects.toThrow('db down');
  });
});
