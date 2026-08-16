/**
 * 冻结合同测试 — run d1360a48 回归夹具
 *
 * 用真实 changed_files（含仓库根 DoD.md）+ 真实 radius 响应录制件（fixtures/d1360a48-radius.json）
 * 复现：旧代码把该确定性结论折叠成 mapper_stale/retryable:true；新代码判为
 * blocked/impact_anchor_missing/retryable:false，detail 带 unclaimed_files。
 * 被改的边（禁 mock）：diff-gate 分类逻辑，真实执行；仅注入录制的 mapper 响应。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const fx = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/d1360a48-radius.json', import.meta.url)), 'utf8'),
);

describe('回归夹具 run d1360a48（真实 changed_files 含 DoD.md 的录制件）', () => {
  it('录制件经新代码判为 blocked impact_anchor_missing retryable false', async () => {
    const r = await evaluateDiffGate({
      taskId: fx.task_id,
      headRevision: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      changedFiles: fx.changed_files,
      mapClient: async () => fx.mapper_response,
    });
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe('impact_anchor_missing');
    expect(r.retryable).toBe(false);
    expect(r.detail?.unclaimed_files).toContain('DoD.md');
  });
});
