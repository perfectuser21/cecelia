/**
 * Regression test: GAN 子图 thread_id + proposer 分支按父图 fresh-start 代际（attemptN）版本化。
 *
 * 根因（生产 run 4225330d，#3380 遗留①）：GAN 子图 thread_id 旧用裸 String(taskId)，与父图
 * 版本化 thread（harness-initiative:id:attemptN）不一致。父图 fresh-start（新 attempt）时：
 *   - GAN 复用同一裸 thread 的旧 checkpoint（不是干净重跑）；
 *   - proposer 分支只按 round+taskId 命名 → B59-idem 幂等门发现上一代旧分支「合同已存在」→ 每轮跳过
 *     spawn，proposer 从不产新合同 → GAN 空转、烧 execution_attempts，fresh-start 无法自愈。
 *
 * 修复：thread_id = `${taskId}:gan:${attemptN}`、proposer 分支 = `...-a${attemptN}`。
 * 每代拿干净 thread + 独立分支；同一 attempt 内（含 brain restart，execution_attempts 不变）稳定可 resume。
 */
import { describe, it, expect } from 'vitest';
import { ganThreadIdFor, proposeBranchFor } from '../harness-gan.graph.js';

describe('GAN thread_id / proposer 分支 attempt 版本化', () => {
  it('ganThreadIdFor：格式 `${taskId}:gan:${attemptN}`', () => {
    expect(ganThreadIdFor('task-abc', 0)).toBe('task-abc:gan:0');
    expect(ganThreadIdFor('task-abc', 3)).toBe('task-abc:gan:3');
  });

  it('ganThreadIdFor：不同 attemptN → 不同 thread（fresh-start 不复用旧 checkpoint）', () => {
    const a0 = ganThreadIdFor('t1', 0);
    const a1 = ganThreadIdFor('t1', 1);
    const a2 = ganThreadIdFor('t1', 2);
    expect(new Set([a0, a1, a2]).size).toBe(3);
  });

  it('ganThreadIdFor：同 taskId + 同 attemptN → 稳定（brain restart resume 续同一 thread）', () => {
    expect(ganThreadIdFor('t1', 2)).toBe(ganThreadIdFor('t1', 2));
  });

  it('ganThreadIdFor：attemptN 缺省/非数字 → 归一为 0', () => {
    expect(ganThreadIdFor('t1')).toBe('t1:gan:0');
    expect(ganThreadIdFor('t1', undefined)).toBe('t1:gan:0');
    expect(ganThreadIdFor('t1', NaN)).toBe('t1:gan:0');
  });

  it('proposeBranchFor：带 -a${attemptN} 后缀，taskId 取前 8 位', () => {
    expect(proposeBranchFor('abcd1234-5678-90', 1, 0)).toBe('cp-harness-propose-r1-abcd1234-a0');
    expect(proposeBranchFor('abcd1234-5678-90', 2, 5)).toBe('cp-harness-propose-r2-abcd1234-a5');
  });

  it('proposeBranchFor：不同 attemptN → 不同分支（B59-idem 不跨 attempt 复用旧合同）', () => {
    const b0 = proposeBranchFor('abcd1234', 1, 0);
    const b1 = proposeBranchFor('abcd1234', 1, 1);
    expect(b0).not.toBe(b1);
  });

  it('proposeBranchFor：仍以 cp-harness-propose- 开头（通配清理/查询不受影响）', () => {
    expect(proposeBranchFor('abcd1234', 3, 7)).toMatch(/^cp-harness-propose-/);
  });
});
