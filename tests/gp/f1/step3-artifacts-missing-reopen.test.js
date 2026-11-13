/**
 * GP-Anchor: factory/F1 造完真验 #step3
 * 历史循环纯逻辑合同：外部派发边完全注入，不启动已退役Kernel运行。
 *
 * 第 31 批（r62 run fa772ff4 案卷）：approved_but_contract_artifacts_missing
 * 直接 failRun 终局，而同类合同缺陷 seal_rejected 有 2 次 proposer 重写机会——
 * 不对称。proposer 输出波动（r61 建了冻结测试/r62 没建）应走同一条自愈路：
 * missing 时落 verdict:contract_seal_rejected（code=FROZEN_CONTRACT_ARTIFACTS_MISSING）
 * 并 continue，derive 既有 seal_rejected 分路自动带反馈重开 proposer（≥2 次才判死）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn(() => { throw new Error('历史循环测试禁止访问默认数据库'); }) },
}));
import defaultPool from '../../../packages/brain/src/db.js';
afterEach(() => expect(defaultPool.query).not.toHaveBeenCalled());

import { sealRejectionInstruction } from '../../../packages/brain/src/orchestrator/dispatcher.js';

describe('dispatcher：ARTIFACTS_MISSING 分文案', () => {
  it('指示合同四件套含 tests/ 冻结测试必须全部 commit', () => {
    const text = sealRejectionInstruction('FROZEN_CONTRACT_ARTIFACTS_MISSING');
    expect(text).toMatch(/tests|冻结测试/);
    expect(text).toMatch(/commit|提交/);
  });
});
