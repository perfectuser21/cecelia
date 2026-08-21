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
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE/);
  });

  it('完整路径映射到冻结产物 → 通过', () => {
    expect(() => assertTestContractResolvable(table(`${SPRINT}/tests/a.test.js`), ARTIFACTS))
      .not.toThrow();
  });

  it('sprints/ 前缀但产物不存在 → 拒绝', () => {
    expect(() => assertTestContractResolvable(table(`${SPRINT}/tests/ghost.test.js`), ARTIFACTS))
      .toThrow(/UNRESOLVABLE/);
  });

  it('repo 既有路径与无表合同 → 不拦', () => {
    expect(() => assertTestContractResolvable(table('packages/brain/src/x/__tests__/a.test.js'), ARTIFACTS)).not.toThrow();
    expect(() => assertTestContractResolvable('# 合同', ARTIFACTS)).not.toThrow();
  });
});
