/**
 * [BEHAVIOR] 冻结合同测试 — run d1360a48 录制件回归夹具（TDD Red）
 *
 * PRD 验收 bullet 3：用 run d1360a48 真实 changed_files（含 DoD.md）+ 真实 radius 响应
 * 录制件复现 —— 旧代码把它折叠成 mapper_stale/retryable=true（无限重试根因），新代码
 * 必须判定 blocked:impact_anchor_missing/retryable=false 并带 detail.unclaimed_files。
 *
 * 禁 mock 被改的边：真调 evaluateDiffGate（被改边），mapper 用录制件回放（外层边界）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/d1360a48-radius-impact-anchor-missing.json', import.meta.url)),
  'utf8',
));

describe('Diff Impact Gate — d1360a48 录制件回归（合同冻结）', () => {
  it('真实 changed_files(含 DoD.md) + 录制 radius 响应 → blocked:impact_anchor_missing/retryable=false', async () => {
    const result = await evaluateDiffGate({
      mapClient: async () => fixture.radius_response,
      headRevision: 'bc4e8644bc4e8644bc4e8644bc4e8644bc4e8644',
      changedFiles: fixture.changed_files,
      repo: 'perfectuser21/cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });
});
