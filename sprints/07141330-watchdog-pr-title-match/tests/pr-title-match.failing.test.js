/**
 * Failing test 骨架：watchdog PR 标题 [短号] 匹配
 *
 * Task ID: d276bdae-e69f-4b87-9ee1-5b0e552acb2b
 * Sprint: sprints/07141330-watchdog-pr-title-match
 *
 * 这些测试在修复前必须 FAIL（复现 bug），修复后必须 PASS。
 * 真正要提交的测试位于：
 *   packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js
 * 本文件作为骨架/参考，不进入 packages/brain 的 Vitest 扫描范围。
 *
 * 用法（修复前验证 failing）：
 *   cd /workspace && node --experimental-vm-modules \
 *     node_modules/.bin/vitest run \
 *     packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js
 *
 * 追加到目标测试文件的代码段见下方注释块。
 */

// ============================================================
// 追加到 harness-relay-watchdog-pr-discovery.test.js 的代码段
// ============================================================

/*
describe('_discoverPrFromGithub — 标题 [短号] 匹配（FR-2/3/4）', () => {

  // [BEHAVIOR-1] 核心 bug fix：标题命中，分支名不含 short → 修复前 failing
  it('[BEHAVIOR-1] 标题含 [short]、分支名不含 short → 返回该 PR（修复前 failing）', () => {
    const short = 'abcd1234';
    const pr = {
      headRefName: 'cp-xxx-no-short',
      title: 'fix(ci-poll): some description [abcd1234]',
      url: 'https://github.com/org/repo/pull/9',
      state: 'OPEN',
    };
    const execFn = () => JSON.stringify([pr]);
    const task = { payload: { base_repo: BASE_REPO } };
    // 修复前：_discoverPrFromGithub 只匹配 headRefName，返回 null → 测试 FAIL
    // 修复后：增加 title.includes('[abcd1234]') 判断 → 返回 pr → 测试 PASS
    expect(_discoverPrFromGithub(task, short, execFn)).toMatchObject({
      url: 'https://github.com/org/repo/pull/9',
      state: 'OPEN',
    });
  });

  // [BEHAVIOR-2] 分支名命中既有路径不回归
  it('[BEHAVIOR-2] 分支名含 short → 仍然命中（回归保护）', () => {
    const execFn = () => JSON.stringify([
      { headRefName: `cp-${SHORT}-ws`, title: 'some unrelated title', url: 'u-branch', state: 'OPEN' },
    ]);
    const task = { payload: { base_repo: BASE_REPO } };
    const result = _discoverPrFromGithub(task, SHORT, execFn);
    expect(result).not.toBeNull();
    expect(result.headRefName).toContain(SHORT);
  });

  // [BEHAVIOR-3] MERGED（标题命中）优先于 OPEN（分支名命中）
  it('[BEHAVIOR-3] MERGED（标题命中）优先于 OPEN（分支名命中）', () => {
    const execFn = () => JSON.stringify([
      { headRefName: `cp-${SHORT}-ws`, title: 'no', url: 'u-open', state: 'OPEN' },
      { headRefName: 'other-branch', title: `fix [${SHORT}]`, url: 'u-merged', state: 'MERGED' },
    ]);
    const task = { payload: { base_repo: BASE_REPO } };
    expect(_discoverPrFromGithub(task, SHORT, execFn)).toMatchObject({
      url: 'u-merged',
      state: 'MERGED',
    });
  });

  // [BEHAVIOR-4] 松散子串（无方括号）不命中 → 返回 null
  it('[BEHAVIOR-4] 标题含 short 但无方括号 → 返回 null（防御松散匹配）', () => {
    const execFn = () => JSON.stringify([
      { headRefName: 'other-branch', title: `fix ${SHORT} issue`, url: 'u', state: 'OPEN' },
    ]);
    const task = { payload: { base_repo: BASE_REPO } };
    expect(_discoverPrFromGithub(task, SHORT, execFn)).toBeNull();
  });

});
*/

// 本文件无实际导入，仅作文档/骨架用途。
// 真正的 failing test 在 packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js。
export {};
