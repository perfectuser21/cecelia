#!/usr/bin/env node
// changed-test-router.mjs
// 输入：变更文件路径列表（argv）。输出：需额外执行的「fs 依赖型」契约测试清单（stdout 一行 JSON）。
//
// 为什么需要：skill 契约测试通过 fs.readFileSync 读 SKILL.md 快照（不是 import 边），
// vitest --changed 沿 import 图探测依赖，探测不到这种 fs 读取依赖 —— skill 快照改了，
// 相应契约测试不会被选中跑。本路由显式建立「changed skill 文件 → fs 依赖测试」映射。
//
// 输出约定：
//   - stderr 打每条命中映射 `[router] <changed> -> <test>`（过程可见，独立裁判逐步核对）
//   - stdout 只输出一行纯 JSON：`{"extraTests": ["<test 路径>", ...]}`（供 jq 直接解析，不被过程行污染）

const SKILL_CONTRACT_TEST = 'packages/brain/scripts/ci/__tests__/skill-contract.test.mjs';

// fs 依赖映射规则：changed 文件命中 match → 需额外跑 tests 清单
const FS_DEP_RULES = [
  {
    // 任意 harness skill 的 SKILL.md 改动 → 跑 skill 契约测试
    match: (f) => /(^|\/)packages\/workflows\/skills\/[^/]+\/SKILL\.md$/.test(f),
    tests: [SKILL_CONTRACT_TEST],
  },
  {
    // ReviewerOutputSchema 来源改动 → 跑 skill 契约测试（reviewer 7 维一致性比对源）
    match: (f) => /(^|\/)packages\/brain\/src\/harness-shared\.js$/.test(f),
    tests: [SKILL_CONTRACT_TEST],
  },
];

export function route(changedFiles) {
  const extra = new Set();
  for (const f of changedFiles) {
    for (const rule of FS_DEP_RULES) {
      if (rule.match(f)) {
        for (const t of rule.tests) {
          extra.add(t);
          console.error(`[router] ${f} -> ${t}`);
        }
      }
    }
  }
  return [...extra];
}

const files = process.argv.slice(2).filter(Boolean);
const extraTests = route(files);
console.log(JSON.stringify({ extraTests }));
