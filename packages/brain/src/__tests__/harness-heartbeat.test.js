/**
 * harness-heartbeat.test.js
 *
 * writeDriverHeartbeat：harness_initiative 的活驱动（executor stream loop /
 * run_sub_task poll）每 ~30s 调一次，把 tasks.driver_heartbeat_at 刷到 NOW()。
 * 看门狗据此判断「驱动器是否还活着」。
 *
 * 不变量：
 *   - UPDATE tasks SET driver_heartbeat_at=NOW() WHERE id=$1（带 harness_initiative 守卫）
 *   - 任何 DB 错误都吞掉（non-fatal）——心跳失败绝不能拖垮 graph 驱动
 */

import { describe, it, expect, vi } from 'vitest';

describe('writeDriverHeartbeat', () => {
  it('export 存在并是函数', async () => {
    const mod = await import('../harness-heartbeat.js');
    expect(typeof mod.writeDriverHeartbeat).toBe('function');
  });

  it('刷 driver_heartbeat_at=NOW() WHERE id=$1（带 task_type 守卫）', async () => {
    const calls = [];
    const fakePool = { query: vi.fn(async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; }) };
    const { writeDriverHeartbeat } = await import('../harness-heartbeat.js');
    await writeDriverHeartbeat(fakePool, 'init-123');
    expect(fakePool.query).toHaveBeenCalledTimes(1);
    const { sql, params } = calls[0];
    expect(sql).toMatch(/UPDATE\s+tasks/i);
    expect(sql).toMatch(/driver_heartbeat_at\s*=\s*NOW\(\)/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*\$1/i);
    expect(sql).toMatch(/harness_initiative/);
    expect(params).toEqual(['init-123']);
  });

  it('DB 报错被吞（non-fatal，不抛）', async () => {
    const fakePool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const { writeDriverHeartbeat } = await import('../harness-heartbeat.js');
    await expect(writeDriverHeartbeat(fakePool, 'init-x')).resolves.toBeUndefined();
  });

  it('initiativeId 缺失 → 不查库（no-op）', async () => {
    const fakePool = { query: vi.fn() };
    const { writeDriverHeartbeat } = await import('../harness-heartbeat.js');
    await writeDriverHeartbeat(fakePool, null);
    expect(fakePool.query).not.toHaveBeenCalled();
  });
});
