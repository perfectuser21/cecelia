# Learning: executor.js sprint_generate 错误使用 /dev skill

**分支**: cp-04072224-fix-sprint-generator-dispatch  
**日期**: 2026-04-07

### 根本原因

`executor.js` 的 `_prepareSprintPrompt` 函数在 Harness v2.0 时期写入了 `/dev --task-id`，用于让 Generator 走 /dev 全流程。升级到 Harness v3.1 后，Generator 应使用专属的 `/sprint-generator` skill，但 executor.js 没有同步更新，导致：

1. Generator 走了 /dev 全流程（Task Card/DoD/CI等），而不是合同执行模式
2. Generator 会自行添加合同外内容（如 PR #1992 的 MAX_PROPOSE_ROUNDS）
3. 违反了 "CONTRACT IS LAW" 原则

### 下次预防

- [ ] skill SKILL.md 升级时，同步检查 executor.js 的 preparePrompt 函数是否需要更新
- [ ] sprint_generate/sprint_fix 的 prompt 头部必须是 `/sprint-generator`，不能是 `/dev`
- [ ] 合同外内容的 PR 出现时，立即检查 executor.js 的 prompt 构建函数
