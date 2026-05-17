# Learning: Engine 深度清理

**日期**: 2026-04-02
**分支**: cp-04021852-engine-deep-cleanup

## 背景

slim-engine-heartbeat 重构后，Engine 包内残留了大量无引用文件。
本次清理前有 ~140 个文件 ~34,500 行，经审计发现 40+ 个文件无任何 CI/Hook/RCI 引用。

## 清理内容

- 9 个 devgate 孤儿脚本
- 17 个 scripts/ 根目录孤儿脚本
- 8 个子目录文件（audit/4, qa/3, lib/1）
- playwright-evaluator skill（已删功能）
- ci/out/ 构建产物（不该在 git 里）
- 3 个孤儿 lib（ci-status.sh, format-duration.sh, lock-utils.sh）
- 4 个全 describe.skip 测试文件

### 根本原因

大型重构删除功能时，只删了核心代码（hooks/主脚本），没有追踪依赖链清理周边文件。
scripts/ 根目录的脚本大多是早期手动运行的工具，后来被 CI/Hook 替代但未删除。

### 下次预防

- [ ] 删除功能时，用 grep -rl 搜索所有引用该功能的文件，一起删
- [ ] scripts/ 目录定期审计：每个脚本必须被 CI workflow 或 Hook 引用，否则删除
