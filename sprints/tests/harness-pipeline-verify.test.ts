/**
 * TDD Red — harness 内部线 pipeline 贯通验证前置断言
 *
 * 以下测试在 Generator 添加触点注释之前必然 FAIL（红）：
 *   - 触点测试：apps/dashboard/index.html 缺少 harness-pipeline-verify 注释 → FAIL
 *   - promote 逻辑单测：验证 Slice9 复合闸的 resolveLine + decidePromote 对内部线的路由
 *   - SHA 锚定测试：checkInitiativeAggregate 函数对无记录情况的返回值结构
 *
 * Generator 添加触点后，触点测试变绿；pipeline 跑完后 E2E script 验证 DB 接缝断言。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── 触点注释测试（Generator 添加后方为绿）──────────────────────────────────
describe('apps/dashboard/index.html 触点注释 [BEHAVIOR]', () => {
  it('包含 harness-pipeline-verify 2026-06-27 注释行', () => {
    const indexPath = resolve(process.cwd(), 'apps/dashboard/index.html');
    const content = readFileSync(indexPath, 'utf8');
    expect(content).toContain('harness-pipeline-verify 2026-06-27');
  });
});

// ── promote 逻辑单测（纯逻辑，环境无关，验证 Slice9 内部线路由）────────────
describe('staging-promote resolveLine + decidePromote 内部线路由 [BEHAVIOR]', () => {
  it('resolveLine("cecelia") 返回 internal', async () => {
    const { resolveLine } = await import('../../../packages/brain/src/staging-promote.js');
    expect(resolveLine('cecelia')).toBe('internal');
  });

  it('decidePromote PASS + cecelia → action=auto，promoteStatus=auto_promoted', async () => {
    const { decidePromote, PROMOTE_STATUS } = await import('../../../packages/brain/src/staging-promote.js');
    const result = decidePromote({ verdict: 'PASS', baseRepo: 'cecelia' });
    expect(result.action).toBe('auto');
    expect(result.promoteStatus).toBe(PROMOTE_STATUS.AUTO_PROMOTED);
  });

  it('decidePromote FAIL + cecelia → action=none，promoteStatus=n_a', async () => {
    const { decidePromote, PROMOTE_STATUS } = await import('../../../packages/brain/src/staging-promote.js');
    const result = decidePromote({ verdict: 'FAIL', baseRepo: 'cecelia' });
    expect(result.action).toBe('none');
    expect(result.promoteStatus).toBe(PROMOTE_STATUS.NA);
  });
});

// ── checkInitiativeAggregate 空记录边界（逻辑断言）────────────────────────
describe('checkInitiativeAggregate 空 initiative 边界 [BEHAVIOR]', () => {
  it('initiative_id=null 时直接返回 {allPass:true, testedSha:null}（不查 DB）', async () => {
    const { checkInitiativeAggregate } = await import('../../../packages/brain/src/staging-e2e-runner.js');
    // null initiativeId → 函数跳过 DB 查询直接返回安全默认值
    const fakePool = { query: async () => { throw new Error('should not be called'); } };
    const result = await checkInitiativeAggregate(fakePool, null);
    expect(result.allPass).toBe(true);
    expect(result.testedSha).toBeNull();
  });
});
