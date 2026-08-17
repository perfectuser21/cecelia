/**
 * 合同冻结测试 — 回归夹具：run d1360a48 真实 changed_files（含 DoD.md）+ radius 录制件
 *
 * 旧代码：diff-gate 只判 freshness.status !== 'fresh' → 折叠成 mapper_stale/retryable=true
 *         （kernel 每 90s 无限重试到 deadline）。
 * 新代码：按 reason_code 分类 → blocked/impact_anchor_missing/retryable=false（fail-closed）。
 *
 * 本测试把录制的真实 radius 输出原样喂给真 evaluateDiffGate（不 mock diff-gate），
 * 断言新行为。当前（旧码）会返回 mapper_stale → 本测试红；实现后 → 绿。这即回归护栏，
 * 永久保留在 CI，防同一根因在后续 sprint 复发。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/d1360a48-radius.json'), 'utf8'));

describe('回归 d1360a48：无主文件 DoD.md → 确定性 blocked 不再 mapper_stale [BEHAVIOR]', () => {
  it('喂真实 radius 录制件，新行为为 blocked:impact_anchor_missing/retryable=false', async () => {
    const result = await evaluateDiffGate({
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: fixture.changed_files,
      mapClient: async () => fixture.radius_response,
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail.unclaimed_files).toEqual(['DoD.md']);
    // 明确断言不再是旧的折叠结论（防实现回退成 mapper_stale）
    expect(result.reason).not.toBe('mapper_stale');
  });
});
