/**
 * conversation-ttl-archiver.test.js
 *
 * [BEHAVIOR] B1 — 10min 内重复调用跳过（不查 DB）
 * [BEHAVIOR] B2 — 10min 后触发 UPDATE，返回归档条数
 * [BEHAVIOR] B3 — DB 无过期 conversation 时 archived=0
 * [BEHAVIOR] B4 — UPDATE SQL 限定 status IN ('active','suspended') + ttl_expires_at < NOW()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runConversationTtlArchiver,
  __resetConvTtlArchiverForTest,
} from '../conversation-ttl-archiver.js';

function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('runConversationTtlArchiver', () => {
  beforeEach(() => {
    __resetConvTtlArchiverForTest();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('[B1] 10min 内第二次调用跳过（不查 DB）', async () => {
    const pool = makePool([{ id: 'conv-1' }]);
    await runConversationTtlArchiver(pool);          // 首次
    const r = await runConversationTtlArchiver(pool); // 10min 内
    expect(r.skipped).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('[B2] 10min 后触发查询，返回归档条数', async () => {
    const pool = makePool([{ id: 'conv-1' }, { id: 'conv-2' }]);
    await runConversationTtlArchiver(pool);                    // 首次
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    const r = await runConversationTtlArchiver(pool);          // 10min 后
    expect(r.skipped).toBe(false);
    expect(r.archived).toBe(2);
  });

  it('[B3] DB 无过期对话时 archived=0，skipped=false', async () => {
    const pool = makePool([]);
    const r = await runConversationTtlArchiver(pool);
    expect(r.skipped).toBe(false);
    expect(r.archived).toBe(0);
  });

  it('[B4] SQL 包含正确 status IN 条件 + ttl_expires_at < NOW()', async () => {
    const pool = makePool([]);
    await runConversationTtlArchiver(pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/status\s+IN\s+\('active',\s*'suspended'\)/i);
    expect(sql).toMatch(/ttl_expires_at\s+<\s+NOW\(\)/i);
    expect(sql).toMatch(/status\s*=\s*'archived'/i);
  });
});
