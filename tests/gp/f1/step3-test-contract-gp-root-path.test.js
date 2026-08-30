// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Test Contract 解析器认仓库根 tests/gp 路径
//
// r83（PR #5091）/ r84（PR #5095）实证：kernel 产出的合同按决策 109dd8eb 把 GP 步骤断言
// 声明在仓库根 `tests/gp/f1/step3-*.test.js`，但 scripts/lib/test-contract-paths.cjs 的
// repositoryRelativePath 只认 sprints/ packages/ scripts/ tests/regression/ 前缀 → tests/gp/…
// 被当作 sprint 相对路径，候选只有 sprints/<dir>/tests/gp/… 与 tests/regression/<slug>/gp/…
// → CI「Test Contract 覆盖检查 (v5.0)」对 kernel 产的每个 PR 必红，generator-fix 无解，
// 人肉收编成了唯一出口。
//
// 修法：tests/gp/ 计入仓库根路径前缀。真 import 被改模块（cjs 经 createRequire），不 mock。
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertTestContractResolvable } from '../../../packages/brain/src/orchestrator/contract-test-paths-seal.js';

const require = createRequire(import.meta.url);
const { resolveContractTestFile } = require('../../../scripts/lib/test-contract-paths.cjs');

const ROOT = path.resolve('/repo');
const SPRINT = 'sprints/08300956-kernel-pr-conflict-rebase';
const CONTRACT = `${SPRINT}/contract-draft.md`;
const GP_TEST = 'tests/gp/f1/step3-pr-conflict-rebase-route.test.js';

function resolve(testFile, existing) {
  const set = new Set(existing.map((p) => path.resolve(ROOT, p)));
  return resolveContractTestFile({
    root: ROOT,
    contractPath: CONTRACT,
    testFile,
    existsSync: (candidate) => set.has(path.resolve(candidate)),
  });
}

describe('resolveContractTestFile：仓库根 tests/gp 路径', () => {
  it('r84 形态：声明 tests/gp/f1/… 且文件在仓库根 → 首候选即仓库根路径，解析成功', () => {
    const r = resolve(GP_TEST, [GP_TEST]);
    expect(r.error).toBeNull();
    expect(r.candidates[0]).toBe(path.resolve(ROOT, GP_TEST));
    expect(r.resolvedPath).toBe(path.resolve(ROOT, GP_TEST));
  });

  it('文件真不存在 → 仍报不存在（不是把闸拆掉）', () => {
    const r = resolve(GP_TEST, []);
    expect(r.resolvedPath).toBeNull();
    expect(r.candidates[0]).toBe(path.resolve(ROOT, GP_TEST));
  });

  it('负向：sprints/<dir>/tests/… 与 tests/regression/… 语义不变', () => {
    const sprintTest = `${SPRINT}/tests/pr-conflict-rebase-route.test.js`;
    const s = resolve(sprintTest, [sprintTest]);
    expect(s.resolvedPath).toBe(path.resolve(ROOT, sprintTest));
    expect(s.candidates).toContain(
      path.resolve(ROOT, 'tests/regression/kernel-pr-conflict-rebase/pr-conflict-rebase-route.test.js'),
    );
    const reg = 'tests/regression/kernel-x/a.test.js';
    expect(resolve(reg, [reg]).resolvedPath).toBe(path.resolve(ROOT, reg));
  });

  it('负向：裸 tests/x.test.js（非 gp / 非 regression）仍按 sprint 相对路径解析', () => {
    const legacy = 'tests/legacy.test.js';
    const r = resolve(legacy, [`${SPRINT}/tests/legacy.test.js`]);
    expect(r.candidates[0]).toBe(path.resolve(ROOT, SPRINT, legacy));
    expect(r.resolvedPath).toBe(path.resolve(ROOT, SPRINT, legacy));
  });
});

describe('封印接线：tests/gp 行属仓库既有路径，不因"不在冻结产物集合"拒封印', () => {
  const artifact = (p, content = 'x') => ({ path: p, content, sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40) });
  const ARTIFACTS = [
    artifact(`${SPRINT}/contract-draft.md`),
    artifact(`${SPRINT}/contract-dod.md`),
    artifact(`${SPRINT}/sprint-prd.md`),
    artifact(`${SPRINT}/tests/pr-conflict-rebase-route.test.js`, "it('DIRTY 路由 generator-fix pr_conflict_rebase', () => {});"),
  ];
  const TABLE = `
## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（it() 名子串）| 预期红证据 |
|---|---|---|---|
| DIRTY 路由 | \`${SPRINT}/tests/pr-conflict-rebase-route.test.js\` | \`DIRTY 路由 generator-fix pr_conflict_rebase\` | baseline FAIL |
| 同套永久回归位 | \`${GP_TEST}\` | \`DIRTY 路由 generator-fix pr_conflict_rebase\` | baseline FAIL |
`;
  it('r84 合同（冻结 sprint 测试 + 仓库根 tests/gp 行）→ 封印通过', () => {
    expect(() => assertTestContractResolvable(TABLE, ARTIFACTS)).not.toThrow();
  });
});
