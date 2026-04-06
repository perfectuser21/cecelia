# Learning: Sprint 3 R5 — 误触发 sprint_fix 关闭流水线

**分支**: cp-04060739-0639739b-2d96-4f53-83bb-c59d47
**PR**: Sprint 3 R5 关闭

---

### 根本原因

Sprint 3 R4 Evaluator 评估结果为 PASS，但 Brain 未能正确处理该 verdict：
- Sprint 任务标题链在多轮 Harness 迭代后超过 varchar(255) 限制
- title overflow 导致 Brain 在处理 sprint_evaluate 回调时静默失败
- Brain 误以为 pipeline 停止，手动恢复创建了 sprint_fix R5

**直接原因**: `packages/brain/src/routes/execution.js` 处理 sprint_evaluate PASS 时，
任务标题链超长（含 Generator → Planner → Reviewer → Evaluator → Fix R1-R4 链），
INSERT 到 sprint_fix 任务时因 varchar(255) 截断而报错，整个回调被 catch 吞掉。

---

### 下次预防

- [ ] Brain 任务标题长度在写入前截断（varchar(255) 前置 guard）— 已由 PR #1966 修复
- [ ] sprint_evaluate PASS 后应直接触发 PR 合并，而非仅创建 sprint_fix
- [ ] Brain 回调报错时应向 Brain error log 写入，不能静默丢失
- [ ] 标题链规则：sprint_fix 标题只保留 "[Fix] Sprint N RN — 简短描述"，不再串联前序标题
