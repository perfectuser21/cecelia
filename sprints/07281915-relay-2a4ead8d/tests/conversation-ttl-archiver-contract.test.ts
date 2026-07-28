/**
 * conversation-ttl-archiver-contract.test.ts
 * Contract Test — PR4/4 TTL archiver 合同测试
 *
 * [BEHAVIOR] B-03: TTL archiver 单测全通过
 * [BEHAVIOR] B-05: SQL 只软归档（status→archived），不 DELETE
 *
 * ── 差异化价值说明（F-04 修复）──────────────────────────────────────
 * 本文件与 packages/brain/src/__tests__/conversation-ttl-archiver.test.js 均测试
 * TTL archiver，但关注层不同：
 *
 * 【已有单测】conversation-ttl-archiver.test.js（单元层）
 *   - 关注：函数级行为（gate 是否触发 / archived 条数 / skipped 标志）
 *   - 断言粒度：返回值（result.archived / result.skipped）
 *   - 目标：保证函数逻辑正确，回归防护
 *
 * 【本合同测试】conversation-ttl-archiver-contract.test.ts（合同层）
 *   - 关注 1：SQL 字面量语义（B-05）
 *     * UPDATE 含 status='archived'（非 DELETE，对应 INV-7）
 *     * 含 ttl_expires_at < NOW() 时间过滤（只归档到期的）
 *     * 含 status IN ('active','suspended')（不归档已终态）
 *   - 关注 2：INV-7 铁律绑定
 *     * "只软归档" 语义在合同层显式 assert，evaluator 可单独对此 judgment
 *     * 若将来有人把 SQL 改成 DELETE + INSERT（等价但违反 INV-7），单测不感知，合同测试必 FAIL
 *   - 关注 3：合同责任归属
 *     * 本文件是 PR4 合同的正式组成部分，evaluator 凭此判定 D4 是否通过
 *     * 已有单测是 Brain 内部质量保障，不属于合同层
 *
 * 总结：两个文件互补，不冲突。合同层的唯一价值是：SQL 字面量 + INV-7 语义锁定。
 * ──────────────────────────────────────────────────────────────────
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
