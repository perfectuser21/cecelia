# Learning: quickcheck 全面简化 + CI apps 补全

## 根本原因

quickcheck.sh 历经多次补丁（#2025 worktree路径、#2033 monorepo hoisting），累积到 300 行，但仍然只覆盖 engine 和 brain，apps/ 两层全盲。问题根源是每次都在原有逻辑上打补丁，而不是重新设计。

## 修复

将 scope 判断逻辑从 300 行化简为 10 行循环：对每个包（engine/brain/apps/api/apps/dashboard），如果有改动就跑 npm test。删除 TypeCheck、ESLint、复杂 find 逻辑。

CI 新增 workspace-test job，对 apps/api 和 apps/dashboard 各跑 vitest，加入 ci-passed needs。

## 下次预防

- [ ] 补丁叠加到一定程度要做一次重写，不要继续叠
- [ ] 新增包时同步更新 quickcheck.sh 的包列表和 ci.yml 的 job
- [ ] 简单的循环比复杂的 scope 逻辑更可靠
