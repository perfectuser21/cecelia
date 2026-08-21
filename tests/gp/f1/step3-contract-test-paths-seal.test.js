// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：合同封印 ↔ Test Contract 表路径可解析
//
// 2026-08-21 生产实证（run 7f939e7c，r33）：proposer 照 SKILL 模板把省略号路径
// `sprints/.../tests/diff-gate-reason-passthrough.test.js` 写进 Test Contract 表 →
// CI「Test Contract 覆盖检查」红 → generator-fix 唯一修法是改已封印的 contract-draft.md
// → post-provider 文档不可变复核（1.273.99 CONTRACT IS LAW 扩展）正确拦截 diverged →
// fix 确定性死循环（三次 provider_exit 同因）。两道闸各自正确，缺口在封印时没有校验
// 合同表路径能否解析——不可解析的合同根本不该被批准冻结。
//
// 修法：materializeApprovedContract 封印时用 scripts/lib/test-contract-paths.cjs 同一条
// 解析链（parseTestContract + resolveContractTestFile，existsSync 注入冻结产物集合）
// 校验每个 `sprints/` 前缀的 Test File 可解析到 artifacts；解析不到 → throw，propose
// 轮即失败，proposer 有机会重写。repo 既有路径（packages/... 等）不在封印职责内，CI 照管。
//
// 按产物闸规矩写在边上：真 import 被改模块（不 vi.mock）。
import { describe, expect, it } from 'vitest';
import { assertTestContractResolvable } from '../../../packages/brain/src/orchestrator/contract-test-paths-seal.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPRINT = 'sprints/08210608-kernel-23e93b86';

function artifact(p) {
  return { path: p, content: 'x', sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40) };
}
const ARTIFACTS = [
  artifact(`${SPRINT}/contract-draft.md`),
  artifact(`${SPRINT}/contract-dod.md`),
  artifact(`${SPRINT}/sprint-prd.md`),
  { path: `${SPRINT}/tests/diff-gate-reason-passthrough.test.js`, content: "it('unknown 状态透传 reason_code 且 retryable false', () => {});\nit('unknown 无 reason_code 回退 mapper_unknown', () => {});", sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40) },
];

// r33 真实合同表形态（省略号 + 反引号 + `+` 连接 repo 既有测试 + 「同上」行）：
const R33_TABLE = `
## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（it() 名子串）| 预期红证据 |
|---|---|---|---|
| unknown 确定性终局出口 | \`sprints/.../tests/diff-gate-reason-passthrough.test.js\` + \`packages/brain/src/impact-contract/__tests__/diff-gate.test.js\` | \`unknown 状态透传 reason_code 且 retryable false\` | baseline FAIL |
| unknown 无 reason_code 回退 | 同上 | \`回退 mapper_unknown\` | baseline FAIL |
`;

const GOOD_TABLE = R33_TABLE.replace(
  'sprints/.../tests/diff-gate-reason-passthrough.test.js',
  `${SPRINT}/tests/diff-gate-reason-passthrough.test.js`,
);

describe('封印时 Test Contract 表路径可解析校验（r33 fix 死循环回归）', () => {
  it('r33 真实省略号路径 → 封印拒绝（throw UNRESOLVABLE）', () => {
    expect(() => assertTestContractResolvable(R33_TABLE, ARTIFACTS))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE/);
  });

  it('完整真实路径（能映射到冻结产物）→ 封印通过', () => {
    expect(() => assertTestContractResolvable(GOOD_TABLE, ARTIFACTS)).not.toThrow();
  });

  it('sprints/ 前缀但产物集合里不存在该文件 → 拒绝', () => {
    const table = GOOD_TABLE.replace('diff-gate-reason-passthrough', 'ghost-test');
    expect(() => assertTestContractResolvable(table, ARTIFACTS))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE/);
  });

  it('repo 既有路径（packages/...）不在封印职责内 → 不拦（CI 照管）', () => {
    const table = `
## Test Contract

| 功能 | Test File | BEHAVIOR | 红证据 |
|---|---|---|---|
| 回归 | \`packages/brain/src/impact-contract/__tests__/diff-gate.test.js\` | \`x\` | FAIL |
`;
    expect(() => assertTestContractResolvable(table, ARTIFACTS)).not.toThrow();
  });

  it('无 Test Contract 表（legacy 合同）→ 不拦', () => {
    expect(() => assertTestContractResolvable('# 合同\n\n正文', ARTIFACTS)).not.toThrow();
  });

  it('r39 形态：BEHAVIOR 覆盖名不是冻结 it() 名子串 → 拒绝封印（封印后双不可变，fix 无解）', () => {
    // run d2334022 实证：CI「Test Contract 覆盖检查」在 generator 后才发现覆盖名与 it()
    // 不匹配；合同与冻结测试封印后双不可变，fix 改哪边都被拦 → 死局。
    // 封印时用与 check-test-coverage 相同的匹配语义（it/test 名双向小写子串）提前拦截。
    const testContent = [
      "it('unknown 状态透传 reason_code 且 retryable false', () => {});",
      "it('瞬时 stale 保持可重试', () => {});",
    ].join('\n');
    const arts = [
      artifact(`${SPRINT}/contract-draft.md`),
      { path: `${SPRINT}/tests/a.test.js`, content: testContent, sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40) },
    ];
    const badTable = '## Test Contract\n\n| 功能 | Test File | BEHAVIOR 覆盖 | 红证据 |\n|---|---|---|---|\n| x | `' + SPRINT + '/tests/a.test.js` | `透传 reason_code 且 retryable:false` | FAIL |\n';
    expect(() => assertTestContractResolvable(badTable, arts))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE/);
  });

  it('覆盖名是冻结 it() 名子串 → 封印通过', () => {
    const testContent = "it('unknown 状态透传 reason_code 且 retryable false', () => {});";
    const arts = [
      artifact(`${SPRINT}/contract-draft.md`),
      { path: `${SPRINT}/tests/a.test.js`, content: testContent, sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40) },
    ];
    const goodTable = '## Test Contract\n\n| 功能 | Test File | BEHAVIOR 覆盖 | 红证据 |\n|---|---|---|---|\n| x | `' + SPRINT + '/tests/a.test.js` | `透传 reason_code 且 retryable false` | FAIL |\n';
    expect(() => assertTestContractResolvable(goodTable, arts)).not.toThrow();
  });

  it('接线：materializeApprovedContract 封印路径真调用本校验', () => {
    const src = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)),
        '../../../packages/brain/src/orchestrator/contract-store.js'),
      'utf8',
    );
    expect(src).toContain('assertTestContractResolvable');
  });
});
