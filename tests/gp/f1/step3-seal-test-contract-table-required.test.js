// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：合同封印完整性 ↔ 冻结守卫
//
// 2026-08-22 生产实证（r45 run 6de78554）：proposer 漏产 contract-draft.md 的
// ## Test Contract 表（rows=0，旧封印校验直接放行），CI 覆盖闸（Test Contract
// 覆盖检查 v5.0 / 金字塔 / 棘轮）在 generator 后才红；generator-fix 唯一修法是
// 补表——但 contract-draft 已冻结，materializer 守卫正确拒改 → 结构死锁，
// fix 修好全部代码层门禁仍无路（3 次 provider_exit → runner_failure 额度耗尽）。
// 两道闸各自正确，缺口在封印时点：artifacts 带冻结测试而合同无表/漏登记的合同
// 根本不该被批准冻结（打回 proposer 可重写轮）。
import { describe, expect, it } from 'vitest';
import { assertTestContractResolvable } from '../../../packages/brain/src/orchestrator/contract-test-paths-seal.js';

const SPRINT = 'sprints/08220937-kernel-xxxx';

function artifacts({ withTests = true } = {}) {
  const list = [
    { path: `${SPRINT}/contract-draft.md`, content: 'placeholder' },
  ];
  if (withTests) {
    list.push({
      path: `${SPRINT}/tests/publisher-retry.test.js`,
      content: "it('B-01 publisher retry routes to publish', () => {})",
    });
  }
  return list;
}

const TABLE = `## Test Contract
| Behavior | Test File | Case |
|---|---|---|
| B-01 publisher retry routes to publish | ${SPRINT}/tests/publisher-retry.test.js | publisher retry |
`;

describe('F1 step3：封印强制 Test Contract 表登记冻结测试（r45 死锁案卷）', () => {
  it('artifacts 带冻结测试而合同无 Test Contract 表 → 拒封印', () => {
    expect(() => assertTestContractResolvable('# 合同\n没有表', artifacts()))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_/);
  });

  it('有表但漏登记某个冻结测试 → 拒封印', () => {
    const extra = artifacts();
    extra.push({
      path: `${SPRINT}/tests/unregistered.test.js`,
      content: "it('x', () => {})",
    });
    expect(() => assertTestContractResolvable(TABLE, extra))
      .toThrow(/unregistered\.test\.js/);
  });

  it('表完整登记全部冻结测试 → 放行', () => {
    expect(() => assertTestContractResolvable(TABLE, artifacts())).not.toThrow();
  });

  it('artifacts 无冻结测试且合同无表 → 放行（非测试类合同不受影响）', () => {
    expect(() => assertTestContractResolvable('# 合同\n没有表', artifacts({ withTests: false })))
      .not.toThrow();
  });
});
