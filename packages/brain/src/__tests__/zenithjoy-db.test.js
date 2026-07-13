import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import defaultPool from '../db.js';
import { getZenithjoyPool, _resetZenithjoyPoolForTest } from '../zenithjoy-db.js';

// 拆库刀1（决策 0710）：ZENITHJOY_DB_NAME 未设 = 行为不变（返回主 pool 同一引用）；
// 设了 = 独立 Pool 指向该库。切换前两 PR 可安全合并的向后兼容契约就在这两条断言里。
describe('zenithjoy-db: 可切换独立连接池', () => {
  const ENV_KEYS = ['ZENITHJOY_DB_NAME', 'ZENITHJOY_DB_HOST', 'ZENITHJOY_DB_PORT', 'ZENITHJOY_DB_USER', 'ZENITHJOY_DB_PASSWORD'];
  const saved = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    _resetZenithjoyPoolForTest();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    _resetZenithjoyPoolForTest();
  });

  it('env 未设 → 返回主 pool 同一对象引用（零新连接池）', () => {
    expect(getZenithjoyPool()).toBe(defaultPool);
  });

  it('ZENITHJOY_DB_NAME 已设 → 独立 Pool 指向该库，且不是主 pool', () => {
    process.env.ZENITHJOY_DB_NAME = 'zenithjoy';
    const p = getZenithjoyPool();
    expect(p).not.toBe(defaultPool);
    expect(p.options.database).toBe('zenithjoy');
  });

  it('独立 Pool memoize（两次调用同一实例）', () => {
    process.env.ZENITHJOY_DB_NAME = 'zenithjoy';
    expect(getZenithjoyPool()).toBe(getZenithjoyPool());
  });

  it('ZENITHJOY_DB_HOST/USER 覆盖生效，未覆盖项回落 DB_DEFAULTS', async () => {
    process.env.ZENITHJOY_DB_NAME = 'zenithjoy';
    process.env.ZENITHJOY_DB_HOST = 'db.example.internal';
    process.env.ZENITHJOY_DB_USER = 'zj_user';
    const { DB_DEFAULTS } = await import('../db-config.js');
    const p = getZenithjoyPool();
    expect(p.options.host).toBe('db.example.internal');
    expect(p.options.user).toBe('zj_user');
    expect(p.options.port).toBe(DB_DEFAULTS.port);
  });

  it('execution.js 发布回执块已接线新池（源码契约：zenithjoy.* SQL 不再走主 pool.query）', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../routes/execution.js', import.meta.url), 'utf8');
    expect(src).toContain("from '../zenithjoy-db.js'");
    // 发布回执块内三条 zenithjoy.* SQL 全部走 zjPool
    const block = src.slice(src.indexOf('content_publish 完成'), src.indexOf('小任务积累触发'));
    expect(block).toContain('zjPool.query');
    expect((block.match(/pool\.query\(\s*[`']INSERT INTO zenithjoy/g) || []).length).toBe(0);
    expect((block.match(/pool\.query\(\s*[`']SELECT id FROM zenithjoy/g) || []).length).toBe(0);
  });
});
