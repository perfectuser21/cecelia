/**
 * Regression test: PostgresSaver checkpointer 连接必须有「查询级超时」防止静默无限挂起。
 *
 * 根因（生产 run 4225330d，2026-06-13，反复卡死靠 watchdog/人工兜底）：
 *   GAN 子图 + 所有 harness graph 用 durability:'sync'，每个节点转换都同步 await
 *   一次 checkpoint 写入（PostgresSaver.put）。旧实现 `PostgresSaver.fromConnString(connStr)`
 *   内部 `new Pool({ connectionString })` —— 没有 query_timeout / statement_timeout /
 *   connectionTimeoutMillis / keepAlive。
 *
 *   GAN proposer/reviewer 容器 exit=0 后 executeInDocker 已 return（日志 `[spawn] end`），
 *   但紧接着 LangGraph 的 checkpoint 写入若卡在一条「TCP 静默死掉」的连接上，put() 永不 resolve，
 *   此时容器内心跳已被 finally clearInterval 清掉 → 图静默 → 只能等 20min watchdog fresh-start。
 *   生产实测：reviewer 07:02:39 干净退出 → 24 分钟零日志 → 07:26:43 watchdog 兜底。
 *
 * 教训：反复靠兜底 = 根因没治。容器「完成信号」之后的 await（checkpoint 写入）链必须可靠 settle。
 *
 * 修复：checkpointer 的 pg pool 注入 query_timeout（客户端定时器，连接静默死也强制 reject）
 *      + statement_timeout（服务端）+ connectionTimeoutMillis + keepAlive。让 checkpoint
 *      await 必然 settle（成功或报错走 LangGraph 错误/重试路径），不再静默无限挂起。
 */
import { describe, it, expect } from 'vitest';
import { buildCheckpointerPool, buildPgCheckpointer } from '../orchestrator/pg-checkpointer.js';

describe('pg-checkpointer 连接超时硬化（GAN 容器退出后图可靠推进根因修复）', () => {
  it('buildCheckpointerPool 注入 query_timeout / statement_timeout / connectionTimeoutMillis / keepAlive（旧 fromConnString 全缺 → 可无限挂起）', async () => {
    const pool = buildCheckpointerPool('postgresql://cecelia@localhost:5432/cecelia');
    try {
      expect(pool.options.query_timeout).toBeGreaterThan(0);
      expect(pool.options.statement_timeout).toBeGreaterThan(0);
      expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
      expect(pool.options.keepAlive).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('buildPgCheckpointer 返回的 PostgresSaver 底层 pool 带超时（单点修复覆盖所有 graph）', async () => {
    const cp = buildPgCheckpointer('postgresql://cecelia@localhost:5432/cecelia');
    try {
      expect(cp.pool.options.query_timeout).toBeGreaterThan(0);
      expect(cp.pool.options.keepAlive).toBe(true);
    } finally {
      await cp.pool.end();
    }
  });

  it('连接不可达时 query() 在有界时间内 reject，不会无限挂起（复现「容器退出后 await 必 settle」）', async () => {
    // 10.255.255.1 = 不可路由地址（RFC 5737 风格黑洞）；TCP SYN 无人应答。
    // 旧 pool（无 connectionTimeoutMillis）会挂到 OS TCP 超时（数分钟级）；
    // 修复后 connectionTimeoutMillis 强制在有界时间内 reject → 模拟 checkpoint 写入不再静默无限挂起。
    const pool = buildCheckpointerPool('postgresql://cecelia@10.255.255.1:5432/cecelia', {
      connectionTimeoutMillis: 800,
      query_timeout: 800,
    });
    const start = Date.now();
    let rejected = false;
    try {
      await pool.query('SELECT 1');
    } catch {
      rejected = true;
    } finally {
      await pool.end().catch(() => {});
    }
    const elapsed = Date.now() - start;
    expect(rejected).toBe(true);
    expect(elapsed).toBeLessThan(5000); // 有界 settle，绝不无限挂起
  });
});
