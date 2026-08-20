/**
 * Sprint 回归测试（TDD Red）— Diff Impact Gate 确定性结论 fail-closed 有界出口
 *
 * 覆盖父路：独立小路（无父路）— 本 sprint 修 evaluateDiffGate Map 可判定性校验分支。
 *
 * 断言的是「本 sprint 新增行为」，当前实现（step 3a 一律折叠 mapper_stale）下必然 FAIL：
 *   - 确定性 reason_code（如 revision_mismatch / fail_current_revision）必须透传且 retryable=false
 *   - 真·瞬态过期（fact_snapshot_stale）仍 mapper_stale + retryable=true（不被误伤）
 *
 * 禁 mock 被改的边：直调真实 evaluateDiffGate（不 stub 该函数/其分类分支）；
 * 只注入 mapClient（外层 Mapper HTTP 依赖，非被改的边），db 省略（step 3a 在任何 DB 副作用前返回）。
 */
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const call = (reasonCode: string | null, status = 'stale') =>
  evaluateDiffGate({
    taskId: 'sprint-diffgate',
    repo: 'cecelia',
    headRevision: 'head-sha',
    mapClient: async () => ({ freshness: { status, reason_code: reasonCode } }),
  });

describe('Diff Impact Gate 确定性结论 fail-closed 有界出口 [BEHAVIOR]', () => {
  it('确定性 reason_code revision_mismatch 透传且 retryable=false', async () => {
    const r = await call('revision_mismatch');
    expect(r.reason).toBe('revision_mismatch');
    expect(r.reason_code).toBe('revision_mismatch');
    expect(r.retryable).toBe(false);
    expect(r.reason).not.toBe('mapper_stale');
  });

  it('确定性 reason_code fail_current_revision 透传且 retryable=false', async () => {
    const r = await call('fail_current_revision', 'unknown');
    expect(r.reason).toBe('fail_current_revision');
    expect(r.retryable).toBe(false);
  });

  it('真·瞬态过期 fact_snapshot_stale 仍 mapper_stale 且 retryable=true', async () => {
    const r = await call('fact_snapshot_stale');
    expect(r.reason).toBe('mapper_stale');
    expect(r.retryable).toBe(true);
  });

  it('freshness 非 fresh 但 reason_code 缺失 → fail-closed retryable=false 不再无限重试', async () => {
    const r = await call(null);
    expect(r.retryable).toBe(false);
    expect(r.reason).not.toBe('mapper_stale');
  });

  it('确定性结论幂等：同输入两次 reason_code 与 retryable 一致', async () => {
    const a = await call('revision_mismatch');
    const b = await call('revision_mismatch');
    expect(a.reason_code).toBe(b.reason_code);
    expect(a.retryable).toBe(b.retryable);
  });
});
