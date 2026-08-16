/**
 * 回归夹具：run d1360a48 真实 changed_files（含 DoD.md）+ 真实 radius 响应录制件
 * —— sprint 08161030-kernel-f9f943fc
 *
 * 复现根因：旧代码 evaluateDiffGate 把该录制件（freshness.status='unknown',
 * reason_code='impact_anchor_missing'）折叠成 mapper_stale/retryable:true，kernel 无限重试到 deadline。
 * 新代码：确定性结论 → blocked/reason='impact_anchor_missing'/retryable:false + detail.unclaimed_files=['DoD.md']。
 *
 * mapper 在范围外，用录制件注入（见 contract-draft.md「未覆盖真实链路清单」）；diff-gate 分类逻辑真实执行。
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateDiffGate } from '../diff-gate.js';

const FIXTURE_URL = new URL(
  '../../../../../sprints/08161030-kernel-f9f943fc/fixtures/radius-d1360a48-impact-anchor.json',
  import.meta.url,
);
const recorded = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), 'utf8'));

describe('回归夹具 run d1360a48（08161030-kernel-f9f943fc）', () => {
  test('录制 radius 响应（含 DoD.md 无主文件）→ 新代码 blocked:impact_anchor_missing/retryable=false', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: '0ca4b234',
      mapClient: async () => recorded,
      changedFiles: recorded.changed_files,
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toContain('DoD.md');
  });
});
