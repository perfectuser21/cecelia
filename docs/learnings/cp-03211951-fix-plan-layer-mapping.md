# Learning: /plan SKILL.md PR→层级映射修复

分支: cp-03211951-fix-plan-layer-mapping
日期: 2026-03-21

## 变更内容

- /plan SKILL.md 工作量维度 1PR 从 Initiative 修正为 Task
- 识别流程默认从 Initiative 改为 Task
- 引用 capacity-budget API 动态校准

### 根本原因

/plan SKILL.md 把 1PR 映射到 Initiative 级别，但按校准表 1PR = Task。这导致 Claude Code 在对话中判断层级时系统性偏高一级。

### 下次预防

- [ ] 新增或修改层级映射时，对照 capacity-budget API 的 layer_budgets 校验
- [ ] /plan、/decomp、/decomp-check 三个 skill 的层级定义必须一致
