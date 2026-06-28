/**
 * Regression: routeAfterFix B18 删除了 MAX_FIX_ROUNDS 上限
 * → fix loop 无限重试 → 撞 LangGraph recursionLimit 200 → 不透明报错。
 *
 * 根因（2026-06-28，r3 run 36446078）：
 *   - B18 commit 删除 MAX_FIX_ROUNDS cap，认为"convergence 靠 PASS 而非轮次"
 *   - 但 host generator exit 127 永不产出 → 每轮 fix_dispatch 无限 loop
 *   - 14 轮 × ~14节点/轮 ≈ 196步 → LangGraph recursion limit 200
 *
 * 修复：fixDispatchNode 在 next > MAX_FIX_ROUNDS 时返回 {status:'failed', error:{...}}
 */
import { describe, it, expect } from 'vitest';
import { fixDispatchNode, MAX_FIX_ROUNDS } from '../harness-task.graph.js';

describe('fix-dispatch MAX_FIX_ROUNDS 上限（防 recursion limit 200）', () => {
  it('fix_round 超过 MAX_FIX_ROUNDS 时 fixDispatchNode 返回 status=failed', async () => {
    const result = await fixDispatchNode({
      fix_round: MAX_FIX_ROUNDS, // next = MAX+1 → 超限
      pr_url: null,
      pr_branch: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('fix_dispatch');
    expect(result.error.message).toMatch(/max fix rounds/i);
  });

  it('fix_round 未超限时正常 increment', async () => {
    const result = await fixDispatchNode({
      fix_round: 0,
      pr_url: null,
      pr_branch: null,
    });
    expect(result.status).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.fix_round).toBe(1);
  });

  it('fix_round 恰好等于 MAX_FIX_ROUNDS-1 时正常 increment（边界：最后一轮允许）', async () => {
    const result = await fixDispatchNode({
      fix_round: MAX_FIX_ROUNDS - 1,
      pr_url: null,
      pr_branch: null,
    });
    expect(result.fix_round).toBe(MAX_FIX_ROUNDS);
    expect(result.status).toBeUndefined();
  });
});
