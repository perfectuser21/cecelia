// 冻结合同测试 — 回归夹具：用 run d1360a48 真实录制件复现旧 mapper_stale / 新 blocked
// sprint: 08161127-kernel-0bce0b07
//
// 覆盖父路：独立小路（无父路）。
// 录制件 fixtures/radius-d1360a48-doc-md.json 是 radius.js 对 d1360a48 候选（含仓库根 DoD.md）的真实返回形态。
// 断言：新 diff-gate 把它分类为 blocked:impact_anchor_missing/retryable=false（旧代码折叠成 mapper_stale/retryable=true → RED）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const here = dirname(fileURLToPath(import.meta.url));
const recorded = JSON.parse(
  readFileSync(join(here, 'fixtures', 'radius-d1360a48-doc-md.json'), 'utf8'),
);

describe('回归夹具 run d1360a48（DoD.md 无主文件）[BEHAVIOR]', () => {
  it('真实录制件 → blocked:impact_anchor_missing/retryable=false，detail.unclaimed_files=["DoD.md"]', async () => {
    const result = await evaluateDiffGate({
      mapClient: async () => recorded,
      headRevision: 'a'.repeat(40),
      changedFiles: recorded.changed_files,
      repo: 'cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });
});
