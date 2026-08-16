/**
 * 冻结合同测试 — run d1360a48 真实 changed_files 回归夹具
 *
 * PRD Golden Path Step 1 + 边界（不依赖实时 Map）：
 *   用 run d1360a48 录制的 radius 响应（含仓库根无主文件 DoD.md）喂给 evaluateDiffGate：
 *     - 旧代码：freshness.status !== 'fresh' → {impact_unknown, mapper_stale, retryable:true}（kernel 无限重试到 deadline）
 *     - 新代码：确定性 → {blocked, impact_anchor_missing, retryable:false, detail.unclaimed_files:['DoD.md']}
 *   本测试断言新行为（当前基线跑此测试为 RED，实现后转 GREEN，即复现修复）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const here = dirname(fileURLToPath(import.meta.url));
const recorded = JSON.parse(
  readFileSync(join(here, 'fixtures', 'd1360a48-radius-impact-anchor-missing.json'), 'utf8'),
);

describe('run d1360a48 回归：无主文件不再折叠成 mapper_stale 无限重试', () => {
  it('录制 radius 响应 → blocked/impact_anchor_missing/retryable false/detail.unclaimed_files 带 DoD.md', async () => {
    const mapClient = async () => recorded.mapper_response;
    const result = await evaluateDiffGate({
      mapClient,
      taskId: recorded.recorded_task_id,
      changedFiles: recorded.changed_files,
      repo: 'perfectuser21/cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toContain('DoD.md');
  });
});
