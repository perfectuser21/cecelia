/**
 * 合同冻结测试 — run d1360a48 真实回归夹具（PRD Golden Path / 边界情况）
 *
 * 用 run d1360a48 录制的真实 radius 响应（含仓库根 DoD.md → impact_anchor_missing、
 * Map 快照 fresh）喂给 diff-gate：新代码必须判 blocked:impact_anchor_missing/retryable:false，
 * 复现旧代码把它折叠成 mapper_stale/retryable:true 的生产事故（kernel 空转到 deadline）。
 *
 * 禁 mock 边：radius 输出是真实录制件（非手捏），diff-gate 分类真跑。
 *
 * TDD Red：旧代码对该夹具返回 mapper_stale → 断言 blocked 在旧代码下 FAIL；此测试永久保留
 * 为回归护栏，防止分类逻辑被回退。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/d1360a48-radius.json', import.meta.url)), 'utf8'),
);

describe('run d1360a48 回归夹具 [BEHAVIOR]', () => {
  it('真实 changed_files（含 DoD.md）+ 真实 radius 录制件 → blocked:impact_anchor_missing/retryable:false（非 mapper_stale）', async () => {
    const result = await evaluateDiffGate({
      repo: 'cecelia',
      changedFiles: fixture.changed_files,
      mapClient: async () => fixture.radius_response,
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
    // 回归护栏：绝不能再折叠成 mapper_stale
    expect(result.reason).not.toBe('mapper_stale');
  });
});
