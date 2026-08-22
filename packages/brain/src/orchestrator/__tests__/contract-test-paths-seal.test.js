// 配套单测（lint-test-pairing）：封印时 Test Contract 表路径可解析校验。
// 完整 GP 步骤断言（r33 真实合同表形态）见 tests/gp/f1/step3-contract-test-paths-seal.test.js。
import { describe, expect, it } from 'vitest';
import { assertTestContractResolvable } from '../contract-test-paths-seal.js';

const SPRINT = 'sprints/08210608-kernel-x';
const ARTIFACTS = [
  { path: `${SPRINT}/contract-draft.md` },
  { path: `${SPRINT}/tests/a.test.js`, content: "it('y', () => {});" },
];

function table(testFile) {
  return `## Test Contract\n\n| 功能 | Test File | BEHAVIOR | 红证据 |\n|---|---|---|---|\n| x | \`${testFile}\` | \`y\` | FAIL |\n`;
}

describe('assertTestContractResolvable', () => {
  it('sprints/ 前缀省略号路径 → 拒绝封印', () => {
    expect(() => assertTestContractResolvable(table('sprints/.../tests/a.test.js'), ARTIFACTS))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_/); // r45 后：真文件未登记先抛 UNREGISTERED，省略号别名同属拒绝
  });

  it('完整路径映射到冻结产物 → 通过', () => {
    expect(() => assertTestContractResolvable(table(`${SPRINT}/tests/a.test.js`), ARTIFACTS))
      .not.toThrow();
  });

  it('sprints/ 前缀但产物不存在 → 拒绝', () => {
    expect(() => assertTestContractResolvable(table(`${SPRINT}/tests/ghost.test.js`), ARTIFACTS))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_/); // ghost 未解析 + a.test.js 未登记，两种码同属拒绝
  });

  it('repo 既有路径与无表合同 → 不拦（无冻结测试的合同；r45 后带冻结测试必须登记）', () => {
    const NO_TEST_ARTIFACTS = [{ path: `${SPRINT}/contract-draft.md` }];
    expect(() => assertTestContractResolvable(table('packages/brain/src/x/__tests__/a.test.js'), NO_TEST_ARTIFACTS)).not.toThrow();
    expect(() => assertTestContractResolvable('# 合同', NO_TEST_ARTIFACTS)).not.toThrow();
    // r45 死锁案卷：带冻结测试而无表 → 拒（旧行为是漏洞）
    expect(() => assertTestContractResolvable('# 合同', ARTIFACTS))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED/);
  });
});
