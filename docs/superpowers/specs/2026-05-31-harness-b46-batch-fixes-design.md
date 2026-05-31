# Harness B46 批量修复设计

**日期：** 2026-05-31
**分支：** cp-0531134328-B46-harness-batch-fixes
**类型：** 小改动（路径 B）

## 范围

7 个独立 bug fix，全部在 Brain harness pipeline 代码中，无新功能、无接口变更。

## 修复清单

### Fix 1: harness-dag.js — estimated_minutes 范围放宽
- 文件：`packages/brain/src/harness-dag.js:100`
- 原因：30 分钟任务在 20-60 范围内合法，但复杂任务可能需 90-120 分钟，旧上限 60 过严
- 改动：`< 20 || > 60` → `< 30 || > 120`，错误消息同步 `must be 30 <= n <= 120`

### Fix 2: harness-initiative.graph.js — planner_container_id Annotation
- 文件：`packages/brain/src/workflows/harness-initiative.graph.js`
- 原因：planner 节点写入 planner_container_id 但 State 无此字段，LangGraph checkpoint 无法持久化
- 改动：InitiativeState 和 FullInitiativeState 各加一行 `planner_container_id: Annotation({...})`

### Fix 3: harness-initiative.graph.js — HARNESS_PHASE_GOALS.planner 文字更新
- 文件：`packages/brain/src/workflows/harness-initiative.graph.js:51`
- 原因：phase goal 描述引用了旧的 task-plan.json 产出物，现在 planner 产出是 sprint-prd.md
- 改动：替换描述文字

### Fix 4: harness-initiative.graph.js — inferTaskPlanNode 显式返回 error
- 文件：`packages/brain/src/workflows/harness-initiative.graph.js:521`
- 原因：GAN 未产出 propose_branch 时 silent `return {}` 导致 fanout 看不到 tasks，Pipeline 静默失败
- 改动：`return {}` → `return { error: { node: 'infer_task_plan', message: '...' } }`

### Fix 5: harness-initiative.graph.js — reportNode 用 computedVerdict
- 文件：`packages/brain/src/workflows/harness-initiative.graph.js:943`
- 原因：harness_report payload 仍用 `state.final_e2e_verdict`（可能为 null），应用同 try 块内已推导的 computedVerdict
- 改动：`state.final_e2e_verdict` → `computedVerdict`

### Fix 6: harness-task.graph.js — mergePrNode 处理 already merged
- 文件：`packages/brain/src/workflows/harness-task.graph.js:467`
- 原因：PR 已被外部合并时 `gh pr merge` 报错，catch 块走 BEHIND_RE 检查，不匹配则抛 error 导致 task 失败
- 改动：在 BEHIND_RE 检查前加 ALREADY_MERGED_RE，匹配时 cleanup worktree + 返回 merged

### Fix 7: executor.js — _prepareHarnessReportPrompt 注入完整字段
- 文件：`packages/brain/src/executor.js:2175`
- 原因：harness-report skill 接收的 prompt 缺少 feature_id/feature_name/journey_id 等字段，skill 无法写 Notion/飞书
- 改动：追加 7 个字段到模板字符串

## 测试策略

- Fix 1：单元测试验证 `estimated_minutes=25` 抛错、`=90` 通过
- Fix 4：单元测试验证 proposeBranch=null 时返回 error 对象
- Fix 5：单元测试验证 reportNode harness_report payload 使用 computedVerdict 而非 state.final_e2e_verdict
- Fix 6：单元测试验证 "already merged" 错误消息时返回 `{ status: 'merged', ci_status: 'merged' }`
- Fix 2/3/7：代码审查即可，无复杂逻辑分支

## 验收标准

- [ ] 所有 7 个 fix 已应用
- [ ] 新增测试文件覆盖 Fix 1/4/5/6
- [ ] `cd packages/brain && npm test` 全绿
- [ ] CI 全绿
