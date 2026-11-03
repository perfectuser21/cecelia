import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMcpPgFixture } from '../helpers/mcp-pg-fixture.js';
import { query } from '../../src/db.js';
import { assertReadonly } from '../../src/self-check.js';

let fixture, pool;
beforeAll(async () => { fixture = await createMcpPgFixture(); pool = fixture.readonlyPool; });
afterAll(async () => { await fixture?.close(); });

describe('真实PG db pool', () => {
  it('轻查询 2s 内返回结果', async () => {
    const result = await query(pool, 'SELECT 1 as one', [], { timeoutMs: 2000 });
    expect(result.rows[0].one).toBe(1);
  });

  it('查询超时抛出 timeout 错误', async () => {
    await expect(
      query(pool, 'SELECT pg_sleep(3)', [], { timeoutMs: 100 })
    ).rejects.toThrow('timeout');
  });

  it('连接池 max 上限为 5', () => {
    expect(pool.options.max).toBe(5);
  });

  it('超时后归还的连接不会把 statement_timeout 泄漏给下一个查询', async () => {
    // 先触发一次 100ms 超时查询（会走 finally 里的 client.release()）
    await expect(
      query(pool, 'SELECT pg_sleep(3)', [], { timeoutMs: 100 })
    ).rejects.toThrow('timeout');

    // 紧接着用一个明显更长、但仍然合理的耗时查询 + 更大的 timeoutMs
    // 如果 statement_timeout 没有被重置，前一个 client 被复用时依旧携带 100ms 限制，这里会误报超时
    const result = await query(pool, 'SELECT pg_sleep(0.3), 42 as answer', [], { timeoutMs: 2000 });
    expect(result.rows[0].answer).toBe(42);
  });

  it('timeoutMs 携带 SQL 注入载荷时拒绝执行，而不是把恶意语句拼进 SET 命令', async () => {
    // query() 内部用字符串拼接构造 `SET statement_timeout = ${timeoutMs}`，
    // 且这是单字符串形式的 client.query() 调用（走 PG simple-query 协议，
    // 允许用分号分隔多条语句）——params 数组完全保护不到这里，因为
    // timeoutMs 根本没有走 params。传一个恶意字符串必须在拼接前被拒绝。
    const maliciousTimeout = '5000; DROP TABLE mcp_readonly_injection_probe --';

    await expect(
      query(pool, 'SELECT 1', [], { timeoutMs: maliciousTimeout })
    ).rejects.toThrow('invalid timeoutMs');
  });

  it('只读角色真实拒绝写入，失败后原数据仍持久存在', async () => {
    await expect(assertReadonly(sql => query(pool, sql))).resolves.toBeUndefined();
    await expect(assertReadonly(sql => query(fixture.pool, sql))).rejects.toThrow(/账号权限配置错误/);
    await expect(query(pool, "INSERT INTO schema_version VALUES ('9998','must reject')")).rejects.toMatchObject({ code: '42501' });
    const result = await query(pool, "SELECT version FROM schema_version ORDER BY version");
    expect(result.rows.map(row => row.version)).toEqual(['402', '405']);
  });

  it('超时错误后原连接上的statement_timeout确实归零', async () => {
    await expect(query(pool, 'SELECT pg_sleep(1)', [], { timeoutMs: 50 })).rejects.toThrow('timeout');
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT current_setting('statement_timeout') AS timeout");
      expect(result.rows[0].timeout).toBe('0');
    } finally { client.release(); }
  });
});
