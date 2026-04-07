# Learning: Harness Planner 真实跑 + sprint-N 目录清理

## 根本原因

### 问题1: Planner 永远 queued（最高优先级）

`pre-flight-check.js` 的 `SYSTEM_TASK_TYPES` 列表缺少 sprint harness 的所有 task types。
当 `execution.js` 在断链中创建 `sprint_planner`、`sprint_contract_propose` 等任务时，`description` 字段为 `null`（这是设计）。
Pre-flight 检查报 `"Task description is empty"` → 任务标记 `pre_flight_failed: true` → 跳过永远不执行。

**结果**: 每次 Harness Sprint 都直接从 contract 阶段开始（Planner 被静默跳过）。

### 问题2: sprint-N 目录遗留

`executor.js` 在 `_prepareSprintPrompt`、`_prepareSprintEvaluatePrompt`、`sprint_contract_propose` 和 `sprint_contract_review` 的 preparePrompt 里，默认值仍是 `'sprints/sprint-1'` 或 `` `sprints/sprint-${sprintNum}` ``（老设计的遗留）。

正确扁平路径：`sprints/sprint-prd.md`、`sprints/contract-draft.md`、`sprints/sprint-contract.md` 等。

### 问题3: Proposer 无法读 sprint-prd.md

`execution.js` 断链创建 `sprint_contract_propose` 时，payload 缺少 `planner_branch`。
`executor.js` preparePrompt 里 `plannerBranch` 默认为 `'main'`，用 `git show origin/main:sprints/sprint-prd.md` 找不到文件（文件在 Planner 的 worktree 分支上）。

## 修复内容

1. `pre-flight-check.js`: 添加 7 种 sprint harness task types 到 `SYSTEM_TASK_TYPES`
2. `executor.js`: 4 处默认值改为 `'sprints'`，移除无用的 `sprintNum` 变量
3. `execution.js`: 从 planner result 中提取 `branch`，注入为 `planner_branch` 到 propose/review payload；`planner_branch` 沿链传递
4. `sprint-planner/SKILL.md`: 输出 verdict 增加 `"branch"` 字段（CRITICAL 标注）
5. `sprint-generator/SKILL.md`, `sprint-report/SKILL.md`: 示例路径从 `sprint-N/` 改为扁平 `sprints/`

## 下次预防

- [ ] 新增 Harness task type 时，必须同时把它加到 `pre-flight-check.js` 的 `SYSTEM_TASK_TYPES`
- [ ] Harness 断链创建下游任务时，检查上游 agent 需要的文件是否可访问（跨 worktree 文件必须通过 `planner_branch` 机制传递）
- [ ] 所有 SKILL.md 输出 verdict 中，如果下游需要读该 worktree 上的文件，必须包含 `"branch"` 字段
