import { describe, it, expect } from 'vitest';

// db.js 在 import 时只构造 Pool，不建连接（node-pg 懒连接）；测试环境 DB_NAME 默认 cecelia_test，
// db-config 的 guard 保证不会误连生产库。
describe('db.js — 主连接池配置', () => {
  it('Pool 透传 DB_DEFAULTS.query_timeout（09-24 gtd 卡死案：整轮唯一无界 await 是 pg 查询）', async () => {
    const { DB_DEFAULTS } = await import('../db-config.js');
    const { default: pool } = await import('../db.js');
    expect(pool.options.query_timeout).toBe(DB_DEFAULTS.query_timeout);
    expect(pool.options.connectionTimeoutMillis).toBe(DB_DEFAULTS.connectionTimeoutMillis);
  });

  it('getPoolHealth 返回四个数字且 activeCount = total - idle', async () => {
    const { getPoolHealth } = await import('../db.js');
    const h = getPoolHealth();
    for (const k of ['total', 'idle', 'waiting', 'activeCount']) expect(typeof h[k]).toBe('number');
    expect(h.activeCount).toBe(h.total - h.idle);
  });
});
