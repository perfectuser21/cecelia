/**
 * okr-initiative-sync 单元测试（已退役，决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）
 *
 * 原"harness → okr_initiatives 活态镜像"业务意义已不存在（okr_initiatives 层冻结）。
 * 回归守卫：两个导出函数无论传入什么 pool/参数，都绝不调用 pool.query——防止镜像
 * 同步逻辑"复活"偷偷再写一次 okr_initiatives。lifecycle 合法性校验是纯参数校验，
 * 不查 DB，继续保留覆盖。
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveOrCreateOkrInitiative, syncOkrInitiativeStatus } from '../okr-initiative-sync.js';

const TASK = 'aaaa0001-0000-0000-0000-000000000001';

function makeSpyPool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('resolveOrCreateOkrInitiative（已退役，no-op）', () => {
  it('恒返回 null，且从不查询数据库', async () => {
    const pool = makeSpyPool();
    const id = await resolveOrCreateOkrInitiative(pool, TASK);
    expect(id).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('syncOkrInitiativeStatus（已退役，no-op）', () => {
  it('合法 lifecycle 值 → 恒返回 null，且从不查询数据库', async () => {
    const pool = makeSpyPool();
    const id = await syncOkrInitiativeStatus(pool, TASK, 'running');
    expect(id).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('done（终态）也恒返回 null，且从不查询数据库', async () => {
    const pool = makeSpyPool();
    const id = await syncOkrInitiativeStatus(pool, TASK, 'done');
    expect(id).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('非法 lifecycle 值 → 仍抛错（纯参数校验，防止调用方传错值被无声吞掉）', async () => {
    const pool = makeSpyPool();
    await expect(syncOkrInitiativeStatus(pool, TASK, 'active')).rejects.toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
