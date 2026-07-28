/**
 * conversation-ttl-archiver-contract.test.ts
 * Contract Test — PR4/4 TTL archiver 合同测试
 *
 * [BEHAVIOR] B-03: TTL archiver 单测全通过
 * [BEHAVIOR] B-05: SQL 只软归档（status→archived），不 DELETE
 *
 * 补强 packages/brain/src/__tests__/conversation-ttl-archiver.test.js 已有测试，
 * 增加合同层面的集成视角断言。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runConversationTtlArchiver,
  __resetConvTtlArchiverForTest,
} from '../../../packages/brain/src/conversation-ttl-archiver.js';

function makePool(rows: { id: string }[] = []) {
  const queryMock = vi.fn().mockResolvedValue({ rows });
  return { query: queryMock };
}

describe('conversation-ttl-archiver — 合同断言（PR4/4 D4）', () => {
  beforeEach(() => {
    __resetConvTtlArchiverForTest();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('[B-03a] 到期 active conversation → status 变 archived', async () => {
    const pool = makePool([{ id: 'conv-expired-1' }]);
    const result = await runConversationTtlArchiver(pool);
    expect(result.skipped).toBe(false);
    expect(result.archived).toBe(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('[B-03b] 非到期 / 已终态 → archived=0（SQL 条件限制）', async () => {
    // pool 返回空行：模拟 DB 无符合条件记录
    const pool = makePool([]);
    const result = await runConversationTtlArchiver(pool);
    expect(result.skipped).toBe(false);
    expect(result.archived).toBe(0);
  });

  it('[B-03c] gate 10min 内重复调用 → skipped=true，不查 DB', async () => {
    const pool = makePool([{ id: 'conv-1' }]);
    await runConversationTtlArchiver(pool); // 首次
    const second = await runConversationTtlArchiver(pool); // 10min 内
    expect(second.skipped).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1); // 只调一次
  });

  it('[B-05] SQL 不含 DELETE — 只软归档（status→archived）', async () => {
    const pool = makePool([]);
    await runConversationTtlArchiver(pool);
    const [sql] = pool.query.mock.calls[0] as [string];
    // 必须含 UPDATE
    expect(sql).toMatch(/UPDATE\s+conversations/i);
    // 必须含 status = 'archived'
    expect(sql).toMatch(/status\s*=\s*'archived'/i);
    // 不得含 DELETE
    expect(sql).not.toMatch(/DELETE/i);
    // 必须含 ttl_expires_at < NOW() 时间窗（INV-7：只软归档到期的）
    expect(sql).toMatch(/ttl_expires_at\s*<\s*NOW\(\)/i);
  });

  it('[B-05b] SQL 限定 status IN (active, suspended) — 不归档已终态', async () => {
    const pool = makePool([]);
    await runConversationTtlArchiver(pool);
    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toMatch(/status\s+IN\s+\('active',\s*'suspended'\)/i);
  });
});
